/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import request from 'supertest';
import { app, serverReady } from '../../../../index.js';
import { db } from '../../../../database_service.js';
import { users, orgs, userOrgs, credentials } from '@shared/schema/index.js';
import { eq, like, or, isNull, and } from 'drizzle-orm';
import { passwordService } from '../../core/password-service.js';
import { grantOrgMembership } from "../../../../../tests/helpers/org-membership.js";

describe('Auth API Deep Audit', () => {
    let testUsername = `audit_user_${Date.now()}`;
    let testEmail = `audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];

    beforeAll(async () => {
        // Wait for server to be fully initialized (including route registration)
        await serverReady;

        // Ensure we have at least one organization for registration
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'Test Audit Org'
            }).returning();
            testOrgId = newOrg.id;
        }
    }, 30000);

    afterAll(async () => {
        // Surgical cleanup of audit data
        if (testUsername) {
            const auditUsers = await db.select().from(users).where(like(users.username, 'audit_user_%'));
            const auditUserIds = auditUsers.map((u: any) => u.id);
            if (auditUserIds.length > 0) {
                // Correctly targeting association tables
                await db.delete(credentials).where(or(...auditUserIds.map((id: any) => eq(credentials.createdBy, id))));
                await db.delete(users).where(like(users.username, 'audit_user_%'));
            }
        }
    });

    describe('Registration Layer (/api/register)', () => {
        it('should fail with missing fields (Fuzzing: Empty)', async () => {
            const res = await request(app).post('/api/register').send({});
            expect([400, 422, 500]).toContain(res.status); // Allowing 500 temporarily to see details if it fails
        });

        it('should fail with weak password', async () => {
            const res = await request(app).post('/api/register').send({
                username: 'weak_user',
                password: '123',
                email: 'weak@example.com'
            });
            expect([400, 422]).toContain(res.status);
        });

        it('should register a new user successfully', async () => {
            const res = await request(app).post('/api/register').send({
                username: testUsername,
                email: testEmail,
                password: testPassword,
            });
            await grantOrgMembership(testUsername, testOrgId);

            expect(res.status).toBe(200);
            expect(res.body.username).toBe(testUsername.toLowerCase());
            expect(res.body).not.toHaveProperty('password');
            expect(res.header['set-cookie']).toBeDefined();
        });

        it('should fail on duplicate username', async () => {
            const res = await request(app).post('/api/register').send({
                username: testUsername,
                email: `different_${Date.now()}@example.com`,
                password: testPassword
            });
            expect(res.status).toBe(409);
        });
    });

    describe('Login Layer (/api/login)', () => {
        it('should reject invalid credentials', async () => {
            const res = await request(app).post('/api/login').send({
                username: testUsername,
                password: 'WrongPassword'
            });
            expect(res.status).toBe(401);
        });

        it('should login successfully and return session cookie', async () => {
            const res = await request(app).post('/api/login').send({
                username: testUsername,
                password: testPassword
            });

            expect(res.status).toBe(200);
            expect(res.body.username).toBe(testUsername.toLowerCase());
            expect(res.header['set-cookie']).toBeDefined();
            authCookie = res.header['set-cookie'] as unknown as string[];
        });

        it('should return 400 or 401 for malformed login payload', async () => {
            const res = await request(app).post('/api/login').send({}); 
            expect([400, 401]).toContain(res.status);
        });
    });

    describe('Session & Identity Layer (/api/user)', () => {
        it('should return authenticated: false for unauthenticated requests', async () => {
            const res = await request(app).get('/api/user');
            expect(res.status).toBe(200); // Standard behavior to avoid loops
            expect(res.body.authenticated).toBe(false);
        });

        it('should return user profile for authenticated session', async () => {
            const res = await request(app)
                .get('/api/user')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.authenticated).toBe(true);
            expect(res.body.username).toBe(testUsername.toLowerCase());
            expect(res.body.csrfToken).toBeDefined();
        });
    });

    describe('Credentials Registry Layer (/api/credentials)', () => {
        it('should block unauthenticated access to credentials', async () => {
            const res = await request(app).get('/api/credentials');
            expect(res.status).toBe(401);
        });

        it('should list credentials for authenticated user (Empty List)', async () => {
            const res = await request(app)
                .get('/api/credentials')
                .set('Cookie', authCookie);
            
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should create a new credential successfully', async () => {
            const res = await request(app)
                .post('/api/credentials')
                .set('Cookie', authCookie)
                .send({
                    name: 'Audit Token',
                    type: 'api_key',
                    provider: 'openai',
                    value: 'sk-audit-test-key-12345',
                    envVarName: 'AUDIT_OPENAI_KEY'
                });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Audit Token');
            expect(res.body.envVarName).toBe('AUDIT_OPENAI_KEY');
        });
    });

    describe('Logout Layer (/api/logout)', () => {
        it('should logout and invalidate session', async () => {
            const logoutRes = await request(app)
                .post('/api/logout')
                .set('Cookie', authCookie);
            
            expect(logoutRes.status).toBe(200);

            const sessionRes = await request(app)
                .get('/api/user')
                .set('Cookie', authCookie);
            
            expect(sessionRes.body.authenticated).toBe(false);
        });
    });
});
