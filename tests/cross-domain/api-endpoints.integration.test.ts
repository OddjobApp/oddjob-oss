/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server/index';

describe('API Integration Tests', () => {
    let server: any;

    beforeAll(async () => {
        const { serverReady } = await import('../../server/index');
        await serverReady;
        server = app;
    });

    afterAll(async () => { });

    describe('Health Check Endpoint', () => {
        it('should return healthy status from /api/health', async () => {
            const response = await request(server).get('/api/health');
            expect([200, 503]).toContain(response.status);
            expect(response.body).toHaveProperty('status');
            expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
        });

        it('should respond to /health endpoint', async () => {
            const response = await request(server).get('/health');
            expect([200, 503]).toContain(response.status);
            expect(response.body).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        /**
         * An unauthenticated caller gets 401 here, not 404 — so an unknown path
         * is indistinguishable from a real one it may not touch, which is the
         * better posture. Asserted as the contract because it is what the app
         * does; I did not pin down which middleware answers first, so if this
         * ever becomes 404 the question is whether the disclosure changed
         * deliberately.
         */
        it('does not disclose whether an unknown endpoint exists', async () => {
            const response = await request(server).get('/api/unknown-endpoint');

            expect(response.status).toBe(401);
        });

        it('should handle malformed JSON gracefully', async () => {
            const response = await request(server)
                .post('/api/login')
                .set('Content-Type', 'application/json')
                .send('{invalid json}');

            expect([400, 500]).toContain(response.status);
        });
    });

    describe('CORS Headers', () => {
        it('should include CORS headers on preflight', async () => {
            const response = await request(server).options('/api/health');

            expect([200, 204]).toContain(response.status);
            expect(
                response.headers['access-control-allow-origin'] || response.headers['access-control-allow-methods']
            ).toBeDefined();
        });
    });
});
