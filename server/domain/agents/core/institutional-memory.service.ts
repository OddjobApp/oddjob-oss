
import { db } from "@server/database_service.js";
import { missionRuns, missionMembers, agentDeployments, knowledgeNodes } from "@shared/schema/index.js";
import { memeticGraph } from "@shared/schema/learning/memetic-graph.js";
import { eq, and, sql, gte, desc, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { compactionService } from "./compaction.service.js";
import { graphService } from "@domain/knowledge/core/graph-service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("InstitutionalMemory");

export class InstitutionalMemoryService {
    /**
     * Executes the "Dreaming Phase" (Nightly Batch Compaction)
     * Reviews all successful missions from the last 24h and ensures expertise is distilled.
     */
    static async performNightlyCompaction(organizationId: number) {
        logger.info(`[Memory] Starting nightly dreaming phase for org ${organizationId}...`);

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Single JOIN to get all (runId, agentId) pairs instead of N+1 loops
        const runMembers = await db
            .select({ runId: missionRuns.id, entityId: missionMembers.entityId })
            .from(missionRuns)
            .innerJoin(missionMembers, and(
                eq(missionMembers.missionId, missionRuns.missionId),
                eq(missionMembers.entityType, 'job')
            ))
            .where(and(
                eq(missionRuns.organizationId, organizationId),
                eq(missionRuns.status, 'completed'),
                gte(missionRuns.updatedAt, yesterday)
            ));

        // Fan out with bounded concurrency so we don't open 100+ DB connections simultaneously
        const CONCURRENCY = 10;
        for (let i = 0; i < runMembers.length; i += CONCURRENCY) {
            await Promise.all(
                runMembers.slice(i, i + CONCURRENCY).map(rm =>
                    compactionService.compactSession(rm.runId, rm.entityId, organizationId)
                )
            );
        }

        logger.info(`[Memory] Dreaming phase complete. Processed ${runMembers.length} run-member pairs.`);
    }

    /**
     * Federates Knowledge: Promotes highly relevant nodes from private agent graphs to the Org Graph.
     * Optionally stamps memetic_graph entries with the originating missionRunId for provenance tracking.
     */
    static async federateKnowledge(organizationId: number, missionRunId?: number) {
        logger.info(`[Memory] Starting knowledge federation for org ${organizationId}...`);

        // 1. Find high-ROI nodes in the knowledge graph that are currently 'private'
        const candidates = await graphService.searchNodes(getSystemOrgContext(organizationId), { 
            label: "agent_cv_achievement",
            limit: 10
        });

        for (const node of candidates.nodes) {
            const nodeData = node.data as Record<string, any> | null;
            const nodeMeta = nodeData?.metadata as Record<string, any> | undefined;
            if (nodeMeta?.roi && Number(nodeMeta.roi) > 80) {
                logger.info(`[Memory] Promoting node "${node.name}" to Organizational Graph.`);
                await graphService.updateNode(node.id, {
                    properties: { metadata: { ...nodeMeta, scope: 'org' } }
                }, getSystemOrgContext(organizationId));
            }
        }

        // 2. If run context is available, stamp unlinked memetic_graph entries for this org
        if (missionRunId) {
            try {
                await db.update(memeticGraph)
                    .set({ missionRunId, updatedAt: new Date() })
                    .where(and(
                        eq(memeticGraph.organizationId, organizationId),
                        isNull(memeticGraph.missionRunId)
                    ));
                logger.info(`[Memory] Stamped memetic_graph entries with missionRunId=${missionRunId}`);
            } catch (err: any) {
                logger.warn(`[Memory] Failed to stamp memetic_graph entries: ${err.message}`);
            }
        }
    }

    /**
     * Updates Agent Portfolios with mastered concepts.
     */
    static async updatePortfolios(organizationId: number) {
        const agents = await db.select().from(agentDeployments).where(eq(agentDeployments.organizationId, organizationId));
        
        for (const agent of agents) {
            // Find all concepts this agent is linked to in the graph
            const { nodes } = await graphService.searchNodes(getSystemOrgContext(organizationId), {
                label: 'agent_cv_achievement',
                limit: 100
            });
            const achievements = nodes.filter((n: any) => n.ownerId === agent.jobId);

            const concepts = new Set<string>();
            achievements.forEach(a => {
                const data = (a.data as any) || {};
                const metadata = (a as any).metadata || data; // Handle both schema structures if mixed
                if (metadata.tags && Array.isArray(metadata.tags)) {
                    metadata.tags.forEach((t: string) => concepts.add(t));
                }
            });

            if (concepts.size > 0) {
                const conceptList = Array.from(concepts).join(', ');
                logger.info(`[Memory] Updating portfolio for agent ${agent.title}: Mastered concepts [${conceptList}]`);
                
                // We could store this in a 'mastered_concepts' column or just keep it in the Legend
                const legendUpdate = `\n\n[PORTFOLIO_SYNC: ${new Date().toISOString()}] Mastered concepts: ${conceptList}`;
                await db.update(agentDeployments)
                    .set({ 
                        legend: sql`legend || ${legendUpdate}`,
                        updatedAt: new Date()
                    })
                    .where(eq(agentDeployments.id, agent.id));
            }
        }
    }
}
