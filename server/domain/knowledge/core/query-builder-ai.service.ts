import { createLogger } from "@server/utils/logger.js";
import { queryBuilderService, type VisualQuery } from "@domain/knowledge/core/query-builder.service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { graphService } from "@domain/knowledge/index.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("QueryBuilderAiService");

export const queryBuilderAiService = {
    /**
     * Map natural language intent to a VisualQuery object
     */
    async generateVisualQuery(
        intent: string,
        orgContext: OrgContext,
        currentQuery?: VisualQuery
    ): Promise<VisualQuery> {
        try {
            logger.info(`Generating visual query for intent: "${intent}"`);

            // 1. Gather schema information
            const [nodeTypes, relTypes] = await Promise.all([
                graphService.getLabels(orgContext),
                graphService.getRelationshipTypes(orgContext)
            ]);

            // 2. Prepare the prompt
            const prompt = `
Role: Knowledge Graph Expert & Cypher Architect.
Task: Translate a user's natural language intent into a "VisualQuery" JSON structure.

Graph Schema:
- Node Types (Labels): ${nodeTypes.join(', ')}
- Relationship Types: ${relTypes.join(', ')}

VisualQuery JSON Structure Definition:
{
  "nodes": [
    { "id": "n1", "label": "LabelName", "alias": "alias_name", "filters": [] }
  ],
  "relationships": [
    { "id": "r1", "type": "TYPE_NAME", "sourceNodeId": "n1", "targetNodeId": "n2", "direction": "outgoing" }
  ],
  "returnClause": {
    "items": [
      { "type": "node", "id": "n1" },
      { "type": "relationship", "id": "r1" }
    ]
  },
  "limit": 50
}

Instructions:
1. Map the user's entities to the provided Node Types.
2. Map the user's requested connections to the Relationship Types.
3. If the user mentions a specific property filter (e.g., "name is 'John'"), add it to the "filters" array of the node.
4. For time-based queries (e.g., "created after 2024", "before June"), use the property "sourceCreatedAt" and operators "before" or "after" with ISO 8601 values.
5. If a "currentQuery" is provided, try to refine it or extend it based on the new intent.
6. Return ONLY valid JSON. No markdown formatting.

Current Query (if any):
${currentQuery ? JSON.stringify(currentQuery, null, 2) : "None"}

User Intent:
"${intent}"

Output JSON:`;

            // 3. Get AI Config and Execute
            const aiConfig = await systemAiService.getAiConfig('copilot');
            if (!aiConfig || !aiConfig.apiKey) {
                throw new Error("AI Service not configured (Missing check for 'copilot' config)");
            }

            const aiClient = AIClientFactory.getClient({
                provider: aiConfig.provider as any,
                baseUrl: aiConfig.baseUrl
            });

            const result = await aiClient.execute({
                model: aiConfig.model,
                userPrompt: prompt,
                temperature: 0.1, // Low temperature for factual structures
                requestType: "json",
                useCache: false,
                saveOutputToFile: false,
                credentialId: aiConfig.credentialId || 0
            }, undefined, aiConfig.apiKey);

            if (!result.success || !result.output) {
                throw new Error(`AI Generation failed: ${result.error || "Empty response"}`);
            }

            // 4. Parse and Validate
            let generatedQuery: VisualQuery;
            try {
                // Remove any markdown code blocks if the LLM ignored instructions
                const cleanOutput = result.output.replace(/```json|```/g, '').trim();
                generatedQuery = JSON.parse(cleanOutput);
            } catch (e) {
                logger.error("Failed to parse AI response as JSON", result.output);
                throw new Error("AI returned invalid JSON structure");
            }

            // Simple validation layer
            if (!generatedQuery.nodes || generatedQuery.nodes.length === 0) {
                throw new Error("AI generated a query with no nodes");
            }

            return generatedQuery;
        } catch (error: any) {
            logger.error("Failed to generate visual query via AI", error);
            throw error;
        }
    }
};


