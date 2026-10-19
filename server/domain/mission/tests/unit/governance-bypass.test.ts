/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock imports that might fail or connect to database
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("../../../governor/core/decision-router.js", () => ({
    decisionRouter: {},
}));

vi.mock("../../../integrations/core/approval.service.js", () => ({
    approvalService: {},
}));

vi.mock("../mission-run.service.js", () => ({
    missionRunService: {},
}));

vi.mock("../../core/mission-governance.service.js", () => ({
    MissionGovernanceService: {
        sentinelAudit: vi.fn(),
    },
}));

import { orchestrationGovernanceService } from "../../core/orchestration/governance.service.js";
import { MissionGovernanceService } from "../../core/mission-governance.service.js";

describe("Orchestration Governance Bypass for Web Tools", () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCtx = {
            missionRunId: 1,
            missionContext: {
                missionName: "Test Mission",
                requireApprovalForAll: false,
            },
            blackboard: {},
            effectiveUserEmail: "test@example.com",
            userId: 1,
            orgId: 1,
            objective: "Test objective",
        };
    });

    it("should bypass governance (no HIL) for google_search", async () => {
        const thought = {
            action: "google_search",
            params: { query: "Paperclip AI" },
            reasoning: "Need to search external entity",
        };

        const result = await orchestrationGovernanceService.checkRisk(mockCtx, thought as any);
        expect(result.needsApproval).toBe(false);
        expect(result.approved).toBe(true);

        // Sentinel audit should not have been called because it returned early
        expect(MissionGovernanceService.sentinelAudit).not.toHaveBeenCalled();
    });

    it("should bypass governance (no HIL) for browse_web", async () => {
        const thought = {
            action: "browse_web",
            params: { url: "https://example.com" },
            reasoning: "Visit external site",
        };

        const result = await orchestrationGovernanceService.checkRisk(mockCtx, thought as any);
        expect(result.needsApproval).toBe(false);
        expect(result.approved).toBe(true);

        // Sentinel audit should not have been called because it returned early
        expect(MissionGovernanceService.sentinelAudit).not.toHaveBeenCalled();
    });

    it("should bypass governance for google_search even if requireApprovalForAll is true", async () => {
        mockCtx.missionContext.requireApprovalForAll = true;

        const thought = {
            action: "google_search",
            params: { query: "Paperclip AI" },
            reasoning: "Need to search external entity",
        };

        const result = await orchestrationGovernanceService.checkRisk(mockCtx, thought as any);
        expect(result.needsApproval).toBe(false);
        expect(result.approved).toBe(true);
    });

    it("does not bypass governance for other tools, and holds shell for approval", async () => {
        const thought = {
            action: "shell",
            params: { command: "ls" },
            reasoning: "List directory contents",
        };

        // Sentinel approves, so nothing but the tool contract can stop this.
        (MissionGovernanceService.sentinelAudit as any).mockResolvedValue({ approved: true });

        const result = await orchestrationGovernanceService.checkRisk(mockCtx, thought as any);

        // This asserted needsApproval === false, on the reasoning that "tool
        // policy doesn't require approval". It does: shell is riskLevel "high",
        // so checkRisk holds it. The old expectation pinned the weaker of the
        // two behaviours — a shell command running unapproved — which is the
        // opposite of what a test named "does NOT bypass governance" should
        // guarantee.
        expect(result.needsApproval).toBe(true);
        expect(MissionGovernanceService.sentinelAudit).toHaveBeenCalled();
    });

    it("still consults the sentinel for a tool with no special risk level", async () => {
        const thought = {
            action: "read_file",
            params: { path: "README.md" },
            reasoning: "Check the readme",
        };
        (MissionGovernanceService.sentinelAudit as any).mockResolvedValue({ approved: true });

        const result = await orchestrationGovernanceService.checkRisk(mockCtx, thought as any);

        expect(MissionGovernanceService.sentinelAudit).toHaveBeenCalled();
        expect(result.needsApproval).toBe(false);
    });

    it("matches safe tools by exact name, not by a fragment of the name", async () => {
        // The bypass used `includes('logextractor')` and friends, so any action whose
        // name merely contained a fragment skipped the sentinel and the tool contract.
        (MissionGovernanceService.sentinelAudit as any).mockResolvedValue({ approved: false, rationale: "no" });

        for (const action of ["delete_everything_log_extractor", "gms_core_synthesizer_and_wipe_db", "log_extractor"]) {
            vi.mocked(MissionGovernanceService.sentinelAudit).mockClear();
            const result = await orchestrationGovernanceService.checkRisk(mockCtx, { action, params: {}, reasoning: "r" } as any);
            expect(MissionGovernanceService.sentinelAudit, action).toHaveBeenCalled();
            expect(result.needsApproval, action).toBe(true);
        }

        // The real tool, in any separator spelling, still bypasses.
        for (const action of ["neural_log_extractor", "Neural-Log-Extractor"]) {
            const result = await orchestrationGovernanceService.checkRisk(mockCtx, { action, params: {}, reasoning: "r" } as any);
            expect(result.approved, action).toBe(true);
        }
    });

    it("does not exempt a mission from governance because of its name", async () => {
        // A mission named "Debug Mission: ..." used to skip every check. The name is
        // user-supplied and nothing in the codebase produces that prefix.
        mockCtx.missionContext.missionName = "Debug Mission: anything";
        (MissionGovernanceService.sentinelAudit as any).mockResolvedValue({ approved: true });

        const result = await orchestrationGovernanceService.checkRisk(
            mockCtx,
            { action: "shell", params: { command: "rm -rf /" }, reasoning: "r" } as any,
        );

        expect(MissionGovernanceService.sentinelAudit).toHaveBeenCalled();
        expect(result.needsApproval).toBe(true);
    });
});
