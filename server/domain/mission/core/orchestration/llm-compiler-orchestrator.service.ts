import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { safeJsonParse } from "@server/utils/json-repair.js";

const logger = createLogger("LLMCompilerOrchestrator");

export interface TaskStep {
  id: string;
  name: string;
  agentId: string;
  description: string;
  dependsOn: string[];
}

export interface CompiledPlan {
  steps: TaskStep[];
}

export class LLMCompilerOrchestratorService {
  /**
   * Compiles a high-level mission objective into a structured DAG of steps.
   */
  static async compilePlan(
    objective: string,
    availableAgents: Array<{ id: string; name: string }>
  ): Promise<CompiledPlan> {
    logger.info(`[LLMCompiler] Compiling plan for objective: "${objective}"`);

    const agentListText = availableAgents.map(a => `- ${a.id}: ${a.name}`).join("\n");

    const prompt = `
You are the Lead AI Compiler. Your job is to translate a high-level user objective into a directed acyclic graph (DAG) of task steps.

### Objective:
"${objective}"

### Available Agents:
${agentListText}

### Instructions:
1. Break down the objective into a list of logical steps.
2. For each step, assign the most suitable agent by its id.
3. For each step, define its dependencies using the "dependsOn" array of step IDs. If a step has no dependencies, "dependsOn" should be empty.
4. Ensure there are no cycles in the dependencies.
5. Keep the plan focused and optimal.

Return the result STRICTLY as a JSON object of this structure:
{
  "steps": [
    {
      "id": "unique-step-id-1",
      "name": "Short Name",
      "agentId": "agent-id-to-assign",
      "description": "Clear instructions for what this step does",
      "dependsOn": []
    },
    {
      "id": "unique-step-id-2",
      "name": "Dependent Step Name",
      "agentId": "agent-id-to-assign",
      "description": "Clear instructions for what this step does",
      "dependsOn": ["unique-step-id-1"]
    }
  ]
}
`;

    const response = await systemAiService.generateJson(prompt, "architect");
    if (!response || !Array.isArray(response.steps)) {
      logger.warn(`[LLMCompiler] Invalid response format. Falling back to simple default plan.`);
      return {
        steps: [
          {
            id: "step-1",
            name: "Default Analysis",
            agentId: availableAgents[0]?.id || "default",
            description: `Execute goal: ${objective}`,
            dependsOn: []
          }
        ]
      };
    }

    return response as CompiledPlan;
  }

  /**
   * Performs topological sort and groups steps into execution waves.
   */
  static computeWaves(steps: TaskStep[]): TaskStep[][] {
    const stepMap = new Map<string, TaskStep>();
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      adj.set(step.id, []);
    }

    for (const step of steps) {
      for (const parentId of step.dependsOn) {
        if (!stepMap.has(parentId)) continue;
        adj.get(parentId)!.push(step.id);
        inDegree.set(step.id, inDegree.get(step.id)! + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const waves: TaskStep[][] = [];
    let currentWaveIds: string[] = [...queue];

    while (currentWaveIds.length > 0) {
      const nextWaveIds: string[] = [];
      const waveSteps: TaskStep[] = [];

      for (const id of currentWaveIds) {
        const step = stepMap.get(id);
        if (step) waveSteps.push(step);

        const children = adj.get(id) || [];
        for (const childId of children) {
          inDegree.set(childId, inDegree.get(childId)! - 1);
          if (inDegree.get(childId) === 0) {
            nextWaveIds.push(childId);
          }
        }
      }

      waves.push(waveSteps);
      currentWaveIds = nextWaveIds;
    }

    return waves;
  }

  /**
   * Main entry point to orchestrate a mission dynamically.
   */
  static async executePlan(
    runId: number,
    objective: string,
    availableAgents: Array<{ id: string; name: string }>,
    executeStepFn: (step: TaskStep) => Promise<any>
  ): Promise<void> {
    logger.info(`[LLMCompiler] Executing dynamic compiled plan for run: ${runId}`);
    const plan = await this.compilePlan(objective, availableAgents);
    const waves = this.computeWaves(plan.steps);

    logger.info(`[LLMCompiler] Generated ${waves.length} topological waves.`);
    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      logger.info(`[LLMCompiler] Executing wave ${i + 1}/${waves.length} containing ${wave.length} tasks...`);
      
      // Run steps in parallel
      await Promise.all(wave.map(step => {
        logger.info(`[LLMCompiler] Launching parallel step: ${step.id} (${step.name})`);
        return executeStepFn(step);
      }));
    }
    logger.info(`[LLMCompiler] Completed dynamic compiled plan for run: ${runId}`);
  }
}
