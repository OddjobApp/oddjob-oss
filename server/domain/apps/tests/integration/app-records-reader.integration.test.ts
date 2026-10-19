/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * read_app_records hands an agent an app's stored rows. The tenant boundary is
 * the whole point: a shared system row holds several orgs' records, another
 * org's install copy must never resolve, an app inside a private Project Space
 * must look absent to someone who cannot read that project — and must not be
 * read into a room of a different project even by someone who can — and
 * QuickBooks-mirrored records need the finance role the QuickBooks tools need.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users } = await import("@shared/schema/auth.js");
const { apps, appRecords, appDeployments } = await import("@shared/schema/apps.js");
const { projects, projectMembers } = await import("@shared/schema/projects.js");
const { saasConnectors } = await import("@shared/schema/integrations.js");
const { inArray, eq } = await import("drizzle-orm");
const { financeRolesService } = await import("@domain/projects/core/finance-roles.service.js");
const {
    resolveAppForRecords, listAppCollections, readAppRecords, aggregateAppRecords,
} = await import("../../core/app-records-reader.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM app_records LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[app-records-reader] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SHARED = `ledger-${stamp}`;
const ISOLATED = `notes-${stamp}`;
const PRIVATE = `vault-${stamp}`;
const DEPLOYED = `desk-${stamp}`;
const BOOKS = `books-${stamp}`;

describe.skipIf(!reachable)("app records reader", () => {
    let orgA = 0, orgB = 0, vaultProject = 0, deskProject = 0, booksProject = 0;
    const user: Record<string, string> = {};
    const appIds: number[] = [];
    const userIds: string[] = [];
    const ctx = (organizationId: number, extra: Record<string, unknown> = {}) =>
        ({ organizationId, userId: "outsider", ...extra });

    beforeAll(async () => {
        const [a] = await db.insert(orgs).values({ name: `Records A ${stamp}`, slug: `records-a-${stamp}` } as any).returning();
        const [b] = await db.insert(orgs).values({ name: `Records B ${stamp}`, slug: `records-b-${stamp}` } as any).returning();
        orgA = a.id; orgB = b.id;
        for (const who of ["owner", "ar", "audit"]) {
            const [u] = await db.insert(users).values({ username: `rec_${who}_${stamp}`, password: "x", email: `rec_${who}_${stamp}@example.test` } as any).returning();
            user[who] = String(u.id); userIds.push(String(u.id));
        }

        // A shared system row both orgs write to under their own org id.
        const [shared] = await db.insert(apps).values({ name: `Ledger ${stamp}`, slug: SHARED, isSystem: true, distribution: "standard" }).returning();
        appIds.push(shared.id);
        // Org B's own copy of a base slug org A does not have.
        const [isolated] = await db.insert(apps).values({ name: `Notes ${stamp}`, slug: `${ISOLATED}-org${orgB}`, organizationId: orgB }).returning();
        appIds.push(isolated.id);
        const [vault] = await db.insert(projects).values({ organizationId: orgA, key: `vault-${stamp}`, name: "Vault", visibility: "private", ownerUserId: user.owner, createdBy: user.owner } as any).returning();
        vaultProject = vault.id;
        const [vaultApp] = await db.insert(apps).values({ name: `Vault ${stamp}`, slug: PRIVATE, organizationId: orgA, projectId: vault.id }).returning();
        appIds.push(vaultApp.id);
        // A shared app with no project of its own, deployed by org A into a private project.
        const [desk] = await db.insert(projects).values({ organizationId: orgA, key: `desk-${stamp}`, name: "Desk", visibility: "private", ownerUserId: user.owner, createdBy: user.owner } as any).returning();
        deskProject = desk.id;
        const [deskApp] = await db.insert(apps).values({ name: `Desk ${stamp}`, slug: DEPLOYED, isSystem: true, distribution: "standard" }).returning();
        appIds.push(deskApp.id);
        await db.insert(appDeployments).values({ appId: deskApp.id, organizationId: orgA, projectId: desk.id } as any);
        // A finance app whose records mirror a QuickBooks connection owned by project Books.
        const [books] = await db.insert(projects).values({ organizationId: orgA, key: `books-${stamp}`, name: "Books", ownerUserId: user.owner, createdBy: user.owner } as any).returning();
        booksProject = books.id;
        await db.insert(projectMembers).values(["ar", "audit"].map((who) => ({ projectId: books.id, principalType: "user", principalId: user[who], role: "viewer", addedBy: user.owner })) as any);
        const ownerCtx = { organizationId: orgA, userId: user.owner };
        await financeRolesService.setRoles(ownerCtx, books.id, user.ar, ["ar"]);
        await financeRolesService.setRoles(ownerCtx, books.id, user.audit, ["audit"]);
        const [connector] = await db.insert(saasConnectors).values({ orgId: orgA, projectId: books.id, platform: "quickbooks", status: "connected", config: { realmId: "1" } } as any).returning();
        const [booksApp] = await db.insert(apps).values({ name: `Books ${stamp}`, slug: BOOKS, isSystem: true, distribution: "standard" }).returning();
        appIds.push(booksApp.id);

        const qbo = (entity: string, id: number) => `qbo:1:${connector.id}:${entity}:${id}`;
        await db.insert(appRecords).values([
            { appId: shared.id, orgId: orgA, collection: "transactions", recordId: "a1", data: { payee: "Acme", amount: 10, currency: "USD" } },
            { appId: shared.id, orgId: orgA, collection: "transactions", recordId: "a2", data: { payee: "Globex", amount: "20", currency: "USD" } },
            { appId: shared.id, orgId: orgA, collection: "transactions", recordId: "a3", data: { payee: "Acme", amount: 5, currency: "USD" } },
            { appId: shared.id, orgId: orgA, collection: "transactions", recordId: "a4", data: { payee: "Initech", amount: "n/a", currency: "USD" } },
            { appId: shared.id, orgId: orgA, collection: "fx", recordId: "x1", data: { amount: 1, currency: "USD" } },
            { appId: shared.id, orgId: orgA, collection: "fx", recordId: "x2", data: { amount: 2, currency: "EUR" } },
            { appId: shared.id, orgId: orgB, collection: "transactions", recordId: "b1", data: { payee: "Secret B", amount: 99, currency: "USD" } },
            { appId: shared.id, orgId: orgB, collection: "payroll", recordId: "b2", data: { name: "B only" } },
            { appId: isolated.id, orgId: orgB, collection: "notes", recordId: "n1", data: { text: "B's note" } },
            { appId: deskApp.id, orgId: orgA, collection: "tickets", recordId: "t1", data: { title: "Printer" } },
            { appId: booksApp.id, orgId: orgA, collection: "receivables", recordId: qbo("invoice", 1), data: { amount: 100 } },
            { appId: booksApp.id, orgId: orgA, collection: "transactions", recordId: qbo("payment", 2), data: { amount: 40 } },
            { appId: booksApp.id, orgId: orgA, collection: "transactions", recordId: qbo("purchase", 3), data: { amount: 15 } },
        ]);
    });

    afterAll(async () => {
        if (!reachable) return;
        await db.delete(apps).where(inArray(apps.id, appIds));
        await db.delete(saasConnectors).where(inArray(saasConnectors.orgId, [orgA, orgB]));
        await db.delete(projects).where(inArray(projects.organizationId, [orgA, orgB]));
        await db.delete(users).where(inArray(users.id, userIds as any));
        await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
    });

    describe("tenant and project boundaries", () => {
        it("reads an exact persisted record ID without crossing organization scope or interpreting it as SQL", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            const one = await readAppRecords(ctx(orgA), app, { collection: 'transactions', recordId: 'a1', limit: 25, offset: 0 });
            expect(one.total).toBe(1);
            expect(one.records.map(row => row.recordId)).toEqual(['a1']);
            expect((await readAppRecords(ctx(orgA), app, { collection: 'transactions', recordId: 'b1', limit: 25, offset: 0 })).total).toBe(0);
            expect((await readAppRecords(ctx(orgA), app, { collection: 'transactions', recordId: "a1' OR 1=1 --", limit: 25, offset: 0 })).total).toBe(0);
        });
        it("reads only the caller's records from a shared row", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            const collections = await listAppCollections(app.id, orgA);
            expect(collections.map((c) => [c.collection, c.records])).toEqual([["fx", 2], ["transactions", 4]]);

            const page = await readAppRecords(ctx(orgA), app, { collection: "transactions", limit: 10, offset: 0 });
            expect(page.total).toBe(4);
            expect(page.records.map((r) => (r.data as any).payee)).not.toContain("Secret B");
        });

        it("filters on a field case-insensitively", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            const page = await readAppRecords(ctx(orgA), app, { collection: "transactions", filterField: "payee", filterValue: "acme", limit: 10, offset: 0 });
            expect(page.records.map((r) => r.recordId).sort()).toEqual(["a1", "a3"]);
        });

        it("never resolves another org's install copy", async () => {
            await expect(resolveAppForRecords(ctx(orgA), ISOLATED)).rejects.toThrow(/No app/);
            await expect(resolveAppForRecords(ctx(orgA), `${ISOLATED}-org${orgB}`)).rejects.toThrow(/No app/);
            const own = await resolveAppForRecords(ctx(orgB), ISOLATED);
            expect(own.slug).toBe(`${ISOLATED}-org${orgB}`);
        });

        it("treats an app in an unreadable private project as absent", async () => {
            await expect(resolveAppForRecords(ctx(orgA), PRIVATE)).rejects.toThrow(/No app/);
            expect((await resolveAppForRecords(ctx(orgA, { userId: user.owner }), PRIVATE)).slug).toBe(PRIVATE);
        });

        it("gates on the deployment's project when the app row has none", async () => {
            await expect(resolveAppForRecords(ctx(orgA), DEPLOYED)).rejects.toThrow(/No app/);
            expect((await resolveAppForRecords(ctx(orgA, { userId: user.owner }), DEPLOYED)).slug).toBe(DEPLOYED);
        });

        it("will not read a private project's app into a room of another project", async () => {
            const owner = { userId: user.owner };
            await expect(resolveAppForRecords(ctx(orgA, { ...owner, roomProjectId: booksProject }), PRIVATE))
                .rejects.toThrow(/private Project Space other than this room's/);
            await expect(resolveAppForRecords(ctx(orgA, { ...owner, roomProjectId: null }), PRIVATE))
                .rejects.toThrow(/private Project Space other than this room's/);
            expect((await resolveAppForRecords(ctx(orgA, { ...owner, roomProjectId: vaultProject }), PRIVATE)).slug).toBe(PRIVATE);
            expect((await resolveAppForRecords(ctx(orgA, { ...owner, roomProjectId: deskProject }), DEPLOYED)).slug).toBe(DEPLOYED);
        });

        it("rejects collection and field names that are not identifiers", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            await expect(readAppRecords(ctx(orgA), app, { collection: "x' OR 1=1", limit: 5, offset: 0 })).rejects.toThrow(/Invalid collection/);
            await expect(readAppRecords(ctx(orgA), app, { collection: "transactions", filterField: "a->>b", filterValue: "x", limit: 5, offset: 0 })).rejects.toThrow(/Invalid filter field/);
        });
    });

    describe("QuickBooks-mirrored records", () => {
        it("marks mirrored collections and refuses a caller with no finance role", async () => {
            const app = await resolveAppForRecords(ctx(orgA), BOOKS);
            const listed = await listAppCollections(app.id, orgA);
            expect(listed.every((c) => c.quickbooks)).toBe(true);
            await expect(readAppRecords(ctx(orgA), app, { collection: "receivables", limit: 5, offset: 0 }))
                .rejects.toThrow(/finance role|QuickBooks/);
            await expect(aggregateAppRecords(ctx(orgA), app, { collection: "receivables", op: "sum", field: "amount" }))
                .rejects.toThrow(/finance role|QuickBooks/);
        });

        it("applies the same entity matrix as the QuickBooks tools", async () => {
            const app = await resolveAppForRecords(ctx(orgA), BOOKS);
            const ar = ctx(orgA, { userId: user.ar });
            expect((await readAppRecords(ar, app, { collection: "receivables", limit: 5, offset: 0 })).total).toBe(1);
            // transactions holds a Purchase, which AR may not read.
            await expect(readAppRecords(ar, app, { collection: "transactions", limit: 5, offset: 0 })).rejects.toThrow(/Purchase/);
            const audit = ctx(orgA, { userId: user.audit });
            expect((await readAppRecords(audit, app, { collection: "transactions", limit: 5, offset: 0 })).total).toBe(2);
        });
    });

    describe("aggregates", () => {
        it("sums numeric values, skipping and counting the rest", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            const r = await aggregateAppRecords(ctx(orgA), app, { collection: "transactions", op: "sum", field: "amount" });
            expect(r).toMatchObject({ matched: 4, counted: 3, value: 35 });
        });

        it("groups by a field, largest first", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            const r = await aggregateAppRecords(ctx(orgA), app, { collection: "transactions", op: "sum", field: "amount", groupBy: "payee" });
            expect(r.groups?.slice(0, 2)).toEqual([
                { key: "Globex", value: 20, counted: 1 },
                { key: "Acme", value: 15, counted: 2 },
            ]);
            expect(r.totalGroups).toBe(3);
        });

        it("refuses to sum across currencies unless grouped or filtered by one", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            await expect(aggregateAppRecords(ctx(orgA), app, { collection: "fx", op: "sum", field: "amount" })).rejects.toThrow(/2 currencies/);
            const byCurrency = await aggregateAppRecords(ctx(orgA), app, { collection: "fx", op: "sum", field: "amount", groupBy: "currency" });
            expect(byCurrency.groups?.map((g) => [g.key, g.value])).toEqual([["EUR", 2], ["USD", 1]]);
            const usd = await aggregateAppRecords(ctx(orgA), app, { collection: "fx", op: "sum", field: "amount", filterField: "currency", filterValue: "usd" });
            expect(usd.value).toBe(1);
        });

        it("counts without a field and rejects an unknown op", async () => {
            const app = await resolveAppForRecords(ctx(orgA), SHARED);
            expect((await aggregateAppRecords(ctx(orgA), app, { collection: "transactions", op: "count" })).value).toBe(4);
            await expect(aggregateAppRecords(ctx(orgA), app, { collection: "transactions", op: "drop" as any, field: "amount" })).rejects.toThrow(/Unsupported/);
        });
    });
});
