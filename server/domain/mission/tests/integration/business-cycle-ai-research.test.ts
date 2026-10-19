/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from "@server/database_service.js";
import { 
    users, 
    orgs, 
    missions,
    missionRuns,
    knowledgeNodes,
    knowledgeEdges,
    jobs
} from "@shared/schema/index.js";
import { eq, like, desc } from "drizzle-orm";
import { jobSynthesisService } from '@domain/jobs/job-synthesis.service.js';
import { missionDependenciesService } from '@domain/mission/core/mission-dependencies.service.js';

// We mock the AI Service so we don't hit the real LLM API during tests
vi.mock("@domain/ai/core/ai-client.service.js", () => {
    return {
        AIClientFactory: {
            getClient: vi.fn().mockReturnValue({
                execute: vi.fn().mockImplementation(async (req: any, _role: any, _key: any) => {
                    const reqStr = JSON.stringify(req);
                    let name = "Mock Agent";
                    let tool = "mock";
                    
                    if (reqStr.includes("Literature Researcher")) {
                        name = "AI Literature Researcher";
                        tool = "search_web";
                    } else if (reqStr.includes("Research Summarizer")) {
                        name = "AI Research Summarizer";
                        tool = "write_to_file";
                    }

                    return {
                        success: true,
                        output: JSON.stringify({
                            name,
                            description: `A specialized mock agent for testing.`,
                            type: "ai_agent",
                            tool,
                            config: {
                                goal: "Mock goal",
                                systemPrompt: "Mock prompt",
                                provider: "google",
                                model: "gemini-2.0-flash",
                                allowedTools: [tool]
                            },
                            parameterSchema: {},
                            outputSchema: {}
                        })
                    };
                })
            })
        }
    };
});

// We also mock knowledge graph qdrant upsert so we don't hit vector db
vi.mock("@server/integrations/qdrant-client.js", () => {
    return {
        upsertQdrantPoints: vi.fn().mockResolvedValue(true),
        searchQdrant: vi.fn().mockResolvedValue([]),
        deleteQdrantByFilter: vi.fn().mockResolvedValue(true),
    };
});

// Also we mock embedding retries since we might hit real embedding models
vi.mock("@server/utils/embedding-retry.js", () => {
    return {
        withEmbeddingRetry: vi.fn().mockImplementation(async (fn) => {
            // just return mock vector
            return Array(1536).fill(0.1);
        })
    };
});

