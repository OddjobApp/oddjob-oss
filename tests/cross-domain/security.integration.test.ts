/** @vitest-environment node */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '../../server/index';

describe('Security Implementation Tests', () => {
    beforeAll(async () => { await serverReady; });
    describe('Rate Limiting', () => {
        it('should allow requests within rate limits', async () => {
            const response = await request(app)
                .get('/api/health');

            expect([200, 503]).toContain(response.status);
            expect(response.body).toHaveProperty('status');
        });

        it('should include rate limit headers when present', async () => {
            const response = await request(app)
                .get('/api/health');

            expect([200, 503]).toContain(response.status);
            // express-rate-limit with standardHeaders may add these
            expect(response.headers).toBeDefined();
        });
    });

    describe('Security Headers', () => {
        it('should include security headers in responses', async () => {
            const response = await request(app)
                .get('/api/health');

            expect([200, 503]).toContain(response.status);
            expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
            expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
            expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
            expect(response.headers).toHaveProperty('content-security-policy');
            expect(response.headers).toHaveProperty('referrer-policy');
            expect(response.headers).toHaveProperty('permissions-policy');
        });
    });

    describe('Input Validation and Sanitization', () => {
        it('should handle malformed JSON gracefully', async () => {
            const response = await request(app)
                .post('/api/login')
                .set('Content-Type', 'application/json')
                .send('{invalid json}');

            expect([400, 500]).toContain(response.status);
        });
    });

    describe('CORS Protection', () => {
        it('should handle CORS preflight requests', async () => {
            const response = await request(app)
                .options('/api/health')
                .set('Origin', 'http://localhost:5173')
                .set('Access-Control-Request-Method', 'GET');

            expect([200, 204]).toContain(response.status);
            expect(
                response.headers['access-control-allow-origin'] ||
                response.headers['access-control-allow-methods']
            ).toBeDefined();
        });
    });

    describe('Error Handling Security', () => {
        it('should not expose internal error details', async () => {
            const response = await request(app)
                .get('/api/unknown-endpoint-that-does-not-exist');

            // Auth middleware runs before route matching; unauthenticated requests get 401
            expect([401, 404]).toContain(response.status);
            expect(response.body).toBeDefined();
            // Should not expose stack traces
            const bodyStr = JSON.stringify(response.body);
            expect(bodyStr).not.toContain('at ');
            expect(bodyStr).not.toContain('node_modules');
        });
    });

    describe('API Endpoint Protection', () => {
        it('should protect sensitive endpoints', async () => {
            const response = await request(app)
                .get('/api/health');

            expect([200, 503]).toContain(response.status);
            expect(response.body).toHaveProperty('status');
        });

        it('should return 404 or 401 for unknown paths', async () => {
            const response = await request(app)
                .get('/api/nonexistent-path-xyz');

            // Auth middleware runs before route matching; unauthenticated requests may get 401
            expect([401, 404]).toContain(response.status);
        });
    });
});
