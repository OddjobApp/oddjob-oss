/**
 * Pipeline tests — aligned with docs/specs/MASTER_INTELLIGENT_AUTOMATION_SPEC.md, TRANSFORMATION_NODES.md
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testPipeline, createMockExecution, createMockStep } from '../../../../../tests/helpers/test-utils.js';
import { fixtures } from '../../../../../tests/fixtures/index.js';
import { clearPipelineTables, createTestUser, deleteTestUser, ensurePipelineRuntimeReady } from '../../../../../tests/cross-domain/helpers.js';
import { pipelineService } from '@server/domain/pipeline/core/pipeline.service.js';
import { db } from '@server/database_service.js';
import { jobs } from '@shared/schema/index.js';
import type { OrgContext } from '@server/utils/auth-context.js';

const mockApiResponse = { data: 'mocked' };

// Pipeline step execution calls assertOrgId, so a null-org pipeline now fails with
// "Organization context required" before running. Org 1 is seeded by
// `npm run test:db:setup`.
const TEST_ORG_ID = 1;

describe('Pipeline Testing Framework', () => {
    let userId: string;
    let testUserDbId: string;

    beforeEach(async () => {
        process.env.DISABLE_JOB_QUEUE = 'true';

        // Executors and hooks are registered by the entrypoints, which tests skip.
        await ensurePipelineRuntimeReady();

        await clearPipelineTables();
        const user = await createTestUser();
        userId = user.id;
        testUserDbId = user.id;

        // Mock fetch to avoid real HTTP calls and speed up tests.
        // Must return Response-like object with .text() and .json() for all URLs (ErrorDiagnosisEngine, gateways, etc.)
        const createMockResponse = (status: number, body: any) => ({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(),
            text: async () => typeof body === 'string' ? body : JSON.stringify(body),
            json: async () => typeof body === 'string' ? JSON.parse(body) : body,
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string | Request) => {
            const u = typeof url === 'string' ? url : (url as Request).url;
            if (u.includes('/ok')) return createMockResponse(200, { ok: true });
            if (u.includes('/404')) return createMockResponse(500, { error: 'fail' });
            if (u.includes('/api')) return createMockResponse(200, mockApiResponse);
            // Default for other URLs (e.g. Google API) - return valid structure to avoid "text is not a function"
            return createMockResponse(200, {});
        }));

        // Create jobs for pipelines
        const [simpleJob] = await db.insert(jobs).values({
            name: 'Simple Test Job',
            type: 'api',
            tool: 'http',
            config: { url: 'https://example.com/ok', method: 'GET' },
            organizationId: TEST_ORG_ID,
            createdBy: userId,
        }).returning();

        const [failingJob] = await db.insert(jobs).values({
            name: 'Failing Job',
            type: 'api',
            tool: 'http',
            config: { url: 'https://example.com/404', method: 'GET' },
            organizationId: TEST_ORG_ID,
            createdBy: userId,
        }).returning();

        const [apiJob] = await db.insert(jobs).values({
            name: 'API Call Job',
            type: 'api',
            tool: 'http',
            config: { url: 'https://example.com/api', method: 'GET' },
            organizationId: TEST_ORG_ID,
            createdBy: userId,
        }).returning();

        const orgContext: OrgContext = {
            organizationId: TEST_ORG_ID, 
            userId,
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false
        };

        // simple-test: succeeds with mocked 200 response
        await pipelineService.create({
            name: 'simple-test',
            triggerType: 'manual',
            steps: [{ jobId: simpleJob.id, order: 0 }],
        }, orgContext);

        // failing-pipeline: fails with mocked 500 response
        await pipelineService.create({
            name: 'failing-pipeline',
            triggerType: 'manual',
            steps: [{ jobId: failingJob.id, order: 0 }],
        }, orgContext);

        // api-pipeline: step with outputName for mock
        await pipelineService.create({
            name: 'api-pipeline',
            triggerType: 'manual',
            steps: [{ jobId: apiJob.id, order: 0, outputName: 'api-call-step' }],
        }, orgContext);
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        await deleteTestUser(testUserDbId);
    });

    describe('testPipeline', () => {
        it('should execute a simple pipeline', async () => {
            const result = await testPipeline('simple-test', {
                input: { test: 'data' },
                mocks: {},
                timeout: 15000
            });

            expect(result).toBeDefined();
            expect(result.status).toBe('completed');
        }, 20000);

        it('should handle pipeline failures', async () => {
            const result = await testPipeline('failing-pipeline', {
                input: {},
                mocks: {},
                timeout: 15000
            });

            expect(result.status).toBe('failed');
            expect(result.error).toBeDefined();
        }, 20000);

        it('should support step mocking', async () => {
            const result = await testPipeline('api-pipeline', {
                input: {},
                mocks: { 'api-call-step': mockApiResponse },
                timeout: 15000
            });

            const output = result.steps[0]?.output;
            const parsed = typeof output === 'string' ? JSON.parse(output || '{}') : output;
            expect(parsed).toEqual(mockApiResponse);
        }, 20000);
    });

    describe('Mock Execution', () => {
        it('should create mock execution', () => {
            const execution = createMockExecution({
                pipelineId: 1,
                status: 'running'
            });

            expect(execution.id).toBeDefined();
            expect(execution.pipelineId).toBe(1);
            expect(execution.status).toBe('running');
        });

        it('should create mock step', () => {
            const step = createMockStep({
                stepOrder: 1,
                jobType: 'curl',
                status: 'completed'
            });

            expect(step.id).toBeDefined();
            expect(step.stepOrder).toBe(1);
            expect(step.status).toBe('completed');
        });
    });

    describe('Fixtures', () => {
        it('should provide JIRA mock data', () => {
            expect(fixtures.jiraResponse).toBeDefined();
            expect(fixtures.jiraResponse.issues).toBeInstanceOf(Array);
        });

        it('should provide Slack mock data', () => {
            expect(fixtures.slackResponse).toBeDefined();
            expect(fixtures.slackResponse.ok).toBe(true);
        });
    });
});
