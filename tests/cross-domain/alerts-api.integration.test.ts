/**
 * Boots the real Express app through supertest, so it needs the node
 * environment — under jsdom this fails to collect with esbuild's
 * "new TextEncoder().encode('') instanceof Uint8Array is incorrectly false".
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app as server, serverReady } from '../../server/index';

describe('Alerts API', () => {
    // server/index exports `app` immediately but registers routes asynchronously via
    // BootstrapService.initialize, exposed as the `serverReady` promise. Without
    // awaiting it the routers are not mounted yet and every request fell through to a
    // 503 rather than hitting the alerts router.
    beforeAll(async () => {
        await serverReady;
    }, 60_000);

    // Both endpoints require authentication. These asserted 200 and an array body,
    // which no unauthenticated caller can get — and the suite has no authenticated
    // fixture (its sibling api-endpoints.integration.test.ts only exercises health and 404 for
    // the same reason). Asserting the guard is what can honestly be verified here:
    // the routes are mounted and they are not open. Exercising the payload needs an
    // authenticated request helper, which does not exist in this suite yet.
    it('requires authentication for alert configurations', async () => {
        const response = await request(server).get('/api/alerts');
        expect(response.status).toBe(401);
    });

    it('requires authentication for alert history', async () => {
        const response = await request(server).get('/api/alerts/history');
        expect(response.status).toBe(401);
    });

    it('mounts the alerts router rather than falling through', async () => {
        // Guards the bug this file was actually hiding: before serverReady was
        // awaited, these requests returned 503 because no router was mounted yet.
        const response = await request(server).get('/api/alerts');
        expect(response.status).not.toBe(503);
        expect(response.status).not.toBe(404);
    });
});
