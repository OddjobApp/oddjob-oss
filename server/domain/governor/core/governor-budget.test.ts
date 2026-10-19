import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const whereCalls: unknown[] = [];
let total = 0;

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: (condition: unknown) => {
                    whereCalls.push(condition);
                    return Promise.resolve([{ total }]);
                },
            }),
        }),
    },
}));

import { governorService } from "./governor-service.js";

const dialect = new PgDialect();
const rendered = (condition: unknown) => dialect.sqlToQuery(condition as any);

function dailyRule(maxCostUSD: number) {
    return {
        type: "budget_limit",
        isEnabled: true,
        configuration: { scope: "daily_total", maxCostUSD },
    } as any;
}

describe("validateBudget daily_total", () => {
    beforeEach(() => {
        whereCalls.length = 0;
        total = 0;
    });

    // The regression: the daily sum had no org filter, so one org's budget was
    // measured against every tenant's spend.
    it("sums only the org's own spend", async () => {
        await governorService.validateBudget({ organizationId: 42 }, [dailyRule(10)]);

        const { sql, params } = rendered(whereCalls[0]);
        expect(sql).toContain('"organization_id" = $');
        expect(params).toContain(42);
    });

    it("sums null-org spend with IS NULL, never every tenant's", async () => {
        await governorService.validateBudget({}, [dailyRule(10)]);

        const { sql } = rendered(whereCalls[0]);
        expect(sql).toContain('"organization_id" is null');
    });

    it("blocks once the org's daily spend reaches the limit", async () => {
        total = 12;
        const result = await governorService.validateBudget({ organizationId: 42 }, [dailyRule(10)]);
        expect(result.allowed).toBe(false);
    });
});
