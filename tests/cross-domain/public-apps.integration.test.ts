/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db } from '@server/database_service.js';
import { apps, appDeployments, orgs } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@server/domain/auth/index.js';

describe('Public Apps API Integration', () => {
    let server: any;
    let orgId: number;
    let testAppId: number;
    let testPasswordAppId: number;
    let testDeploymentId: number;
    const testSlug = 'test-public-app-' + Date.now();
    const testPasswordSlug = 'test-pw-app-' + Date.now();
    const plainPassword = 'super-secret';

    beforeAll(async () => {
        await serverReady;
        server = app;

        // Setup test data
        const [org] = await db.insert(orgs).values({
            name: 'Test Org Public Apps'
        }).returning();
        orgId = org.id;

        // apps.name is globally unique, exactly like apps.slug — and at least ten
        // suites insert the literal 'Test App'. The slug was already being
        // uniquified here; the name was not, so running alongside any of them
        // failed beforeAll on apps_name_unique and this suite ran zero tests.
        const runId = Date.now();
        const [testApp] = await db.insert(apps).values({
            name: `Test App ${runId}`,
            slug: 'test-app-' + runId,
            description: 'Test description',
            isPublic: true,
            isSystem: false,
            version: '1.0.0'
        }).returning();
        testAppId = testApp.id;

        // app_deployments carries a UNIQUE (organization_id, app_id) index, so one
        // org cannot hold two deployments of the same app. The password-protected
        // deployment below therefore needs its own app row; previously both used
        // testAppId and the second insert failed the constraint, so this suite never
        // got past beforeAll and ran zero tests.
        const [pwdApp] = await db.insert(apps).values({
            name: `Test App (password) ${runId}`,
            slug: 'test-app-pw-' + runId,
            description: 'Password protected test app',
            isPublic: true,
            isSystem: false,
            version: '1.0.0'
        }).returning();
        testPasswordAppId = pwdApp.id;

        // Create a public deployment
        const [deployment1] = await db.insert(appDeployments).values({
            appId: testAppId,
            organizationId: orgId,
            status: 'installed',
            isPublished: true,
            publicSlug: testSlug,
            title: 'My Public App',
            accessPolicy: 'public',
            config: {}
        }).returning();
        testDeploymentId = deployment1.id;

        // Create a password protected deployment
        const pwdHash = await hashPassword(plainPassword);
        await db.insert(appDeployments).values({
            appId: testPasswordAppId,
            organizationId: orgId,
            status: 'installed',
            isPublished: true,
            publicSlug: testPasswordSlug,
            title: 'My PW App',
            accessPolicy: 'password',
            accessPasswordHash: pwdHash,
            config: {}
        });
    });

    afterAll(async () => {
        // Cleanup test data
        await db.delete(appDeployments).where(eq(appDeployments.appId, testAppId));
        await db.delete(appDeployments).where(eq(appDeployments.appId, testPasswordAppId));
        await db.delete(apps).where(eq(apps.id, testAppId));
        await db.delete(apps).where(eq(apps.id, testPasswordAppId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it('should fetch public deployment by slug', async () => {
        const response = await request(server).get(`/api/public/apps/${testSlug}`);
        expect(response.status).toBe(200);
        expect(response.body.title).toBe('My Public App');
        expect(response.body.appId).toBe(testAppId);
    });

    it('should return 404 for non-existent slug', async () => {
        const response = await request(server).get(`/api/public/apps/does-not-exist-123`);
        expect(response.status).toBe(404);
    });

    it('should return 401 for password protected app when fetching', async () => {
        const response = await request(server).get(`/api/public/apps/${testPasswordSlug}`);
        expect(response.status).toBe(401);
        expect(response.body.error?.message || response.body.message).toContain('Password required');
    });

    it('should authenticate correctly with valid password', async () => {
        const response = await request(server)
            .post(`/api/public/apps/${testPasswordSlug}/auth`)
            .send({ password: plainPassword });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it('should fail authentication with invalid password', async () => {
        const response = await request(server)
            .post(`/api/public/apps/${testPasswordSlug}/auth`)
            .send({ password: 'wrong-password' });

        expect(response.status).toBe(401);
        expect(response.body.error?.message || response.body.message).toContain('Invalid password');
    });
});
