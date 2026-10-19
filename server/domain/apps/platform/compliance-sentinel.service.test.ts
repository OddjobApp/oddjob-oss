import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityPolicyLoader } from "@domain/governor/core/capability-policy-loader.service.js";
import {
    ComplianceSentinelService,
    verifyComplianceReceipt,
} from "./compliance-sentinel.service.js";
import { SwissCheeseGuardrailService } from "@domain/governor/core/swiss-cheese-guardrail.service.js";

describe("Compliance Sentinel operational blueprint contract", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(capabilityPolicyLoader, "has").mockReturnValue(false);
        SwissCheeseGuardrailService.clearSessionRiskHistory();
    });

    it("sources its evidence from all five live Swiss Cheese layers", async () => {
        const service = new ComplianceSentinelService();
        const result = await service.collectEvidence({ organizationId: 42 });

        expect(result.evidence).toHaveLength(5);
        expect(result.evidence.map((item) => item.source)).toEqual([
            expect.stringContaining("Layer 1"),
            expect.stringContaining("Layer 2"),
            expect.stringContaining("Layer 3"),
            expect.stringContaining("Layer 4"),
            expect.stringContaining("Layer 5"),
        ]);
        expect(result.evidence.every((item) => item.hash.length === 64)).toBe(true);
    });

    it("runs a remediation through the pipeline, escalates declared high risk to HIL, and signs the receipt", async () => {
        const hilSink = vi.fn().mockResolvedValue("731");
        const service = new ComplianceSentinelService(undefined, hilSink, () => new Date("2026-08-23T12:00:00.000Z"));
        const receipt = await service.simulate({
            scenarioId: "secret-rotation",
            name: "Rotate production database secrets",
            targetFramework: "ISO 27001 A.9.4.3",
            proposedAction: "Rotate managed credentials",
            riskScore: 28,
            impactedResources: ["db-primary"],
        }, { organizationId: 42, agentId: 9 });

        expect(receipt.guardrail.layerResults).toHaveLength(5);
        expect(receipt.verdict).toBe("requires_hil_review");
        expect(receipt.hilRequestId).toBe("731");
        expect(hilSink).toHaveBeenCalledWith(expect.objectContaining({
            context: expect.objectContaining({ source: "compliance-sentinel" }),
        }));
        expect(verifyComplianceReceipt(receipt)).toBe(true);

        receipt.subject.name = "tampered";
        expect(verifyComplianceReceipt(receipt)).toBe(false);
    });

    it("does not create HIL work for a safe low-risk remediation", async () => {
        const hilSink = vi.fn().mockResolvedValue("unused");
        const receipt = await new ComplianceSentinelService(undefined, hilSink).simulate({
            scenarioId: "tls",
            name: "Enforce TLS",
            targetFramework: "SOC2 CC6.1",
            proposedAction: "Enable TLS 1.3",
            riskScore: 12,
        }, { organizationId: 42 });

        expect(receipt.verdict).toBe("safe_to_commit");
        expect(receipt.hilRequestId).toBeUndefined();
        expect(hilSink).not.toHaveBeenCalled();
        expect(verifyComplianceReceipt(receipt)).toBe(true);
    });
});
