
/**
 * Knowledge Service Facade
 * 
 * Aggregates domain-specific services into a single interface for backward compatibility.
 * 
 * Refactored to split monolithic service into domain services:
 * - GraphService (Nodes, Edges)
 * - TopicService (Topics)
 * - DocumentService (Documents)
 * - StatsService (Metrics)
 * - ContextService (Run/Dataset Context)
 * - AnalysisService (Sessions)
 */

import { graphService } from "./core/graph/graph-service.js";
import { topicService } from "./core/topic-service.js";
import { documentService } from "./core/extraction/document-service.js";
import { statsService } from "./core/stats-service.js";
import { contextService } from "./core/rag/context-service.js";
import { analysisService } from "./core/analysis-service.js";
import { searchService } from "./core/search/search-service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("KnowledgeService");

// Export types for consumers
export * from "./core/types.js";

// Re-export specific helpers if needed by other modules directly
export { graphService, topicService, documentService, statsService, contextService, analysisService };

export const knowledgeService = {
    // --- Graph Operations ---
    ...graphService,

    // --- Topic Operations ---
    ...topicService,

    // --- Document Operations ---
    ...documentService,

    // --- Stats & Context ---
    ...statsService,
    ...contextService,

    // --- Analysis Sessions ---
    ...analysisService,

    // --- Legacy / Helper Wrappers ---

    /**
     * Suggest a Schema based on description (Delegate to knowledge-graph-service)
     */
    async suggestSchema(description: string, orgContext: OrgContext) {
        if (!orgContext.organizationId) throw new BadRequestError("Organization context required", { operation: "suggestSchema" });
        const { suggestSchema } = await import("@server/knowledge/knowledge-graph-service.js");
        return (suggestSchema as any)(description, orgContext);
    },

    /**
     * Execute Semantic Graph Query (Delegate to knowledge-graph-service)
     */
    async semanticQuery(query: string, orgContext: OrgContext) {
        if (!orgContext.organizationId) throw new BadRequestError("Organization context required", { operation: "semanticQuery" });
        const { semanticGraphQuery } = await import("@server/knowledge/knowledge-graph-service.js");
        return (semanticGraphQuery as any)(query, orgContext);
    },

    /**
     * Unified Semantic Search (Docs + Nodes)
     */
    async searchUnified(query: string, orgContext: OrgContext, options: { limit: number, types?: string[] }) {
        if (!orgContext.organizationId) throw new BadRequestError("Organization context required", { operation: "searchUnified" });
        return searchService.executeUnifiedSearch(query, "unknown", orgContext.organizationId as number);
    },

    // Aliases for migrated methods to maintain partial backward compat with older calling patterns if essential
    // or to map to new naming conventions. Use graphService methods directly where possible.
    async searchKnowledgeGraph(orgContext: OrgContext, options: any) {
        return graphService.queryGraph(orgContext, options);
    },

    /**
     * Compare pipeline runs
     */
    async comparePipelineRuns(
        orgContext: OrgContext,
        pipelineIds: number[],
        baselineWindow: { start_time: string; end_time: string },
        comparisonWindow: { start_time: string; end_time: string }
    ) {
        return contextService.comparePipelineRuns(orgContext, pipelineIds, baselineWindow, comparisonWindow);
    },

    /**
     * Get property keys for a specific node type
     */
    async getNodeTypeProperties(nodeType: string, orgContext: OrgContext) {
        return graphService.getNodeTypeProperties(nodeType, orgContext);
    },

    /**
     * Curate a "Lesson Learned" from a mission run.
     * (Agentic Knowledge Curation)
     */
    async curateLesson(missionId: number, content: string, orgContext: OrgContext) {
        if (!orgContext.organizationId) throw new BadRequestError("Organization context required", { operation: "curateLesson" });

        // Create the document with "Agency Intelligence" topic
        const docInput = {
            title: `Lesson Learned: Mission ${missionId} (${new Date().toLocaleDateString()})`,
            textContent: content,
            sourceType: "mission_lesson",
            metadata: { missionId, generatedBy: "agent", type: "lesson_learned" },
            topicNames: ["Agency Intelligence"]
        };

        const document = await documentService.createDocument(docInput, orgContext);

        return {
            documentId: document.id,
            topics: (document as any).topics
        };
    },

    /**
     * Curate a structured "Navigational Guide" from a successful browser run.
     * Bridges raw steps into both a Knowledge Document and a Computer Use Skill draft.
     */
    async curateNavigationalGuide(domain: string, goal: string, steps: any[], orgContext: OrgContext) {
        if (!orgContext.organizationId) throw new BadRequestError("Organization context required", { operation: "curateNavigationalGuide" });

        let skillId: string | undefined;
        try {
            const { learnedSkillsService, adaptGenericStepsToRecordedSteps } = await import("../integrations/trycua/learned-skills.service.js");
            const adapted = adaptGenericStepsToRecordedSteps(steps, domain);
            if (adapted.length > 0) {
                const skill = await learnedSkillsService.createSkillFromSteps({
                    organizationId: orgContext.organizationId as number,
                    userId: orgContext.userId || "system",
                    steps: adapted,
                    goal,
                    name: `Guide: ${goal.slice(0, 70)} (${domain})`
                });
                skillId = skill.id;
            }
        } catch (err: any) {
            logger.warn("Could not synthesize learned skill during curateNavigationalGuide", { error: err?.message });
        }

        const docInput = {
            title: `Navigational Guide: ${goal} on ${domain}`,
            textContent: JSON.stringify(steps),
            sourceType: "browser_guide",
            metadata: { 
                type: "navigational_guide", 
                domain, 
                goal, 
                skillId,
                recordedAt: new Date().toISOString(),
                schemaVersion: "1.0"
            },
            topicNames: ["Agency Intelligence", "Browser Automation"]
        };

        const document = await documentService.createDocument(docInput, orgContext);
        return { documentId: document.id, skillId };
    },

    /**
     * Finds previous successful guides for a domain/goal.
     * Checks active learned skills first for deterministic replayable procedures,
     * falling back to unified knowledge document search.
     */
    async findNavigationalGuide(domain: string, goal: string, orgContext: OrgContext) {
        if (!orgContext.organizationId) return null;
        
        // 1. Try to find a matching active learned skill first
        try {
            const { learnedSkillsService, matchSkill } = await import("../integrations/trycua/learned-skills.service.js");
            const activeSkills = await learnedSkillsService.listSkills(orgContext.organizationId as number, "active");
            const matched = matchSkill(activeSkills, goal);
            if (matched && (!matched.site || matched.site.toLowerCase().includes(domain.toLowerCase()) || domain.toLowerCase().includes(matched.site.toLowerCase()))) {
                return {
                    id: matched.id,
                    title: matched.name,
                    textContent: matched.procedure || JSON.stringify(matched.steps),
                    sourceType: "learned_skill",
                    metadata: {
                        type: "learned_skill",
                        skillId: matched.id,
                        domain: matched.site,
                        goal: matched.goalExample,
                        procedure: matched.procedure,
                        inputs: matched.inputs,
                        steps: matched.steps,
                        riskClass: matched.riskClass,
                    }
                };
            }
        } catch (err: any) {
            logger.warn("Could not query learned skills during findNavigationalGuide", { error: err?.message });
        }

        // 2. Fall back to unified search over knowledge documents
        const query = `navigational guide for ${goal} on ${domain}`;
        const results = await searchService.executeUnifiedSearch(query, "unknown", orgContext.organizationId as number);
        
        // Filter for guides in metadata if possible, or just return top result
        const guides = results.filter(r => (r as any).metadata?.type === "navigational_guide" || r.title?.includes("Navigational Guide"));
        
        return guides.length > 0 ? guides[0] : null;
    },
};

export default knowledgeService;


