/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agent SaaS tools reach the sidecar only for the caller's organization. They
 * used to call it with no organization at all, and fall back to organization 1
 * for their audit records and request bodies.
 */
const mocks = vi.hoisted(() => ({ sidecarFetch: vi.fn(), audit: vi.fn() }));
vi.mock("../../integrations/sidecar-client.js", () => ({ sidecarFetch: mocks.sidecarFetch }));
vi.mock("@domain/audit/index.js", () => ({ auditService: { log: mocks.audit, logAction: mocks.audit, record: mocks.audit } }));
vi.mock("../auth.js", () => ({ requireToolPermission: () => ({ allowed: true }) }));
import { handleListSaasConnectors, handleAddJiraComment } from "./saas.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("SaaS tools and organizations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sidecarFetch.mockImplementation(async () => json({ connectors: [] }));
    });

    it("refuses to call the sidecar without an organization", async () => {
        const result = await handleListSaasConnectors({});
        expect(JSON.stringify(result)).toContain("Organization context required");
        expect(mocks.sidecarFetch).not.toHaveBeenCalled();
    });

    it("passes the caller's organization to the sidecar", async () => {
        await handleListSaasConnectors({}, { organizationId: 7 } as any);
        expect(mocks.sidecarFetch).toHaveBeenCalledWith("/api/saas/connectors", { organizationId: 7 });
    });

    it("posts a Jira comment for the caller's organization, never organization 1", async () => {
        await handleAddJiraComment({ issueKey: "OPS-1", comment: "done" }, { organizationId: 7, permissions: [] } as any);
        const [path, request] = mocks.sidecarFetch.mock.calls[0];
        expect(path).toBe("/api/saas/jira/comment");
        expect(request).toMatchObject({ organizationId: 7, method: "POST" });
        expect(JSON.stringify(request.body)).not.toContain('"organization_id":1');
    });
});
