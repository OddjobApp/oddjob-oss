/** @vitest-environment node */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * QuickBooks finance roles against a real database: an owner assigns them, the
 * tools refuse a member without the permission before QuickBooks is contacted,
 * a void is routed to the project's Executives, and the approval gate refuses
 * an unqualified approver before the decision is recorded. QuickBooks itself is
 * replaced by a client that answers at once.
 */

configureTestEnvironment();

const qb = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@domain/integrations/quickbooks/service.js", async (importOriginal) => {
    const original = await importOriginal<any>();
    const client = {
        realmId: "123",
        company: async () => ({ CompanyName: "Books Co", HomeCurrency: { value: "USD" } }),
        get: async (entity: string, id: string) => {
            qb.calls.push(`get ${entity} ${id}`);
            if (entity === "Customer") return { Id: id, DisplayName: "Acme", Active: true };
            if (entity === "Item") return { Id: id, Active: true };
            if (entity === "Invoice") return { Id: id, DocNumber: "1001", TotalAmt: 50, Balance: 50, SyncToken: "0", CustomerRef: { value: "7", name: "Acme" } };
            return null;
        },
        list: async () => ({ items: [], nextStart: null }),
        voidInvoice: async (id: string) => { qb.calls.push(`void ${id}`); return { Id: id, TotalAmt: 0 }; },
        createInvoice: async () => { qb.calls.push("create invoice"); return { Id: "900", SyncToken: "0" }; },
    };
    return { ...original, getQuickBooksClient: async () => { qb.calls.push("client"); return { connectorId: 1, client }; }, upsertSyncLink: async () => ({}) };
});

