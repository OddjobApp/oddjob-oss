import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    insertReturning: vi.fn(),
    selectLimit: vi.fn(),
    updateReturning: vi.fn(),
    discover: vi.fn(),
    run: vi.fn(),
}));

function insertQuery() {
    return {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: h.insertReturning,
    };
}

function selectQuery() {
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn(),
        limit: h.selectLimit,
    };
}

function updateQuery() {
    return {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: h.updateReturning,
    };
}

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn(insertQuery),
        select: vi.fn(selectQuery),
        update: vi.fn(updateQuery),
    },
}));
vi.mock("./capability-registry.service.js", () => ({ capabilityRegistry: { discover: h.discover } }));
vi.mock("./code-to-docs.pipeline.js", () => ({ codeToDocsPipeline: { run: h.run } }));

import { capabilityProposalService } from "./capability-proposal.service.js";

const manifest = {
    schema_version: 1,
    capability_version: "0.1.0",
    capability_id: "invoice_triage",
    metadata: { display_name: "Invoice Triage", category: "Financial Operations", description: "Triage invoices.", owner: "finance" },
    technical_spec: { inputs: { invoice: "object" }, outputs: { decision: "string" } },
    documentation_meta: { summary: "", business_use_cases: ["Triage invoices"], guardrails: ["Require review"] },
    runtime_context: { risk_profile: "Medium", execution_environment: "Host", dependencies: [] },
} as const;

describe("CapabilityProposalService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.discover.mockResolvedValue([]);
    });

    it("persists a validated non-executable proposal", async () => {
        h.insertReturning.mockResolvedValue([{ id: 7, status: "proposed", proposedManifest: manifest }]);
        const proposal = await capabilityProposalService.create(291, {
            proposedCapabilityId: "invoice_triage",
            classification: "missing",
            title: "Invoice triage",
            rationale: "Repeated manual triage",
            confidence: 80,
            source: "test",
            evidence: [{ source: "mission", summary: "Repeated manual step" }],
            proposedManifest: manifest,
            createdBy: "admin",
        });
        expect(proposal.status).toBe("proposed");
        expect(h.run).not.toHaveBeenCalled();
    });

    it("rejects a mismatched proposed manifest id", async () => {
        await expect(capabilityProposalService.create(291, {
            proposedCapabilityId: "different_id",
            classification: "missing",
            title: "Invoice triage",
            rationale: "Repeated manual triage",
            confidence: 80,
            source: "test",
            evidence: [],
            proposedManifest: manifest,
            createdBy: "admin",
        })).rejects.toThrow("must match proposedCapabilityId");
    });

    it("promotes an approved proposal through the ACDD pipeline", async () => {
        h.selectLimit.mockResolvedValue([{ id: 7, organizationId: 291, status: "proposed", proposedManifest: manifest }]);
        h.run.mockResolvedValue({ capabilityId: "invoice_triage", applied: true, revision: 1 });
        h.updateReturning.mockResolvedValue([{ id: 7, status: "promoted", proposedManifest: manifest }]);
        const proposal = await capabilityProposalService.promote(291, 7, "admin", "Approved for evaluation");
        expect(h.run).toHaveBeenCalledWith(291, manifest);
        expect(proposal.status).toBe("promoted");
    });
});