describe('AI Research Business Cycle Integration Test', () => {
    let testUsername = `cycle_test_${Date.now()}`;
    let testOrgId: number;
    let researcherJobId: number;
    let summarizerJobId: number;
    let mission1Id: number;
    let mission2Id: number;

    beforeAll(async () => {
        // Ensure Organization
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'Test Business Cycle Org'
            } as any).returning();
            testOrgId = newOrg.id;
        }

        // Create a test user directly
        const [user] = await db.insert(users).values({
            username: testUsername,
            email: `${testUsername}@example.com`,
            password: "dummy",
            defaultOrgId: testOrgId
        }).returning();

        // synthesizeJob appends " (N)" when a job of that name already exists in
        // the org. Runs that did not clean up therefore push the name along —
        // this suite was asserting "AI Literature Researcher" and receiving
        // "AI Literature Researcher (14)". Clear the slate so the name is
        // deterministic, and clear it again afterwards so the next run starts
        // where this one did.
        await db.delete(jobs).where(like(jobs.name, 'AI Literature Researcher%'));
        await db.delete(jobs).where(like(jobs.name, 'AI Research Summarizer%'));

        missionDependenciesService.clearAll();
    });

    afterAll(async () => {
        // Clean up database 
        if (mission2Id) {
            await db.delete(missionRuns).where(eq(missionRuns.missionId, mission2Id));
            await db.delete(missions).where(eq(missions.id, mission2Id));
        }
        if (mission1Id) {
            await db.delete(missionRuns).where(eq(missionRuns.missionId, mission1Id));
            await db.delete(missions).where(eq(missions.id, mission1Id));
        }
        await db.delete(knowledgeEdges).where(eq(knowledgeEdges.organizationId, testOrgId));
        await db.delete(knowledgeNodes).where(like(knowledgeNodes.name, 'Test Research%'));
        await db.delete(jobs).where(like(jobs.name, 'AI Literature Researcher%'));
        await db.delete(jobs).where(like(jobs.name, 'AI Research Summarizer%'));
        await db.delete(users).where(like(users.username, 'cycle_test_%'));
    });

    it('Phase 1: Synthesize two specialized AI agents', async () => {
        const researcherJob = await jobSynthesisService.synthesizeJob(
            "AI Literature Researcher",
            testOrgId,
            testUsername,
            "An agent that finds recent papers on AI topics."
        );
        expect(researcherJob).toBeDefined();
        expect(researcherJob.name).toBe("AI Literature Researcher");
        expect(researcherJob.type).toBe("ai_agent");
        researcherJobId = researcherJob.id;

        const summarizerJob = await jobSynthesisService.synthesizeJob(
            "AI Research Summarizer",
            testOrgId,
            testUsername,
            "An agent that summarizes research findings and creates knowledge graph nodes."
        );
        expect(summarizerJob).toBeDefined();
        expect(summarizerJob.name).toBe("AI Research Summarizer");
        expect(summarizerJob.type).toBe("ai_agent");
        summarizerJobId = summarizerJob.id;
    });

    it('Phase 2 & 3: Mission Dependency Chaining', async () => {
        // Create Mission 1 assigned to the Researcher
        const [mission1] = await db.insert(missions).values({
            name: 'Test Cycle - Research AI Papers',
            objective: 'Find recent papers about autonomous agents',
            type: 'agentic',
            assignedAgentId: researcherJobId,
            organizationId: testOrgId,
            createdBy: testUsername,
        } as any).returning();
        mission1Id = mission1.id;

        // Create Mission 2 assigned to the Summarizer
        const [mission2] = await db.insert(missions).values({
            name: 'Test Cycle - Summarize AI Papers',
            objective: 'Summarize the papers found in the previous mission',
            type: 'agentic',
            assignedAgentId: summarizerJobId,
            organizationId: testOrgId,
            createdBy: testUsername,
        } as any).returning();
        mission2Id = mission2.id;

        // Add Dependency: Mission 2 depends on Mission 1 completing successfully
        await missionDependenciesService.addDependency(mission2Id, mission1Id, "sequential", "completed");

        // Verify dependency
        const dependencies = missionDependenciesService.getDependencies(mission2Id);
        expect(dependencies.length).toBe(1);
        expect(dependencies[0].targetMissionId).toBe(mission1Id);

        // Simulate Mission 1 run
        const [run1] = await db.insert(missionRuns).values({
            missionId: mission1Id,
            status: 'completed',
            name: 'Run 1',
            createdBy: testUsername,
            missionContext: {}
        } as any).returning();

        // Trigger dependents (this is what the supervisor would do automatically)
        const triggerResults = await missionDependenciesService.triggerDependents(mission1Id, run1.id, 'completed');
        
        expect(triggerResults.length).toBe(1);
        expect(triggerResults[0].triggered).toBe(true);
        expect(triggerResults[0].dependentMissionId).toBe(mission2Id);

        // Normally, the event stream would catch this and start a run for Mission 2.
        // We will mock the start of Mission 2 here.
        const [run2] = await db.insert(missionRuns).values({
            missionId: mission2Id,
            status: 'active',
            name: 'Run 2 (Triggered)',
            createdBy: testUsername,
            missionContext: {}
        } as any).returning();
        expect(run2.status).toBe('active');
    });

    it('Phase 4: Knowledge Graph Capture', async () => {
        // We simulate the Summarizer agent creating a knowledge graph node
        const { embedKnowledgeNode } = await import('@server/knowledge/knowledge-graph-service.js');

        const [node1] = await db.insert(knowledgeNodes).values({
            name: 'Test Research Paper: Agentic Architectures',
            label: 'Paper',
            organizationId: testOrgId,
            externalId: 'test_paper_1',
            data: {
                description: 'A comprehensive study on multi-agent collaboration.',
                sourceMission: mission2Id
            }
        }).returning();

        // Simulate the embedding process
        await embedKnowledgeNode(node1);

        const [node2] = await db.insert(knowledgeNodes).values({
            name: 'Test Research Concept: Shared Blackboard',
            label: 'Concept',
            organizationId: testOrgId,
            data: {
                description: 'Using a blackboard pattern for agent communication.',
                sourceMission: mission2Id
            }
        }).returning();

        await embedKnowledgeNode(node2);

        // Create a relationship between the two
        await db.insert(knowledgeEdges).values({
            sourceId: node1.id,
            targetId: node2.id,
            relation: 'MENTIONS',
            organizationId: testOrgId,
            weight: 1.0
        });

        // Verify the database has the nodes
        const nodes = await db.select().from(knowledgeNodes).where(like(knowledgeNodes.name, 'Test Research%'));
        expect(nodes.length).toBeGreaterThanOrEqual(2);

        const edges = await db.select().from(knowledgeEdges).where(eq(knowledgeEdges.sourceId, node1.id));
        expect(edges.length).toBe(1);
        expect(edges[0].targetId).toBe(node2.id);
        expect(edges[0].relation).toBe('MENTIONS');
    });
});
