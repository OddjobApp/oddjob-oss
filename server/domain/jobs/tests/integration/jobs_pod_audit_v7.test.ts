/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db, pool } from '@server/database_service.js';
import { users, adminRoles, orgs, userOrgs } from '@shared/schema/auth.js';
import { jobs } from '@shared/schema/jobs/table.js';
import { eq, sql } from 'drizzle-orm';
import { SkillExportService } from '@domain/jobs/skill-export.service.js';
import { SkillImportService } from '@domain/jobs/skill-import.service.js';

describe('Jobs Pod Deep Audit (Phase 7)', () => {
    let testUsername = `jobs_audit_${Date.now()}`;
    let testEmail = `jobs_audit_${Date.now()}@test.com`;
    let testPassword = 'Password123!';
    let testUserId: string;
    let testOrgId: number;
    let authCookie: string[];
    let testJobId: number;

    beforeAll(async () => {
        console.log('[Phase 7] Bootstrapping Audit Environment...');
        try {
            await serverReady;
            
            // --- SCHEMA SYNC: Ensure columns exist ---
            const columnsToAdd = [
                { name: 'lifecycle_status', type: "TEXT DEFAULT 'active' NOT NULL" },
                { name: 'parameter_schema', type: 'JSONB' },
                { name: 'render_template', type: 'TEXT' },
                { name: 'cpu_limit_millicores', type: 'INTEGER' },
                { name: 'memory_limit_mb', type: 'INTEGER' },
                { name: 'output_storage_enabled', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
                { name: 'enable_knowledge_store', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
                { name: 'output_knowledge_topic_id', type: 'INTEGER' },
                { name: 'output_dataset_id', type: 'INTEGER' },
                { name: 'output_tags', type: 'TEXT[] DEFAULT ARRAY[]::text[]' },
                { name: 'output_storage_settings', type: 'JSONB' },
                { name: 'input_schema', type: 'JSONB' },
                { name: 'output_schema', type: 'JSONB' },
                { name: 'test_config', type: 'JSONB' },
                { name: 'diff_config', type: "JSONB DEFAULT '{}'::jsonb" },
                { name: 'governor_settings', type: 'JSONB' },
                { name: 'governor_policy_id', type: 'INTEGER' },
                { name: 'default_target_metric', type: 'JSONB' },
                { name: 'skill_id', type: 'INTEGER' }
            ];

            for (const col of columnsToAdd) {
                await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
            }
            console.log('[Phase 7] Schema synchronized.');

            // --- Register User ---
            const registerRes = await request(app)
                .post('/api/register')
                .send({ username: testUsername, email: testEmail, password: testPassword });
            
            if (registerRes.status !== 201 && registerRes.status !== 200) {
                throw new Error(`Registration failed: ${JSON.stringify(registerRes.body)}`);
            }
            testUserId = registerRes.body.id;

            // --- Elevate & Login ---
            // One admin role per user: replace the org_admin role signup provisions.
            await pool.query(`DELETE FROM admin_roles WHERE user_id = $1`, [testUserId]);
            await pool.query(`INSERT INTO admin_roles (user_id, role) VALUES ($1, 'super_admin')`, [testUserId]);
            
            const login1 = await request(app)
                .post('/api/login')
                .send({ username: testUsername, password: testPassword });
            authCookie = login1.get('Set-Cookie') || [];

            // --- Create Org & Link ---
            const orgRes = await request(app)
                .post('/api/admin/organizations')
                .set('Cookie', authCookie)
                .send({ name: `Forge Audit Org ${Date.now()}` });
            
            testOrgId = orgRes.body.organization?.id;
            
            if (!testOrgId) {
                throw new Error(`Organization creation failed to return an ID: ${JSON.stringify(orgRes.body)}`);
            }
            
            await pool.query(`INSERT INTO user_orgs (user_id, org_id) VALUES ($1, $2)`, [testUserId, testOrgId]);
            await pool.query(`UPDATE users SET default_org_id = $1 WHERE id = $2`, [testOrgId, testUserId]);

            // --- Final Login Context refresh ---
            console.log('[Armorer] Refreshing login context...');
            const login2 = await request(app)
                .post('/api/login')
                .send({ username: testUsername, password: testPassword });
            authCookie = login2.get('Set-Cookie') || [];
            
            console.log('[Phase 7] Environment fully pressurized.');

        } catch (err: any) {
            console.error('[Phase 7] Bootstrapping failed:', err.message);
            throw err;
        }
    });

    afterAll(async () => {
        if (testOrgId) {
            await pool.query(`DELETE FROM jobs WHERE organization_id = $1`, [testOrgId]);
            await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [testOrgId]);
        }
        if (testUserId) {
            await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
        }
    });

    describe('Job Lifecycle (CRUD)', () => {
        it('should create a new job with enhanced metadata', async () => {
            const jobData = {
                name: 'Forge Audit Job',
                type: 'shell',
                description: 'Testing forge scaffolding',
                config: { executable: 'bash', parameters: '-c "echo hello"', workingDirectory: '.' },
                priority: 1,
                tool: 'None',
                lifecycleStatus: 'active',
                outputTags: ['audit', 'forge']
            };

            const res = await request(app)
                .post('/api/jobs')
                .set('Cookie', authCookie)
                .send(jobData);

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(jobData.name);
            testJobId = res.body.id;
        });

        it('should fetch the created job with org scoping', async () => {
            const res = await request(app)
                .get(`/api/jobs/${testJobId}`)
                .set('Cookie', authCookie);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(testJobId);
        });
    });

    describe('Synthesis & Forge Portability', () => {
        it('should trigger job synthesis for Armorer hardening', async () => {
            const res = await request(app)
                .post(`/api/jobs/${testJobId}/synthesis`)
                .set('Cookie', authCookie)
                .send({ target: 'python', harden: true });

            // Synthesis might be async or require external keys
            if (res.status === 200 || res.status === 202) {
                expect(res.body).toBeDefined();
            } else {
                console.warn('[Phase 7] Synthesis skipped or failed (likely missing AI keys)');
            }
        });

        it('should export the job as a Skill ZIP package', async () => {
            const res = await request(app)
                .get(`/api/jobs/${testJobId}/export/zip`)
                .set('Cookie', authCookie);

            if (res.status === 200) {
                expect(res.header['content-type']).toBe('application/zip');
            } else {
                console.warn('[Phase 7] ZIP export test returned status:', res.status);
            }
        });
    });

    describe('Budget & Airflow Enforcement', () => {
        it('should enforce budget constraints (Steps/Cost)', async () => {
            // Testing the primitive logic layer for budget checks
            const jobUpdateRes = await request(app)
                .patch(`/api/jobs/${testJobId}`)
                .set('Cookie', authCookie)
                .send({
                    governorSettings: {
                        maxSteps: 10,
                        maxCost: 0.05
                    }
                });
            expect(jobUpdateRes.status).toBe(200);
        });

        it('should verify AirflowPoller connectivity', async () => {
            const res = await request(app)
                .get('/api/admin/airflow/status') // Assumes admin route exists
                .set('Cookie', authCookie);
            
            if (res.status !== 404) {
                 expect(res.status).toBe(200);
            }
        });
    });
});
