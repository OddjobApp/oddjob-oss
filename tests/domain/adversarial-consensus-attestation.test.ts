import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    adversarialConsensusService,
    type AttestationToken,
    type ConsensusDeliberationResult,
} from "@server/domain/governance/core/adversarial-consensus.service.js";
import {
    CopilotGovernanceGuard,
    type CopilotGovernanceContext,
} from "@server/domain/governance/copilot-governance.guard.js";
import {
    AutonomousLifecycleManager,
    type TaskManifest,
} from "@server/domain/ai/core/autonomous-lifecycle.service.js";
import { CONSENSUS_TOOLS } from "@server/domain/tools/v1/capabilities/consensus-tools.js";

// Mock Sentinel and Budget services for autonomous lifecycle tests
vi.mock("@domain/mission/core/sentinel-service.js", () => ({
    SentinelService: {
        logSuccess: vi.fn().mockResolvedValue(undefined),
        logFailure: vi.fn().mockResolvedValue(undefined),
        getSkillHealth: vi.fn().mockResolvedValue({ reliabilityIndex: 95, totalRuns: 20 }),
    },
}));

vi.mock("@domain/governor/core/budget-governance.service.js", () => ({
    BudgetGovernanceService: {
        checkAgentSalary: vi.fn().mockResolvedValue({ allowed: true }),
        recordSpend: vi.fn().mockResolvedValue(undefined),
    },
}));

