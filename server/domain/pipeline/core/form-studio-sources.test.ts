/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Records the query the service builds, and renders it the way the driver would.
const built: any[] = [];
vi.mock("@server/database_service.js", () => {
    const chain = () => {
        const self: any = {};
        for (const m of ["select", "from", "where", "orderBy", "limit"]) {
            self[m] = (...args: unknown[]) => { if (m !== "select") built.push({ m, args }); return self; };
        }
        self.then = (res: any) => { built.push({ m: "executed", query: self }); return Promise.resolve([]).then(res); };
        return self;
    };
    return { db: chain() };
});
vi.mock("./form-studio-access.js", () => ({ formProjectId: vi.fn(async () => null) }));

import { formStudioService } from "./form-studio.service.js";

const ctx = { userId: "u1", organizationId: 291, isAdmin: false, isSuperAdmin: false } as any;

describe("form studio sources", () => {
    beforeEach(() => { built.length = 0; });

    // The regression: with no project, `inProject` is the literal false, and
    // "order by false desc" is rejected by Postgres ("non-integer constant in
    // ORDER BY") - so every source search from an unscoped form failed.
    it("does not order by a constant when the form belongs to no project", async () => {
        await formStudioService.sources("", ctx, {});

        const orderBy = built.find((c) => c.m === "orderBy");
        expect(orderBy.args).toHaveLength(1);
        const rendered = new PgDialect().sqlToQuery(orderBy.args[0] as any).sql;
        expect(rendered).toContain("updated_at");
        expect(rendered).not.toMatch(/\bfalse\b/);
    });

    it("still ranks a project's own documents first when there is one", async () => {
        await formStudioService.sources("", ctx, { projectId: 7 });

        const orderBy = built.find((c) => c.m === "orderBy");
        expect(orderBy.args).toHaveLength(2);
        expect(new PgDialect().sqlToQuery(orderBy.args[0] as any).sql).toContain("project_id");
    });
});
