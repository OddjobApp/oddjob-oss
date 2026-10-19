import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The scoping decision, tested without a database.
 *
 * What matters is the predicate this layer builds, so `db` is stubbed and the
 * assertions read the `where` clause it was handed. A test that needed Postgres
 * would not run in the unit gate, which is where a tenant-scoping regression
 * has to be caught.
 */

const captured: { where: any; table: any; values?: any; op?: string }[] = [];

function chain(rows: any[]) {
    const api: any = {
        from(table: any) { captured[captured.length - 1].table = table; return api; },
        where(w: any) { captured[captured.length - 1].where = w; return api; },
        orderBy() { return api; },
        // limit() and offset() can each end a chain or be followed by the
        // other, so they return something both awaitable and chainable.
        limit() { return Object.assign(Promise.resolve(rows), api); },
        offset() { return Object.assign(Promise.resolve(rows), api); },
        set(values: any) { captured[captured.length - 1].values = values; return api; },
        values(rows: any) { captured[captured.length - 1].values = rows; return api; },
        returning() { return Promise.resolve(rows); },
        then(onFulfilled: any) { return Promise.resolve(rows).then(onFulfilled); },
    };
    return api;
}

const rowsToReturn: { current: any[]; queue: any[][] } = { current: [], queue: [] };

/** Rows for the next call: the queue if one was staged, else `current`. */
function nextRows(): any[] {
    return rowsToReturn.queue.length > 0 ? rowsToReturn.queue.shift()! : rowsToReturn.current;
}

// `transaction` runs its callback against the same recorder, so a write inside
// replaceBlueprints is captured exactly like one outside it.
const dbStub: any = {
    select(cols?: any) { captured.push({ where: null, table: null, op: "select" }); return chain(nextRows()); },
    update(table: any) { captured.push({ where: null, table, op: "update" }); return chain(nextRows()); },
    insert(table: any) { captured.push({ where: null, table, op: "insert" }); return chain(nextRows()); },
    delete(table: any) { captured.push({ where: null, table, op: "delete" }); return chain(nextRows()); },
    transaction: async (fn: any) => fn(dbStub),
};

vi.mock("@server/database_service.js", () => ({ db: dbStub }));

const { operationalCycleAccess, operationalCycleAggregate, statusForCycleFailure, bodyForCycleFailure } =
    await import("./operational-cycle-access.service.js");

/**
 * Walks the captured Drizzle predicate and reports the columns and bound values
 * it references. Drizzle's SQL objects are circular (a column points at its
 * table, which points back), so JSON.stringify cannot be used on them.
 */
function inspect(where: any): { columns: string[]; values: unknown[] } {
    const columns: string[] = [];
    const values: unknown[] = [];
    const seen = new Set<unknown>();

    const walk = (node: any): void => {
        if (!node || typeof node !== "object" || seen.has(node)) return;
        seen.add(node);

        // A Drizzle column carries a string `name` and a `table`.
        if (typeof node.name === "string" && node.table) columns.push(node.name);
        // A bound parameter carries `value` and no further structure worth walking.
        if ("value" in node && !node.queryChunks && typeof node.name !== "string") {
            values.push(node.value);
        }

        for (const key of ["queryChunks", "left", "right", "sql", "params"]) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(walk);
            else if (child) walk(child);
        }
        if (Array.isArray(node)) node.forEach(walk);
    };

    walk(where);
    return { columns, values };
}

/** The columns a captured predicate references. */
function columnsOf(where: any): string[] {
    return inspect(where).columns;
}

/** The last captured query's predicate, for calls that make exactly one. */
function predicate(): { columns: string[]; values: unknown[] } {
    return inspect(captured[captured.length - 1]?.where);
}

/**
 * The cycle-table update replaceBlueprints makes first. Its blueprint and gate
 * writes follow in the same transaction and are keyed by cycleId, so the last
 * capture is not the one that carries the organization predicate.
 */
function cycleUpdate() {
    const row = captured.find((c) => c.op === "update");
    if (!row) throw new Error("no update was captured");
    return row;
}

const ORG_MEMBER = { organizationId: 7, isSuperAdmin: false };
const SUPER_ADMIN = { organizationId: null, isSuperAdmin: true };
const ORGLESS_ADMIN = { organizationId: null, isSuperAdmin: false };

