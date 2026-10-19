import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, like, isNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeConcepts } from "@shared/schema/knowledge/index.js";
import { orgs } from "@shared/schema/auth.js";
import { conceptService } from "../../core/graph/concept-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";

/**
 * Live, DB-backed test for `conceptService.upsertConcept`.
 *
 * Uniqueness on knowledge_concepts is split across two PARTIAL unique indexes
 * (migration 0059) — one for org-scoped rows (project_id IS NULL), one for
 * project-scoped rows (project_id IS NOT NULL). A single conflict target cannot
 * satisfy both, so each index is exercised on its own here: a test that only
 * covers one path would leave the other raising unique violations in production.
 *
 * This has to run against a real Postgres. ON CONFLICT against a partial index is
 * precisely the behaviour a mocked `db` would assert into existence rather than
 * verify — the original bug was a blind INSERT that no unit test ever caught.
 */

// Kept as bare literals as well as contexts: OrgContext.organizationId is
// `number | null`, which drizzle will not accept in a query builder.
const ORG_A_ID = 1;
const ORG_B_ID = 2;

const ORG_A: OrgContext = {
    organizationId: ORG_A_ID,
    userId: "test:concept-upsert",
    isAdmin: false,
    isSuperAdmin: false,
    isOrgAdmin: false,
};
const ORG_B: OrgContext = { ...ORG_A, organizationId: ORG_B_ID };
const PROJECT_X = 90_001;
const PROJECT_Y = 90_002;
const FIXTURE = "concept-upsert-fixture";

async function cleanup() {
    await db
        .delete(knowledgeConcepts)
        .where(
            and(
                inArray(knowledgeConcepts.organizationId, [ORG_A_ID, ORG_B_ID]),
                like(knowledgeConcepts.name, `${FIXTURE}%`),
            ),
        );
}

/** Rows we own, for counting duplicates. */
async function rowsNamed(name: string) {
    return db
        .select()
        .from(knowledgeConcepts)
        .where(
            and(
                inArray(knowledgeConcepts.organizationId, [ORG_A_ID, ORG_B_ID]),
                eq(knowledgeConcepts.name, name),
            ),
        );
}

describe("conceptService.upsertConcept", () => {
    beforeAll(async () => {
        // Both orgs FK from knowledge_concepts, so a missing org takes the suite
        // down before a single assertion runs.
        for (const [id, name] of [
            [ORG_A_ID, "Concept Upsert Org A"],
            [ORG_B_ID, "Concept Upsert Org B"],
        ] as const) {
            await db.insert(orgs).values({ id, name }).onConflictDoNothing();
        }
        await cleanup();
    });

    afterAll(cleanup);

    describe("org scope — project_id IS NULL", () => {
        it("is idempotent across repeated calls", async () => {
            const name = `${FIXTURE}-org-idempotent`;

            const first = await conceptService.upsertConcept(name, "first description", ORG_A, null);
            const second = await conceptService.upsertConcept(name, "second description", ORG_A, null);

            expect(first.id).toBe(second.id);
            expect(await rowsNamed(name)).toHaveLength(1);
        });

        it("refreshes the description on conflict rather than discarding the write", async () => {
            const name = `${FIXTURE}-org-update`;

            await conceptService.upsertConcept(name, "original", ORG_A, null);
            const updated = await conceptService.upsertConcept(name, "revised", ORG_A, null);

            // DoNothing would return no row at all; the caller needs the id back.
            expect(updated).toBeDefined();
            expect(updated.description).toBe("revised");
        });

        it("stores project_id as NULL, not 0", async () => {
            const name = `${FIXTURE}-org-null`;

            const concept = await conceptService.upsertConcept(name, "org wide", ORG_A, null);

            expect(concept.projectId).toBeNull();
            const [row] = await db
                .select()
                .from(knowledgeConcepts)
                .where(and(eq(knowledgeConcepts.id, concept.id), isNull(knowledgeConcepts.projectId)));
            expect(row).toBeDefined();
        });

        it("defaults to org scope when projectId is omitted", async () => {
            const name = `${FIXTURE}-org-default`;

            const concept = await conceptService.upsertConcept(name, "defaulted", ORG_A);

            expect(concept.projectId).toBeNull();
        });
    });

    describe("project scope — project_id IS NOT NULL", () => {
        it("is idempotent across repeated calls", async () => {
            const name = `${FIXTURE}-project-idempotent`;

            const first = await conceptService.upsertConcept(name, "first", ORG_A, PROJECT_X);
            const second = await conceptService.upsertConcept(name, "second", ORG_A, PROJECT_X);

            expect(first.id).toBe(second.id);
            expect(first.projectId).toBe(PROJECT_X);
            expect(await rowsNamed(name)).toHaveLength(1);
        });

        it("keeps the same name distinct across two projects", async () => {
            const name = `${FIXTURE}-per-project`;

            const inX = await conceptService.upsertConcept(name, "in X", ORG_A, PROJECT_X);
            const inY = await conceptService.upsertConcept(name, "in Y", ORG_A, PROJECT_Y);

            expect(inX.id).not.toBe(inY.id);
            expect(await rowsNamed(name)).toHaveLength(2);
        });
    });

    describe("scope isolation", () => {
        it("keeps an org-wide concept and a project concept of the same name apart", async () => {
            // The reason there are two partial indexes rather than one composite:
            // Postgres treats NULLs as distinct, so a single index over
            // (org, project, name) would let org-level rows duplicate freely.
            const name = `${FIXTURE}-same-name-both-scopes`;

            const orgWide = await conceptService.upsertConcept(name, "org wide", ORG_A, null);
            const scoped = await conceptService.upsertConcept(name, "project only", ORG_A, PROJECT_X);

            expect(orgWide.id).not.toBe(scoped.id);
            expect(orgWide.projectId).toBeNull();
            expect(scoped.projectId).toBe(PROJECT_X);
            expect(await rowsNamed(name)).toHaveLength(2);
        });

        it("keeps the same name distinct across two orgs", async () => {
            const name = `${FIXTURE}-cross-org`;

            const a = await conceptService.upsertConcept(name, "org A", ORG_A, null);
            const b = await conceptService.upsertConcept(name, "org B", ORG_B, null);

            expect(a.id).not.toBe(b.id);
            expect(a.organizationId).toBe(ORG_A.organizationId);
            expect(b.organizationId).toBe(ORG_B.organizationId);
        });
    });

    describe("org context", () => {
        it("rejects a context with no organization rather than writing org 0", async () => {
            await expect(
                conceptService.upsertConcept(`${FIXTURE}-no-org`, "orphan", { organizationId: null } as never, null),
            ).rejects.toThrow(/Organization context required/);
        });
    });

    describe("createConcept compatibility", () => {
        it("no longer raises a unique violation on a repeated name", async () => {
            const name = `${FIXTURE}-legacy-create`;

            const first = await conceptService.createConcept(name, "first", ORG_A);
            const second = await conceptService.createConcept(name, "second", ORG_A);

            expect(first.id).toBe(second.id);
            expect(await rowsNamed(name)).toHaveLength(1);
        });
    });
});
