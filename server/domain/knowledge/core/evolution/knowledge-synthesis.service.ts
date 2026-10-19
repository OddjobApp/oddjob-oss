import { db } from "../../../../database_service.js";
import { knowledgeNodes, knowledgeEdges, knowledgeEvolutionEvents } from "@shared/schema/index.js";
import { eq, inArray, and, sql } from "drizzle-orm";
import { systemAiService } from "../../../ai/core/system-ai.service.js";
import { missionService } from "../../../mission/core/mission.service.js";
import { createLogger } from "../../../../utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey, ORG_GEMINI_KEY_MISSING, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("KnowledgeSynthesisService");

export const knowledgeSynthesisService = {
  /**
   * Scan a cluster of nodes for missing intelligence.
   */
  async detectKnowledgeGaps(organizationId: number, nodeIds: number[]): Promise<any> {
    logger.info(`Scanning knowledge cluster in org ${organizationId} for gaps (Size: ${nodeIds.length})`);

    // 1. Fetch node context
    const nodes = await db
      .select()
      .from(knowledgeNodes)
      .where(and(
        inArray(knowledgeNodes.id, nodeIds),
        sql`${knowledgeNodes.sourceType} != 'confluence'`
      ));

    if (nodes.length < 3) return { success: false, reason: "Cluster too small for synthesis" };
    if (nodes.length > 100) return { success: false, reason: "Cluster too large for single synthesis pass — paginate or summarise first" };

    // 2. Fetch edge relationships in this cluster
    const edges = await db
      .select()
      .from(knowledgeEdges)
      .where(inArray(knowledgeEdges.sourceId, nodeIds));

    const graphSummary = nodes.map(n => `[${n.label}] ${n.name}: ${JSON.stringify(n.data)}`).join("\n") +
      "\n" + edges.map(e => `${e.sourceId} --(${e.relation})--> ${e.targetId}`).join("\n");

    // 3. Ask LLM to identify gaps
    const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-pro' };
    const aiClient = AIClientFactory.getClient({ provider: config.provider } as any);

    const prompt = `
      You are an Intelligence Synthesis Engine. 
      Analyze the following knowledge graph cluster and identify "White Spaces" (information gaps, contradictions, or missing strategic links).
      
      CLUSTER DATA:
      ${graphSummary}

      OUTPUT INSTRUCTIONS:
      - Define exactly what is missing.
      - Propose a specific, actionable Research Mission to fill this gap.
      - Respond ONLY with the following JSON:
      {
        "identifiedGap": "Detailed description of what we don't know",
        "contradictionDetected": "Description of any conflicting info",
        "proposedMission": {
          "title": "Clear, concise mission title",
          "objective": "Strong objective string",
          "targetMetric": "Specific metric to improve (e.g. data_completeness)"
        }
      }
    `;

    const apiKey = config.provider === 'google' ? await resolveOrgGeminiKey(null) : developmentProviderKey("openai");
    if (!apiKey) throw new Error(`${ORG_GEMINI_KEY_MISSING} to run knowledge synthesis`);

    try {
      const res = await aiClient.execute({
        model: config.model,
        systemPrompt: "You are a proactive intelligence officer. Return only JSON.",
        userPrompt: prompt,
        provider: config.provider as any
      } as any, prompt, apiKey);

      if (!res.success || !res.output) throw new Error("Synthesis AI returned no output");

      const cleanOutput = res.output.replace(/```json|```/g, "").trim().replace(/:\s*None\b/g, ": null");

      let synthesis: any;
      try {
        synthesis = JSON.parse(cleanOutput);
      } catch (parseError: any) {
        logger.error(`Synthesis AI returned invalid JSON: ${parseError.message}`, { rawOutput: cleanOutput.slice(0, 200) });
        return { success: false, error: "Synthesis AI returned malformed JSON", reason: parseError.message };
      }

      if (!synthesis || !synthesis.proposedMission) {
        logger.warn("Synthesis AI returned incomplete data", { synthesis });
        return { 
           success: false, 
           identifiedGap: synthesis?.identifiedGap || "Unknown gap",
           reason: "Proposed mission missing from AI output"
        };
      }

      logger.info(`Gap detected: ${synthesis.proposedMission.title}`);

      // Log the event
      await db.insert(knowledgeEvolutionEvents).values({
        type: "SYNTHESIS",
        status: "SUCCESS",
        organizationId,
        details: {
          gap: synthesis.identifiedGap,
          proposedMission: synthesis.proposedMission,
          nodeIds
        }
      });

      return { success: true, ...synthesis };

    } catch (error: any) {
      logger.error(`Synthesis failure: ${error.message}`);
      return { success: false, error: error.message };
    }
  },

  /**
   * Automatically launch a research mission based on synthesis.
   */
  async launchGapMission(organizationId: number, synthesis: any, userId: string): Promise<number | null> {
    if (!synthesis?.proposedMission) return null;

    logger.info(`Launching proactive research mission: ${synthesis.proposedMission.title}`);
    
    // Create the mission
    const mission = await missionService.createMission({
      name: `[PROACTIVE] ${synthesis.proposedMission.title}`,
      objective: synthesis.proposedMission.objective,
      targetMetric: { type: "completeness", goal: 100 },
      organizationId,
      createdBy: userId,
      type: "mission_based",
      executionStrategy: "dynamic_autonomous",
      blackboard: {
        missionBrief: `This mission was autonomously triggered by the Knowledge Synthesis Engine to fill an intelligence gap: ${synthesis.identifiedGap}`
      }
    }, userId);

    return mission.id;
  }
};


