import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@server/database_service.js";
import { datasets, fineTuningDatasets, fineTuningExamples } from "@shared/schema/index.js";
import { searchService } from "../../core/search/search-service.js";
import { ensureFixtureOrgs } from "../../../../../tests/helpers/fixture-orgs.js";

/**
 * Unified search returns only the caller's organization's content.
 *
 * The dataset arm searched datasets, fine-tuning datasets and fine-tuning examples
 * with no organization filter, so every organization's search, and every agent's
 * search_unified_knowledge, could surface another tenant's dataset names and
 * example inputs and outputs. Each organization here owns rows carrying its own
 * random token; searching for one organization's token as the other must find
 * nothing, in any field of the response.
 */

const ORG_A = 9301;
const ORG_B = 9302;
const PREFIX = "search-isolation-fixture";
const TOKEN: Record<number, string> = { [ORG_A]: `canary${randomUUID().replace(/-/g, "")}`, [ORG_B]: `canary${randomUUID().replace(/-/g, "")}` };

async function cleanup() {
    await db.delete(datasets).where(like(datasets.name, `${PREFIX}%`));
    // Examples go with their dataset (ON DELETE CASCADE).
    await db.delete(fineTuningDatasets).where(like(fineTuningDatasets.name, `${PREFIX}%`));
}

async function search(token: string, organizationId: number) {
    return searchService.executeUnifiedSearch(token, "dataset", organizationId, { limit: 20 });
}

describe("unified search tenant isolation", () => {
    beforeAll(async () => {
        await ensureFixtureOrgs([[ORG_A, "Search isolation A"], [ORG_B, "Search isolation B"]]);
        await cleanup();
        for (const org of [ORG_A, ORG_B]) {
            const token = TOKEN[org];
            await db.insert(datasets).values({ name: `${PREFIX} ${token}`, description: `dataset ${token}`, organizationId: org });
            // The token sits in the description only, so the example below is the
            // only fine-tuning match by input; the dataset matches by description.
            const [ft] = await db.insert(fineTuningDatasets)
                .values({ name: `${PREFIX} training ${org}`, description: `training ${token}`, organizationId: org })
                .returning({ id: fineTuningDatasets.id });
            await db.insert(fineTuningExamples).values({ datasetId: ft.id, input: `input ${token}`, output: `output ${token}` });
        }
    });

    afterAll(cleanup);

    it("finds an organization's own datasets, training sets and examples", async () => {
        const results = await search(TOKEN[ORG_A], ORG_A);
        const types = results.map((r) => r.type).sort();
        expect(types).toEqual(["dataset", "dataset", "example"]);
        expect(JSON.stringify(results)).toContain(TOKEN[ORG_A]);
    });

    it("never returns another organization's datasets, training sets or examples", async () => {
        for (const [owner, caller] of [[ORG_A, ORG_B], [ORG_B, ORG_A]]) {
            const results = await search(TOKEN[owner], caller);
            expect(results).toEqual([]);
        }
    });

    it("never mixes the other organization's rows into a broad match", async () => {
        // Matches both organizations' fixtures by the shared prefix.
        const results = await search(PREFIX, ORG_B);
        const serialized = JSON.stringify(results);
        expect(serialized).toContain(TOKEN[ORG_B]);
        expect(serialized).not.toContain(TOKEN[ORG_A]);
    });

    it("refuses a search with no organization rather than searching every tenant", async () => {
        await expect(searchService.executeUnifiedSearch(TOKEN[ORG_A], "dataset", null)).rejects.toMatchObject({ status: 403 });
        await expect(searchService.executeHybridSearch(TOKEN[ORG_A], null)).rejects.toMatchObject({ status: 403 });
    });
});
