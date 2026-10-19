import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { jobCollections, jobCollectionItems, jobs, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { collectionService } from "../../core/collection.service.js";
import type { OrgContext } from "@server/utils/auth-context.js";

describe("collectionService — tenant scoping and collection item isolation", () => {
    let orgAId: number;
    let orgBId: number;
    let collectionAId: number;
    let collectionBId: number;
    let jobA1Id: number;
    let jobA2Id: number;
    let jobB1Id: number;

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        // Create test orgs
        const [orgA] = await db.insert(orgs).values({ name: `CollectionTest Org A ${stamp}` }).returning();
        const [orgB] = await db.insert(orgs).values({ name: `CollectionTest Org B ${stamp}` }).returning();
        orgAId = orgA.id;
        orgBId = orgB.id;

        // Create test jobs for Org A and Org B
        const [jobA1] = await db.insert(jobs).values({
            name: `Job A1 ${stamp}`,
            type: "api",
            config: {},
            organizationId: orgAId,
            createdBy: "test",
        }).returning();
        const [jobA2] = await db.insert(jobs).values({
            name: `Job A2 ${stamp}`,
            type: "api",
            config: {},
            organizationId: orgAId,
            createdBy: "test",
        }).returning();
        const [jobB1] = await db.insert(jobs).values({
            name: `Job B1 ${stamp}`,
            type: "api",
            config: {},
            organizationId: orgBId,
            createdBy: "test",
        }).returning();

        jobA1Id = jobA1.id;
        jobA2Id = jobA2.id;
        jobB1Id = jobB1.id;

        // Create collections for Org A and Org B
        const [colA] = await db.insert(jobCollections).values({
            name: `Collection A ${stamp}`,
            organizationId: orgAId,
            createdBy: "test",
        }).returning();
        const [colB] = await db.insert(jobCollections).values({
            name: `Collection B ${stamp}`,
            organizationId: orgBId,
            createdBy: "test",
        }).returning();

        collectionAId = colA.id;
        collectionBId = colB.id;

        // Associate jobs with collections:
        // Collection A has job A1 and A2
        // Collection B has job B1
        await db.insert(jobCollectionItems).values([
            { collectionId: collectionAId, jobId: jobA1Id },
            { collectionId: collectionAId, jobId: jobA2Id },
            { collectionId: collectionBId, jobId: jobB1Id },
        ]);
    });

    afterAll(async () => {
        if (collectionAId && collectionBId) {
            await db.delete(jobCollectionItems).where(
                inArray(jobCollectionItems.collectionId, [collectionAId, collectionBId]),
            );
            await db.delete(jobCollections).where(
                inArray(jobCollections.id, [collectionAId, collectionBId]),
            );
        }
        if (jobA1Id && jobA2Id && jobB1Id) {
            await db.delete(jobs).where(inArray(jobs.id, [jobA1Id, jobA2Id, jobB1Id]));
        }
        if (orgAId && orgBId) {
            await db.delete(orgs).where(inArray(orgs.id, [orgAId, orgBId]));
        }
    });

    it("getCollectionById returns ONLY jobs belonging to the requested collection", async () => {
        const orgAContext: OrgContext = {
            organizationId: orgAId,
            userId: "user-a",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        const result = await collectionService.getCollectionById(collectionAId, orgAContext);
        expect(result.id).toBe(collectionAId);
        expect(result.jobs).toHaveLength(2);
        const jobIds = result.jobs.map((j: any) => j.id).sort();
        expect(jobIds).toEqual([jobA1Id, jobA2Id].sort());
        expect(jobIds).not.toContain(jobB1Id);
    });

    it("getCollectionById rejects access if collection belongs to a different tenant", async () => {
        const orgBContext: OrgContext = {
            organizationId: orgBId,
            userId: "user-b",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        await expect(
            collectionService.getCollectionById(collectionAId, orgBContext),
        ).rejects.toThrow("Access denied");
    });

    it("listCollections isolates tenant collections and does not leak Org B into Org A", async () => {
        const orgAContext: OrgContext = {
            organizationId: orgAId,
            userId: "user-a",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        const list = await collectionService.listCollections(orgAContext);
        const colIds = list.map((c) => c.id);
        expect(colIds).toContain(collectionAId);
        expect(colIds).not.toContain(collectionBId);
    });

    it("updateCollection prevents cross-tenant modification", async () => {
        const orgBContext: OrgContext = {
            organizationId: orgBId,
            userId: "user-b",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        await expect(
            collectionService.updateCollection(collectionAId, { name: "Hacked" }, orgBContext),
        ).rejects.toThrow("Collection not found or access denied");
    });
});
