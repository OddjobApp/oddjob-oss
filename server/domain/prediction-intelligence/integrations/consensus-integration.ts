// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CONSENSUS INTEGRATION
// Maps the relationship chain: Agent -> Proposal -> Vote
// ============================================================================

import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConsensusIntegration");

export class ConsensusIntegration {
    /**
     * Maps agent consensus proposals and votes in the Trustgraph.
     */
    async mapConsensus(
        proposalId: string,
        proposalTitle: string,
        agentVotes: Array<{ agentId: string; vote: string }>,
        missionId: string,
        orgContext: OrgContext
    ): Promise<boolean> {
        logger.info(`[Consensus] Mapping proposal ${proposalId} for mission ${missionId}`);

        try {
            // 1. Create/Resolve Proposal Node
            const proposalNodeName = `Proposal: ${proposalTitle}`;
            const propIds = await graphService.resolveEntitiesToNodeIds([proposalNodeName], orgContext);
            let propNodeId = propIds[0];
            if (!propNodeId) {
                const node = await graphService.createNode({
                    name: proposalNodeName,
                    label: "Proposal",
                    properties: { proposalId }
                } as any, orgContext);
                propNodeId = node.id;
            }

            // 2. Resolve Mission Node
            const missionNodes = await graphService.searchNodes(orgContext, {
                label: "Mission",
                query: missionId
            });
            let missionNodeId = missionNodes.nodes[0]?.id;

            if (!missionNodeId) {
                const node = await graphService.createNode({
                    name: `Mission: ${missionId}`,
                    label: "Mission",
                    missionId: missionId,
                    properties: { status: "active" }
                } as any, orgContext);
                missionNodeId = node.id;
            }

            // 3. Link Proposal to Mission
            await graphService.createEdge({
                sourceNodeId: propNodeId,
                targetNodeId: missionNodeId,
                relation: "FOR_MISSION",
                weight: 5,
                properties: {}
            } as any, orgContext);

            // 4. Map Votes
            for (const agentVote of agentVotes) {
                // Resolve Agent Node
                const agentName = `Agent: ${agentVote.agentId}`;
                const agentIds = await graphService.resolveEntitiesToNodeIds([agentName], orgContext);
                let agentNodeId = agentIds[0];
                if (!agentNodeId) {
                    const node = await graphService.createNode({
                        name: agentName,
                        label: "Agent",
                        properties: { agentId: agentVote.agentId }
                    } as any, orgContext);
                    agentNodeId = node.id;
                }

                // Create Edge: Agent -> VOTED -> Proposal
                await graphService.createEdge({
                    sourceNodeId: agentNodeId,
                    targetNodeId: propNodeId,
                    relation: "VOTED",
                    weight: agentVote.vote === "yes" ? 10 : 1, // Map yes to high weight, no to low
                    properties: { vote: agentVote.vote }
                } as any, orgContext);
            }

            logger.info(`[Consensus] Successfully mapped consensus for proposal ${proposalId}`);
            return true;
        } catch (error: any) {
            logger.error(`[Consensus] Failed to map consensus`, error);
            return false;
        }
    }
}

export const consensusIntegration = new ConsensusIntegration();
