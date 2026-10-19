import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges, skills, approvalRequests, saasConnectors } from "@shared/schema/index.js";
import { eq, and, notInArray, sql, desc, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { decisionRouter } from "./decision-router.js";
import { hermesProtocolService } from "../../agents/core/hermes-protocol.service.js";

const logger = createLogger("InnovationLabService");

export class InnovationLabService {
    /**
     * Scans the TrustGraph for entities that represent missing capabilities.
     * Logic: Finds nodes mentioned in missions with high edge count that don't match existing skills.
     */
    async scanForEvolutionOpportunities(orgId: number, rotationSeed?: number) {
        logger.info("Starting TrustGraph evolution scan...", { orgId, rotationSeed });

        // 1. Get existing skill names to avoid duplicates
        const existingSkills = await db.select({ name: skills.name }).from(skills);
        const skillNames = existingSkills.map(s => s.name.toLowerCase());

        // 2. Determine total gaps for rotation offset
        const [totalGapsResult] = await db.select({ count: sql<number>`count(distinct ${knowledgeNodes.id})` })
            .from(knowledgeNodes)
            .where(and(
                eq(knowledgeNodes.organizationId, orgId),
                sql`${knowledgeNodes.label} IN ('Tool', 'Capability', 'Workflow', 'Service')`,
                // Ideally we'd also filter by !skillNames here but count(distinct) is simpler for total pool
            ));
        
        const totalGaps = Number(totalGapsResult?.count || 0);
        const limit = 10;
        const maxOffsets = Math.max(1, Math.ceil(totalGaps / limit));
        const offset = rotationSeed !== undefined ? (rotationSeed % maxOffsets) * limit : 0;

        logger.debug("Evolution scan parameters", { totalGaps, limit, offset });

        // 3. Identify "Capability Gaps" in the Knowledge Graph with rotation
        const gaps = await db.select({
            id: knowledgeNodes.id,
            name: knowledgeNodes.name,
            label: knowledgeNodes.label,
            edgeCount: sql<number>`count(${knowledgeEdges.id})`
        })
        .from(knowledgeNodes)
        .leftJoin(knowledgeEdges, eq(knowledgeNodes.id, knowledgeEdges.targetId))
        .where(and(
            eq(knowledgeNodes.organizationId, orgId),
            sql`${knowledgeNodes.label} IN ('Tool', 'Capability', 'Workflow', 'Service')`,
            sql`${knowledgeNodes.sourceType} != 'confluence'`
        ))
        .groupBy(knowledgeNodes.id, knowledgeNodes.name, knowledgeNodes.label)
        .orderBy(desc(sql`count(${knowledgeEdges.id})`))
        .limit(limit)
        .offset(offset);

        const filteredGaps = gaps.filter(gap => !skillNames.includes(gap.name.toLowerCase()));

        if (filteredGaps.length === 0) {
            logger.info("No evolution gaps detected in TrustGraph.");
            return [];
        }

        logger.info(`Detected ${filteredGaps.length} potential evolution gaps.`, { gaps: filteredGaps.map(g => g.name) });

        const pitches = [];
        for (const gap of filteredGaps) {
            const pitch = await this.generateEvolutionPitch(gap, orgId);
            if (pitch) pitches.push(pitch);
        }

        return pitches;
    }

    /**
     * Fetches connected SaaS platforms for an organization to assess integration value-adds.
     */
    private async getConnectedPlatforms(orgId: number) {
        try {
            const platforms = await db.select({
                platform: saasConnectors.platform,
                status: saasConnectors.status
            })
            .from(saasConnectors)
            .where(and(
                eq(saasConnectors.orgId, orgId),
                eq(saasConnectors.status, 'connected')
            ));
            
            return platforms.map(p => p.platform);
        } catch (error) {
            logger.error("Failed to fetch connected platforms", error as Error);
            return [];
        }
    }

    /**
     * Uses Hermes Protocol to research and pitch a missing capability.
     */
    private async generateEvolutionPitch(gap: any, orgId: number) {
        logger.info(`Generating evolution pitch for: ${gap.name}`);

        // 1. Get integration context
        const connectedPlatforms = await this.getConnectedPlatforms(orgId);
        const integrationContext = connectedPlatforms.length > 0 
            ? `Connected Platforms: ${connectedPlatforms.join(', ')}` 
            : "No external platforms currently connected.";

        // 2. Research the gap (Synthesized context from Knowledge Graph)
        const context = await db.select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.id, gap.id))
            .limit(1);

        const prompt = `
        <mission>EVOLUTIONARY_PITCH</mission>
        <context>
            The Oddjob TrustGraph has identified a structural gap: "${gap.name}" (${gap.label}).
            This entity has ${gap.edgeCount} references but no associated functional Skill.
            
            Entity Data: ${JSON.stringify(context[0]?.data || {})}
            
            ${integrationContext}
        </context>
        <instruction>
            Analyze how adding a specialized Skill or App for "${gap.name}" would improve corporate efficiency.
            
            CRITICAL ADDITION: Assess how the currently connected platforms (${connectedPlatforms.join(', ') || 'none'}) can be leveraged to support or enhance this new capability.
            Identify specific "Integration Value-Adds" (e.g., "Use Slack for real-time notifications of this workflow" or "Sync this data to Jira").
            
            Provide:
            1. Rationale (Why now?)
            2. Implementation Strategy (How?)
            3. ROI Hypothesis (Benefit?)
            4. Integration Assessment (Value-Adds for connected services)
        </instruction>
        `;

        const hermesResponse = await hermesProtocolService.reason(prompt);
        
        if (!hermesResponse.thought_process || !hermesResponse.action_details) {
            logger.warn("Hermes failed to generate a valid pitch structure.");
            return null;
        }

        // 3. Wrap as an Approval Request (Decision Inbox)
        const request = await decisionRouter.requestDecision({
            sessionId: `evo_${gap.name}_${Date.now()}`,
            tool: "Innovation Lab",
            goal: `Evolutionary Pitch: ${gap.name}`,
            riskLevel: "low",
            description: `A proposal to evolve the TrustGraph by adding the "${gap.name}" capability.`,
            params: {
                type: 'EVOLUTIONARY_PITCH',
                gap: gap.name,
                rationale: hermesResponse.thought_process,
                proposal: hermesResponse.action_details,
                integrationAssessment: hermesResponse.integration_assessment || "Automated assessment: This capability can operate independently or be hooked into future integrations.",
                connectedPlatforms,
                hermes_raw: hermesResponse
            },
            isEvolutionary: true, 
            organizationId: orgId,
            approverType: "internal",
            approverEmail: "admin@example.com", // System default (verified account)
            channels: ["inbox", "copilot"],
            noWait: true
        });

        logger.info(`Evolution pitch posted to Decision Inbox.`, { requestId: request.requestId });
        return request;
    }

}

export const innovationLabService = new InnovationLabService();
