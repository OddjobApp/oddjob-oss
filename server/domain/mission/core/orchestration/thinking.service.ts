
import { db } from "@server/database_service.js";
import { missions, missionRuns, users, routingTelemetry } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { AGENT_TOOLS } from "../../../tools/v1/tool-registry.service.js";
import { skillService } from "../../../agents/core/skill-service.js";
import { SkillManager } from "../../../agents/core/skill-manager.js";
import { appRegistryService } from "../../../apps/app-registry.service.js";
import { buildPersonalityModifier } from "../../../agents/core/app-personality.service.js";
import { HermesProtocolService } from "../../../agents/core/hermes-protocol.service.js";
import { safeJsonParse } from "../../../../utils/json-repair.js";
import { OrchestrationContext, OrchestrationThought } from "./types.js";
import fs from "fs/promises";

const logger = createLogger("OrchestrationThinking");

function calculateStateEntropy(ctx: OrchestrationContext): number {
    let entropy = 0.1; // Baseline entropy

    // 1. Cycle count factor: as the cycle count goes up, it means the agent is spending more cycles on the task (higher complexity/uncertainty).
    const cycleRatio = ctx.cycleCount / Math.max(1, ctx.maxCycles || 20);
    entropy += cycleRatio * 0.3;

    // 2. Blackboard scan: check for errors, failures, retries, and exceptions.
    let errorCount = 0;
    let hasFailedTool = false;
    for (const key of Object.keys(ctx.blackboard)) {
        if (key.toLowerCase().includes("error") || key.toLowerCase().includes("fail") || key.toLowerCase().includes("exception")) {
            errorCount++;
        }
        const val = ctx.blackboard[key];
        if (val && typeof val === "object") {
            try {
                const valStr = JSON.stringify(val).toLowerCase();
                if (valStr.includes("error") || valStr.includes("fail") || valStr.includes("exception") || valStr.includes("rejected")) {
                    errorCount++;
                }
            } catch (e) {
                // Ignore circular reference or JSON stringify errors
            }
        }
        if (key.startsWith("tool_output_")) {
            const data = val as any;
            if (data && typeof data === "object") {
                const text = data.content?.[0]?.text || "";
                if (text.toLowerCase().includes("failure") || text.toLowerCase().includes("error") || text.toLowerCase().includes("exception")) {
                    hasFailedTool = true;
                }
            }
        }
    }

    if (errorCount > 0) {
        entropy += Math.min(0.3, errorCount * 0.1);
    }
    if (hasFailedTool) {
        entropy += 0.2;
    }

    // 3. Dynamic trace reflection indicators (from history)
    if (ctx.dynamicTrace && ctx.dynamicTrace.length > 0) {
        // Count repeated consecutive actions (looping behavior increases uncertainty/entropy)
        let loops = 0;
        for (let i = 1; i < ctx.dynamicTrace.length; i++) {
            if (ctx.dynamicTrace[i].action === ctx.dynamicTrace[i - 1].action) {
                loops++;
            }
        }
        if (loops > 0) {
            entropy += Math.min(0.2, loops * 0.05);
        }
    }

    return Math.min(1.0, Math.max(0.0, entropy));
}

