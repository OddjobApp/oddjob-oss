/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from "@server/index.js";
import { db } from "@server/database_service.js";
import { 
    users, 
    orgs, 
    missions,
    missionRuns
} from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";
import { grantOrgMembership } from "../../../../../tests/helpers/org-membership.js";

// NOTE: No mocks for AI services here. We are testing the real integration.

describe('AI Live Mode Validation (High-Fidelity Audit)', () => {
    let testUsername = `ai_live_audit_${Date.now()}`;
    let testEmail = `ai_live_audit_${Date.now()}@example.com`;
    let testPassword = 'Password123!';
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;
    let testMissionId: number;

    beforeAll(async () => {
        const { registerRoutes } = await import('@server/routes.js');
        await registerRoutes(app, {} as any);

        // Ensure Organization
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'AI Live Audit Org'
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
    });

    afterAll(async () => {
        if (testMissionId && !isNaN(testMissionId)) {
            await db.delete(missionRuns).where(eq(missionRuns.missionId, testMissionId));
            await db.delete(missions).where(eq(missions.id, testMissionId));
        }
        await db.delete(users).where(like(users.username, 'ai_live_audit_%'));
    });

    describe('Live Mission Planning', () => {
        it.skip('should generate a mission plan using real Gemini LLM', async () => {
            console.log('[LIVE AI TEST] Requesting mission plan for prompt: "Develop a strategy for code audit."');
            const res = await request(app)
                .post('/api/missions/plan')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    prompt: 'Develop a strategy for an automated code audit mission.'
                });
            
            if (res.status !== 200) {
                console.error('[LIVE AI TEST] Failed to generate plan:', JSON.stringify(res.body, null, 2));
            }

            expect(res.status).toBe(200);
            expect(res.body.plan).toBeDefined();
            console.log('[LIVE AI TEST] Received plan reasoning preview:', res.body.reasoning?.substring(0, 100));
        }, 60000); // 60s
    });

    describe('Live Semantic Chat', () => {
        it.skip('should handle mission creation and semantic chat response', async () => {
            const createRes = await request(app)
                .post('/api/missions')
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Live Audit Mission',
                    objective: 'Verify semantic chat grounding',
                    type: 'manual'
                });
            
            expect(createRes.status).toBe(201);
            testMissionId = createRes.body.id;
            expect(testMissionId).toBeTypeOf('number');
            expect(isNaN(testMissionId)).toBe(false);

            // Trigger a dummy active run for the intervention logic
            await db.insert(missionRuns).values({
                missionId: testMissionId,
                status: 'active',
                name: 'Test Live Run',
                createdBy: testUsername,
                missionContext: {}
            } as any);

            console.log('[LIVE AI TEST] Requesting semantic chat response for mission:', testMissionId);
            const chatRes = await request(app)
                .post(`/api/missions/${testMissionId}/chat`)
                .set('Cookie', authCookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    message: 'What is the current objective of this mission?'
                });

            expect(chatRes.status).toBe(200);
            expect(chatRes.body.success).toBe(true);
            
            console.log('[LIVE AI TEST] Polling for background assistant response...');
            let assistantMessage;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const pollRes = await request(app)
                    .get(`/api/missions/${testMissionId}`)
                    .set('Cookie', authCookie);
                
                const messages = pollRes.body.blackboard?.messages || [];
                assistantMessage = messages.find((m: any) => m.role === 'assistant');
                if (assistantMessage) break;
            }

            if (!assistantMessage) {
                throw new Error('Timed out waiting for AI assistant response in the blackboard.');
            }

            console.log('[LIVE AI TEST] Received assistant response:', assistantMessage.content);
            expect(assistantMessage.content.toLowerCase()).toContain('verify');
        }, 120000); // 120s
    });
});
