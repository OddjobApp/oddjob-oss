/**
 * Adversarial Consensus & Cryptographic Attestation Service
 * 
 * Orchestrates multi-agent deliberation before high-blast-radius actions
 * (e.g. production deployments, database migrations, legal exports, guardrail overrides).
 * Enforces tripartite consensus (Lead Architect, Compliance Sentinel, Devil's Advocate)
 * and signs tamper-evident cryptographic attestation tokens.
 */

import { createHmac, createHash } from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AdversarialConsensusService");

export type ConsensusRole = "LeadArchitect" | "ComplianceSentinel" | "DevilsAdvocate";

export interface PersonaVote {
    role: ConsensusRole;
    decision: "approve" | "veto" | "conditional";
    confidence: number; // 0.0 - 1.0
    riskScore: number;  // 0.0 - 1.0
    concerns: string[];
    requiredMitigations: string[];
}

export interface ConsensusDeliberationResult {
    consensusScore: number;
    decision: "approved" | "vetoed" | "conditional";
    hasVeto: boolean;
    vetoReasons: string[];
    mitigations: string[];
    votes: PersonaVote[];
    deliberatedAt: string;
}

export interface AttestationToken {
    tokenVersion: "v1";
    action: string;
    targetResource?: string;
    payloadHash: string;
    consensusScore: number;
    voterRoles: ConsensusRole[];
    issuedAt: string;
    expiresAt: string;
    signature: string;
}

export class AdversarialConsensusService {
    private static instance: AdversarialConsensusService;
    private readonly defaultSecret: string;
    private readonly tokenValidityMs: number = 1000 * 60 * 30; // 30 minutes

    private constructor() {
        this.defaultSecret = process.env.ATTESTATION_SIGNING_SECRET || "oddjob-default-attestation-secret-key-v1";
    }

    public static getInstance(): AdversarialConsensusService {
        if (!AdversarialConsensusService.instance) {
            AdversarialConsensusService.instance = new AdversarialConsensusService();
        }
        return AdversarialConsensusService.instance;
    }

    /**
     * Executes tripartite adversarial deliberation on a proposed action.
     */
    public async deliberate(
        action: string,
        payload: Record<string, any>,
        context?: { organizationId?: number; sessionId?: string; evidence?: string[] }
    ): Promise<ConsensusDeliberationResult> {
        logger.info(`[AdversarialConsensus] Starting deliberation for action "${action}" (Session: ${context?.sessionId || 'unspecified'})`);

        // Parallel evaluation by the 3 personas
        const [architectVote, complianceVote, devilsVote] = await Promise.all([
            this.evaluateArchitect(action, payload, context),
            this.evaluateCompliance(action, payload, context),
            this.evaluateDevilsAdvocate(action, payload, context),
        ]);

        const votes = [architectVote, complianceVote, devilsVote];
        const hasVeto = votes.some((v) => v.decision === "veto");
        const vetoReasons = votes
            .filter((v) => v.decision === "veto")
            .flatMap((v) => v.concerns);

        const mitigations = Array.from(new Set(votes.flatMap((v) => v.requiredMitigations)));

        // Compute weighted consensus score (0.0 to 1.0)
        // Architect 35%, Compliance 35%, Devil's Advocate 30%
        const weights: Record<ConsensusRole, number> = {
            LeadArchitect: 0.35,
            ComplianceSentinel: 0.35,
            DevilsAdvocate: 0.30,
        };

        let weightedScore = 0;
        for (const vote of votes) {
            const raw = vote.decision === "approve" ? 1.0 : vote.decision === "conditional" ? 0.6 : 0.0;
            weightedScore += raw * (weights[vote.role] || 0.33) * vote.confidence;
        }

        const normalizedScore = Math.round(weightedScore * 100) / 100;
        const isApproved = !hasVeto && normalizedScore >= 0.75;
        const isConditional = !hasVeto && normalizedScore >= 0.50 && !isApproved;

        const decision: ConsensusDeliberationResult["decision"] = hasVeto
            ? "vetoed"
            : isApproved
            ? "approved"
            : isConditional
            ? "conditional"
            : "vetoed";

        logger.info(
            `[AdversarialConsensus] Action "${action}" Deliberation: ${decision.toUpperCase()} ` +
            `(Score: ${normalizedScore}, Veto: ${hasVeto ? "YES" : "NO"})`
        );

        return {
            consensusScore: normalizedScore,
            decision,
            hasVeto,
            vetoReasons,
            mitigations,
            votes,
            deliberatedAt: new Date().toISOString(),
        };
    }

    /**
     * Mints a tamper-proof cryptographic attestation token after successful deliberation.
     */
    public generateAttestationToken(
        action: string,
        payload: Record<string, any>,
        deliberation: ConsensusDeliberationResult,
        secretKey: string = this.defaultSecret,
        targetResource?: string
    ): AttestationToken {
        if (deliberation.decision !== "approved") {
            throw new Error(`Cannot mint attestation token: deliberation was ${deliberation.decision}.`);
        }

        const payloadHash = this.computePayloadHash(payload);
        const issuedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + this.tokenValidityMs).toISOString();
        const voterRoles = deliberation.votes.map((v) => v.role);

        const signaturePayload = `${action}|${targetResource || ""}|${payloadHash}|${deliberation.consensusScore}|${issuedAt}|${expiresAt}`;
        const signature = createHmac("sha256", secretKey).update(signaturePayload).digest("hex");

