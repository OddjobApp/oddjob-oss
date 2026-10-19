import { describe, it, expect } from "vitest";

import { auditSourceFile } from "./lint-org-scoping.js";

/**
 * The linter's own tests.
 *
 * This repo's recurring defect is a gate that reads green while not checking
 * what it claims to. `lint:arch` certified "all routes follow the Deep Module
 * pattern" over 328 direct db calls because its file matcher missed a
 * directory; coverage thresholds were configured and never evaluated. A linter
 * for tenant scoping with no tests of its own would be the same mistake with
 * higher stakes.
 *
 * So every fixture below is a real shape that was in this tree, taken from the
 * commit that removed it, and every one must be flagged. The second block is
 * equally important: these are patterns that must NOT be flagged, because a
 * linter that fires on correct code gets disabled and then protects nothing.
 */

function rulesFor(code: string): string[] {
    return auditSourceFile("server/fixture.ts", code).map((f) => f.rule);
}

function findingsFor(code: string) {
    return auditSourceFile("server/fixture.ts", code);
}

describe("lint:org-scoping catches every spelling found in this tree", () => {
    it("1. an org predicate skipped by an if with no else (the cycle handlers)", () => {
        // daf75e272: six mutating handlers. A null-org principal added no
        // predicate and the query narrowed to `WHERE id = $1`.
        const code = `
            const conditions = [eq(operationalCycles.id, id)];
            if (!isSuperAdmin && orgId) {
                conditions.push(eq(operationalCycles.organizationId, orgId));
            }
            const [cycle] = await db.select().from(operationalCycles).where(and(...conditions));
        `;
        expect(rulesFor(code)).toContain("org-predicate-conditionally-skipped");
    });

    it("2. a ternary whose else branch is undefined (org-conditions.ts)", () => {
        const code = `
            const filter = orgId != null ? eq(table.organizationId, orgId) : undefined;
            await db.select().from(table).where(filter);
        `;
        expect(rulesFor(code)).toContain("org-filter-falls-through");
    });

    it("3. an org coerced with || to a literal id", () => {
        // 3dfef1d92: five sites, including a payout recipient.
        const code = `const userOrgId = app.organizationId || 1;`;
        expect(rulesFor(code)).toContain("org-coerced-to-literal");
    });

    it("4. an org coerced with ?? to a literal id, which a grep for || 1 misses", () => {
        const code = `const orgId = req.org?.id ?? Number(req.body?.orgId) ?? 1;`;
        expect(rulesFor(code)).toContain("org-coerced-to-literal");
    });

    it("4b. a coercion to a specific tenant rather than to 1", () => {
        // b82bbfb05: `|| 291` wrote another tenant's incident into TECHHEAD7.
        const code = `const orgId = session.organizationId || 291;`;
        expect(rulesFor(code)).toContain("org-coerced-to-literal");
    });

    it("5. a non-null assertion on a tenant", () => {
        // c0b276fa0: hid that a null-org cycle matched no apps of its own.
        const code = `
            await db.select().from(apps)
                .where(or(eq(apps.organizationId, cycle.organizationId!), eq(apps.organizationId, 291)));
        `;
        expect(rulesFor(code)).toContain("org-non-null-assertion");
    });

    it("6. a ternary falling through to sql`true`, a literal true predicate", () => {
        // 623f51d31: five sites. Reads as deliberate, filters nothing.
        const code = `
            const orgFilter = organizationId
                ? eq(missions.organizationId, organizationId)
                : sql\`true\`;
            await db.select().from(missions).where(orgFilter);
        `;
        expect(rulesFor(code)).toContain("org-filter-falls-through");
    });

    it("7. a predicate variable left unassigned on one branch, reaching .where()", () => {
        // 623f51d31: a cross-tenant DELETE. `.where(undefined)` is no filter.
        const code = `
            let conditions: any;
            if (!orgContext.isSuperAdmin && orgContext.organizationId) {
                conditions = eq(errorDiagnoses.organizationId, orgContext.organizationId);
            } else if (orgContext.isSuperAdmin) {
                conditions = sql\`true\`;
            }
            const result = await db.delete(errorDiagnoses).where(conditions).returning();
        `;
        expect(rulesFor(code)).toContain("where-maybe-unassigned");
    });

    it("also catches .where(undefined) written outright", () => {
        expect(rulesFor(`await db.select().from(t).where(undefined);`)).toContain("where-without-filter");
    });

    it("also catches a tenant taken from the request instead of the session", () => {
        // The pattern a peer session found in governor.ts: req.org is assigned
        // nowhere, so the body names the tenant and the handler believes it.
        const fromBody = rulesFor(`const organizationId = req.body?.organizationId || 1;`);
        expect(fromBody).toContain("org-sourced-from-request");

        const fromQuery = rulesFor(`const organizationId = req.query.orgId ? parseInt(req.query.orgId) : undefined;`);
        expect(fromQuery).toContain("org-sourced-from-request");
    });

    it("reports the line and the rule, so a regression is actionable", () => {
        const code = ["const a = 1;", "const b = 2;", "const orgId = session.organizationId || 291;"].join("\n");
        const [finding] = findingsFor(code);
        expect(finding.line).toBe(3);
        expect(finding.rule).toBe("org-coerced-to-literal");
        expect(finding.snippet).toContain("291");
    });
});

