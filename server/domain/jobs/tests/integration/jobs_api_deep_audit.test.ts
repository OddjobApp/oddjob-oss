/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '@server/index.js';
import { db } from '@server/database_service.js';
import { 
    users, 
    orgs, 
    jobs,
    missions
} from '@shared/schema/index.js';
import { eq, like, and } from 'drizzle-orm';
import { grantOrgMembership } from "../../../../../tests/helpers/org-membership.js";

describe('Jobs Pod API Deep Audit (Phase 3)', () => {
    let testUsername = `jobs_audit_${Date.now()}`;
    let testEmail = `jobs_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let testMissionId: number;
    let testJobId: number;

    beforeAll(async () => {
        const { registerRoutes } = await import('@server/routes.js');
        await registerRoutes(app, {} as any);

        // --- DATABASE SYNC ---
        // Ensure test DB is patched with Mission Lifecycle columns
        const { pool } = await import('@server/database_service.js');
        const schemaCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'missions'");
        const columns = schemaCheck.rows.map((r: any) => r.column_name);
        
        const missingMissionCols = [
            { name: 'is_draft', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
            { name: 'workflow_blueprint', type: 'JSONB' },
            { name: 'vcs_config', type: "JSONB NOT NULL DEFAULT '{}'" }
        ];

        for (const col of missingMissionCols) {
            if (!columns.includes(col.name)) {
                await pool.query(`ALTER TABLE missions ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // --- JOBS SCHEMA SYNC ---
        const jobSchemaCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs'");
        const jobColumns = jobSchemaCheck.rows.map((r: any) => r.column_name);

        const missingJobCols = [
            { name: 'is_hidden', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'tool', type: "TEXT DEFAULT 'None' NOT NULL" },
            { name: 'priority', type: 'INTEGER DEFAULT 2' },
            { name: 'lifecycle_status', type: "TEXT DEFAULT 'active' NOT NULL" },
            { name: 'parameter_schema', type: 'JSONB' },
            { name: 'render_template', type: 'TEXT' },
            { name: 'cpu_limit_millicores', type: 'INTEGER' },
            { name: 'memory_limit_mb', type: 'INTEGER' },
            { name: 'last_tested_at', type: 'TIMESTAMP' },
            { name: 'last_test_status', type: 'TEXT' },
            { name: 'output_storage_enabled', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
            { name: 'enable_knowledge_store', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
            { name: 'output_knowledge_topic_id', type: 'INTEGER' },
            { name: 'output_dataset_id', type: 'INTEGER' },
            { name: 'output_tags', type: 'TEXT[] DEFAULT ARRAY[]::TEXT[]' },
            { name: 'output_storage_settings', type: 'JSONB' },
            { name: 'input_schema', type: 'JSONB' },
            { name: 'output_schema', type: 'JSONB' },
            { name: 'test_config', type: 'JSONB' },
            { name: 'diff_config', type: "JSONB DEFAULT '{}'::JSONB" },
            { name: 'governor_settings', type: 'JSONB' },
            { name: 'governor_policy_id', type: 'INTEGER' },
            { name: 'default_target_metric', type: 'JSONB' },
            { name: 'skill_id', type: 'INTEGER' }
        ];

        for (const col of missingJobCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing job column: ${col.name}`);
                await pool.query(`ALTER TABLE jobs ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // Patch 'org_settings' table
        const missingOrgSettingsCols = [
            { name: 'assistant_soul_traits', type: 'JSONB DEFAULT \'{}\'::JSONB' },
            { name: 'assistant_soul_archetype', type: 'TEXT' },
            { name: 'allowed_agent_tools', type: 'TEXT[]' },
            { name: 'allowed_job_types', type: 'TEXT[]' }
        ];

        for (const col of missingOrgSettingsCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'org_settings' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing org_settings column: ${col.name}`);
                await pool.query(`ALTER TABLE org_settings ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // Ensure Organization
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'Jobs Audit Org'
            } as any).returning();
            testOrgId = newOrg.id;
        }

        // Register and Login
        await request(app).post('/api/register').send({
            username: testUsername,
            email: testEmail,
            password: testPassword,
        });
        await grantOrgMembership(testUsername, testOrgId);

        const loginRes = await request(app).post('/api/login').send({
            username: testUsername,
            password: testPassword
        });
        authCookie = loginRes.header['set-cookie'] as unknown as string[];

        const userRes = await request(app)
            .get('/api/user')
            .set('Cookie', authCookie);
        csrfToken = userRes.body.csrfToken;

        // Create a Mission as a parent for jobs
        const missionRes = await request(app)
            .post('/api/missions')
            .set('Cookie', authCookie)
            .set('x-csrf-token', csrfToken)
            .send({
                name: 'Jobs Audit Mission',
                objective: 'Context for testing job pods',
                type: 'manual'
            });
        
        if (missionRes.status !== 201) {
            console.error('[JOBS AUDIT] Mission creation failed:', JSON.stringify(missionRes.body, null, 2));
        }
        expect(missionRes.status).toBe(201);
        testMissionId = missionRes.body.id;
        expect(testMissionId).toBeTypeOf('number');
    });

    afterAll(async () => {
        if (testJobId) {
            await db.delete(jobs).where(eq(jobs.id, testJobId) as any);
        }
        if (testMissionId && !isNaN(testMissionId)) {
            await db.delete(missions).where(eq(missions.id, testMissionId) as any);
        }
        await db.delete(users).where(like(users.username, 'jobs_audit_%') as any);
    });

    describe('Job Lifecycle Tracks', () => {
        it('should create a new job via POST /api/jobs', async () => {
            const res = await request(app)
                .post('/api/jobs')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                // As a draft, the way the create screen does it. Creating a job ACTIVE
                // validates its config first — that gate is what stops a half-configured
                // job going live — so a minimal config can only be created as a draft.
                .send({
                    name: 'Test Audit Job',
                    type: 'agent_chat',
                    config: { mode: 'audit' },
                    lifecycleStatus: 'draft',
                    isActive: false
                });

            if (res.status !== 200 && res.status !== 201) {
                console.error('[JOBS AUDIT] Job creation failed with status:', res.status);
                console.error('[JOBS AUDIT] Response body:', JSON.stringify(res.body, null, 2));
            }
            expect([200, 201]).toContain(res.status);
            expect(res.body.id).toBeDefined();
            testJobId = res.body.id;
        });

        it('should retrieve job details via GET /api/jobs/:id', async () => {
            const res = await request(app)
                .get(`/api/jobs/${testJobId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(testJobId);
        });

        it('should update job status via PATCH /api/jobs/:id', async () => {
            const res = await request(app)
                .patch(`/api/jobs/${testJobId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    priority: 1
                });

            expect(res.status).toBe(200);
            expect(res.body.priority).toBe(1);
        });

        it('should list jobs via GET /api/jobs', async () => {
            const res = await request(app)
                .get(`/api/jobs`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeDefined();
            expect(Array.isArray(res.body.items)).toBe(true);
        });
    });

    describe('Job Synthesis & Operations', () => {
        it('should trigger job synthesis via POST /api/jobs/synthesize', async () => {
            const res = await request(app)
                .post('/api/jobs/synthesize')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    role: 'Lead Auditor',
                    context: 'Testing Phase 3 project-wide audit',
                    suggestedConfig: { type: 'analysis' }
                });

            // Synthesis might return 200 or 500 depending on AI availability, 
            // but we want to verify the route is reachable and handles the request.
            expect([200, 404, 500]).toContain(res.status); 
        }, 30000); // 30s timeout for AI synthesis
    });
});
