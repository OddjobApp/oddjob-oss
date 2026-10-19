import { TaskManifest, TaskManifestSchema } from '../../../ai/core/autonomous-lifecycle.service.js';
import { SpeculativeExecutionService } from './speculative-execution.service.js';
import { LLMStateSimulator } from './llm-state-simulator.js';
import { SentinelService } from '../../../mission/core/sentinel-service.js';
import { safeJsonParse } from '../../../../utils/json-repair.js';
import { createLogger } from '../../../../utils/logger.js';
import { eventStream } from '../../../core/infrastructure/event-stream.service.js';

const logger = createLogger('PlannerStrategies');

export interface PlannerContext {
    client: any;
    apiKey?: string;
    defaultModel: string;
    organizationId?: number;
    missionId?: number;
    jobId?: number;
}

export interface PlannerStrategy {
    plan(goal: string, tools: any[], context: PlannerContext): Promise<TaskManifest | null>;
}

/**
 * MCTS-based planning strategy.
 */
export class MCTSPlannerStrategy implements PlannerStrategy {
    async plan(goal: string, tools: any[], context: PlannerContext): Promise<TaskManifest | null> {
        logger.info(`Planning manifest for goal: ${goal} using MCTS Strategy`);

        try {
            const simulator = new LLMStateSimulator(goal, tools, context.organizationId);
            const realEventStream = {
                publish: async (event: any) => {
                    logger.info(`[Speculative Event] ${event.type}`, event.payload);
                    await eventStream.publish(event.type, event.payload, { organizationId: context.organizationId });
                }
            };
            const speculativeService = new SpeculativeExecutionService(simulator, realEventStream as any);

            const initialState = {
                id: 'root',
                description: 'Initial state',
                context: { goal },
                parentId: null,
                depth: 0,
                isTerminal: false,
                value: 0,
                visits: 0,
                totalReward: 0
            };

            // Fetch predictions
            let predictions: { suggestedSources: string[]; priorityKeywords: string[] } | undefined;
            try {
                const { researchPredictor } = await import("../../../prediction-intelligence/prediction/research-predictor.js");
                const { randomUUID } = await import("crypto");
                
                const prediction = await researchPredictor.predictResearchTargets(goal, {
                    mode: "realtime",
                    now: new Date().toISOString(),
                    requestId: `research-${randomUUID()}`,
                    correlationId: context.missionId ? `mission-${context.missionId}` : `research-strategy`
                });
                
                predictions = {
                    suggestedSources: prediction.suggestedSources,
                    priorityKeywords: prediction.priorityKeywords
                };
                logger.info(`[MCTSPlannerStrategy] Fetched predictions for goal: ${goal}`);
            } catch (err: any) {
                logger.error(`[MCTSPlannerStrategy] Research prediction failed: ${err.message}`);
            }

            const result = await speculativeService.plan({
                id: `plan-${Math.random().toString(36).substring(2, 9)}`,
                initialState,
                goal,
                availableActions: tools.map(t => t.name),
                horizon: 'medium',
                successCriteria: 'Goal reached',
                predictions
            });

            if (result.bestPlan && result.bestPlan.length > 0) {
                const steps = result.bestPlan.map((action, index) => ({
                    id: `step_${index + 1}`,
                    description: action.description,
                    tool: action.type,
                    params: action.parameters,
                    hypothesis: action.expectedOutcome,
                    completionCriteria: [action.expectedOutcome || "The action produces a non-error result that advances the objective."],
                    risk: (action.cost > 5 ? "high" : (action.cost > 2 ? "medium" : "low")) as "low" | "medium" | "high",
                    status: "pending" as const,
                    verificationTool: undefined as string | undefined,
                    estimatedTokens: 1000,
                    dependencies: index > 0 ? [`step_${index}`] : []
                }));

                return {
                    goal,
                    strategy: `MCTS Plan (Value: ${result.expectedValue.toFixed(3)}, Confidence: ${result.confidence.toFixed(2)})`,
                    successCriteria: ["Every planned step completes and the final output directly satisfies the stated goal."],
                    steps,
                    createdAt: new Date().toISOString(),
                    riskLevel: steps.some(s => s.risk === "high") ? "high" : "low"
                };
            }
            
            logger.warn("MCTS generated empty plan");
            return null;
        } catch (e) {
            logger.error("Failed to generate MCTS plan", e);
            return null;
        }
    }
}

/**
 * Original Prompt-based planning strategy.
 */
