import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { componentLookupService } from "../../autonomous/component-lookup.service.js";

/**
 * The write half of the component feedback loop.
 *
 * `component_lookup` selects components by `effectiveness_score`, but until an
 * outcome is recorded every row sits at its seeded 5.00 / 100% — which reads as
 * a perfect component rather than an unmeasured one. `recordAssemblyFeedback`
 * is what turns those seeds into measurements.
 *
 * It has never run in production: it is reached from `handleApplyEdits`, which
 * needs `generation_sessions` and `artifact_registry`, and those were missing
 * until migration 0077. So this suite is the only thing proving the write half
 * works at all, and it has to be DB-backed — the running average and the
 * first-outcome rule are SQL-visible state, not pure functions.
 */

const FIXTURE = "FeedbackFixtureComponent";

/** Insert a component at the seeded defaults, exactly as sync/seed scripts do. */
async function seedComponent(name: string) {
    await db.insert(componentIndex).values({
        componentName: name,
        componentCategory: "test",
        exportType: "named",
        packageSource: "local",
        importPath: `@/components/${name}`,
        codeSnippet: `<${name} />`,
        // Defaults left alone on purpose: 5.00 / 100.00 / 0 / 0.
    });
}

async function read(name: string) {
    const [row] = await db.select().from(componentIndex).where(eq(componentIndex.componentName, name)).limit(1);
    return row;
}

async function cleanup() {
    await db.delete(componentIndex).where(like(componentIndex.componentName, `${FIXTURE}%`));
}

describe("recordAssemblyFeedback", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("replaces the seeded default outright on the first failure", async () => {
        // The subtle one. Averaging the first outcome against the seeded 100%
        // would report ~50% for a component that has only ever failed.
        const name = `${FIXTURE}FirstFail`;
        await seedComponent(name);

        await componentLookupService.recordAssemblyFeedback(name, false);

        const row = await read(name);
        expect(Number(row.verificationSuccessRate)).toBe(0);
        expect(Number(row.effectivenessScore)).toBe(0);
        expect(row.verificationRunCount).toBe(1);
    });

    it("replaces the seeded default outright on the first success", async () => {
        const name = `${FIXTURE}FirstPass`;
        await seedComponent(name);

        await componentLookupService.recordAssemblyFeedback(name, true);

        const row = await read(name);
        expect(Number(row.verificationSuccessRate)).toBe(100);
        expect(Number(row.effectivenessScore)).toBe(5);
        // Now measured — the value coincides with the seed but the run count
        // is what tells a reader the difference.
        expect(row.verificationRunCount).toBe(1);
    });

    it("averages subsequent outcomes over verification runs", async () => {
        const name = `${FIXTURE}Average`;
        await seedComponent(name);

        await componentLookupService.recordAssemblyFeedback(name, true);
        await componentLookupService.recordAssemblyFeedback(name, false);

        const row = await read(name);
        // (100 + 0) / 2
        expect(Number(row.verificationSuccessRate)).toBe(50);
        expect(Number(row.effectivenessScore)).toBe(2.5); // 50 / 20
        expect(row.verificationRunCount).toBe(2);
    });

    it("keeps the star score as a pure function of the success rate", async () => {
        const name = `${FIXTURE}Stars`;
        await seedComponent(name);

        await componentLookupService.recordAssemblyFeedback(name, true);
        await componentLookupService.recordAssemblyFeedback(name, true);
        await componentLookupService.recordAssemblyFeedback(name, true);
        await componentLookupService.recordAssemblyFeedback(name, false);

        const row = await read(name);
        expect(Number(row.verificationSuccessRate)).toBe(75);
        expect(Number(row.effectivenessScore)).toBe(3.75); // 75 / 20
    });

    it("counts verification runs separately from assemblies", async () => {
        // total_assemble_count also counts instant-app renders, which carry no
        // pass/fail signal. Averaging over it would dilute real outcomes.
        const name = `${FIXTURE}Counts`;
        await seedComponent(name);

        // Simulate renders that produced no verification outcome.
        await db
            .update(componentIndex)
            .set({ totalAssembleCount: 10 })
            .where(eq(componentIndex.componentName, name));

        await componentLookupService.recordAssemblyFeedback(name, false);

        const row = await read(name);
        expect(row.totalAssembleCount).toBe(11);
        expect(row.verificationRunCount).toBe(1);
        // 1 verification run, 1 failure — the 10 renders must not soften it.
        expect(Number(row.verificationSuccessRate)).toBe(0);
    });

    it("leaves an unmeasured component distinguishable from a perfect one", async () => {
        const measured = `${FIXTURE}Measured`;
        const untouched = `${FIXTURE}Untouched`;
        await seedComponent(measured);
        await seedComponent(untouched);

        await componentLookupService.recordAssemblyFeedback(measured, true);

        const a = await read(measured);
        const b = await read(untouched);

        // Identical scores...
        expect(Number(a.effectivenessScore)).toBe(Number(b.effectivenessScore));
        // ...distinguished only by the run count. This is what `isMeasured`
        // in the component-index tool reads.
        expect(a.verificationRunCount).toBe(1);
        expect(b.verificationRunCount).toBe(0);
    });

    it("is a no-op for a component that is not indexed", async () => {
        await expect(
            componentLookupService.recordAssemblyFeedback(`${FIXTURE}DoesNotExist`, true),
        ).resolves.toBeUndefined();
    });
});
