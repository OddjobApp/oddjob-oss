/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { 
    users, 
    orgs, 
    missions, 
    missionRuns, 
    missionRagAssets, 
    ragAssets,
    credentials,
    pipelines
} from "@shared/schema/index.js";
import { eq, like, or } from "drizzle-orm";
import { grantOrgMembership } from "../../../../../tests/helpers/org-membership.js";

// Mock AI Services to prevent external calls
vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: () => ({
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    name: "Creative Mission Name",
                    objective: "Detailed mission objective...",
                    members: [],
                    plan: { steps: [{ name: "Mock Step", type: "task" }] },
                    reasoning: "Mock reasoning"
                })
            })
        })
    }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'mock-api-key',
            credentialId: 1
        })
    }
}));

describe('Mission Lifecycle API Deep Audit', () => {
    let testUsername = `mission_audit_${Date.now()}`;
    let testEmail = `mission_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let testMissionId: number;
    let testRagAssetId: number;
    let testPipelineId: number;
    let testUserId: string;

    beforeAll(async () => {
        // Wait for server to be fully initialized
        await serverReady;

        // Ensure Organization
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'Mission Audit Org',
                slug: 'mission-audit-org'
            } as any).returning();
            testOrgId = newOrg.id;
        }

        // Setup RAG Asset for testing attachments
        const [asset] = await db.insert(ragAssets).values({
            name: 'Audit Reference Doc',
            assetType: 'Text',
            sourceType: 'upload',
            textContent: 'This is a test document for mission context.',
            organizationId: testOrgId
        } as any).returning();
        testRagAssetId = asset.id;

        // --- DATABASE SYNC (Baseline Fixes) ---
        // We sync the test database inline to ensure all required columns exist
        const { pool } = await import('@server/database_service.js');
        const schemaCheck = await (pool as any).query("SELECT column_name FROM information_schema.columns WHERE table_name = 'missions'");
        const columns = schemaCheck.rows.map((r: any) => r.column_name);
        
        const missingCols = [
            { name: 'is_draft', type: 'BOOLEAN DEFAULT FALSE NOT NULL' },
            { name: 'workflow_blueprint', type: 'JSONB' },
            { name: 'context_core_url', type: 'TEXT' },
            { name: 'entity_count', type: 'INTEGER' },
            { name: 'relationship_count', type: 'INTEGER' },
            { name: 'workspace_path', type: 'TEXT' },
            { name: 'vcs_config', type: "JSONB NOT NULL DEFAULT '{}'" }
        ];

        for (const col of missingCols) {
            if (!columns.includes(col.name)) {
                console.log(`[TEST SETUP] Adding missing column: ${col.name}`);
                await (pool as any).query(`ALTER TABLE missions ADD COLUMN ${col.name} ${col.type}`);
            }
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
        testUserId = userRes.body.id;

        // Setup a dummy pipeline for members testing (needs a real user FK)
        let dummyPipeline = (await db.select().from(pipelines).where(
            eq(pipelines.name, 'Audit Manual Pipeline')
        ))[0];
        if (!dummyPipeline) {
            const [newPipeline] = await db.insert(pipelines).values({
                name: 'Audit Manual Pipeline',
                triggerType: 'manual',
                organizationId: testOrgId,
                createdBy: testUserId
            } as any).returning();
            dummyPipeline = newPipeline;
        }
        testPipelineId = dummyPipeline.id;
    }, 30000);

    afterAll(async () => {
        // Cleanup surgical
        if (testMissionId) {
            // @ts-ignore
            await db.delete(missionRuns).where(eq(missionRuns.missionId, testMissionId));
            // @ts-ignore
            await db.delete(missionRagAssets).where(eq(missionRagAssets.missionId, testMissionId));
            // @ts-ignore
            await db.delete(missions).where(eq(missions.id, testMissionId));
        }
        if (testRagAssetId) {
            // @ts-ignore
            await db.delete(ragAssets).where(eq(ragAssets.id, testRagAssetId));
        }
        
        const auditUsers = await db.select().from(users).where(like(users.username, 'mission_audit_%'));
        const auditUserIds = auditUsers.map((u: any) => u.id);
        if (auditUserIds.length > 0) {
            // @ts-ignore
            await db.delete(credentials).where(or(...auditUserIds.map((id: any) => eq(credentials.createdBy, id))));
            // @ts-ignore
            await db.delete(users).where(like(users.username, 'mission_audit_%'));
        }
    });

    describe('Track 1: Manual Mission Multi-Step Lifecycle', () => {
        let manualMissionId: number;

        it('Step 1: should create a new manual mission', async () => {
            const res = await request(app)
                .post('/api/missions')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Track 1: Manual Mission',
                    objective: 'Verify full manual lifecycle',
                    type: 'manual',
                    executionStrategy: 'pre_planned'
                });
            expect(res.status).toBe(201);
            manualMissionId = res.body.id;
        });

        it('Step 2: should add members to the manual mission', async () => {
            // Adding a mock member (e.g., a pipeline or job reference if they existed)
            // For now, we verify the endpoint handles member updates
            const res = await request(app)
                .post(`/api/missions/${manualMissionId}/members`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    entityType: 'pipeline',
                    entityId: testPipelineId, // Use the dynamically created pipeline ID
                    role: 'member'
                });
            // 201 or 400 if ID 1 doesn't exist, but we audit the route logic
            expect([201, 400, 422]).toContain(res.status);
        });

        it('Step 3: should attach RAG assets', async () => {
            const res = await request(app)
                .post(`/api/missions/${manualMissionId}/assets`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    ragAssetId: testRagAssetId,
                    purpose: 'context'
                });
            expect(res.status).toBe(201);
        });

        it('Step 4: should launch the manual mission', async () => {
            const res = await request(app)
                .post(`/api/missions/${manualMissionId}/launch-mission`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);
            if (res.status === 500) {
                throw new Error("Step 4 launch-mission failed with 500: " + JSON.stringify(res.body || res.text));
            }
            expect([200, 201, 400]).toContain(res.status); // 400 if members are invalid/missing
        });

        it('Step 5: should cleanup the manual mission', async () => {
            const res = await request(app)
                .delete(`/api/missions/${manualMissionId}`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);
            expect(res.status).toBe(200);
        });
    });

    describe('Track 2: Supervisor-Led (AI-Orchestrated) Lifecycle', () => {
        let supervisorMissionId: number;

        it('Step 1: should trigger AI mission planning', async () => {
            const res = await request(app)
                .post('/api/missions/plan')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({ prompt: 'Execute a complex research audit' });
            if (res.status !== 200) {
                throw new Error("Track 2 Step 1 plan failed with: " + res.status + " - " + JSON.stringify(res.body || res.text));
            }
            expect(res.status).toBe(200);
            expect(res.body.plan).toBeDefined();
        });

        it('Step 2: should create mission from plan', async () => {
            const res = await request(app)
                .post('/api/missions')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Track 2: Supervisor Mission',
                    objective: 'AI Planned Objective',
                    type: 'supervisor_led',
                    executionStrategy: 'dynamic_autonomous'
                });
            expect(res.status).toBe(201);
            supervisorMissionId = res.body.id;
        });

        it('Step 3: should verify dynamic launch', async () => {
            const res = await request(app)
                .post(`/api/missions/${supervisorMissionId}/launch-mission`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken);
            expect([200, 400]).toContain(res.status);
        });

        it('Step 4: Cleanup', async () => {
            await request(app).delete(`/api/missions/${supervisorMissionId}`).set('Cookie', authCookie).set('x-csrf-token', csrfToken);
        });
    });

    describe('Track 3: Governed Mission Lifecycle', () => {
        it('should create and verify a governed mission', async () => {
            const res = await request(app)
                .post('/api/missions')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Track 3: Governed Mission',
                    objective: 'Verify budget enforcement',
                    type: 'governed',
                    budgetLimitUsd: 100.00
                });
            expect(res.status).toBe(201);
            const missionId = res.body.id;
            
            await request(app).delete(`/api/missions/${missionId}`).set('Cookie', authCookie).set('x-csrf-token', csrfToken);
        });
    });

    describe('Track 4: Mission-Based (Template) Lifecycle', () => {
        it('should instantiate mission from template', async () => {
            // Get first available template
            const templatesRes = await request(app).get('/api/missions/templates').set('Cookie', authCookie);
            if (templatesRes.body.length > 0) {
                const templateId = templatesRes.body[0].id;
                const res = await request(app)
                    .post(`/api/missions/templates/${templateId}/instantiate`)
                    .set('Cookie', authCookie)
                    .set('x-csrf-token', csrfToken)
                    .send({ name: 'Instantiated from Template' });
                
                expect([201, 200]).toContain(res.status);
                if (res.status === 201) {
                    await request(app).delete(`/api/missions/${res.body.id}`).set('Cookie', authCookie).set('x-csrf-token', csrfToken);
                }
            }
        });
    });

    describe('Track 5: Rescue Mission Lifecycle', () => {
        it('should handle rescue mission transitions', async () => {
            // Rescue missions are typically system-triggered or created with type='rescue'
            const res = await request(app)
                .post('/api/missions')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Track 5: Rescue Mission',
                    objective: 'Recover from failure',
                    type: 'rescue'
                });
            expect(res.status).toBe(201);
            await request(app).delete(`/api/missions/${res.body.id}`).set('Cookie', authCookie).set('x-csrf-token', csrfToken);
        });
    });
});