describe("lint:org-scoping stays quiet on correct code", () => {
    it("does not flag an optional non-org filter falling through to sql`true`", () => {
        // The trycua services do this for userId and status, where matching
        // everything is the correct meaning of an omitted parameter. A linter
        // that fired here would be switched off.
        const code = `
            const rows = await db.select().from(tasks).where(and(
                userId ? eq(tasks.userId, userId) : sql\`true\`,
                status ? eq(tasks.status, status) : sql\`true\`,
            ));
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag the canonical null-org handling", () => {
        // A null organization means IS NULL, which is a real predicate.
        const code = `
            const conditions = orgId !== null
                ? [eq(credentials.organizationId, orgId)]
                : [sql\`\${credentials.organizationId} IS NULL\`];
            await db.select().from(credentials).where(and(...conditions));
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag a required org passed straight through", () => {
        const code = `
            async function list(organizationId: number) {
                return db.select().from(cycles).where(eq(cycles.organizationId, organizationId));
            }
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag a refusal followed by an unconditional predicate", () => {
        // The shape every fix in this series converged on.
        const code = `
            if (organizationId == null) return { ok: false, failure: "organization-required" };
            const orgFilter = eq(apps.organizationId, organizationId);
            await db.select().from(apps).where(orgFilter);
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag a non-org value coerced to a literal", () => {
        // Pagination, weights and divisors legitimately default to 1.
        const code = `
            const page = options.page || 1;
            const weight = input.weight ?? 1;
            const segTotal = segments.reduce((s, x) => s + x, 0) || 1;
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag a let that is assigned on every branch and typed", () => {
        const code = `
            let conditions: SQL;
            if (orgContext.isSuperAdmin) {
                conditions = sql\`true\`;
            } else {
                conditions = eq(errorDiagnoses.organizationId, requireOrgId(orgContext));
            }
            await db.delete(errorDiagnoses).where(conditions);
        `;
        expect(rulesFor(code)).toEqual([]);
    });

    it("does not flag a non-null assertion on something that is not a tenant", () => {
        expect(rulesFor(`const name = user.displayName!;`)).toEqual([]);
    });
});

describe("lint:org-scoping distinguishes a covered if-chain from a fall-through", () => {
    it("does not flag a let assigned on every branch of if / else-if / else", () => {
        // attachment-tools.ts does this correctly, and every branch carries the
        // organization predicate. Flagging it would be noise on correct code.
        const code = `
            let condition;
            if (params.attachmentId) {
                condition = and(eq(crewAttachments.orgId, orgId), eq(crewAttachments.id, params.attachmentId));
            } else if (params.fileName) {
                condition = and(eq(crewAttachments.orgId, orgId), ilike(crewAttachments.displayName, pattern));
            } else {
                condition = and(eq(crewAttachments.orgId, orgId));
            }
            const [row] = await db.select().from(crewAttachments).where(condition).limit(1);
        `;
        expect(rulesFor(code)).not.toContain("where-maybe-unassigned");
    });

    it("still flags the same shape when the final else is missing", () => {
        const code = `
            let conditions: any;
            if (!orgContext.isSuperAdmin && orgContext.organizationId) {
                conditions = eq(errorDiagnoses.organizationId, orgContext.organizationId);
            } else if (orgContext.isSuperAdmin) {
                conditions = sql\`true\`;
            }
            await db.delete(errorDiagnoses).where(conditions);
        `;
        expect(rulesFor(code)).toContain("where-maybe-unassigned");
    });
});