const { db } = await import("@server/database_service.js");
const { orgs, users } = await import("@shared/schema/auth.js");
const { approvalRequests } = await import("@shared/schema/index.js");
const { projects, projectMembers } = await import("@shared/schema/projects.js");
const { financeRolesService, executiveApproverAddress } = await import("../../core/finance-roles.service.js");
const { projectService } = await import("../../core/project.service.js");
const { QUICKBOOKS_TOOLS } = await import("@domain/tools/v1/capabilities/quickbooks.js");
const { approvalService } = await import("@domain/integrations/core/approval.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM project_finance_roles LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[finance-roles] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("QuickBooks finance roles", () => {
    let orgId: number, projectId: number, projectKey: string;
    const ids: Record<string, string> = {};
    const ctx = (who: string) => ({ organizationId: orgId, userId: ids[who], isSuperAdmin: false, isOrgAdmin: false }) as any;
    const tool = (who: string) => ({ organizationId: orgId, projectId, userId: ids[who] }) as any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Finance ${stamp}`, slug: `finance-${stamp}` } as any).returning();
        orgId = org.id;
        for (const who of ["owner", "ar", "exec", "exec2", "member", "outsider"]) {
            const [u] = await db.insert(users).values({ username: `fin_${who}_${stamp}`, password: "not-a-real-password", email: `fin_${who}_${stamp}@example.test` } as any).returning();
            ids[who] = String(u.id);
        }
        projectKey = `books-${stamp}`;
        const [p] = await db.insert(projects).values({ organizationId: orgId, key: projectKey, name: "Books", ownerUserId: ids.owner, createdBy: ids.owner } as any).returning();
        projectId = p.id;
        await db.insert(projectMembers).values(["ar", "exec", "exec2", "member"].map(who => ({
            projectId, principalType: "user", principalId: ids[who], role: who === "member" ? "viewer" : "editor", addedBy: ids.owner,
        })));
    });

    it("lets only the project owner assign finance roles, and only to members", async () => {
        await expect(financeRolesService.setRoles(ctx("ar"), projectKey, ids.ar, ["ar"])).rejects.toThrow("Only an owner");
        await expect(financeRolesService.setRoles(ctx("owner"), projectKey, ids.outsider, ["audit"])).rejects.toThrow("Add this person");
        await expect(financeRolesService.setRoles(ctx("owner"), projectKey, ids.ar, ["admin"])).rejects.toThrow("roles must be");
        await financeRolesService.setRoles(ctx("owner"), projectKey, ids.ar, ["ar"]);
        await financeRolesService.setRoles(ctx("owner"), projectKey, ids.exec, ["executive"]);
        await financeRolesService.setRoles(ctx("owner"), projectKey, ids.exec2, ["ar", "executive"]);
        const listed = await financeRolesService.listForProject(ctx("owner"), projectKey);
        expect(listed.canManage).toBe(true);
        expect(listed.members.find(m => m.userId === ids.ar)?.financeRoles).toEqual(["ar"]);
        expect((await financeRolesService.listForProject(ctx("member"), projectKey)).canManage).toBe(false);
    });

    it("refuses a member with no finance role before QuickBooks is contacted", async () => {
        qb.calls.length = 0;
        await expect(QUICKBOOKS_TOOLS.quickbooks_get_company.execute({}, tool("member"))).rejects.toThrow("needs a finance role");
        await expect(QUICKBOOKS_TOOLS.quickbooks_list_records.execute({ entity: "Invoice" }, tool("member"))).rejects.toThrow("cannot read");
        await expect(QUICKBOOKS_TOOLS.quickbooks_propose_invoice.execute({ customer_id: "7", txn_date: "2026-10-01", lines: [{ item_id: "3", quantity: 1, unit_price: 50 }] }, tool("member"))).rejects.toThrow("cannot create");
        expect(qb.calls).toEqual([]);
    });

    it("says what would allow a refused call, and who can grant it", async () => {
        const refused = (who: string, extra = {}) => QUICKBOOKS_TOOLS.quickbooks_list_records.execute({ entity: "Invoice" }, { ...tool(who), ...extra }).catch((e: any) => e);

        // A member: the steps are connecting QuickBooks and the role, and the owner grants them.
        const member = await refused("member");
        expect(member.permission).toMatchObject({
            type: "permission_required", action: "read QuickBooks Invoice records",
            project: { id: projectId, key: projectKey, name: "Books" }, organizationId: orgId,
            grantedBy: `the project owner (fin_owner_${stamp})`, callerCanGrant: false,
            steps: [{ id: "connect", done: false }, { id: "grant", done: false }],
        });
        expect(member.permission.allowedRoles).toContain("Accounts receivable");
        expect(member.message).toContain(`ask the project owner (fin_owner_${stamp})`);

        // Someone outside the project must also be added before a role can count.
        expect((await refused("outsider")).permission.steps.map((s: any) => s.id)).toEqual(["connect", "join", "grant"]);

        // An org admin can take every step, so the card links them to do it.
        const admin = await refused("outsider", { isOrgAdmin: true });
        expect(admin.permission).toMatchObject({ callerCanGrant: true, manageHref: `/projects/${projectKey}?tab=integrations&orgId=${orgId}` });
    });

    it("keeps AR to its side of the books", async () => {
        await expect(QUICKBOOKS_TOOLS.quickbooks_list_records.execute({ entity: "Bill" }, tool("ar"))).rejects.toThrow("Accounts payable");
        await expect(QUICKBOOKS_TOOLS.quickbooks_get_report.execute({ report: "ProfitAndLoss" }, tool("ar"))).rejects.toThrow("Audit or Executive");
        const readable = await financeRolesService.readableEntities(orgId, ids.ar);
        expect(readable(projectId)("Invoice")).toBe(true);
        expect(readable(projectId)("Bill")).toBe(false);
        expect(readable(null)("Vendor")).toBe(false);
    });

    it("routes an invoice to its proposer and executes it on their approval", async () => {
        const card = JSON.parse(await QUICKBOOKS_TOOLS.quickbooks_propose_invoice.execute({ customer_id: "7", txn_date: "2026-10-01", lines: [{ item_id: "3", quantity: 1, unit_price: 50 }] }, tool("ar")));
        const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, card.proposalId));
        expect(request.approverId).toBe(ids.ar);
        expect(request.approverEmail).toBe(ids.ar);
        expect((request.toolArgs as any)).toMatchObject({ permissionProjectId: projectId, proposedBy: ids.ar, needsExecutiveApproval: false });
        qb.calls.length = 0;
        await approvalService.processDecision(card.proposalId, { decision: "approved" }, ids.ar, request.approverEmail);
        expect(qb.calls).toContain("create invoice");
    });

    it("refuses an approver whose finance role was revoked, and leaves the request pending", async () => {
        const card = JSON.parse(await QUICKBOOKS_TOOLS.quickbooks_propose_invoice.execute({ customer_id: "7", txn_date: "2026-10-02", lines: [{ item_id: "3", quantity: 1, unit_price: 20 }] }, tool("ar")));
        await financeRolesService.setRoles(ctx("owner"), projectKey, ids.ar, []);
        await expect(approvalService.processDecision(card.proposalId, { decision: "approved" }, ids.ar, ids.ar)).rejects.toThrow("finance role");
        const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, card.proposalId));
        expect(request.status).toBe("pending");
        await approvalService.processDecision(card.proposalId, { decision: "rejected" }, ids.ar, ids.ar);
        await financeRolesService.setRoles(ctx("owner"), projectKey, ids.ar, ["ar"]);
    });

    it("sends a void to the project's Executives, never back to its proposer", async () => {
        const card = JSON.parse(await QUICKBOOKS_TOOLS.quickbooks_propose_void_invoice.execute({ invoice_id: "55" }, tool("exec2")));
        const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, card.proposalId));
        expect(request.approverEmail).toBe(executiveApproverAddress(projectId));
        expect(card.needsExecutiveApproval).toBe(true);

        // AR holds the void permission but is not an Executive; exec2 is an Executive but asked for it.
        await expect(approvalService.processDecision(card.proposalId, { decision: "approved" }, ids.ar, "")).rejects.toThrow("designated approver");
        await expect(approvalService.processDecision(card.proposalId, { decision: "approved" }, ids.exec2, "")).rejects.toThrow("other than the person who asked");

        const inbox = await approvalService.listPending(ids.exec, `fin_exec_${stamp}@example.test`, { organizationId: orgId });
        expect(inbox.some((r: any) => (r.approval?.id ?? r.id) === card.proposalId)).toBe(true);

        qb.calls.length = 0;
        await approvalService.processDecision(card.proposalId, { decision: "approved" }, ids.exec, "");
        expect(qb.calls).toContain("void 55");
    });

    it("ends a member's finance roles when they leave the project", async () => {
        await projectService.removeMember(ctx("owner"), projectKey, "user", ids.ar);
        expect(await financeRolesService.rolesFor(orgId, projectId, ids.ar)).toEqual([]);
    });
});
