/**
 * /app/:slug could not say WHICH organization's deployment it meant.
 *
 * An app is deployed once per organization — app 824 exists as deployment 780 in org
 * 473 and 887 in org 291 — so the slug alone is ambiguous and the server had to pick
 * one. Which one it picked depended on session state and, before fe841ec58, on the
 * query planner. /o/:orgId/app/:slug supplies the missing half.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { appDeployments, apps, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { AppDeploymentService } from "@domain/apps/app-deployment.service.js";

const SLUG = `orgscope-test-${Date.now()}`;
let orgA = 0, orgB = 0, appId = 0;

beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [a] = await db.insert(orgs).values({ name: `Org Scope A ${stamp}` }).returning();
    const [b] = await db.insert(orgs).values({ name: `Org Scope B ${stamp}` }).returning();
    orgA = a.id; orgB = b.id;

    const [app] = await db.insert(apps).values({ name: `Scope App ${stamp}`, slug: SLUG }).returning();
    appId = app.id;

    // The same app, published in two organizations — the situation the bare slug cannot express.
    await db.insert(appDeployments).values([
        { appId, organizationId: orgA, publicSlug: SLUG, isPublished: true, status: "active", title: "Deployment A" },
        { appId, organizationId: orgB, publicSlug: `${SLUG}-b`, isPublished: true, status: "active", title: "Deployment B" },
    ]);
});

afterAll(async () => {
    await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
    await db.delete(apps).where(eq(apps.id, appId));
    await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
});

describe("org-scoped public app resolution", () => {
    it("returns org A's deployment when org A is named", async () => {
        const res = await AppDeploymentService.getBySlug(SLUG, orgA);
        expect(res?.deployment.title).toBe("Deployment A");
        expect(res?.deployment.organizationId).toBe(orgA);
    });

    it("returns org B's deployment for the same app slug when org B is named", async () => {
        // Matches through the app-slug fallback, since B's publicSlug differs.
        const res = await AppDeploymentService.getBySlug(SLUG, orgB);
        expect(res?.deployment.title).toBe("Deployment B");
        expect(res?.deployment.organizationId).toBe(orgB);
    });

    it("finds nothing for an organization that has no deployment of this app", async () => {
        expect(await AppDeploymentService.getBySlug(SLUG, 999999)).toBeNull();
    });

    it("still resolves without an org, for links already in circulation", async () => {
        const res = await AppDeploymentService.getBySlug(SLUG);
        expect(res).not.toBeNull();
        expect([orgA, orgB]).toContain(res!.deployment.organizationId);
    });

    it("is deterministic without an org — repeated calls agree", async () => {
        const first = await AppDeploymentService.getBySlug(SLUG);
        for (let i = 0; i < 4; i++) {
            const next = await AppDeploymentService.getBySlug(SLUG);
            expect(next!.deployment.id).toBe(first!.deployment.id);
        }
    });
});
