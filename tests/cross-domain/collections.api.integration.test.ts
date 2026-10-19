/**
 * Collections API tests — aligned with docs/specs/oddjob_feature_reference.md (jobs, collections)
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '../../server/index';
import { db } from '@server/database_service.js';
import { jobCollections, jobs, jobCollectionItems } from '@shared/schema';
import { eq } from 'drizzle-orm';

describe('Collections API Integration Tests', () => {
    let testContext: {
        collectionId: number;
        jobId: number;
        internalToken: string;
    };

    beforeAll(async () => {
        await serverReady;
        // Set up internal token for auth bypass
        const internalToken = 'test-secret';
        vi.stubEnv('INTERNAL_API_SECRET', internalToken);
        vi.stubEnv('SESSION_SECRET', internalToken);

        // Create a test collection and job
        const [collection] = await db.insert(jobCollections).values({
            name: 'Integration Test Collection',
            organizationId: null,
            createdBy: 'test_user',
            securityReport: { riskLevel: 'low', analysis: 'Safe' }
        }).returning();

        const [job] = await db.insert(jobs).values({
            name: 'Test Job in Collection',
            type: 'api',
            config: { url: 'https://example.com' },
            organizationId: null,
            createdBy: 'test_user',
            tool: 'None'
        }).returning();

        await db.insert(jobCollectionItems).values({
            collectionId: collection.id,
            jobId: job.id
        });

        testContext = {
            collectionId: collection.id,
            jobId: job.id,
            internalToken
        };
    });

    afterAll(async () => {
        // Cleanup
        await db.delete(jobCollectionItems).where(eq(jobCollectionItems.collectionId, testContext.collectionId));
        await db.delete(jobs).where(eq(jobs.id, testContext.jobId));
        await db.delete(jobCollections).where(eq(jobCollections.id, testContext.collectionId));
    });

    describe('GET /api/collections', () => {
        it('should list collections with auth bypass', async () => {
            const response = await request(app)
                .get('/api/collections?organizationId=global')
                .set('x-internal-token', testContext.internalToken)
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
            const found = response.body.find((c: any) => c.id === testContext.collectionId);
            expect(found).toBeDefined();
            expect(found.name).toBe('Integration Test Collection');
            // listCollections projects an explicit column set and does not ship
            // security_report — a jsonb blob it deliberately leaves out of the
            // list view. The fixture stores one; it comes back from the detail
            // endpoint, which selects the whole row.
            expect(found.securityReport).toBeUndefined();
        });

        it('returns the stored security report from the detail endpoint', async () => {
            const response = await request(app)
                .get(`/api/collections/${testContext.collectionId}`)
                .set('x-internal-token', testContext.internalToken)
                .expect(200);

            expect(response.body.securityReport).toEqual({ riskLevel: 'low', analysis: 'Safe' });
        });
    });

    describe('POST /api/collections/:id/test-all', () => {
        it('should trigger batch tests for all jobs in collection', async () => {
            // Mock jobTestService to avoid actual execution if needed, 
            // but for integration we might want to let it run if it's safe.
            // Since it's an 'api' job, it might try to make a request.

            const response = await request(app)
                .post(`/api/collections/${testContext.collectionId}/test-all`)
                .set('x-internal-token', testContext.internalToken);

            if (response.status !== 200) {
                console.error('Test-all failed:', response.body);
            }

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('results');
            expect(Array.isArray(response.body.results)).toBe(true);
            expect(response.body.results.length).toBeGreaterThan(0);
            expect(response.body.results[0]).toHaveProperty('jobId', testContext.jobId);
        });
    });

    describe('Security Reports', () => {
        it('should persist and retrieve security reports', async () => {
            const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, testContext.collectionId));
            expect(collection.securityReport).toBeDefined();
            expect((collection.securityReport as any).riskLevel).toBe('low');
        });
    });
});
