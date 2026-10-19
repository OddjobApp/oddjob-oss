/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '../../../../index.js';
import { db } from '../../../../database_service.js';
import { 
    users, 
    orgs, 
    userOrgs,
    adminRoles
} from '@shared/schema/index.js';
import { eq, like, and } from 'drizzle-orm';
import { passwordService } from '../../core/password-service.js';

describe('Org/Admin Pod API Deep Audit', () => {
    let testUsername = `org_audit_${Date.now()}`;
    let testEmail = `org_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let secondaryOrgId: number;
    let secondaryUserId: string;

    beforeAll(async () => {
        await serverReady;

        // --- AUTH SETUP (Super Admin) ---
        // Generated per run. orgs.name is UNIQUE and the previous fixed name survived
        // teardown, so the first run poisoned every later one with
        // "duplicate key value violates unique constraint orgs_name_unique" — a suite
        // that passes once and then fails forever, which reads like a code regression.
        const [org] = await db.insert(orgs).values({
            name: `Org Audit Root ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }).returning();
        testOrgId = org.id;

        const hashedPassword = await passwordService.hashPassword(testPassword);
        const [insertedUser] = await db.insert(users).values({
            email: testEmail,
            password: hashedPassword,
            username: testUsername,
            defaultOrgId: testOrgId
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
    });

    afterAll(async () => {
        await db.delete(users).where(like(users.username, 'org_audit_%'));
        // Best-effort org cleanup. Not the fix for the collision — the per-run name
        // above is — because an org that a test has touched may be referenced by tables
        // without ON DELETE CASCADE (forensic_event_log is one), and a teardown that
        // throws would fail a suite whose assertions all passed. Warn instead, so
        // accumulating rows stay visible rather than silently swallowed.
        for (const orgId of [testOrgId, secondaryOrgId].filter(Boolean) as number[]) {
            await db.delete(orgs).where(eq(orgs.id, orgId)).catch((err) => {
                console.warn(`[org_api_deep_audit] could not remove test org ${orgId}: ${err?.message ?? err}`);
            });
        }
    });

    describe('Organizations Management', () => {
        it('should create a new organization via POST /api/admin/organizations', async () => {
            const res = await request(app)
                .post('/api/admin/organizations')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ name: `Sub-Org ${Date.now()}` });

            expect(res.status).toBe(201);
            expect(res.body.organization.name).toContain('Sub-Org');
            secondaryOrgId = res.body.organization.id;
        });

        it('should list organizations via GET /api/admin/organizations', async () => {
            const res = await request(app)
                .get('/api/admin/organizations')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.organizations)).toBe(true);
            expect(res.body.organizations.find((o: any) => o.id === secondaryOrgId)).toBeDefined();
        });

        it('should get organization details via GET /api/admin/organizations/:id', async () => {
            const res = await request(app)
                .get(`/api/admin/organizations/${secondaryOrgId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.organization.id).toBe(secondaryOrgId);
        });

        it('should update organization via PUT /api/admin/organizations/:id', async () => {
            const res = await request(app)
                .put(`/api/admin/organizations/${secondaryOrgId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ name: 'Updated Org Name' });

            expect(res.status).toBe(200);
            expect(res.body.organization.name).toBe('Updated Org Name');
        });
    });

    describe('User-Organization Mapping', () => {
        it('should create a test user for mapping via POST /api/admin/users', async () => {
            const res = await request(app)
                .post('/api/admin/users')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    username: `org_audit_user_${Date.now()}`,
                    password: 'Password123!',
                    email: `user_${Date.now()}@example.com`,
                    organizationId: testOrgId
                });

            expect(res.status).toBe(201);
            secondaryUserId = res.body.id;
        });

        it('should add user to secondary organization via POST /api/admin/organizations/:id/users', async () => {
            const res = await request(app)
                .post(`/api/admin/organizations/${secondaryOrgId}/users`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ userId: secondaryUserId });

            expect(res.status).toBe(201);
        });

        it('should list users in organization via GET /api/admin/organizations/:id/users', async () => {
            const res = await request(app)
                .get(`/api/admin/organizations/${secondaryOrgId}/users`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            // Service returns array of { userId, username, email, firstName, lastName }
            expect(res.body.users.find((u: any) => u.userId === secondaryUserId)).toBeDefined();
        });
    });

    describe('Admin Roles', () => {
        it('should assign a role via POST /api/admin/roles', async () => {
            const res = await request(app)
                .post('/api/admin/roles')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    userId: secondaryUserId,
                    roleType: 'org_admin',
                    organizationId: secondaryOrgId
                });

            expect(res.status).toBe(201);
        });

        it('should list admin roles via GET /api/admin/roles', async () => {
            const res = await request(app)
                .get('/api/admin/roles')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.find((r: any) => r.userId === secondaryUserId)).toBeDefined();
        });
    });

    describe('Settings Routing', () => {
        it('should retrieve org settings via GET /api/org-settings (Settings Router)', async () => {
            const res = await request(app)
                .get('/api/org-settings')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body).toBeDefined();
        });

        it('should update org settings via PUT /api/org-settings (Settings Router)', async () => {
            const res = await request(app)
                .put('/api/org-settings')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ retentionDays: 30 });

            expect(res.status).toBe(200);
            // Verify update if model supports it
        });
    });

    describe('Cleanup (Integration-level)', () => {
        it('should remove user from organization via DELETE /api/admin/organizations/:id/users/:userId', async () => {
            const res = await request(app)
                .delete(`/api/admin/organizations/${secondaryOrgId}/users/${secondaryUserId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);

            expect(res.status).toBe(204);
        });

        it('should delete organization via DELETE /api/admin/organizations/:id', async () => {
            const res = await request(app)
                .delete(`/api/admin/organizations/${secondaryOrgId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);

            expect(res.status).toBe(204);
        });
    });
});
