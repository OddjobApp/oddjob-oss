/** @vitest-environment node */
/**
 * GET /api/datasets/collections
 *
 * The route did not exist, so Express fell through to "/:id", parseInt("collections")
 * gave NaN, and the dataset lookup 500'd. Its only caller (TagInput's collection
 * suggestions in the App Hookups tab) treats a non-OK response as an empty list, so
 * the suggestions were silently always empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db } from '@server/database_service.js';
import { users, orgs, apps as appsTable, appRecords, userOrgs } from '@shared/schema/index.js';
import { eq, like } from 'drizzle-orm';
import { passwordService } from '@server/domain/auth/core/password-service.js';

describe('GET /api/datasets/collections', () => {
    const stamp = Date.now();
    const testUsername = `dscoll_${stamp}`;
    const testPassword = 'Password123!';

    let orgId: number;
    let otherOrgId: number;
    let appId: number;
    let otherAppId: number;
    let authCookie: string[];

    beforeAll(async () => {
        await serverReady;

        const [org] = await db.insert(orgs).values({ name: `DS Coll Org ${stamp}` }).returning();
        orgId = org.id;
        const [otherOrg] = await db.insert(orgs).values({ name: `DS Coll Other Org ${stamp}` }).returning();
        otherOrgId = otherOrg.id;

        const [user] = await db.insert(users).values({
            email: `dscoll_${stamp}@example.com`,
            password: await passwordService.hashPassword(testPassword),
            username: testUsername,
            defaultOrgId: orgId,
        }).returning();
        await db.insert(userOrgs).values({ userId: user.id, orgId });

        const [ownApp] = await db.insert(appsTable).values({
            name: `DS Coll App ${stamp}`,
            slug: `ds-coll-app-${stamp}`,
            developerOrgId: orgId,
            version: '1.0.0',
        }).returning();
        appId = ownApp.id;

        const [foreignApp] = await db.insert(appsTable).values({
            name: `DS Coll Foreign App ${stamp}`,
            slug: `ds-coll-foreign-app-${stamp}`,
            developerOrgId: otherOrgId,
            version: '1.0.0',
        }).returning();
        otherAppId = foreignApp.id;

        // Two collections for our org, one of them with several records so the
        // response is proven to be DISTINCT rather than one row per record.
        await db.insert(appRecords).values([
            { appId, orgId, collection: 'incidents', recordId: 'r1', data: {} },
            { appId, orgId, collection: 'incidents', recordId: 'r2', data: {} },
            { appId, orgId, collection: 'assets', recordId: 'r3', data: {} },
            // Another tenant's collection, which must never appear.
            { appId: otherAppId, orgId: otherOrgId, collection: 'foreign_secrets', recordId: 'r4', data: {} },
        ]);

        const loginRes = await request(app)
            .post('/api/login')
            .send({ username: testUsername, password: testPassword });
        authCookie = loginRes.header['set-cookie'] as unknown as string[];
    });

    afterAll(async () => {
        await db.delete(appRecords).where(eq(appRecords.orgId, orgId));
        await db.delete(appRecords).where(eq(appRecords.orgId, otherOrgId));
        if (appId) await db.delete(appsTable).where(eq(appsTable.id, appId));
        if (otherAppId) await db.delete(appsTable).where(eq(appsTable.id, otherAppId));
        await db.delete(users).where(like(users.username, `dscoll_${stamp}`));
        if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
        if (otherOrgId) await db.delete(orgs).where(eq(orgs.id, otherOrgId));
    });

    it('returns the org\'s distinct collection names, sorted', async () => {
        const res = await request(app)
            .get('/api/datasets/collections')
            .set('Cookie', authCookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toEqual(['assets', 'incidents']);
    });

    // Regression: without its own route this path was read as a dataset id.
    it('is not parsed as a dataset id', async () => {
        const res = await request(app)
            .get('/api/datasets/collections')
            .set('Cookie', authCookie);

        expect(res.status).not.toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/Failed query|NaN/i);
    });

    it('never leaks another organization\'s collections', async () => {
        const res = await request(app)
            .get('/api/datasets/collections')
            .set('Cookie', authCookie);

        expect(res.body).not.toContain('foreign_secrets');
    });

    it('requires authentication', async () => {
        const res = await request(app).get('/api/datasets/collections');
        expect([401, 403]).toContain(res.status);
    });
});
