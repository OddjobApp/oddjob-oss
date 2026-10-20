import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { latLngToCell, cellToParent } from "h3-js";
import { db } from "@server/database_service.js";
import { spatialRegions } from "@shared/schema/spatial-regions.js";
import { orgs } from "@shared/schema/auth.js";
import { spatialRegionService } from "../../core/spatial-region.service.js";
import { spatialRegionStore } from "../../core/spatial-region-store.service.js";
import { SpatialPredicateEngineService } from "../../core/spatial-predicate-engine.service.js";
import type { SpatialCondition } from "@shared/contracts/spatial-predicates.js";
import { ensureFixtureOrgs } from "../../../../../tests/helpers/fixture-orgs.js";

/**
 * End-to-end for a rule that references a STORED region rather than inlining
 * cells: spatial_regions row → SpatialRegionStore → predicate engine.
 *
 * The unit tests inject a fake store, so this is the only place that proves the
 * real query honours org scope and soft deletion — both of which are access
 * control here, not hygiene. A rule naming another org's region id must resolve
 * to nothing, and a deleted boundary must stop matching rather than keep firing.
 */

const ORG_A_ID = 1;
const ORG_B_ID = 2;
const FIXTURE = "region-rules-fixture";

const LAT = 33.74;
const LNG = -118.25;
const CELL_R7 = latLngToCell(LAT, LNG, 7);
const CELL_R5 = cellToParent(CELL_R7, 5);

function condition(regionId: number): SpatialCondition {
    return {
        type: "spatial",
        mode: "topological",
        predicate: "there",
        geometry: { regionId },
    } as SpatialCondition;
}

const observation = { subjectId: "vessel-1", latitude: LAT, longitude: LNG, h3Index: CELL_R7 };

/** A fresh engine wired to the REAL store. */
function engineWithStore() {
    const engine = new SpatialPredicateEngineService();
    engine.setRegionStore(spatialRegionStore);
    return engine;
}

async function cleanup() {
    await db.delete(spatialRegions).where(like(spatialRegions.name, `${FIXTURE}%`));
}

describe("rules referencing a stored spatial region", () => {
    let ownedId: number;
    let otherOrgId: number;
    let deletedId: number;
    let mixedId: number;

    beforeAll(async () => {
        await ensureFixtureOrgs([
            [ORG_A_ID, "Region Rules Org A"],
            [ORG_B_ID, "Region Rules Org B"],
        ]);
        await cleanup();

        const owned = await spatialRegionService.create(
            { organizationId: ORG_A_ID, userId: "test" },
            { name: `${FIXTURE} harbour`, cells: [CELL_R7] },
        );
        ownedId = owned.id;

        const other = await spatialRegionService.create(
            { organizationId: ORG_B_ID, userId: "test" },
            { name: `${FIXTURE} other org harbour`, cells: [CELL_R7] },
        );
        otherOrgId = other.id;

        const doomed = await spatialRegionService.create(
            { organizationId: ORG_A_ID, userId: "test" },
            { name: `${FIXTURE} decommissioned`, cells: [CELL_R7] },
        );
        deletedId = doomed.id;
        await spatialRegionService.softDelete({ organizationId: ORG_A_ID }, deletedId);

        const mixed = await spatialRegionService.create(
            { organizationId: ORG_A_ID, userId: "test" },
            { name: `${FIXTURE} mixed`, cells: [CELL_R5, CELL_R7] },
        );
        mixedId = mixed.id;
    });

    afterAll(cleanup);

    it("matches a position inside a region the org owns", async () => {
        const engine = engineWithStore();
        const conds = [condition(ownedId)];

        await engine.hydrateRegions(ORG_A_ID, conds);

        expect(engine.evaluate(conds, observation as never).passed).toBe(true);
    });

    it("refuses a region belonging to another organization", async () => {
        const engine = engineWithStore();
        const conds = [condition(otherOrgId)];

        // Same cells, same position — only the owning org differs.
        await engine.hydrateRegions(ORG_A_ID, conds);

        expect(engine.evaluate(conds, observation as never).passed).toBe(false);
    });

    it("stops matching once a region is soft-deleted", async () => {
        const engine = engineWithStore();
        const conds = [condition(deletedId)];

        await engine.hydrateRegions(ORG_A_ID, conds);

        expect(engine.evaluate(conds, observation as never).passed).toBe(false);
    });

    it("refuses a stored mixed-resolution region instead of distorting it", async () => {
        const engine = engineWithStore();
        const conds = [condition(mixedId)];

        await engine.hydrateRegions(ORG_A_ID, conds);

        // Geometrically inside, so passing here would mean the mixed cell set
        // was silently collapsed to a single resolution.
        expect(engine.evaluate(conds, observation as never).passed).toBe(false);
    });

    it("records the resolution range the writer computed", async () => {
        const [row] = await db
            .select()
            .from(spatialRegions)
            .where(and(eq(spatialRegions.id, mixedId)));

        expect(row.minResolution).toBe(5);
        expect(row.maxResolution).toBe(7);
    });

    it("re-reads a boundary after it is edited", async () => {
        const elsewhere = latLngToCell(51.5, -0.12, 7);
        await spatialRegionService.update({ organizationId: ORG_A_ID }, ownedId, { cells: [elsewhere] });

        // A fresh engine, because the point is that the STORED boundary moved.
        const engine = engineWithStore();
        const conds = [condition(ownedId)];
        await engine.hydrateRegions(ORG_A_ID, conds);

        expect(engine.evaluate(conds, observation as never).passed).toBe(false);

        // Put it back so the assertion above cannot pass by ordering luck.
        await spatialRegionService.update({ organizationId: ORG_A_ID }, ownedId, { cells: [CELL_R7] });
        const engine2 = engineWithStore();
        const conds2 = [condition(ownedId)];
        await engine2.hydrateRegions(ORG_A_ID, conds2);
        expect(engine2.evaluate(conds2, observation as never).passed).toBe(true);
    });

    it("will not update a region owned by another organization", async () => {
        const result = await spatialRegionService.update({ organizationId: ORG_A_ID }, otherOrgId, {
            name: `${FIXTURE} hijacked`,
        });

        expect(result).toBeNull();
    });
});
