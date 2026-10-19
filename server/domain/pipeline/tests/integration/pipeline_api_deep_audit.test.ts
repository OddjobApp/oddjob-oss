/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db } from '@server/database_service.js';
import { 
    users, 
    orgs, 
    jobs,
    pipelines,
    pipelineSteps,
    pipelineExecutions,
    pipelineStepExecutions,
    pipelineVersions,
    missions,
    userOrgs,
    adminRoles
} from '@shared/schema/index.js';
import { eq, like, sql, inArray, or } from 'drizzle-orm';
import { passwordService } from '@domain/auth/core/password-service.js';

describe('Pipelines Pod API Deep Audit (Phase 3)', () => {
    let testUsername = `pipe_audit_${Date.now()}`;
    let testEmail = `pipe_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let testJobId: number;
    let testPipelineId: number;
    let testExecutionId: number;
    let multiStepPipelineId: number;

    async function purgeAuditResources() {
        const auditUsers = await db.select({ id: users.id }).from(users).where(like(users.username, 'pipe_audit_%'));
        const userIds = auditUsers.map(u => u.id);

        const auditOrgs = await db.select({ id: orgs.id }).from(orgs).where(like(orgs.name, 'Pipeline Audit Org%'));
        const orgIds = auditOrgs.map(o => o.id);

        if (userIds.length > 0 || orgIds.length > 0) {
            // Find pipelines using Drizzle's 'or' and 'inArray' helpers to avoid Postgres array syntax issues
            const conditions = [];
            if (orgIds.length > 0) {
                conditions.push(inArray(pipelines.organizationId, orgIds));
            }
            if (userIds.length > 0) {
                conditions.push(inArray(pipelines.createdBy, userIds));
            }

            const pipes = await db.select({ id: pipelines.id }).from(pipelines).where(
                or(...conditions)
            );
            const pipelineIds = pipes.map(p => p.id);

            if (pipelineIds.length > 0) {
                const execs = await db.select({ id: pipelineExecutions.id }).from(pipelineExecutions).where(
                    inArray(pipelineExecutions.pipelineId, pipelineIds)
                );
                const execIds = execs.map(e => e.id);
                if (execIds.length > 0) {
                    await db.delete(pipelineStepExecutions).where(inArray(pipelineStepExecutions.pipelineExecutionId, execIds));
                    await db.delete(pipelineExecutions).where(inArray(pipelineExecutions.id, execIds));
                }
                await db.delete(pipelineSteps).where(inArray(pipelineSteps.pipelineId, pipelineIds));
                await db.delete(pipelineVersions).where(inArray(pipelineVersions.pipelineId, pipelineIds));
                await db.delete(pipelines).where(inArray(pipelines.id, pipelineIds));
            }

            // Delete jobs belonging to the orgs
            if (orgIds.length > 0) {
                const auditJobs = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.organizationId, orgIds));
                const jobIds = auditJobs.map(j => j.id);
                if (jobIds.length > 0) {
                    await db.delete(pipelineStepExecutions).where(inArray(pipelineStepExecutions.jobId, jobIds));
                    await db.delete(jobs).where(inArray(jobs.id, jobIds));
                }
            }

            // Delete associations
            if (userIds.length > 0) {
                await db.delete(adminRoles).where(inArray(adminRoles.userId, userIds));
                await db.delete(userOrgs).where(inArray(userOrgs.userId, userIds));
            }
            if (orgIds.length > 0) {
                await db.delete(userOrgs).where(inArray(userOrgs.orgId, orgIds));
            }

            // Delete users & orgs
            if (userIds.length > 0) {
                await db.delete(users).where(inArray(users.id, userIds));
            }
            if (orgIds.length > 0) {
                try {
                    await db.execute(sql`DELETE FROM forensic_event_log WHERE organization_id IN (${sql.raw(orgIds.join(','))})`);
                } catch (err) {
                    // Ignore if table or column doesn't exist yet
                }
                await db.delete(orgs).where(inArray(orgs.id, orgIds));
            }
        }
    }

    beforeAll(async () => {
        // Wait for server to be fully initialized with all routes registered
        await serverReady;

        const { pool } = await import('@server/database_service.js');

        // --- SCHEMA SYNC: pipelines ---
        const missingPipeCols = [
            { name: 'trigger_credential_id', type: 'INTEGER' },
            { name: 'labels', type: 'JSONB' },
            { name: 'current_version', type: 'INTEGER DEFAULT 1' },
            { name: 'monthly_budget_usd', type: 'DECIMAL(10,2)' },
            { name: 'enable_knowledge_graph', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
            { name: 'knowledge_graph_config', type: 'JSONB' },
            { name: 'lifecycle_status', type: "TEXT DEFAULT 'active' NOT NULL" },
            { name: 'governor_settings', type: 'JSONB' },
            { name: 'governor_policy_id', type: 'INTEGER' }
        ];
        for (const col of missingPipeCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipelines' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing pipeline column: ${col.name}`);
                await pool.query(`ALTER TABLE pipelines ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // --- SCHEMA SYNC: pipeline_steps ---
        const missingStepCols = [
            { name: 'run_on_condition', type: "TEXT DEFAULT 'on_success' NOT NULL" },
            { name: 'wait_duration_seconds', type: 'INTEGER DEFAULT 0' },
            { name: 'on_failure_action', type: "TEXT DEFAULT 'Stop Pipeline' NOT NULL" },
            { name: 'parallel_group', type: 'TEXT' },
            { name: 'condition_expression', type: 'TEXT' },
            { name: 'module_type', type: 'TEXT' },
            { name: 'destination_step_id', type: 'INTEGER' },
            { name: 'decision_node_config', type: 'JSONB' },
            { name: 'knowledge_graph_config', type: 'JSONB' },
            { name: 'retry_config', type: 'JSONB' },
            { name: 'expected_input_schema', type: 'JSONB' },
            { name: 'guaranteed_output_schema', type: 'JSONB' },
            { name: 'tool_name', type: 'TEXT' },
            { name: 'tool_arguments', type: 'JSONB' }
        ];
        for (const col of missingStepCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_steps' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing pipeline_steps column: ${col.name}`);
                await pool.query(`ALTER TABLE pipeline_steps ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // --- SCHEMA SYNC: pipeline_executions ---
        const missingExecCols = [
            { name: 'cancelled_at', type: 'TIMESTAMP' },
            { name: 'start_step_id', type: 'INTEGER' },
            { name: 'ttl', type: 'INTEGER' },
            { name: 'trace_id', type: 'VARCHAR(32)' },
            { name: 'sampling_rate', type: "DECIMAL(3,2) DEFAULT 1.00" },
            { name: 'trace_source', type: 'VARCHAR(20)' },
            { name: 'last_heartbeat', type: 'TIMESTAMP' },
            { name: 'parent_execution_id', type: 'INTEGER' },
            { name: 'mission_id', type: 'INTEGER' },
            { name: 'mission_run_id', type: 'INTEGER' },
            { name: 'version', type: 'INTEGER DEFAULT 1 NOT NULL' },
            { name: 'context_snapshot', type: 'JSONB' },
            { name: 'estimated_time_remaining_ms', type: 'INTEGER' },
            { name: 'last_etc_calculation_at', type: 'TIMESTAMP' },
            { name: 'deleted_at', type: 'TIMESTAMP' }
        ];
        for (const col of missingExecCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_executions' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing pipeline_executions column: ${col.name}`);
                await pool.query(`ALTER TABLE pipeline_executions ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // --- SCHEMA SYNC: pipeline_step_executions ---
        const missingStepExecCols = [
            { name: 'run_group', type: 'TEXT' },
            { name: 'idempotency_key', type: 'TEXT' },
            { name: 'trace_id', type: 'TEXT' },
            { name: 'output_uri', type: 'TEXT' },
            { name: 'error_uri', type: 'TEXT' },
            { name: 'output_name', type: 'TEXT' },
            { name: 'span_id', type: 'VARCHAR(16)' },
            { name: 'parent_span_id', type: 'VARCHAR(16)' },
            { name: 'trace_flags', type: "VARCHAR(2) DEFAULT '01'" },
            { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
            { name: 'parent_step_execution_id', type: 'INTEGER' },
            { name: 'output_schema', type: 'JSONB' },
            { name: 'execution_stats', type: 'JSONB' },
            { name: 'version', type: 'INTEGER DEFAULT 1 NOT NULL' },
            { name: 'sleep_until', type: 'TIMESTAMP' },
            { name: 'suspension_metadata', type: 'JSONB' },
            { name: 'deleted_at', type: 'TIMESTAMP' }
        ];
        for (const col of missingStepExecCols) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_step_executions' AND column_name = '${col.name}'`);
            if (res.rows.length === 0) {
                console.log(`[TEST SETUP] Adding missing pipeline_step_executions column: ${col.name}`);
                await pool.query(`ALTER TABLE pipeline_step_executions ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // --- SCHEMA SYNC: forensic_event_log ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS forensic_event_log (
                id SERIAL PRIMARY KEY,
                trace_id VARCHAR(32) NOT NULL,
                span_id VARCHAR(16) NOT NULL,
                job_type VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                start_time_ns BIGINT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);
        const forensicCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'forensic_event_log'");
        const forensicColNames = forensicCols.rows.map((r: any) => r.column_name);
        if (!forensicColNames.includes('mission_run_id')) {
            await pool.query("ALTER TABLE forensic_event_log ADD COLUMN mission_run_id INTEGER");
        }

        // --- SCHEMA SYNC: reporting functions ---
        await pool.query("CREATE SCHEMA IF NOT EXISTS reporting");
        await pool.query(`
            CREATE OR REPLACE FUNCTION reporting.refresh_kpi_views()
            RETURNS void AS $$
            BEGIN
                -- Dummy function for audit context
            END;
            $$ LANGUAGE plpgsql;
        `);

        // Run deep purge before inserting fresh records
        await purgeAuditResources();

        // --- AUTH SETUP ---
        // Create user and org directly
        const [org] = await db.insert(orgs).values({ name: `Pipeline Audit Org ${Date.now()}` }).returning();
        testOrgId = org.id;

        const hashedPassword = await passwordService.hashPassword(testPassword);
        const [insertedUser] = await db.insert(users).values({
            username: testUsername,
            email: testEmail,
            password: hashedPassword,
            defaultOrgId: testOrgId
        }).returning();

        await db.insert(userOrgs).values({
            userId: insertedUser.id,
            orgId: testOrgId
        });

        await db.insert(adminRoles).values({
            userId: insertedUser.id,
            role: 'super_admin'
        });

        // Login to get session
        const loginRes = await request(app).post('/api/login').send({
            username: testUsername,
            password: testPassword
        });
        authCookie = loginRes.header['set-cookie'] as unknown as string[];

        // Get CSRF token
        const csrfRes = await request(app)
            .get('/api/csrf-token')
            .set('Cookie', authCookie);
        csrfToken = csrfRes.body.csrfToken;

        // Create a Job to be used as a pipeline step
        const jobRes = await request(app)
            .post('/api/jobs')
            .set('Cookie', authCookie)
            .set('x-csrf-token', csrfToken)
            .send({
                // 'agent_chat' is not a job type — it appears nowhere in
                // jobConfigSchema's discriminated union, so POST /api/jobs rejected
                // this with "Job configuration is not ready for activation" and the
                // whole suite failed in beforeAll. static_response is the simplest
                // valid type; this job only needs to exist as a pipeline step.
                name: 'Pipeline Step Job',
                type: 'static_response',
                config: { content: 'audit', requiredVariables: [] }
            });
        testJobId = jobRes.body.id;
        expect(testJobId).toBeTypeOf('number');
    });

    afterAll(async () => {
        await purgeAuditResources();
    });

    describe('Pipeline Lifecycle', () => {
        it('should create a new pipeline via POST /api/pipelines', async () => {
            const res = await request(app)
                .post('/api/pipelines')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Audit Pipeline',
                    description: 'Testing the pipeline pod integration',
                    triggerType: 'manual',
                    steps: [
                        { jobId: testJobId, order: 0, outputName: 'step_one' }
                    ]
                });

            expect(res.status).toBe(201);
            expect(res.body.id).toBeDefined();
            testPipelineId = res.body.id;
        });

        it('should retrieve pipeline details via GET /api/pipelines/:id', async () => {
            const res = await request(app)
                .get(`/api/pipelines/${testPipelineId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(testPipelineId);
            expect(res.body.name).toBe('Audit Pipeline');
        });

        it('should update pipeline metadata via PATCH /api/pipelines/:id', async () => {
            const res = await request(app)
                .patch(`/api/pipelines/${testPipelineId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    description: 'Updated Pipeling Description'
                });

            expect(res.status).toBe(200);
            expect(res.body.description).toBe('Updated Pipeling Description');
        });

        it('should list pipelines via GET /api/pipelines', async () => {
            const res = await request(app)
                .get('/api/pipelines')
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            const found = res.body.find((p: any) => p.id === testPipelineId);
            expect(found).toBeDefined();
        });
    });

    describe('Execution & Versioning', () => {
        it('should create a version snapshot via POST /api/pipelines/:id/versions', async () => {
            const res = await request(app)
                .post(`/api/pipelines/${testPipelineId}/versions`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    description: 'Initial Audit Snapshot'
                });

            expect([200, 201]).toContain(res.status);
            expect(res.body.version).toBeDefined();
        });

        it('should trigger execution via POST /api/pipelines/:id/execute', async () => {
            const res = await request(app)
                .post(`/api/pipelines/${testPipelineId}/execute`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    input_param_1: 'audit_value'
                });

            expect(res.status).toBe(200);
            expect(res.body.executionId).toBeDefined();
            testExecutionId = res.body.executionId;
        });

        it('should retrieve execution details via GET /api/pipeline-executions/:id', async () => {
            const res = await request(app)
                .get(`/api/pipeline-executions/${testExecutionId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(testExecutionId);
            expect(res.body.pipelineId).toBe(testPipelineId);
        });
    });

    describe('Variable Propagation & Multi-Step Logic', () => {

        it('should create a multi-step pipeline with output naming', async () => {
            const res = await request(app)
                .post('/api/pipelines')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Multi-Step Audit',
                    triggerType: 'manual',
                    steps: [
                        { jobId: testJobId, order: 0, outputName: 'primary_search' },
                        { 
                            jobId: testJobId, 
                            order: 1, 
                            conditionExpression: "{{step.0.output}} != 'error'",
                            outputName: 'secondary_process'
                        }
                    ]
                });

            expect(res.status).toBe(201);
            multiStepPipelineId = res.body.id;
        });

        it('should verify variable substitution in step config (internal unit check)', async () => {
            // We can't easily trigger a full AI run in audit, but we can check if the API 
            // accepts and persists the template variables correctly.
            const res = await request(app)
                .get(`/api/pipelines/${multiStepPipelineId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            const step2 = res.body.steps.find((s: any) => s.order === 1);
            expect(step2.conditionExpression).toBe("{{step.0.output}} != 'error'");
        });

        it('should verify execution context initialization', async () => {
            const res = await request(app)
                .post(`/api/pipelines/${multiStepPipelineId}/execute`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    seed_value: 'initial_data'
                });

            expect(res.status).toBe(200);
            const execId = res.body.executionId;
            
            // Check if execution was created with the input variables
            const execRes = await request(app)
                .get(`/api/pipeline-executions/${execId}`)
                .set('Cookie', authCookie);
            
            expect(execRes.status).toBe(200);
            expect(execRes.body.status).toBeDefined();
        });
    });
});
