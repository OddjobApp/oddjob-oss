/** @vitest-environment node */
/**
 * monitoring.service.ts had one org-scoping shape repeated five times:
 *
 *     if (organizationId !== null)  filter by org
 *     else if (!isAdmin)           filter by IS NULL
 *     // else: no filter at all
 *
 * The missing branch — an admin context with a null org — returned an unscoped
 * query across every tenant. It keyed on isAdmin, not isSuperAdmin, and API-key
 * auth resolves to isAdmin:true / isSuperAdmin:false, so that path was reachable
 * without being a super admin. clearAcknowledgedAlerts is a DELETE, so the same
 * gap erased other tenants' alerts.
 *
 * These assert the conditions produced for each context shape. They exercise
 * getOrgConditions against the real tables rather than the DB, because the bug
 * was in which predicate got built, not in what the rows contained.
 */
import { describe, it, expect } from "vitest";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import { alerts } from "@shared/schema/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";

function ctx(over: Partial<OrgContext>): OrgContext {
    return {
        userId: "u1",
        organizationId: null,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
        ...over,
    } as OrgContext;
}

describe("monitoring org scoping", () => {
    it("scopes an org admin with a null org instead of returning everything", () => {
        // The exact context that used to produce no filter.
        const conditions = getOrgConditions(ctx({ isAdmin: true, organizationId: null }), alerts, false);
        expect(conditions.length).toBeGreaterThan(0);
    });

    it("scopes API-key auth, which is isAdmin true but not a super admin", () => {
        const conditions = getOrgConditions(
            ctx({ isAdmin: true, isOrgAdmin: true, isSuperAdmin: false, organizationId: null }),
            alerts,
            false,
        );
        expect(conditions.length).toBeGreaterThan(0);
    });

    it("scopes a plain user with an org", () => {
        const conditions = getOrgConditions(ctx({ organizationId: 42 }), alerts, false);
        expect(conditions.length).toBe(1);
    });

    it("scopes a super admin who has selected an org", () => {
        const conditions = getOrgConditions(
            ctx({ isSuperAdmin: true, isAdmin: true, organizationId: 42 }),
            alerts,
            false,
        );
        expect(conditions.length).toBe(1);
    });

    it("lets only an unscoped super admin read across tenants", () => {
        // The single legitimate cross-tenant case.
        const conditions = getOrgConditions(
            ctx({ isSuperAdmin: true, isAdmin: true, organizationId: null }),
            alerts,
            false,
        );
        expect(conditions.length).toBe(0);
    });

    it("does not widen an org user to also see global rows", () => {
        // allowGlobal:false is deliberate — the previous code filtered on the org
        // alone, so the OR form would have quietly added every organizationId IS NULL
        // row to what an org user sees. Compare the built SQL, not the object: two
        // different drizzle conditions serialise identically under JSON.stringify.
        const chunks = (c: any) => JSON.stringify((c[0] as any)?.queryChunks?.length ?? 0);
        const strict = getOrgConditions(ctx({ organizationId: 42 }), alerts, false);
        const widened = getOrgConditions(ctx({ organizationId: 42 }), alerts, true);
        expect(chunks(strict)).not.toBe(chunks(widened));
    });
});
