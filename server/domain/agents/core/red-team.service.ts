import { db } from "@server/database_service.js";
import { skills, fineTuningDatasets, fineTuningPreferences } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@server/domain/ai/core/system-ai.service.js";
import { skillService } from "./skill-service.js";
import { safeJsonParse } from "../../../utils/json-repair.js";

const logger = createLogger("RedTeamService");

export class RedTeamService {
    /**
     * Runs adversarial red-teaming against a distilled skill.
     * Generates tricky inputs, executes the skill, compares with the Teacher, and logs failures.
     */
    async redTeam(skillName: string): Promise<{
        success: boolean;
        testsRun: number;
        failuresFound: number;
        dpoRecordsLogged: number;
        logs: string[];
    }> {
        const logs: string[] = [];
        const log = (msg: string) => {
            logger.info(msg);
            logs.push(msg);
        };

        log(`[RedTeam] Starting red-teaming for skill: ${skillName}`);

        try {
            // 1. Fetch skill
            const skill = await skillService.getSkillByName(skillName);
            if (!skill) {
                throw new Error(`Skill ${skillName} not found in database.`);
            }

            // 2. Resolve or create red-team training dataset
            const datasetName = `Agent ${skillName} Red-Team Dataset`;
            let [dataset] = await db.select()
                .from(fineTuningDatasets)
                .where(eq(fineTuningDatasets.name, datasetName))
                .limit(1);

            if (!dataset) {
                [dataset] = await db.insert(fineTuningDatasets).values({
                    name: datasetName,
                    description: `Adversarial Red-Teaming dataset for skill: ${skillName}`,
                    organizationId: skill.organizationId || null
                }).returning();
                log(`[RedTeam] Created new training dataset: ${datasetName} (id: ${dataset.id})`);
            } else {
                log(`[RedTeam] Using existing dataset: ${datasetName} (id: ${dataset.id})`);
            }

            // 3. Request adversarial inputs from Teacher LLM
            const generationPrompt = `You are a world-class security researcher and red-teaming agent.
We are auditing a distilled deterministic JavaScript function named "${skillName}".
Description of task: ${skill.description || "N/A"}

Function code:
\`\`\`javascript
${skill.code}
\`\`\`

Generate exactly 5 highly complex, adversarial, extreme, or boundary-pushing input argument objects for this function that are likely to cause a naive heuristic, simple logic, or a student model to return incorrect results or crash.

For example, if the function is a math addition tool, provide extreme numbers, negative values, decimals, empty parameters, or unexpected formats. If the function is a string transformer, provide special characters, massive strings, or null inputs.

You MUST respond with ONLY a valid JSON array of these 5 test cases. Do not include markdown formatting or wrapping code blocks other than standard JSON.
Example format:
[
  { "args": { "x": 100000, "y": -99999 } },
  { "args": { "x": 0.00001, "y": 0.00002 } }
]
Ensure each element has an "args" property mapping to the input arguments object.

Generate test cases now:`;

            log(`[RedTeam] Requesting 5 adversarial inputs from Teacher LLM...`);
            const rawInputs = await systemAiService.generateText(generationPrompt, { serviceKey: 'codegen' });

            if (!rawInputs) {
                throw new Error("Received empty adversarial input generation from system AI");
            }

            // Parse inputs
            let parsedInputs: any[] = [];
            try {
                const cleanedStr = rawInputs.trim().replace(/^```json/i, "").replace(/```$/i, "").trim();
                parsedInputs = JSON.parse(cleanedStr);
            } catch (err) {
                log(`[RedTeam] Failed to parse generated JSON directly, attempting JSON repair...`);
                parsedInputs = safeJsonParse(rawInputs) || [];
            }

            if (!Array.isArray(parsedInputs) || parsedInputs.length === 0) {
                throw new Error("Failed to generate a valid non-empty array of test cases.");
            }

            log(`[RedTeam] Generated ${parsedInputs.length} adversarial test cases. Executing evaluations...`);

            let failuresFound = 0;
            let dpoRecordsLogged = 0;

            for (let i = 0; i < parsedInputs.length; i++) {
                const testCase = parsedInputs[i];
                const inputArgs = testCase.args || testCase; // Fallback if structure varies slightly

                log(`[RedTeam] Test #${i + 1}: Arguments = ${JSON.stringify(inputArgs)}`);

                // 4. Run distilled skill in VM sandbox
                const distilledRes = await skillService.executeSkill(skill.id, inputArgs);
                const distilledOutput = distilledRes.success ? distilledRes.result : null;

                // 5. Call Teacher LLM to compute the correct Ground Truth answer
                const teacherPrompt = `You are a highly accurate Teacher agent. Solve the following task: "${skillName}"
Description: ${skill.description || "N/A"}
Input arguments: ${JSON.stringify(inputArgs)}

Write down a brief, logical explanation of your reasoning, then conclude with the exact correct final answer.
Your final answer MUST be returned as a JSON object wrapped inside <output>...</output> tags.
Example:
Some reasoning here...
<output>{"result": 123}</output>

Task: Solve the inputs now:`;

                const rawTeacherResult = await systemAiService.generateText(teacherPrompt, { serviceKey: 'copilot' });
                const outputMatch = rawTeacherResult?.match(/<output>([\s\S]*?)<\/output>/i);
                let teacherOutput: any = null;

                if (outputMatch) {
                    try {
                        teacherOutput = JSON.parse(outputMatch[1].trim());
                    } catch (e) {
                        teacherOutput = safeJsonParse(outputMatch[1].trim());
                    }
                } else {
                    teacherOutput = safeJsonParse(rawTeacherResult || "");
                }

                log(`[RedTeam]   - Distilled output: ${JSON.stringify(distilledOutput)} (Success: ${distilledRes.success})`);
                log(`[RedTeam]   - Teacher output: ${JSON.stringify(teacherOutput)}`);

                // 6. Compare results and log discrepancies to DPO
                const outputsMatch = distilledRes.success &&
                    teacherOutput !== null &&
                    JSON.stringify(distilledOutput) === JSON.stringify(teacherOutput);

                if (!outputsMatch) {
                    failuresFound++;
                    log(`[RedTeam]   ❌ Edge-case failure/discrepancy detected! Logging DPO preference record.`);

                    // Construct prompt, chosen (Teacher), rejected (Distilled/Student)
                    const dpoPrompt = `Task: ${skillName}
Input: ${JSON.stringify(inputArgs)}`;
                    
                    const dpoChosen = JSON.stringify(teacherOutput || { error: "Failed to resolve ground truth" }, null, 2);
                    const dpoRejected = distilledRes.success 
                        ? JSON.stringify(distilledOutput, null, 2) 
                        : JSON.stringify({ success: false, error: distilledRes.error || "Execution crashed" }, null, 2);

                    await db.insert(fineTuningPreferences).values({
                        datasetId: dataset.id,
                        prompt: dpoPrompt,
                        chosenResponse: dpoChosen,
                        rejectedResponse: dpoRejected,
                        humanConfidence: 95 // Pre-approved by system AI validation
                    });
                    dpoRecordsLogged++;
                } else {
                    log(`[RedTeam]   ✅ Distilled output matches Teacher output.`);
                }
            }

            log(`[RedTeam] Red-teaming completed. Run count: ${parsedInputs.length}, Failures found: ${failuresFound}, DPO records created: ${dpoRecordsLogged}`);

            return {
                success: true,
                testsRun: parsedInputs.length,
                failuresFound,
                dpoRecordsLogged,
                logs
            };

        } catch (err: any) {
            log(`[RedTeam] Red-teaming failed: ${err.message}`);
            return {
                success: false,
                testsRun: 0,
                failuresFound: 0,
                dpoRecordsLogged: 0,
                logs
            };
        }
    }
}

export const redTeamService = new RedTeamService();