describe("OperationalCycleAccessService scoping", () => {
    beforeEach(() => {
        captured.length = 0;
        rowsToReturn.queue = [];
        rowsToReturn.current = [{ id: 42, organizationId: 7, status: "active" }];
    });

    it("refuses a non-super-admin with no organization, without querying", async () => {
        // The bug this layer exists to stop: six route handlers wrote
        // `if (!isSuperAdmin && orgId) push(...)` with no else, so this
        // principal got `WHERE id = $1` and could mutate any tenant's cycle.
        const result = await operationalCycleAccess.find(42, ORGLESS_ADMIN);

        expect(result).toEqual({ ok: false, failure: "organization-required" });
        expect(captured).toHaveLength(0);
    });

    it("refuses the same principal on every entry point, not just reads", async () => {
        for (const call of [
            () => operationalCycleAccess.find(42, ORGLESS_ADMIN),
            () => operationalCycleAccess.findStatus(42, ORGLESS_ADMIN),
            () => operationalCycleAccess.update(42, ORGLESS_ADMIN, { status: "paused" }),
            () => operationalCycleAccess.setStatus(42, ORGLESS_ADMIN, "aborted"),
        ]) {
            const result = await call();
            expect(result.ok).toBe(false);
            expect((result as any).failure).toBe("organization-required");
        }
        expect(captured).toHaveLength(0);
    });

    it("constrains an org member's read to their organization", async () => {
        await operationalCycleAccess.find(42, ORG_MEMBER);

        expect(captured).toHaveLength(1);
        const { columns, values } = predicate();
        expect(columns).toContain("organization_id");
        expect(columns).toContain("id");
        expect(values).toContain(7);
    });

    it("does not constrain a super admin by organization", async () => {
        await operationalCycleAccess.find(42, SUPER_ADMIN);

        expect(captured).toHaveLength(1);
        const { columns } = predicate();
        expect(columns).toContain("id");
        expect(columns).not.toContain("organization_id");
    });

    it("constrains an org member's update to their organization", async () => {
        const result = await operationalCycleAccess.update(42, ORG_MEMBER, { status: "paused" });

        expect(result).toEqual({ ok: true, id: 42 });
        expect(predicate().columns).toContain("organization_id");
        expect(captured[0].op).toBe("update");
    });

    it("stamps updatedAt on every update so a caller cannot leave it stale", async () => {
        await operationalCycleAccess.update(42, ORG_MEMBER, { status: "paused" });

        expect(captured[0].values.updatedAt).toBeInstanceOf(Date);
        expect(captured[0].values.status).toBe("paused");
    });

    it("reports not-found when the row is absent or belongs to another org", async () => {
        rowsToReturn.current = [];

        expect(await operationalCycleAccess.find(42, ORG_MEMBER)).toEqual({
            ok: false,
            failure: "not-found",
        });
        expect(await operationalCycleAccess.update(42, ORG_MEMBER, { status: "x" })).toEqual({
            ok: false,
            failure: "not-found",
        });
    });

    it("leaves soft-deleted rows in scope unless asked, preserving current route behaviour", async () => {
        await operationalCycleAccess.find(42, ORG_MEMBER);
        expect(predicate().columns).not.toContain("deleted_at");

        captured.length = 0;
        await operationalCycleAccess.find(42, ORG_MEMBER, { excludeDeleted: true });
        expect(predicate().columns).toContain("deleted_at");
    });

    it("maps a refusal to the status and body the routes already returned", () => {
        expect(statusForCycleFailure("organization-required")).toBe(403);
        expect(statusForCycleFailure("not-found")).toBe(404);
        expect(bodyForCycleFailure("organization-required")).toEqual({
            error: "Organization context required",
        });
        expect(bodyForCycleFailure("not-found")).toEqual({ error: "Cycle not found" });
    });
});

