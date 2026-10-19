
import { db } from "@server/database_service.js";
import { documentTemplates } from "@shared/schema/document-templates.js";
import { createLogger } from "@server/utils/logger.js";
import { LocalSLMService } from "../../ai/core/local-slm.service.js";

const logger = createLogger("MissionTemplate");

export class MissionTemplateService {
    /**
     * Semantically selects the best document template for a given mission objective.
     */
    static async resolveTemplateForObjective(objective: string, orgId: number | null): Promise<string | null> {
        try {
            // 1. Fetch available templates
            const templates = await db.select().from(documentTemplates);
            if (templates.length === 0) return null;

            const templateList = templates.map(t => `- [ID: ${t.id}] ${t.name}: ${t.description}`).join('\n');

            // 2. Use Local SLM to route objective to template
            const prompt = `You are a Semantic Template Router.
Given a mission objective, select the most appropriate document template ID from the list below.

OBJECTIVE: ${objective}

AVAILABLE TEMPLATES:
${templateList}

Return ONLY the ID of the selected template, or "null" if no template is a good fit.`;

            const selectedId = await LocalSLMService.execute('classify', prompt);

            if (selectedId && !selectedId.toLowerCase().includes("null")) {
                // Robustly extract the first numeric ID from the response
                // (Ollama may return "ID: 3" or "The best fit is template 3" instead of just "3")
                const match = selectedId.match(/\b(\d+)\b/);
                const id = match ? parseInt(match[1], 10) : NaN;
                const template = !isNaN(id) ? templates.find(t => t.id === id) : undefined;
                if (template && template.content) {
                    logger.info(`[MissionTemplate] Routed objective to template: ${template.name}`);
                    return template.content;
                }
            }
        } catch (err: any) {
            logger.warn(`[MissionTemplate] Template resolution failed: ${err.message}`);
        }
        return null;
    }
}
