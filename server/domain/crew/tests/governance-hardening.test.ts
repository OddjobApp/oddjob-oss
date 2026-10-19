import { describe, it, expect } from "vitest";
import { GovernanceProxyService } from "../../ai/core/governance-proxy.service.js";

describe("Governance Hardening & Quorum Invariants (Hardening Sprint 1)", () => {
    it("enforces separation of duties and rejects self-approval", () => {
        const evaluation = GovernanceProxyService.evaluateAction({
            actionKey: "alter_production_table",
            targetResource: "prod/users/schema.sql",
            agentName: "AutonomousAgent42",
            requesterId: 101,
        });

        expect(evaluation.decision).toBe("require_approval");
        expect(evaluation.nonce).toBeDefined();

        // 1. Same user/agent tries to approve their own request -> Fails
        const selfApproval = GovernanceProxyService.validateApproval({
            evaluationId: evaluation.evaluationId,
            requesterId: 101,
            approverId: 101,
            expiresAt: evaluation.expiresAt,
            nonce: evaluation.nonce,
        });

        expect(selfApproval.isValid).toBe(false);
        expect(selfApproval.error).toContain("Separation of Duties violation");

        // 2. Different human approver approves -> Succeeds
        const validApproval = GovernanceProxyService.validateApproval({
            evaluationId: evaluation.evaluationId,
            requesterId: 101,
            approverId: 202, // Different user
            expiresAt: evaluation.expiresAt,
            nonce: evaluation.nonce,
        });

        expect(validApproval.isValid).toBe(true);
    });

    it("enforces 15-minute TTL expiration on approval tokens", () => {
        const expiredTimestamp = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute in the past

        const result = GovernanceProxyService.validateApproval({
            evaluationId: "gov-eval-expired",
            requesterId: 101,
            approverId: 202,
            expiresAt: expiredTimestamp,
            nonce: "test-nonce-123",
        });

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("Approval token expired");
    });

    it("blocks path traversal outside sandbox boundaries", () => {
        const sandboxRoot = process.cwd();

        // 1. Safe relative path
        expect(GovernanceProxyService.validateResourcePath("client/src/App.tsx", sandboxRoot)).toBe(true);

        // 2. Traversal attempt out of root
        expect(GovernanceProxyService.validateResourcePath("../../../Windows/System32/cmd.exe", sandboxRoot)).toBe(false);
    });
});
