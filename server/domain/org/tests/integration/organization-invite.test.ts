/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '../../../../index.js';
import { db } from '../../../../database_service.js';
import { users, orgs, userOrgs, adminRoles, organizationInvites } from '@shared/schema/index.js';
import { eq, like, and } from 'drizzle-orm';
import { passwordService } from '../../../auth/core/password-service.js';

describe('Organization Invite API', () => {
    let testUsername = `invite_admin_${Date.now()}`;
    let testEmail = `invite_admin_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;

    beforeAll(async () => {
        await serverReady;

        const [org] = await db.insert(orgs).values({
            name: `Invite Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }).returning();
        testOrgId = org.id;

        const hashedPassword = await passwordService.hashPassword(testPassword);
        const [insertedUser] = await db.insert(users).values({
            email: testEmail,
            password: hashedPassword,
            username: testUsername,
            defaultOrgId: testOrgId,
        }).returning();

        await db.insert(userOrgs).values({ userId: insertedUser.id, orgId: testOrgId });
        await db.insert(adminRoles).values({ userId: insertedUser.id, role: 'org_admin', organizationId: testOrgId });

        const loginRes = await request(app).post('/api/login').send({
            username: testUsername,
            password: testPassword,
        });
        authCookie = loginRes.header['set-cookie'] as unknown as string[];

        const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', authCookie);
        csrfToken = csrfRes.body.csrfToken;
    });

    afterAll(async () => {
        await db.delete(organizationInvites).where(eq(organizationInvites.organizationId, testOrgId));
        await db.delete(users).where(and(
            eq(users.defaultOrgId, testOrgId),
            like(users.username, 'accept_%'),
        ));
        await db.delete(users).where(like(users.username, 'invite_%'));
        await db.delete(orgs).where(eq(orgs.id, testOrgId));
    });

    it('creates an invite as an org admin', async () => {
        const res = await request(app)
            .post('/api/admin/invites')
            .set('Cookie', authCookie)
            .set('x-csrf-token', csrfToken)
            .send({ email: 'newuser@example.com', role: 'operator' });

        expect(res.status).toBe(201);
        expect(res.body.invite.organizationId).toBe(testOrgId);
        expect(res.body.invite.email).toBe('newuser@example.com');
        expect(res.body.token).toHaveLength(64);
    });

    it('lists pending invites for an organization', async () => {
        const res = await request(app)
            .get('/api/admin/invites')
            .set('Cookie', authCookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.invites)).toBe(true);
        expect(res.body.invites.some((i: any) => i.email === 'newuser@example.com')).toBe(true);
    });

    it('verifies an invite token publicly', async () => {
        const createRes = await request(app)
            .post('/api/admin/invites')
            .set('Cookie', authCookie)
            .set('x-csrf-token', csrfToken)
            .send({ email: 'verify@example.com', role: 'operator' });

        const token = createRes.body.token;

        const res = await request(app).get(`/api/invites/verify?token=${token}`);
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.organization.id).toBe(testOrgId);
    });

    it('accepts an invite and creates a user in the organization', async () => {
        const unique = `accept_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createRes = await request(app)
            .post('/api/admin/invites')
            .set('Cookie', authCookie)
            .set('x-csrf-token', csrfToken)
            .send({ email: `${unique}@example.com`, role: 'operator' });

        const token = createRes.body.token;

        const res = await request(app)
            .post('/api/invites/accept')
            .set('x-csrf-token', csrfToken)
            .send({
                token,
                username: unique,
                email: `${unique}@example.com`,
                password: 'Password123!',
                tosAccepted: true,
                privacyPolicyAccepted: true,
            });

        expect(res.status).toBe(201);
        expect(res.body.defaultOrgId).toBe(testOrgId);
        expect(res.body.email).toBe(`${unique}@example.com`);
    });
});
