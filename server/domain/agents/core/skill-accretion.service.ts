import { createLogger } from "../../../utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import * as fs from "fs";
import * as path from "path";

const logger = createLogger("SkillAccretion");

export interface AccretionRunData {
    goal: string;
    history: any[];
    response: string;
    organizationId?: number | null;
}

export class SkillAccretionService {
    /**
     * Accretes and compiles a successful multi-step agent run trace into a permanent markdown skill.
     */
    async accreteFromRun(runData: AccretionRunData): Promise<void> {
        const { goal, history, response } = runData;

        if (!history || history.length === 0) {
            return;
        }

        // 1. Filter: Check if the run executed any actions/tool calls
        const hasToolCalls = history.some(step => {
            const hasToolName = !!step.toolName;
            const hasActionType = step.type === 'action';
            const hasArgs = step.toolArgs && Object.keys(step.toolArgs).length > 0;
            return hasToolName || hasActionType || hasArgs;
        });

        if (!hasToolCalls) {
            logger.info(`[SkillAccretion] Skipping skill accretion for goal "${goal.slice(0, 50)}" - No tool calls executed.`);
            return;
        }

        logger.info(`[SkillAccretion] Initiating skill accretion for goal: "${goal.slice(0, 50)}"...`);

        try {
            // 2. Format execution steps for LLM distillation
            const formattedSteps = history.map((step, idx) => {
                let text = `Step ${idx + 1} [${step.type || step.role}]:`;
                const mainContent = step.thoughts || step.content;
                if (mainContent) {
                    text += `\nThoughts/Content: ${mainContent}`;
                }
                if (step.toolName) {
                    text += `\nCalled Tool: ${step.toolName} | Args: ${JSON.stringify(step.toolArgs || {})}`;
                }
                if (step.observation) {
                    text += `\nObservation: ${step.observation.slice(0, 500)}${step.observation.length > 500 ? "..." : ""}`;
                }
                return text;
            }).join("\n\n");

            // Extract tool names to prompt LLM on which capabilities were successfully leveraged
            const toolNamesUsed = [...new Set(history.map(s => s.toolName).filter(Boolean))];

            // 3. Construct prompt
            const prompt = `You are a world-class Systems and Agentic Workflow Engineer.
We are performing **Autonomic Skill Accretion** on a successful multi-step agent execution trace.
Your task is to analyze the trace and distill it into a reusable customization skill (Markdown document) so that future agents can perform this class of tasks faster, more reliably, and in fewer steps.

Goal: "${goal}"
Final Response: "${response}"

Tools successfully used during this run: ${toolNamesUsed.join(", ")}

Detailed execution steps:
${formattedSteps}

Requirements for the generated Customization Skill:
1. It MUST contain YAML frontmatter at the very top:
   ---
   name: <descriptive-kebab-case-name>
   description: <one-sentence-summary-of-what-this-skill-accomplishes-for-the-agent>
   ---
2. It MUST contain a main "# Instructions" heading explaining the workflow.
3. Outline the detailed step-by-step logic, search query strategies, tool execution sequences (referencing tools like: ${toolNamesUsed.join(", ")}), and parameters to use.
4. Include tips, warnings, or constraints to prevent issues.
5. Do NOT include markdown code blocks wrapping the whole response. Start directly with the YAML frontmatter.

Generate the Markdown Customization Skill now:`;

            // 4. Request LLM distillation
            const rawResponse = await systemAiService.generateText(prompt, { temperature: 0.2 });
            if (!rawResponse) {
                throw new Error("Received empty response from AI for skill distillation.");
            }

            // Clean wrapping markdown blocks
            let cleaned = rawResponse.trim();
            cleaned = cleaned.replace(/^```markdown\n?|```$/gi, '').trim();

            // 5. Extract name/slug from frontmatter YAML
            const nameMatch = cleaned.match(/name:\s*(.+)/i);
            let skillSlug = "autosynthesized-skill-" + Date.now();
            if (nameMatch && nameMatch[1]) {
                skillSlug = nameMatch[1].trim()
                    .toLowerCase()
                    .replace(/['"]/g, '')
                    .replace(/[^a-z0-9_-]+/gi, '-');
            }

            // Ensure skill slug is not empty
            if (!skillSlug || skillSlug === "yaml") {
                skillSlug = "autosynthesized-skill-" + Date.now();
            }

            // 6. Write to Workspace Customizations Root (.agents/skills/<skill_slug>/SKILL.md)
            const targetDir = path.join(process.cwd(), ".agents", "skills", skillSlug);
            await fs.promises.mkdir(targetDir, { recursive: true });
            const targetPath = path.join(targetDir, "SKILL.md");

            await fs.promises.writeFile(targetPath, cleaned, "utf8");
            logger.info(`[SkillAccretion] Successfully accreted new skill: ${skillSlug} at ${targetPath}`);

        } catch (err: any) {
            logger.error(`[SkillAccretion] Skill accretion failed: ${err.message}`, err);
        }
    }
}

export const skillAccretionService = new SkillAccretionService();
