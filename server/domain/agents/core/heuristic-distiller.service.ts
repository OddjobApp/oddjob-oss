import { db } from "@server/database_service.js";
import { blueprints, skills } from "@shared/schema/index.js";
import { fineTuningPreferences } from "@shared/schema/training.js";
import { eq, or, like } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@server/domain/ai/core/system-ai.service.js";
import { skillService } from "./skill-service.js";

const logger = createLogger("HeuristicDistiller");

export class HeuristicDistillerService {
    /**
     * Distills a highly reliable agent/blueprint into a sandboxed Javascript skill
     */
    async distill(blueprintName: string): Promise<void> {
        logger.info(`[HeuristicDistiller] Initiating distillation for blueprint: ${blueprintName}`);

        try {
            // 1. Query blueprint and skill tables for context
            const [blueprintRecord] = await db
                .select()
                .from(blueprints)
                .where(or(eq(blueprints.name, blueprintName), eq(blueprints.slug, blueprintName)))
                .limit(1);

            const [skillRecord] = await db
                .select()
                .from(skills)
                .where(eq(skills.name, blueprintName))
                .limit(1);

            // 2. Query recent DPO records / preferences for examples
            const preferences = await db
                .select()
                .from(fineTuningPreferences)
                .where(like(fineTuningPreferences.prompt, `%${blueprintName}%`))
                .limit(10);

            // 3. Extract logic definition & constraints
            const description = blueprintRecord?.description || skillRecord?.description || `Heuristic logic for ${blueprintName}`;
            const manifest = blueprintRecord?.manifest || {};
            const inputSchema = blueprintRecord?.configSchema || {};
            const outputSchema = {}; // Placeholder or infer from examples

            // 4. Format examples for prompt
            let examplesText = "No direct examples available.";
            if (preferences && preferences.length > 0) {
                examplesText = preferences.map((p, idx) => {
                    return `Example ${idx + 1}:
Prompt/Input Context: ${p.prompt}
Successful Output: ${p.chosenResponse}`;
                }).join("\n\n");
            }

            // 5. Construct distillation prompt
            const prompt = `You are a world-class systems engineer and code generation engine.
We are performing **Heuristic Distillation** on a high-performing agent pipeline.
The goal is to distill the reasoning steps of a LLM-based blueprint or skill into a single, deterministic, fast, sandboxed JavaScript function that executes the task logic instantly.

Blueprint Name: ${blueprintName}
Description: ${description}
Manifest/Steps Config: ${JSON.stringify(manifest, null, 2)}
Input Schema: ${JSON.stringify(inputSchema, null, 2)}
Output Schema: ${JSON.stringify(outputSchema, null, 2)}

We have captured some prompt and response pairs for this task during live agent runs:
${examplesText}

Environment Constraints for the JavaScript Sandbox:
1. The code runs inside a locked-down Node.js VM context (\`vm.runInNewContext\`).
2. ONLY the following globals/helpers are available:
   - \`args\`: The input object containing arguments for this function.
   - \`result\`: The output/return value variable. You MUST assign the final output to the global \`result\` variable (e.g. \`result = { success: true, ... };\`).
   - \`console\`: exposes \`console.log\`, \`console.warn\`, \`console.error\`.
   - \`Math\`, \`JSON\`, \`Date\`.
   - \`temporal\`: helper library with methods:
     - \`temporal.isBefore(d1, d2)\` (returns boolean)
     - \`temporal.isAfter(d1, d2)\` (returns boolean)
     - \`temporal.isBetween(d, s, e)\` (returns boolean)
     - \`temporal.daysBetween(d1, d2)\` (returns number)
     - \`temporal.addDays(d, days)\` (returns ISO string)
3. You CANNOT use \`require\`, \`import\`, \`fetch\`, external network requests, or filesystem access. Everything must be calculated deterministically in JavaScript.
4. Do NOT wrap the code in a function declaration or IIFE (the execution wrapper does that). Simply write the body of the function, ensuring the final output is assigned to \`result\`.

Your response MUST contain ONLY the JavaScript code block (e.g., inside \`\`\`javascript ... \`\`\` or as raw text). No explanations, no conversation, no markdown other than the optional code block.

Generate the distilled JavaScript code now:`;

            logger.info(`[HeuristicDistiller] Requesting code generation from Teacher LLM for: ${blueprintName}`);
            const rawResponse = await systemAiService.generateText(prompt, { serviceKey: 'codegen' });

            if (!rawResponse) {
                throw new Error("Received empty code generation response from system AI");
            }

            // 6. Clean generated JS code
            const cleanedCode = this.cleanGeneratedCode(rawResponse);

            logger.info(`[HeuristicDistiller] Code generated successfully. Length: ${cleanedCode.length}. Registering dynamic skill...`);

            // 7. Register/Upsert dynamic skill
            const registeredSkill = await skillService.registerDynamicSkill(
                blueprintName,
                `Heuristic distilled deterministic skill for ${blueprintName}. Distilled automatically after high success rate validation.`,
                cleanedCode,
                "javascript"
            );

            logger.info(`[HeuristicDistiller] Distillation completed successfully. Registered skill ID: ${registeredSkill.id}`);

        } catch (err: any) {
            logger.error(`[HeuristicDistiller] Distillation failed for ${blueprintName}: ${err.message}`, err);
            throw err;
        }
    }

    private cleanGeneratedCode(code: string): string {
        let cleaned = code.trim();
        // Remove markdown code blocks if present
        const match = cleaned.match(/```(?:javascript|typescript|js)?\s*([\s\S]*?)\s*```/i);
        if (match) {
            cleaned = match[1].trim();
        }
        return cleaned;
    }
}

export const heuristicDistillerService = new HeuristicDistillerService();
