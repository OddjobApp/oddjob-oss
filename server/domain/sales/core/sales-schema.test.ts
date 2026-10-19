import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
    SALES_RECOMMENDATION_KIND_VALUES,
    SALES_STAGE_VALUES,
    insertSalesAccountSchema,
    insertSalesOpportunitySchema,
    salesAccounts,
    salesActivities,
    salesForecasts,
    salesLeads,
    salesOpportunities,
    salesOpportunityWindows,
    salesRecommendations,
    salesWindowSnapshots,
} from "@shared/schema/index.js";
import { SALES_STAGE_ENTITLEMENT } from "./collections.js";

describe("sales domain schema", () => {
    it("uses durable sales table names instead of app-record collection names", () => {
        expect(getTableName(salesAccounts)).toBe("sales_accounts");
        expect(getTableName(salesLeads)).toBe("sales_leads");
        expect(getTableName(salesOpportunities)).toBe("sales_opportunities");
        expect(getTableName(salesActivities)).toBe("sales_activities");
        expect(getTableName(salesOpportunityWindows)).toBe("sales_opportunity_windows");
        expect(getTableName(salesWindowSnapshots)).toBe("sales_window_snapshots");
        expect(getTableName(salesForecasts)).toBe("sales_forecasts");
        expect(getTableName(salesRecommendations)).toBe("sales_recommendations_domain");
    });

    it("keeps stage values aligned with the narrowing-window service entitlements", () => {
        expect(SALES_STAGE_VALUES).toEqual([
            "PROSPECT",
            "QUALIFIED",
            "PROPOSAL",
            "NEGOTIATION",
            "CLOSED_WON",
            "CLOSED_LOST",
        ]);
        expect(Object.keys(SALES_STAGE_ENTITLEMENT)).toEqual([...SALES_STAGE_VALUES]);
        expect(SALES_STAGE_ENTITLEMENT.CLOSED_WON).toBe(100);
        expect(SALES_STAGE_ENTITLEMENT.CLOSED_LOST).toBe(0);
    });

    it("validates basic account and opportunity inserts", () => {
        expect(() => insertSalesAccountSchema.parse({
            organizationId: 1,
            accountKey: "acct_demo",
            name: "Demo Account",
        })).not.toThrow();

        expect(() => insertSalesOpportunitySchema.parse({
            organizationId: 1,
            accountId: 1,
            opportunityKey: "opp_demo",
            name: "Expansion Deal",
            amount: 25000,
            stage: "QUALIFIED",
        })).not.toThrow();
    });

    it("declares recommendation kinds expected by the risk center", () => {
        expect(SALES_RECOMMENDATION_KIND_VALUES).toEqual([
            "slip_risk",
            "stalled",
            "aging",
            "next_best_action",
            "win",
            "loss",
        ]);
    });
});