export class PromptPlannerStrategy implements PlannerStrategy {
    async plan(goal: string, tools: any[], context: PlannerContext): Promise<TaskManifest | null> {
        logger.info(`Planning manifest for goal: ${goal} using Prompt Strategy`);

        // Predictive Leverage
        let predictionPrompt = "";
        try {
            const { researchPredictor } = await import("../../../prediction-intelligence/prediction/research-predictor.js");
            const { randomUUID } = await import("crypto");
            
            const prediction = await researchPredictor.predictResearchTargets(goal, {
                mode: "realtime",
                now: new Date().toISOString(),
                requestId: `research-${randomUUID()}`,
                correlationId: context.missionId ? `mission-${context.missionId}` : `research-strategy`
            });
            
            predictionPrompt = `
PREDICTIVE TARGETS (Suggested by Prediction Engine):
- Suggested Sources: ${prediction.suggestedSources.join(", ")}
- Priority Keywords: ${prediction.priorityKeywords.join(", ")}
- Reasoning: ${prediction.reason}

Use these suggestions to guide your search queries and tool selection.
`;
        } catch (err: any) {
            logger.error(`[PromptPlannerStrategy] Research prediction failed: ${err.message}`);
        }

        const skillNames = tools.map(t => t.name);
        const healthMap = await SentinelService.getBatchSkillHealth(skillNames);
        
        const toolHealthData = tools.map(t => ({
            name: t.name,
            ...healthMap[t.name]
        }));

        const toolContext = tools.map((t, i) => {
            const h = toolHealthData[i];
            const reliabilityTag = h.totalRuns > 0 ? ` [Reliability: ${h.reliabilityIndex}%, Avg Latency: ${h.avgLatencyMs}ms]` : " [New/Untested]";
            return `- ${t.name}: ${t.description}${reliabilityTag}`;
        }).join("\n");

        const prompt = `
You are the "Strategic Planner" for an autonomous agent. 
Analyze the user's goal and the available tools to create a "Task Manifest" (a step-by-step plan).

${predictionPrompt}

GOAL: ${goal}
AVAILABLE TOOLS (with real-time Sentinel reliability metrics):
${toolContext}

INSTRUCTIONS:
1. Restate the outcome as 1-5 objective-level success criteria that are observable and testable. Do not use vague criteria such as "looks good" or "goal reached".
2. Break the goal into the smallest logical steps needed to satisfy those criteria. Preserve useful completed work when recovery is needed.
3. For each step, specify the tool, a hypothesis, and concrete completion criteria describing the evidence that proves the step worked.
4. **RELIABILITY FIRST**: Prefer tools with high Reliability (>80%) and low Latency. If a tool has low reliability (< 50%), you MUST explain in the \`strategy\` section why it is still the best choice.
5. **CRITICAL**: The \`tool\` and \`verificationTool\` MUST come from the \`AVAILABLE TOOLS\` list below. Do NOT invent tool names.
6. **ITERATIVE APPROVAL**: If the user asks for "paragraph-by-paragraph" approval, you MUST create SEPARATE steps for each segment.
7. **COMPETITIVE RESEARCH (MANDATORY)**: If the goal involves researching an external company, application (e.g. "Paperclip AI"), or trend, you MUST include \`google_search\` or \`synthesize_mission_assets\` in the FIRST step. Do NOT search internal datasets (Slack/Jira/Confluence) for external entity details.
8. Assign a risk level (low, medium, high).
9. Suggest a 'verificationTool' ONLY if it is in the \`AVAILABLE TOOLS\` list. When its inputs differ from the action, provide \`verificationParams\` explicitly.
10. Prefer independent verification for consequential writes. Never treat tool invocation alone as proof of success.
11. Dependencies must reference existing earlier step IDs. Do not emit duplicate IDs, self-dependencies, or empty plans.

Return ONLY a JSON object matching the TaskManifest schema.
\`\`\`json
{
  "goal": "${goal}",
  "strategy": "...",
  "successCriteria": ["Observable outcome 1", "Observable outcome 2"],
  "steps": [
    {
      "id": "step_1",
      "description": "...",
      "tool": "...",
      "params": {},
      "hypothesis": "...",
      "completionCriteria": ["Observable evidence that proves this step succeeded"],
      "risk": "low|medium|high",
      "verificationTool": "...",
      "verificationParams": {},
      "estimatedTokens": 1000,
      "dependencies": []
    }
  ],
  "createdAt": "${new Date().toISOString()}",
  "riskLevel": "low|medium|high"
}
\`\`\`
`;

        try {
            const res = await context.client.execute({
                model: context.defaultModel,
                systemPrompt: "You are a strategic task planner. Output ONLY valid JSON.",
                userPrompt: prompt,
                temperature: 0
            }, undefined, context.apiKey);

            if (res.success && res.output) {
                const jsonMatch = res.output.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/) || [null, res.output];
                const cleanJson = jsonMatch[1]!.trim();
                const parsed = safeJsonParse(cleanJson);
                return TaskManifestSchema.parse(parsed);
            }
        } catch (e) {
            logger.error("Failed to generate fallback manifest", e);
        }

        return null;
    }
}