        return {
            tokenVersion: "v1",
            action,
            targetResource,
            payloadHash,
            consensusScore: deliberation.consensusScore,
            voterRoles,
            issuedAt,
            expiresAt,
            signature,
        };
    }

    /**
     * Verifies the authenticity, signature, and non-expiration of an AttestationToken.
     */
    public verifyAttestationToken(
        token: AttestationToken,
        expectedAction?: string,
        expectedPayload?: Record<string, any>,
        secretKey: string = this.defaultSecret
    ): { valid: boolean; reason?: string } {
        if (!token || !token.signature) {
            return { valid: false, reason: "Missing attestation signature." };
        }

        // 1. Expiration check
        const expiryTime = new Date(token.expiresAt).getTime();
        if (Date.now() > expiryTime) {
            return { valid: false, reason: `Attestation token expired at ${token.expiresAt}.` };
        }

        // 2. Action match check
        if (expectedAction && token.action.toLowerCase() !== expectedAction.toLowerCase()) {
            return {
                valid: false,
                reason: `Attestation token action '${token.action}' does not match expected '${expectedAction}'.`,
            };
        }

        // 3. Payload integrity check
        if (expectedPayload) {
            const expectedHash = this.computePayloadHash(expectedPayload);
            if (token.payloadHash !== expectedHash) {
                return { valid: false, reason: "Attestation token payloadHash mismatch. Target payload was modified." };
            }
        }

        // 4. Cryptographic signature check
        const signaturePayload = `${token.action}|${token.targetResource || ""}|${token.payloadHash}|${token.consensusScore}|${token.issuedAt}|${token.expiresAt}`;
        const expectedSignature = createHmac("sha256", secretKey).update(signaturePayload).digest("hex");

        if (token.signature !== expectedSignature) {
            return { valid: false, reason: "Cryptographic signature validation failed. Token has been tampered with." };
        }

        return { valid: true };
    }

    public computePayloadHash(payload: Record<string, any>): string {
        const canonical = JSON.stringify(payload, Object.keys(payload).sort());
        return createHash("sha256").update(canonical).digest("hex");
    }

    // --- Persona Evaluator Implementations ---

    private async evaluateArchitect(
        action: string,
        payload: Record<string, any>,
        context?: any
    ): Promise<PersonaVote> {
        const concerns: string[] = [];
        const mitigations: string[] = [];
        let riskScore = 0.2;

        const actionLower = action.toLowerCase();
        if (actionLower.includes("drop") || actionLower.includes("truncate") || actionLower.includes("delete_all")) {
            concerns.push("Irreversible destructive schema or table deletion detected.");
            mitigations.push("Require shadow table backup before schema mutation.");
            return {
                role: "LeadArchitect",
                decision: "veto",
                confidence: 0.98,
                riskScore: 0.95,
                concerns,
                requiredMitigations: mitigations,
            };
        }

        if (actionLower.includes("deploy_production") && !payload.hasRollbackPlan) {
            concerns.push("Production deployment has no automated rollback plan declared in payload.");
            mitigations.push("Declare explicit rollbackStrategy and target revision tag.");
            riskScore = 0.6;
        }

        return {
            role: "LeadArchitect",
            decision: concerns.length > 0 ? "conditional" : "approve",
            confidence: 0.92,
            riskScore,
            concerns,
            requiredMitigations: mitigations,
        };
    }

    private async evaluateCompliance(
        action: string,
        payload: Record<string, any>,
        context?: any
    ): Promise<PersonaVote> {
        const concerns: string[] = [];
        const mitigations: string[] = [];
        let riskScore = 0.15;

        // Check for tenant or PII leakage risks
        if (payload.disableRbac === true || payload.overrideTenantIsolation === true) {
            concerns.push("Action explicitly requests disabling multi-tenant RBAC or tenant isolation.");
            return {
                role: "ComplianceSentinel",
                decision: "veto",
                confidence: 1.0,
                riskScore: 1.0,
                concerns,
                requiredMitigations: ["Multi-tenant isolation cannot be overridden."],
            };
        }

        if (action.includes("export") && payload.containsPii && !payload.anonymized) {
            concerns.push("Export payload contains un-anonymized sensitive customer information.");
            mitigations.push("Apply differential privacy or pseudonymization to exported entities.");
            riskScore = 0.65;
        }

        return {
            role: "ComplianceSentinel",
            decision: concerns.length > 0 ? "conditional" : "approve",
            confidence: 0.95,
            riskScore,
            concerns,
            requiredMitigations: mitigations,
        };
    }

    private async evaluateDevilsAdvocate(
        action: string,
        payload: Record<string, any>,
        context?: any
    ): Promise<PersonaVote> {
        const concerns: string[] = [];
        const mitigations: string[] = [];
        let riskScore = 0.3;

        // Proactive edge-case attack
        if (payload.blastRadius && payload.blastRadius > 0.5) {
            concerns.push(`Estimated blast radius (${Math.round(payload.blastRadius * 100)}%) exceeds safe threshold (50%).`);
            mitigations.push("Partition action into canary rollout waves of <= 10% blast radius.");
            return {
                role: "DevilsAdvocate",
                decision: "veto",
                confidence: 0.90,
                riskScore: 0.85,
                concerns,
                requiredMitigations: mitigations,
            };
        }

        if (!context?.evidence || context.evidence.length === 0) {
            concerns.push("Action is supported only by hypothetical assertions; zero empirical benchmark logs provided.");
            mitigations.push("Attach test run telemetry or empirical verification proof.");
            riskScore = 0.5;
        }

        return {
            role: "DevilsAdvocate",
            decision: concerns.length > 0 ? "conditional" : "approve",
            confidence: 0.88,
            riskScore,
            concerns,
            requiredMitigations: mitigations,
        };
    }
}

export const adversarialConsensusService = AdversarialConsensusService.getInstance();
