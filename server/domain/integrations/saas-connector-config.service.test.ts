// @vitest-environment node
/**
 * upsertEventWorkflow must not store a numeric workflow id that names another
 * org's mission: the orchestrator launches that id as `system` and
 * launchMission loads missions by id alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
    const selects: unknown[][] = [];
    const writes: Array<{ op: string; values?: unknown }> = [];
    const chain = (result: unknown) => {
        const c: any = {};
        for (const m of ["from", "where", "limit", "set", "orderBy"]) c[m] = () => c;
        c.values = (values: unknown) => { writes[writes.length - 1].values = values; return c; };
        c.returning = () => Promise.resolve([{ id: 99 }]);
        c.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
        return c;
    };
    const db = {
        select: () => chain(selects.shift() ?? []),
        insert: () => { writes.push({ op: "insert" }); return chain([]); },
        update: () => { writes.push({ op: "update" }); return chain([]); },
    };
    return { selects, writes, db };
});

vi.mock("@server/database_service.js", () => ({ db: fake.db }));

import { saasConnectorConfigService } from "./saas-connector-config.service";

const input = (workflowId: string) => ({ triggerEvent: "issue_created", workflowId });

beforeEach(() => {
    fake.selects.length = 0;
    fake.writes.length = 0;
});

describe("upsertEventWorkflow", () => {
    it("refuses a numeric id that is not a mission in the caller's org, and writes nothing", async () => {
        fake.selects.push([]); // mission lookup scoped to org: no row
        const result = await saasConnectorConfigService.upsertEventWorkflow(5, "jira", input("123"));
        expect(result).toEqual({ ok: false, failure: "mission-not-found" });
        expect(fake.writes).toEqual([]);
    });

    it("stores a numeric id that is a mission in the caller's org, stamped with that org", async () => {
        fake.selects.push([{ id: 123 }], []); // mission found; no existing workflow
        const result = await saasConnectorConfigService.upsertEventWorkflow(5, "jira", input("123"));
        expect(result.ok).toBe(true);
        expect(fake.writes).toEqual([{ op: "insert", values: expect.objectContaining({ orgId: 5, workflowId: "123", platform: "jira" }) }]);
    });

    it("stores a free-text descriptor without a mission lookup, as before", async () => {
        fake.selects.push([]); // existing-workflow lookup only
        const result = await saasConnectorConfigService.upsertEventWorkflow(5, "jira", input("ESCALATE_P1"));
        expect(result.ok).toBe(true);
        expect(fake.selects).toEqual([]);
        expect(fake.writes[0].op).toBe("insert");
    });

    it("updates the existing workflow instead of inserting a duplicate", async () => {
        fake.selects.push([{ id: 123 }], [{ id: 7 }]);
        await saasConnectorConfigService.upsertEventWorkflow(5, "jira", input("123"));
        expect(fake.writes.map((w) => w.op)).toEqual(["update"]);
    });
});
