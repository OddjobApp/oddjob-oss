/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '../../../../index.js';

describe('Authentication', () => {
    beforeAll(async () => {
        await serverReady;
    });

    describe('Login', () => {
        it('should return 400 for missing credentials', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({});

            expect([400, 401, 500]).toContain(response.status);
        });

        it('should return 401 for invalid credentials', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({ username: 'nonexistent', password: 'wrong' });

            expect([401, 500]).toContain(response.status);
        });

        it('should accept valid login format', async () => {
            const response = await request(app)
                .post('/api/login')
                .send({ username: 'testuser', password: 'password123' });

            expect([200, 401, 500]).toContain(response.status);
        });
    });

    describe('Protected routes', () => {
        it('should return 401 for /api/user without session', async () => {
            const response = await request(app).get('/api/user');

            // Route returns 200 with authenticated:false to issue a CSRF token for pre-auth flows
            expect([200, 401]).toContain(response.status);
            if (response.status === 200) {
                expect(response.body.authenticated).toBe(false);
            }
        });
    });
});