describe("Superagent Phase IV: Adversarial Consensus & Cryptographic Attestation Protocol", () => {
    const mockContext = {
        organizationId: 101,
        sessionId: "session-superagent-attestation-test",
        evidence: ["e2e-canary-pass.log", "benchmark-latency-ok.json"],
    };

    describe("1. Tripartite Adversarial Deliberation & Scoring", () => {
        it("approves safe production operations with all 3 personas participating", async () => {
            const safePayload = {
                targetService: "auth-worker",
                hasRollbackPlan: true,
                rollbackStrategy: "blue-green",
                blastRadius: 0.05,
                anonymized: true,
            };

            const result = await adversarialConsensusService.deliberate(
                "deploy_production",
                safePayload,
                mockContext
            );

            expect(result.decision).toBe("approved");
            expect(result.hasVeto).toBe(false);
            expect(result.consensusScore).toBeGreaterThanOrEqual(0.75);
            expect(result.votes.length).toBe(3);

            const roles = result.votes.map((v) => v.role);
            expect(roles).toContain("LeadArchitect");
            expect(roles).toContain("ComplianceSentinel");
            expect(roles).toContain("DevilsAdvocate");
        });

        it("Lead Architect vetoes destructive schema drop operations", async () => {
            const destructivePayload = {
                command: "DROP TABLE users_historical CASCADE",
                hasRollbackPlan: false,
            };

            const result = await adversarialConsensusService.deliberate(
                "drop_table",
                destructivePayload,
                mockContext
            );

            expect(result.decision).toBe("vetoed");
            expect(result.hasVeto).toBe(true);
            expect(result.vetoReasons.some((r) => r.toLowerCase().includes("destructive"))).toBe(true);

            const architectVote = result.votes.find((v) => v.role === "LeadArchitect");
            expect(architectVote?.decision).toBe("veto");
        });

        it("Compliance Sentinel vetoes actions that disable RBAC or multi-tenant isolation", async () => {
            const roguePayload = {
                disableRbac: true,
                overrideTenantIsolation: true,
                reason: "Quick debug in production",
            };

            const result = await adversarialConsensusService.deliberate(
                "override_guardrail",
                roguePayload,
                mockContext
            );

            expect(result.decision).toBe("vetoed");
            expect(result.hasVeto).toBe(true);
            expect(result.vetoReasons.some((r) => r.toLowerCase().includes("multi-tenant"))).toBe(true);

            const complianceVote = result.votes.find((v) => v.role === "ComplianceSentinel");
            expect(complianceVote?.decision).toBe("veto");
        });

        it("Devil's Advocate vetoes actions exceeding safe blast radius threshold (>50%)", async () => {
            const highBlastPayload = {
                targetCluster: "all-regions",
                blastRadius: 0.85,
                hasRollbackPlan: true,
            };

            const result = await adversarialConsensusService.deliberate(
                "deploy_production",
                highBlastPayload,
                mockContext
            );

            expect(result.decision).toBe("vetoed");
            expect(result.hasVeto).toBe(true);
            expect(result.vetoReasons.some((r) => r.toLowerCase().includes("blast radius"))).toBe(true);

            const devilsVote = result.votes.find((v) => v.role === "DevilsAdvocate");
            expect(devilsVote?.decision).toBe("veto");
        });
    });

    describe("2. Cryptographic HMAC Attestation Token Generation & Verification", () => {
        const approvedPayload = {
            service: "billing-api",
            version: "v2.14.0",
            hasRollbackPlan: true,
            blastRadius: 0.1,
        };

        let deliberation: ConsensusDeliberationResult;

        beforeEach(async () => {
            deliberation = await adversarialConsensusService.deliberate(
                "deploy_production",
                approvedPayload,
                mockContext
            );
        });

        it("mints a valid HMAC-SHA256 attestation token upon approval", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation,
                undefined,
                "cluster://prod-us-east-1"
            );

            expect(token.tokenVersion).toBe("v1");
            expect(token.action).toBe("deploy_production");
            expect(token.targetResource).toBe("cluster://prod-us-east-1");
            expect(token.payloadHash).toBeTruthy();
            expect(token.signature).toHaveLength(64); // 32-byte sha256 hex
            expect(token.voterRoles).toEqual(["LeadArchitect", "ComplianceSentinel", "DevilsAdvocate"]);
            expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
        });

        it("refuses to mint attestation token for vetoed deliberations", () => {
            const vetoedDeliberation: ConsensusDeliberationResult = {
                ...deliberation,
                decision: "vetoed",
                hasVeto: true,
            };

            expect(() => {
                adversarialConsensusService.generateAttestationToken(
                    "deploy_production",
                    approvedPayload,
                    vetoedDeliberation
                );
            }).toThrow(/Cannot mint attestation token: deliberation was vetoed/);
        });

        it("verifies a valid attestation token against expected action and payload", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation
            );

            const verification = adversarialConsensusService.verifyAttestationToken(
                token,
                "deploy_production",
                approvedPayload
            );

            expect(verification.valid).toBe(true);
            expect(verification.reason).toBeUndefined();
        });

        it("rejects token when action does not match expected action", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation
            );

            const verification = adversarialConsensusService.verifyAttestationToken(
                token,
                "mutate_production_db", // Mismatch
                approvedPayload
            );

            expect(verification.valid).toBe(false);
            expect(verification.reason).toContain("does not match expected");
        });

        it("rejects token when payload has been tampered with after signing", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation
            );

            const tamperedPayload = {
                ...approvedPayload,
                blastRadius: 0.99, // Tampered!
            };

            const verification = adversarialConsensusService.verifyAttestationToken(
                token,
                "deploy_production",
                tamperedPayload
            );

            expect(verification.valid).toBe(false);
            expect(verification.reason).toContain("payloadHash mismatch");
        });

        it("rejects token with forged cryptographic signature", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation
            );

            const forgedToken: AttestationToken = {
                ...token,
                signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            };

            const verification = adversarialConsensusService.verifyAttestationToken(
                forgedToken,
                "deploy_production",
                approvedPayload
            );

            expect(verification.valid).toBe(false);
            expect(verification.reason).toContain("Cryptographic signature validation failed");
        });

        it("rejects expired attestation token", () => {
            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                approvedPayload,
                deliberation
            );

            // Force expiration in the past
            const expiredToken: AttestationToken = {
                ...token,
                expiresAt: new Date(Date.now() - 10000).toISOString(),
            };

            const verification = adversarialConsensusService.verifyAttestationToken(
                expiredToken,
                "deploy_production",
                approvedPayload
            );

            expect(verification.valid).toBe(false);
            expect(verification.reason).toContain("expired");
        });
    });

    describe("3. CopilotGovernanceGuard Attestation Protocol Integration", () => {
        const testPayload = { service: "search-indexer", rollbackStrategy: "canary", hasRollbackPlan: true };

        it("permits high-risk actions when a valid attestation token is provided", async () => {
            const deliberation = await adversarialConsensusService.deliberate(
                "deploy_production",
                testPayload,
                mockContext
            );

            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                testPayload,
                deliberation
            );

            const result = CopilotGovernanceGuard.validateAction("deploy_production", {
                userRoles: ["operations-supervisor"],
                evidenceProvided: true,
                attestationToken: token,
                payload: testPayload,
                requireAttestation: true,
            });

            expect(result.allowed).toBe(true);
        });

        it("blocks high-risk actions when requireAttestation is true but token is omitted", () => {
            const result = CopilotGovernanceGuard.validateAction("deploy_production", {
                userRoles: ["operations-supervisor"],
                evidenceProvided: true,
                requireAttestation: true,
            });

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("requires a valid cryptographic AttestationToken");
        });

        it("blocks high-risk actions when provided attestation token fails verification", async () => {
            const deliberation = await adversarialConsensusService.deliberate(
                "deploy_production",
                testPayload,
                mockContext
            );

            const token = adversarialConsensusService.generateAttestationToken(
                "deploy_production",
                testPayload,
                deliberation
            );

            // Attempt to use token on a different action without re-deliberating
            const result = CopilotGovernanceGuard.validateAction("mutate_production_db", {
                userRoles: ["operations-supervisor"],
                evidenceProvided: true,
                attestationToken: token,
                payload: testPayload,
            });

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Attestation verification failed");
        });

        it("maintains backward compatibility when attestation is not required", () => {
            const result = CopilotGovernanceGuard.validateAction("deploy_production", {
                userRoles: ["operations-supervisor"],
                evidenceProvided: true,
            });

            expect(result.allowed).toBe(true);
        });
    });

    describe("4. AutonomousLifecycleManager Deliberation Guard", () => {
        it("intercepts high-risk destructive steps in alert() via adversarial consensus veto", async () => {
            const manager = new AutonomousLifecycleManager(
                "session-lifecycle-attestation-test",
                88,
                undefined,
                undefined,
                "gemini-1.5-pro",
                101
            );

            const destructiveStep: TaskManifest["steps"][0] = {
                id: "step-drop",
                description: "Purge production table",
                tool: "drop_table",
                params: { table: "customers_archive", cascade: true },
                hypothesis: "Table is purged immediately",
                completionCriteria: ["Table dropped"],
                risk: "high",
                status: "pending",
                dependencies: [],
            };

            const alertResult = await manager.alert(destructiveStep);

            expect(alertResult.proceed).toBe(false);
            expect(alertResult.reason).toContain("Adversarial Consensus Veto");
        });
    });

    describe("5. Tool Layer: request_adversarial_consensus & verify_action_attestation", () => {
        it("request_adversarial_consensus tool executes deliberation and mints token", async () => {
            const tool = CONSENSUS_TOOLS.request_adversarial_consensus;
            const payload = {
                targetService: "notification-mesh",
                hasRollbackPlan: true,
                blastRadius: 0.05,
            };

            const rawResult = await tool.execute(
                {
                    action: "deploy_production",
                    payload,
                    mintToken: true,
                },
                { organizationId: 101, sessionId: "tool-test-session" }
            );

            const result = JSON.parse(rawResult);
            expect(result.success).toBe(true);
            expect(result.decision).toBe("approved");
            expect(result.attestationToken).toBeDefined();
            expect(result.attestationToken.signature).toBeTruthy();
        });

        it("verify_action_attestation tool validates authentic token and catches tampered token", async () => {
            const requestTool = CONSENSUS_TOOLS.request_adversarial_consensus;
            const verifyTool = CONSENSUS_TOOLS.verify_action_attestation;

            const payload = { targetService: "auth-gateway", hasRollbackPlan: true, blastRadius: 0.02 };
            const reqRaw = await requestTool.execute({
                action: "deploy_production",
                payload,
                mintToken: true,
            });
            const reqData = JSON.parse(reqRaw);

            // 1. Verify valid token
            const verifyRawValid = await verifyTool.execute({
                token: reqData.attestationToken,
                expectedAction: "deploy_production",
                expectedPayload: payload,
            });
            const verifyValid = JSON.parse(verifyRawValid);
            expect(verifyValid.valid).toBe(true);

            // 2. Verify tampered payload
            const verifyRawTampered = await verifyTool.execute({
                token: reqData.attestationToken,
                expectedAction: "deploy_production",
                expectedPayload: { ...payload, blastRadius: 0.99 },
            });
            const verifyTampered = JSON.parse(verifyRawTampered);
            expect(verifyTampered.valid).toBe(false);
            expect(verifyTampered.reason).toContain("payloadHash mismatch");
        });
    });
});
