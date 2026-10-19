/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db } from '@server/database_service.js';
import { 
    users, 
    orgs, 
    apps as appsTable,
    appDeployments,
    userOrgs,
    adminRoles
} from '@shared/schema/index.js';
import { eq, like } from 'drizzle-orm';
import { passwordService } from '@server/domain/auth/core/password-service.js';
import { redis } from '@server/domain/core/infrastructure/redis/redis-client.js';

describe('Apps Pod API Deep Audit', () => {
    // Unique per run, like the username below. A fixed name plus an afterAll that
    // left the org behind meant this suite passed exactly once per database and
    // then failed forever on orgs_name_unique.
    let testOrgName = `Apps Audit Org ${Date.now()}`;
    let testUsername = `apps_audit_${Date.now()}`;
    let testEmail = `apps_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let testAppId: number;
    let testDeploymentId: number;

    beforeAll(async () => {
        await serverReady;

        // --- AUTH SETUP ---
        const [org] = await db.insert(orgs).values({ name: testOrgName }).returning();
        testOrgId = org.id;

        const hashedPassword = await passwordService.hashPassword(testPassword);
        const [insertedUser] = await db.insert(users).values({
            email: testEmail,
            password: hashedPassword,
            username: testUsername,
            defaultOrgId: testOrgId,
        }).returning();

        await db.insert(userOrgs).values({ userId: insertedUser.id, orgId: testOrgId });
        await db.insert(adminRoles).values({ userId: insertedUser.id, role: 'super_admin' });

        const loginRes = await request(app).post('/api/login').send({
            username: testUsername,
            password: testPassword
        });
        authCookie = loginRes.header['set-cookie'] as unknown as string[];

        const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', authCookie);
        csrfToken = csrfRes.body.csrfToken;

        // --- SEED TEST APP ---
        const [newApp] = await db.insert(appsTable).values({
            name: `Audit App ${Date.now()}`,
            slug: `audit-app-${Date.now()}`,
            description: 'Test App for functional audit',
            isPublic: true,
            // A developer org's app offered to others: a listing, not an org's own install copy,
            // which the marketplace leaves out.
            distribution: 'listed',
            developerOrgId: testOrgId,
            version: '1.0.0'
        }).returning();
        testAppId = newApp.id;

        // --- CACHE INVALIDATION ---
        await redis.del('apps:market:true');
        await redis.del('apps:market:false');
    });

    afterAll(async () => {
        if (testAppId) {
            await db.delete(appsTable).where(eq(appsTable.id, testAppId));
        }
        await db.delete(users).where(like(users.username, 'apps_audit_%'));
        if (testOrgId) {
            // userOrgs and adminRoles cascade from users; the org itself does not, and
            // leaving it is what broke every rerun.
            await db.delete(appDeployments).where(eq(appDeployments.organizationId, testOrgId));
            await db.delete(orgs).where(eq(orgs.id, testOrgId));
        }
    });

    describe('Marketplace & Installation', () => {
        it('should list available apps in the marketplace via GET /api/apps/market', async () => {
            const res = await request(app)
                .get('/api/apps/market')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            const found = res.body.find((a: any) => a.id === testAppId);
            expect(found).toBeDefined();
            expect(found.name).toContain('Audit App');
        });

        it('should install an app via POST /api/apps/install', async () => {
            const res = await request(app)
                .post('/api/apps/install')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ appId: testAppId });

            expect(res.status).toBe(200);
            expect(res.body.appId).toBe(testAppId);
            expect(res.body.status).toBe('installed');
            testDeploymentId = res.body.id;
        });

        it('should list installed apps via GET /api/apps/installed', async () => {
            const res = await request(app)
                .get('/api/apps/installed')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            
            // service returns [{ deployment, app }]
            const found = res.body.find((d: any) => d.deployment.id === testDeploymentId);
            expect(found).toBeDefined();
            expect(found.app.id).toBe(testAppId);
        });
    });

    describe('Deployment Management', () => {
        it('should retrieve deployment settings via GET /api/apps/:id/deploy', async () => {
            const res = await request(app)
                .get(`/api/apps/${testAppId}/deploy`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(testDeploymentId);
        });

        it('should update deployment publishing settings via POST /api/apps/:id/deploy', async () => {
            const res = await request(app)
                .post(`/api/apps/${testAppId}/deploy`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    publicSlug: `audit-slug-${Date.now()}`,
                    title: 'Published Audit App',
                    accessPolicy: 'password',
                    password: 'secret-audit-pass'
                });

            expect(res.status).toBe(200);
            expect(res.body.accessPolicy).toBe('password');
            expect(res.body.accessPasswordHash).toBeDefined();
        });

        /**
         * Publishing stopped being a visibility toggle: the route starts the app
         * and probes it for readiness first, so a public URL can never point at
         * something that has not answered. This app is a seeded row that was
         * never built, so the refusal is the contract — the test used to send
         * isPublished:true alongside the settings above and expect 200.
         */
        it('refuses to publish an app that has not been prepared', async () => {
            const res = await request(app)
                .post(`/api/apps/${testAppId}/deploy`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ publicSlug: `audit-slug-${Date.now()}`, isPublished: true });

            expect(res.status).toBe(400);
            expect(String(res.body?.error?.message ?? res.body?.message)).toMatch(/deploy|readiness|publish/i);
        });

        it('should retrieve app analytics via GET /api/apps/:id/analytics', async () => {
            const res = await request(app)
                .get(`/api/apps/${testAppId}/analytics`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body).toBeDefined();
            // Deployment analytics might be empty initially but the structure should be returned
        });
    });

    describe('Cleanup', () => {
        it('should uninstall an app via DELETE /api/apps/:id/deploy', async () => {
            const res = await request(app)
                .delete(`/api/apps/${testAppId}/deploy`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify uninstallation
            const checkRes = await request(app)
                .get('/api/apps/installed')
                .set('Cookie', authCookie);
            const found = checkRes.body.find((d: any) => d.id === testDeploymentId);
            expect(found).toBeUndefined();
        });
    });
});