export const orchestrationThinkingService = {
    async determineNextAction(ctx: OrchestrationContext): Promise<OrchestrationThought> {
        const { orgId, missionId, missionRunId, blackboard, missionContext, objective, allowedTools } = ctx;

        // 1. Resolve Personality & Intent
        let intent = objective || "Complete the overarching mission.";
        if (blackboard.viaAppSlug && orgId) {
            try {
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const deployInfo = await appRegistryService.findDeploymentBySlug(blackboard.viaAppSlug, orgId);
                if (deployInfo?.deployment) {
                    const { buildPersonalityModifier } = await import("../../../agents/core/app-personality.service.js");
                    const modifier = buildPersonalityModifier(
                        deployInfo.deployment.oceanTraits as any,
                        deployInfo.deployment.soulArchetype || undefined
                    );
                    if (modifier) intent = `${modifier}\n\n${intent}`;
                }
            } catch (err: any) {
                logger.warn("Failed to apply personality modifier", { error: err.message });
            }
        }

        // 1b. Resolve Behavioral Steering Vector (PSBS)
        let steeringVector = ctx.steeringVector; // Use pre-resolved vector if available
        if (!steeringVector) {
            try {
                const { steeringVectorService } = await import("../../../ai/core/steering-vector.service.js");
                steeringVector = await steeringVectorService.resolveSteeringVector(ctx, {
                    enableGoldenPathRetrieval: true,
                    enablePerCycleReRetrieval: ctx.cycleCount > 3,
                    maxGoldenPathTokens: 500,
                });
            } catch (steeringErr: any) {
                logger.warn("[ThinkingService] Failed to resolve steering vector", { error: steeringErr.message });
            }
        }

        // 2. Prune Blackboard (Token Optimization)
        const prunedBlackboard = { ...blackboard };
        const heavyKeys = Object.keys(prunedBlackboard).filter(k => k.startsWith('tool_output_'));
        const toolInventory: string[] = [];

        for (const key of heavyKeys) {
            const data = prunedBlackboard[key] as any;
            let summary = "";
            if (data && typeof data === 'object') {
                const actualData = data.content?.[0]?.text ? safeJsonParse(data.content[0].text.replace(/^Success: /, "")) : data;
                if (Array.isArray(actualData)) {
                    summary = `${actualData.length} items. Fields: ${Object.keys(actualData[0] || {}).join(", ")}`;
                } else if (typeof actualData === 'object' && actualData !== null) {
                    summary = `Keys: ${Object.keys(actualData).join(", ")}`;
                }
            }
            toolInventory.push(`${key}: ${summary || 'Opaque data'} (${JSON.stringify(data).length} chars)`);
            delete prunedBlackboard[key];
        }

        // 3. Resolve Tools & Skills
        const { getAgentTools } = await import("../../../tools/v1/capabilities/index.js");
        const allAgentTools = getAgentTools();
        
        const filteredTools = Object.values(allAgentTools).filter(t => {
            if (!allowedTools || allowedTools.length === 0) {
                return ["google_search", "browse_web", "get_blackboard", "update_blackboard"].includes(t.name);
            }
            return allowedTools.includes(t.name);
        });

        const toolDocs = filteredTools.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
        
        let dynamicSkillDocs = "";
        try {
            const allSkills = await skillService.listSkills(true);
            const prunedSkills = SkillManager.pruneDynamicSkills(intent, [], allSkills);
            dynamicSkillDocs = prunedSkills.map(s => `- ${s.name}: ${s.description} (Code Lang: ${s.language})`).join('\n');
        } catch (err: any) {
            logger.warn("Failed to fetch dynamic skills", { error: err.message });
        }

        // 4. Build Prompt
        const activeSubMissions = (blackboard as any)?.active_sub_missions || [];
        const activeSubMissionsDocs = activeSubMissions.length > 0 
            ? activeSubMissions.map((s: any) => `- Sub-mission Run ID ${s.runId}: ${s.goal} (Status: ${s.status})`).join('\n')
            : "No active sub-missions.";

        // Build step sequence guidance (from mission template)
        let stepSequenceDocs = "";
        if (ctx.stepSequence && ctx.stepSequence.length > 0) {
            const currentIdx = ctx.currentStepIndex ?? 0;
            const steps = ctx.stepSequence.map((step, idx) => {
                const marker = idx === currentIdx ? "→ " : idx < currentIdx ? "✓ " : "  ";
                const humanTag = step.requiresHuman ? " [HUMAN APPROVAL]" : "";
                const outputTag = step.outputs?.length ? ` → outputs: ${step.outputs.join(", ")}` : "";
                const inputTag = step.inputs?.length ? ` (needs: ${step.inputs.join(", ")})` : "";
                return `${marker}${idx + 1}. [${step.stepCode}] ${step.action}: ${step.description || ""}${humanTag}${inputTag}${outputTag}`;
            }).join('\n');
            
            const strategyNote = ctx.executionStrategy === "pre_planned" 
                ? "IMPORTANT: This mission uses a PRE-PLANNED strategy. You MUST follow the steps in order. Do not skip or reorder steps."
                : "This sequence is a recommended execution plan. Follow it unless you have a strong reason to deviate.";
            
            stepSequenceDocs = `\nMISSION STEP SEQUENCE (${ctx.executionStrategy || "dynamic"}):\n${strategyNote}\n${steps}\n`;
        }

        // Build output chaining guidance
        let outputChainingDocs = "";
        if (ctx.stepSequence && ctx.stepSequence.length > 0) {
            const currentStep = ctx.stepSequence[ctx.currentStepIndex ?? 0];
            if (currentStep?.outputs?.length) {
                outputChainingDocs = `\nOUTPUT CONTRACT: When you complete step [${currentStep.stepCode}], you MUST write the following keys to the blackboard using update_blackboard:\n${currentStep.outputs.map(o => `  - "${o}": <your output for this step>`).join('\n')}\nThis ensures downstream steps can read your work.\n`;
            }
            if (currentStep?.inputs?.length) {
                const missingInputs = currentStep.inputs.filter(inp => !blackboard[inp]);
                if (missingInputs.length > 0) {
                    outputChainingDocs += `\nMISSING INPUTS: The following required inputs are not yet on the blackboard: ${missingInputs.join(", ")}. Read them with get_blackboard or check if a prior step needs to run first.\n`;
                }
            }
        }

        // Build steering injection block (token-budget proportional to α)
        let steeringBlock = "";
        if (steeringVector) {
            try {
                const { steeringVectorService } = await import("../../../ai/core/steering-vector.service.js");
                steeringBlock = steeringVectorService.buildSteeringBlock(steeringVector);
            } catch { /* Non-fatal — continue without steering block */ }
        }

        const systemPrompt = `You are the Oddjob Autonomous Orchestrator (Mach 3).
Your goal: ${intent}
${stepSequenceDocs}${outputChainingDocs}${steeringBlock}
RULES:
1. You operate in a stateful "Blackboard" environment.
2. Every action must be aimed at progress. If you're stuck, use 'think_step' to re-evaluate.
3. You have access to specialized Tools and Dynamic Skills.
4. When a step declares outputs, ALWAYS write them to the blackboard so downstream steps can consume them.
5. When advancing to the next step, update the blackboard key "_currentStepIndex" to track progress.

AVAILABLE TOOLS:
${toolDocs}

DYNAMIC SKILLS (Unified Computer Intelligence):
${dynamicSkillDocs}

ACTIVE SUB-MISSIONS:
${activeSubMissionsDocs}

BLACKBOARD STATE (Pruned):
${JSON.stringify(prunedBlackboard, null, 2)}

TOOL OUTPUT INVENTORY (Reference these by name if needed):
${toolInventory.join('\n') || 'No large outputs yet.'}

EXECUTION HISTORY (Past Cycles):
${(ctx as any).dynamicTrace ? JSON.stringify((ctx as any).dynamicTrace.slice(-10), null, 2) : 'No history available.'}

RESPONSE PROTOCOL:
You must respond using the HERMES XML protocol:
<think>Your step-by-step reasoning</think>
<action name="tool_name">
  {"param1": "value"}
</action>

CRITICAL: You MUST ONLY use tool names listed in AVAILABLE TOOLS or DYNAMIC SKILLS. Using any other name will result in a system error and mission stall. Do NOT hallucinate tool names like "critic_agent" or "file_manager" unless they are explicitly listed above.

If the mission is complete, use:
<action name="conclude_mission">
  {"result": "Summary of findings"}
</action>`;

        // 5. Call LLM
        let aiConfig = await systemAiService.getAiConfig('copilot', orgId ?? undefined) || { provider: 'google', model: 'gemini-2.0-flash', apiKey: "" };
        let apiKey = aiConfig.apiKey || "";
        
        // --- STUDENT LLM ROUTING WITH PREDICTIVE ENTROPY ---
        const HIGH_THRESHOLD = 0.7;
        const LOW_THRESHOLD = 0.3;
        const stateEntropy = calculateStateEntropy(ctx);
        logger.info(`[ThinkingService] Calculated blackboard state entropy: ${stateEntropy.toFixed(3)}`);

        let useStudent = false;
        if (ctx.studentModelConfig) {
            if (stateEntropy >= HIGH_THRESHOLD) {
                logger.info(`[ThinkingService] High state entropy (${stateEntropy.toFixed(3)} >= ${HIGH_THRESHOLD}). Routing to high-capability Teacher model for safety.`);
                useStudent = false;
            } else if (stateEntropy < LOW_THRESHOLD) {
                logger.info(`[ThinkingService] Low state entropy (${stateEntropy.toFixed(3)} < ${LOW_THRESHOLD}). Routing to cheap Student model.`);
                useStudent = true;
            } else {
                // Moderate entropy: fall back to Teacher — student models are unreliable in ambiguous state
                logger.info(`[ThinkingService] Moderate state entropy (${stateEntropy.toFixed(3)}). Routing to Teacher model for reliability.`);
                useStudent = false;
            }
        }

        if (useStudent && ctx.studentModelConfig) {
            logger.info(`[ThinkingService] Routing request to Specialized Student LLM: ${ctx.studentModelConfig.adapterPath}`);
            aiConfig = {
                provider: 'ollama', // We assume student models run locally via Ollama/vLLM
                model: ctx.studentModelConfig.baseModel,
                apiKey: "",
            } as any;
            (aiConfig as any).baseUrl = 'http://localhost:11434';
            (aiConfig as any).adapterPath = ctx.studentModelConfig.adapterPath;
        } else {
            logger.info(`[ThinkingService] Routing request to Teacher LLM: ${aiConfig.provider}/${aiConfig.model}`);
        }

        // Log routing decision to routing_telemetry table asynchronously
        const telModelUsed = useStudent && ctx.studentModelConfig
            ? `${ctx.studentModelConfig.baseModel} (Student)`
            : `${aiConfig.provider}/${aiConfig.model} (Teacher)`;
        const telCostSavings = useStudent && ctx.studentModelConfig ? 0.015 : 0.0;

        // Log steering telemetry to dynamic trace (fire-and-forget)
        if (steeringVector) {
            try {
                const { steeringVectorService } = await import("../../../ai/core/steering-vector.service.js");
                const steeringEntry = steeringVectorService.buildTraceEntry(steeringVector, ctx.cycleCount);
                logger.info(`[ThinkingService] Steering vector applied: α=${steeringVector.alpha}, dims=${steeringVector.dimensions.length}, gp=${steeringVector.goldenPathId ?? 'none'}`);
                // Attach resolved vector to trace for downstream consumers
                (ctx as any).steeringVector = steeringVector;
            } catch { /* Non-fatal */ }
        }

        db.insert(routingTelemetry).values({
            missionRunId: missionRunId || null,
            routingDecision: useStudent ? 'student' : 'teacher',
            entropy: stateEntropy,
            modelUsed: telModelUsed,
            costSavings: telCostSavings,
        }).then(() => {
            logger.info(`[ThinkingService] Logged routing decision to telemetry table: ${useStudent ? 'student' : 'teacher'}`);
        }).catch(err => {
            logger.error(`[ThinkingService] Failed to log routing decision to telemetry table: ${err.message}`);
        });

        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: (aiConfig as any).baseUrl } as any);

        const response = await aiClient.execute(
            {
                model: aiConfig.model,
                systemPrompt: systemPrompt,
                userPrompt: `Cycle ${ctx.cycleCount}. Determine next step.`,
                temperature: 0.2,
                adapterPath: (aiConfig as any).adapterPath // Pass adapter path to AI Provider
            } as any,
            undefined,
            apiKey
        );

        const rawResponse = response.output || "";
        logger.info(`[ThinkingService] Raw AI Response: ${rawResponse}`);

        // 6. Parse Response
        const parsed = HermesProtocolService.parseResponse(rawResponse);

        const thought = parsed.thought;
        const action = parsed.toolCalls?.[0]?.name;
        const params = parsed.toolCalls?.[0]?.arguments;

        return {
            action: action || 'think_step',
            reasoning: thought || 'Analyzing next steps.',
            params,
            protocol: 'hermes',
            rawResponse
        };
    }
};
