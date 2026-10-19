import { StateSimulator, PlanningState, PlannedAction } from './types.js';
import { AIClientFactory } from '../../../../domain/ai/core/ai-client.service.js';
import { systemAiService } from '../../../../domain/ai/core/system-ai.service.js';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('LLMStateSimulator');

export class LLMStateSimulator implements StateSimulator {
    private client: any;
    private apiKey: string | undefined;
    private model: string;
    private cache: Map<string, PlanningState> = new Map();

    constructor(private goal: string, private tools: any[], orgId?: number) {
        this.model = "gemini-1.5-flash";
        this.initializeClient(orgId);
    }

    private async initializeClient(orgId?: number) {
        const aiConfig = await systemAiService.getAiConfig('copilot', orgId);
        if (aiConfig) {
            this.client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);
            this.apiKey = aiConfig.apiKey;
            if (aiConfig.model) this.model = aiConfig.model;
        }
    }

    /**
     * Simulate action execution using LLM.
     * Batches state prediction, evaluation, and terminal check.
     */
    async simulate(state: PlanningState, action: PlannedAction): Promise<PlanningState> {
        const cacheKey = `${state.id}-${action.id}`;
        if (this.cache.has(cacheKey)) {
            logger.debug(`Cache hit for simulation: ${cacheKey}`);
            return this.cache.get(cacheKey)!;
        }

        logger.info(`Simulating action: ${action.description}`);
        
        if (!this.client || !this.apiKey) {
            logger.warn("No AI client available for simulation. Returning original state.");
            return state;
        }

        const prompt = `
You are a "World Model" for an autonomous agent.
Given the current state and a proposed action, predict the resulting state, evaluate it, and check if it is terminal.

GOAL: ${this.goal}
CURRENT STATE:
${JSON.stringify(state.context, null, 2)}

PROPOSED ACTION:
${JSON.stringify(action, null, 2)}

Instructions:
1. Predict the new state context after this action is executed.
2. Rate how close this state is to the goal on a scale from -1 (harmful/dead end) to 1 (goal reached).
3. Determine if the state is terminal (goal reached or complete failure).

Return ONLY a JSON object matching this schema:
{
  "context": object,
  "value": number,
  "isTerminal": boolean,
  "reason": "Why it is terminal or not"
}
`;

        try {
            const res = await this.client.execute({
                model: this.model,
                systemPrompt: "You are a state simulator. Output ONLY valid JSON.",
                userPrompt: prompt,
                temperature: 0.2,
                response_format: { type: 'json_object' }
            } as any, undefined, this.apiKey);

            if (res.success && res.output) {
                const cleanJson = res.output.replace(/```json\s*|```/g, '').trim();
                const data = JSON.parse(cleanJson);
                
                const newState: PlanningState = {
                    id: `state-${Math.random().toString(36).substring(2, 9)}`,
                    description: `Simulated state after ${action.type}`,
                    context: data.context || {},
                    parentId: state.id,
                    incomingAction: action,
                    depth: state.depth + 1,
                    isTerminal: data.isTerminal || false,
                    value: data.value || 0,
                    visits: 0,
                    totalReward: 0
                };

                this.cache.set(cacheKey, newState);
                return newState;
            }
        } catch (e: any) {
            logger.error(`Simulation failed: ${e.message}`);
        }

        return state;
    }

    /**
     * Evaluate state value (returns cached value from simulation).
     */
    async evaluate(state: PlanningState): Promise<number> {
        return state.value;
    }

    /**
     * Check if state is terminal (returns cached value from simulation).
     */
    async isTerminal(state: PlanningState): Promise<boolean> {
        return state.isTerminal;
    }

    /**
     * Get available actions.
     */
    async getAvailableActions(state: PlanningState): Promise<PlannedAction[]> {
        return this.tools.map(t => ({
            id: `action-${t.name}`,
            type: t.name,
            description: t.description,
            parameters: {},
            expectedOutcome: "Tool execution",
            cost: 1.0,
            successProbability: 0.9
        }));
    }
}
