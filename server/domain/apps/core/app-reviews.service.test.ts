import { describe, it, expect, vi, beforeEach } from "vitest";

// Each select() takes the next queued answer, in the order the service queries.
const answers: unknown[][] = [];
const inserts: unknown[] = [];
vi.mock("@server/database_service.js", () => {
    const chain = (result: () => unknown) => {
        const self: any = {};
        for (const m of ["from", "where", "orderBy", "groupBy", "limit", "onConflictDoUpdate"]) self[m] = () => self;
        self.values = (v: unknown) => { inserts.push(v); return self; };
        self.returning = () => Promise.resolve(result());
        self.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
        return self;
    };
    return {
        db: {
            select: () => chain(() => answers.shift() ?? []),
            insert: () => chain(() => [{ id: 1, rating: 4, comment: null, createdAt: new Date(), updatedAt: new Date() }]),
            delete: () => chain(() => []),
        },
    };
});

import { appReviewsService } from "./app-reviews.service.js";

describe("appReviewsService", () => {
    beforeEach(() => {
        answers.length = 0;
        inserts.length = 0;
    });

    it("refuses a reviewer with no org", async () => {
        expect(await appReviewsService.canReview(5, "u1", null)).toBe(false);
    });

    // getUserOrgContext accepts ?orgId= without checking membership, so the
    // service has to: naming an org that installed the app is not enough.
    it("refuses someone who is not a member of the org they name", async () => {
        answers.push([]); // user_orgs: no membership
        expect(await appReviewsService.canReview(5, "u1", 42)).toBe(false);
    });

    it("refuses a member whose org has not installed the app", async () => {
        answers.push([{ orgId: 42 }], []); // member, no deployment
        expect(await appReviewsService.canReview(5, "u1", 42)).toBe(false);
    });

    it("allows a member of an org that has the app installed", async () => {
        answers.push([{ orgId: 42 }], [{ id: 9 }]);
        expect(await appReviewsService.canReview(5, "u1", 42)).toBe(true);
    });

    it("rejects a review from someone not entitled to write one", async () => {
        answers.push([{ id: 5 }], []); // app exists, not a member
        await expect(appReviewsService.upsert(5, "u1", 42, { rating: 5 })).rejects.toThrow(/installed this app/);
        expect(inserts).toHaveLength(0);
    });

    it("stores an entitled review with a blank comment as null", async () => {
        answers.push([{ id: 5 }], [{ orgId: 42 }], [{ id: 9 }]);
        await appReviewsService.upsert(5, "u1", 42, { rating: 4, comment: "   " });
        expect(inserts[0]).toMatchObject({ appId: 5, userId: "u1", organizationId: 42, rating: 4, comment: null });
    });

    it("hides a private app's reviews from an org that has not installed it", async () => {
        answers.push([{ isPublic: false }], []); // private, viewer not a member
        await expect(appReviewsService.list(5, "u1", 42)).rejects.toThrow(/not found/i);
    });

    it("never returns who wrote a review, only whether it is the viewer's", async () => {
        answers.push([{ isPublic: true }], [
            { id: 1, appId: 5, userId: "u1", organizationId: 42, rating: 5, comment: "good", createdAt: new Date(), updatedAt: new Date() },
            { id: 2, appId: 5, userId: "u2", organizationId: 43, rating: 2, comment: null, createdAt: new Date(), updatedAt: new Date() },
        ]);
        const reviews = await appReviewsService.list(5, "u1", 42);
        expect(reviews.map((r) => r.mine)).toEqual([true, false]);
        for (const r of reviews) {
            expect(r).not.toHaveProperty("userId");
            expect(r).not.toHaveProperty("organizationId");
        }
    });

    it("rounds the average to one decimal", async () => {
        answers.push([{ appId: 5, average: "4.3333", count: "3" }]);
        expect((await appReviewsService.summaries([5])).get(5)).toEqual({ average: 4.3, count: 3 });
    });
});
