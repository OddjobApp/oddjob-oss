// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — SKILL LINEAGE INTEGRATION
// Maps the relationship chain: Old Skill -> Evolution -> New Skill
// ============================================================================

import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SkillLineageIntegration");

export class SkillLineageIntegration {
    /**
     * Maps the lineage of a skill evolution in the Trustgraph.
     */
    async mapSkillLineage(
        oldSkillName: string,
        newSkillName: string,
        failureReason: string,
        missionId: string,
        orgContext: OrgContext
    ): Promise<boolean> {
        logger.info(`[SkillLineage] Mapping evolution from ${oldSkillName} to ${newSkillName}`);

        try {
            // 1. Create/Resolve Old Skill Node
            const oldSkillIds = await graphService.resolveEntitiesToNodeIds([oldSkillName], orgContext);
            let oldSkillNodeId = oldSkillIds[0];
            if (!oldSkillNodeId) {
                const node = await graphService.createNode({
                    name: oldSkillName,
                    label: "Skill",
                    properties: { status: "deprecated" }
                } as any, orgContext);
                oldSkillNodeId = node.id;
            }

            // 2. Create/Resolve New Skill Node
            const newSkillIds = await graphService.resolveEntitiesToNodeIds([newSkillName], orgContext);
            let newSkillNodeId = newSkillIds[0];
            if (!newSkillNodeId) {
                const node = await graphService.createNode({
                    name: newSkillName,
                    label: "Skill",
                    properties: { status: "active" }
                } as any, orgContext);
                newSkillNodeId = node.id;
            }

            // 3. Resolve Mission Node (that triggered the evolution due to failure)
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
                    properties: { status: "failed" }
                } as any, orgContext);
                missionNodeId = node.id;
            }

            // 4. Create Edge: OldSkill -> EVOLVED_INTO -> NewSkill
            await graphService.createEdge({
                sourceNodeId: oldSkillNodeId,
                targetNodeId: newSkillNodeId,
                relation: "EVOLVED_INTO",
                weight: 10,
                properties: { reason: failureReason }
            } as any, orgContext);

            // 5. Create Edge: Mission -> TRIGGERED_EVOLUTION -> NewSkill
            await graphService.createEdge({
                sourceNodeId: missionNodeId,
                targetNodeId: newSkillNodeId,
                relation: "TRIGGERED_EVOLUTION",
                weight: 8,
                properties: { failureReason }
            } as any, orgContext);

            logger.info(`[SkillLineage] Successfully mapped skill lineage`);
            return true;
        } catch (error: any) {
            logger.error(`[SkillLineage] Failed to map skill lineage`, error);
            return false;
        }
    }
}

export const skillLineageIntegration = new SkillLineageIntegration();