describe("cycle aggregate: children are reached only through their cycle", () => {
    beforeEach(() => {
        captured.length = 0;
        rowsToReturn.queue = [];
        rowsToReturn.current = [{ id: 42, organizationId: 7, status: "active" }];
    });

    it("refuses a blueprint page for a cycle the principal cannot see, and runs no second query", async () => {
        // This is the hole this method closed. GET /:id/blueprints resolved an
        // org context, never used it, and filtered on cycleId alone, while
        // requireCycleRead establishes only that the caller is *some*
        // organization's admin. Any org admin could page any tenant's
        // blueprints by id.
        rowsToReturn.queue = [[]]; // the cycle lookup finds nothing

        const result = await operationalCycleAggregate.listBlueprintsPage(42, ORG_MEMBER, {
            limit: 50,
            offset: 0,
        });

        expect(result).toEqual({ ok: false, failure: "not-found" });
        // One query: the authorization. The blueprint read never happened.
        expect(captured).toHaveLength(1);
    });

    it("pages blueprints once the cycle is authorized", async () => {
        rowsToReturn.queue = [
            [{ id: 42, organizationId: 7 }],          // cycle
            [{ id: 1, cycleId: 42, name: "alpha" }],  // blueprints
            [{ count: 1 }],                           // total
        ];

        const result = await operationalCycleAggregate.listBlueprintsPage(42, ORG_MEMBER, {
            limit: 50,
            offset: 0,
        });

        expect(result.ok).toBe(true);
        expect((result as any).cycle.total).toBe(1);
        expect((result as any).cycle.blueprints).toHaveLength(1);
    });

    it("refuses an org-less principal before any query, on every child accessor", async () => {
        for (const call of [
            () => operationalCycleAggregate.listBlueprintsPage(42, ORGLESS_ADMIN, { limit: 10, offset: 0 }),
            () => operationalCycleAggregate.listRuns(42, ORGLESS_ADMIN, { limit: 10, offset: 0 }),
            () => operationalCycleAggregate.listBlueprints(42, ORGLESS_ADMIN),
            () => operationalCycleAggregate.findInFlightRun(42, ORGLESS_ADMIN),
            () => operationalCycleAggregate.failActiveRuns(42, ORGLESS_ADMIN),
            () => operationalCycleAggregate.findDetail(42, ORGLESS_ADMIN),
            () => operationalCycleAggregate.findBlueprintByName(42, ORGLESS_ADMIN, "alpha"),
            () => operationalCycleAggregate.setBlueprintRuntimeStatus(42, ORGLESS_ADMIN, "alpha", "completed"),
        ]) {
            const result = await call();
            expect(result.ok).toBe(false);
            expect((result as any).failure).toBe("organization-required");
        }
        expect(captured).toHaveLength(0);
    });

    it("keeps the organization predicate on mission_runs as well as authorizing the cycle", async () => {
        // mission_runs carries a denormalized organization_id, so checking both
        // means a run stamped with the wrong organization is not readable
        // through a cycle the caller does own.
        rowsToReturn.queue = [
            [{ id: 42, organizationId: 7 }], // cycle
            [],                              // runs
            [{ count: 0 }],                  // total
        ];

        await operationalCycleAggregate.listRuns(42, ORG_MEMBER, { limit: 10, offset: 0 });

        const runsQuery = captured[1];
        const columns: string[] = [];
        const seen = new Set<unknown>();
        const walk = (node: any): void => {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            if (typeof node.name === "string" && node.table) columns.push(node.name);
            for (const key of ["queryChunks", "left", "right", "sql", "params"]) {
                const child = node[key];
                if (Array.isArray(child)) child.forEach(walk);
                else if (child) walk(child);
            }
        };
        walk(runsQuery.where);

        expect(columns).toContain("cycle_id");
        expect(columns).toContain("organization_id");
    });

    it("fails a cycle's live runs with one predicate, not two written out twice", async () => {
        rowsToReturn.queue = [
            [{ id: 42, organizationId: 7 }], // cycle
            [{ id: 101 }, { id: 102 }],      // the runs it will fail
            [],                              // the update
        ];

        const result = await operationalCycleAggregate.failActiveRuns(42, ORG_MEMBER);

        expect(result).toEqual({ ok: true, cycle: [101, 102] });
        // The select and the update must share one predicate object, so the set
        // reported cannot drift from the set terminated.
        expect(captured[1].where).toBe(captured[2].where);
        expect(captured[2].op).toBe("update");
    });
});

describe("replaceBlueprints revising the cycle's own columns", () => {
    beforeEach(() => {
        captured.length = 0;
        rowsToReturn.queue = [];
        rowsToReturn.current = [{ id: 42, organizationId: 7, status: "active" }];
    });

    it("applies the whitelisted cycle fields in the same update as the blueprints", async () => {
        const result = await operationalCycleAggregate.replaceBlueprints(42, ORG_MEMBER, {
            metadata: { blueprints: [] },
            blueprints: [],
            cycle: { name: "Revised", objective: "New objective", priority: 2, budgetLimitUsd: "250.00" },
        });

        expect(result.ok).toBe(true);
        const values = captured[0].values;
        expect(values.name).toBe("Revised");
        expect(values.objective).toBe("New objective");
        expect(values.priority).toBe(2);
        expect(values.budgetLimitUsd).toBe("250.00");
    });

    it("keeps the fields it owns even if a caller passes them", async () => {
        // The spread puts caller fields first precisely so this holds.
        await operationalCycleAggregate.replaceBlueprints(42, ORG_MEMBER, {
            metadata: { real: true },
            blueprints: [{ name: "a", objective: "o", estimatedDays: 1 }],
            cycle: {
                name: "Revised",
                // Not in CycleRevisableFields; present here to prove the
                // ordering holds regardless of what reaches the object.
                ...( { metadata: { forged: true }, blueprintCount: 99, organizationId: 999 } as any ),
            },
        });

        const values = captured[0].values;
        expect(values.metadata).toEqual({ real: true });
        expect(values.blueprintCount).toBe(1);
        expect(values.updatedAt).toBeInstanceOf(Date);
    });

    it("still scopes the update by organization when revising", async () => {
        await operationalCycleAggregate.replaceBlueprints(42, ORG_MEMBER, {
            metadata: {},
            blueprints: [],
            cycle: { name: "Revised" },
        });

        // The cycle update, not the blueprint or gate writes that follow it in
        // the same transaction; those are keyed by cycleId.
        expect(columnsOf(cycleUpdate().where)).toContain("organization_id");
    });

    it("refuses an org-less principal before writing anything", async () => {
        const result = await operationalCycleAggregate.replaceBlueprints(42, ORGLESS_ADMIN, {
            metadata: {},
            blueprints: [],
            cycle: { name: "Revised" },
        });

        expect(result).toEqual({ ok: false, failure: "organization-required" });
        expect(captured).toHaveLength(0);
    });

    it("works unchanged when no cycle fields are supplied", async () => {
        const result = await operationalCycleAggregate.replaceBlueprints(42, ORG_MEMBER, {
            metadata: { x: 1 },
            blueprints: [],
        });

        expect(result.ok).toBe(true);
        expect(captured[0].values.name).toBeUndefined();
    });
});
