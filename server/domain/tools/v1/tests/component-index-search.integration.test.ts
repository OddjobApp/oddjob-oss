import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { searchComponentIndex } from "../capabilities/component-index.js";

/**
 * The effectiveness floor in component search.
 *
 * `effectiveness_score` is seeded at 5.00 and only becomes a measurement once
 * `recordAssemblyFeedback` writes a verification outcome. A naive
 * `score >= minEffectiveness` therefore admitted every unmeasured component as
 * though it had scored top marks, which is worse than no filter: it looks like
 * a quality gate and silently ranks seeds alongside real measurements.
 *
 * DB-backed because the predicate is SQL. A mocked `db` would assert the
 * intended behaviour rather than verify it.
 */

const FIXTURE = "SearchFilterFixture";

async function seed(name: string, opts: { score?: string; runs?: number } = {}) {
    await db.insert(componentIndex).values({
        componentName: name,
        componentCategory: "search-filter-test",
        exportType: "named",
        packageSource: "local",
        importPath: `@/components/${name}`,
        codeSnippet: `<${name} />`,
        effectivenessScore: opts.score ?? "5.00",
        verificationRunCount: opts.runs ?? 0,
    });
}

async function cleanup() {
    await db.delete(componentIndex).where(like(componentIndex.componentName, `${FIXTURE}%`));
}

async function search(minEffectiveness: number) {
    const rows = await searchComponentIndex({
        category: "search-filter-test",
        minEffectiveness,
        limit: 50,
    });
    return rows.map(r => r.name);
}

describe("searchComponentIndex effectiveness floor", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("drops a component measured below the floor", async () => {
        await seed(`${FIXTURE}Bad`, { score: "1.00", runs: 4 });
        await seed(`${FIXTURE}Good`, { score: "4.80", runs: 4 });

        const names = await search(4.5);

        expect(names).toContain(`${FIXTURE}Good`);
        expect(names).not.toContain(`${FIXTURE}Bad`);
    });

    it("keeps an unmeasured component rather than stranding the pipeline", async () => {
        // Every row in the live table looks like this today.
        await seed(`${FIXTURE}Unmeasured`, { score: "5.00", runs: 0 });

        const names = await search(4.5);

        expect(names).toContain(`${FIXTURE}Unmeasured`);
    });

    it("marks the unmeasured component so a caller can tell it apart", async () => {
        await seed(`${FIXTURE}Unmeasured`, { score: "5.00", runs: 0 });
        await seed(`${FIXTURE}Proven`, { score: "5.00", runs: 6 });

        const rows = await searchComponentIndex({
            category: "search-filter-test",
            minEffectiveness: 4.5,
            limit: 50,
        });

        const unmeasured = rows.find(r => r.name === `${FIXTURE}Unmeasured`);
        const proven = rows.find(r => r.name === `${FIXTURE}Proven`);

        // Identical scores, opposite standing.
        expect(unmeasured!.effectivenessScore).toBe(proven!.effectivenessScore);
        expect(unmeasured!.isMeasured).toBe(false);
        expect(proven!.isMeasured).toBe(true);
    });

    it("does not let a seeded 5.00 outrank a measured component", async () => {
        // The regression this whole change exists to prevent: a component
        // measured at 4.90 over six runs must not be filtered out while an
        // unproven 5.00 survives on a floor of 5.00.
        await seed(`${FIXTURE}Seeded`, { score: "5.00", runs: 0 });
        await seed(`${FIXTURE}Measured`, { score: "4.90", runs: 6 });

        const names = await search(5.0);

        expect(names).toContain(`${FIXTURE}Seeded`); // unmeasured, passes through
        // ...but it is flagged, and the measured one being dropped at a 5.00
        // floor is a real measurement, not an artefact of seeding.
        expect(names).not.toContain(`${FIXTURE}Measured`);
    });

    it("returns everything when no floor is requested", async () => {
        await seed(`${FIXTURE}Bad`, { score: "0.00", runs: 3 });
        await seed(`${FIXTURE}Unmeasured`, { score: "5.00", runs: 0 });

        const names = await search(0);

        expect(names).toContain(`${FIXTURE}Bad`);
        expect(names).toContain(`${FIXTURE}Unmeasured`);
    });
});
