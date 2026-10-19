import { createHash } from "node:crypto";
import {
    swissCheeseGuardrailService,
    type GuardrailContext,
    type SwissCheeseValidationResult,
} from "@domain/governor/core/swiss-cheese-guardrail.service.js";

export interface ComplianceSimulationRequest {
    scenarioId: string;
    name: string;
    targetFramework: string;
    proposedAction: string;
    riskScore?: number;
    impactedResources?: string[];
    runtimeMetrics?: { loopCount?: number; executionTimeMs?: number; circuitOpen?: boolean };
}

export interface ComplianceReceipt {
    "@context": string[];
    type: "ForensicAuditReceipt";
    receiptId: string;
    generatedAt: string;
    subject: ComplianceSimulationRequest;
    guardrail: SwissCheeseValidationResult;
    verdict: "safe_to_commit" | "requires_hil_review";
    hilRequestId?: string;
    sha256Proof: string;
}

type GuardrailRunner = typeof swissCheeseGuardrailService.validateFullPipeline;
type HilSink = (input: {
    prompt: string;
    context: Record<string, unknown>;
}) => Promise<string>;

const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
};

export function verifyComplianceReceipt(receipt: ComplianceReceipt): boolean {
    const { sha256Proof, ...unsigned } = receipt;
    return createHash("sha256").update(stableJson(unsigned)).digest("hex") === sha256Proof;
}

export class ComplianceSentinelService {
    constructor(
        private readonly runGuardrail: GuardrailRunner = swissCheeseGuardrailService.validateFullPipeline.bind(swissCheeseGuardrailService),
        private readonly createHil?: HilSink,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async collectEvidence(context: GuardrailContext) {
        const result = await this.runGuardrail(
            { purpose: "continuous compliance evidence collection", source: "compliance-sentinel" },
            "compliance_evidence_collection",
            context,
        );
        const timestamp = result.forensicAuditLog.timestamp;
        return {
            generatedAt: timestamp,
            overallRiskScore: result.overallRiskScore,
            evidence: result.layerResults.map((layer) => ({
                id: `SC-L${layer.layerNumber}-${createHash("sha256").update(`${timestamp}:${layer.layerNumber}:${layer.layerName}`).digest("hex").slice(0, 10)}`,
                source: `Swiss Cheese Layer ${layer.layerNumber}: ${layer.layerName}`,
                framework: "Oddjob Guardrail Control",
                status: layer.passed ? "verified" : "drift_detected",
                timestamp,
                confidence: Math.max(0, 1 - layer.riskScore / 100),
                hash: createHash("sha256").update(stableJson(layer)).digest("hex"),
                violations: layer.violations,
            })),
        };
    }

    async simulate(request: ComplianceSimulationRequest, context: GuardrailContext): Promise<ComplianceReceipt> {
        const guardrail = await this.runGuardrail(
            { action: request.proposedAction, resources: request.impactedResources ?? [] },
            "compliance_remediation",
            { ...context, sessionId: context.sessionId ?? `compliance-sentinel:${request.scenarioId}` },
            request.runtimeMetrics,
        );
        const escalationWorthy = !guardrail.allowed || (request.riskScore ?? 0) > 20 || guardrail.overallRiskScore >= 50;
        let hilRequestId: string | undefined;
        if (escalationWorthy && this.createHil) {
            hilRequestId = await this.createHil({
                prompt: `Review compliance remediation: ${request.name}`,
                context: { scenario: request, guardrail, source: "compliance-sentinel" },
            });
        }

        const generatedAt = this.now().toISOString();
        const unsigned = {
            "@context": ["https://www.w3.org/ns/activitystreams", "https://oddjob.ai/ns/forensic/v1"],
            type: "ForensicAuditReceipt" as const,
            receiptId: `csr-${createHash("sha256").update(`${request.scenarioId}:${generatedAt}`).digest("hex").slice(0, 16)}`,
            generatedAt,
            subject: request,
            guardrail,
            verdict: escalationWorthy ? "requires_hil_review" as const : "safe_to_commit" as const,
            ...(hilRequestId ? { hilRequestId } : {}),
        };
        return { ...unsigned, sha256Proof: createHash("sha256").update(stableJson(unsigned)).digest("hex") };
    }
}
