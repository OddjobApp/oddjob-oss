/**
 * Blueprint Generator
 * 
 * Uses LLM to generate candidate mission blueprints from natural language requests.
 * 
 * Approach: "FunSearch" style generation
 * - LLM proposes diverse blueprints (n=20-50)
 * - Each proposal includes Hermes reasoning about why it fits
 * - Structured output with full mission configuration
 * 
 * Research basis:
 * - FunSearch: LLM proposes, evaluator scores, best patterns retained
 * - Tree of Thoughts: Diverse reasoning paths explored
 * - Voyager: Skill library informs generation
 */

import { createLogger } from "../../../utils/logger.js";
import { AIClientFactory } from "../../../domain/ai/core/ai-client.service.js";
import { HermesProtocolService } from "../../../domain/agents/core/hermes-protocol.service.js";
import type { 
  BlueprintCandidate, 
  MissionBlueprint,
  GenerationMetadata,
  SynthesizeRequest 
} from "../common/types.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("BlueprintGenerator");

export interface GeneratorConfig {
  nCandidates: number;        // How many blueprints to generate
  temperature: number;        // LLM temperature for diversity
  maxTokensPerCandidate: number;
  model: string;
  
  // Diversity enforcement
  enforceDiversity: boolean;
  diversityDimensions: string[]; // Agent mix, tool selection, structure
  
  // Quality thresholds
  minSteps: number;
  maxSteps: number;
  requiredToolCategories: string[];
}

const DEFAULT_CONFIG: GeneratorConfig = {
  nCandidates: 20,
  temperature: 0.8,
  maxTokensPerCandidate: 2000,
  model: "gemini-2.0-flash",
  enforceDiversity: true,
  diversityDimensions: ["agent_selection", "tool_mix", "execution_strategy", "data_flow"],
  minSteps: 2,
  maxSteps: 15,
  requiredToolCategories: []
};

/**
 * Blueprint Generator
 * 
 * Generates diverse mission blueprints from user requests using
 * structured LLM prompting with Hermes protocol.
 */
export class BlueprintGenerator {
  private config: GeneratorConfig;
  private client: any;
  
  // Available agents and tools for generation
  private availableAgents: string[];
  private availableTools: string[];
  
  constructor(
    config: Partial<GeneratorConfig> = {},
    availableAgents: string[] = [],
    availableTools: string[] = []
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.availableAgents = availableAgents;
    this.availableTools = availableTools;
    this.client = AIClientFactory.getClient({ provider: "google" } as any);
  }

  /**
   * Generate candidate blueprints from user request
   * 
   * This is the main entry point for Phase 2 synthesis.
   */
  async generateCandidates(request: SynthesizeRequest): Promise<BlueprintCandidate[]> {
    const { request: userRequest, context, options } = request;

    // A per-request nCandidates overrides the engine default. Guarded because this
    // drives real LLM calls: a zero or negative value would generate nothing, and a
    // fractional one would make the batching loop misbehave.
    const requestedN = options?.nCandidates;
    const nCandidates =
      typeof requestedN === "number" && Number.isInteger(requestedN) && requestedN > 0
        ? requestedN
        : this.config.nCandidates;

    logger.info(`Generating ${nCandidates} blueprint candidates`, { 
      request: userRequest.substring(0, 100) 
    });
    
    const startTime = Date.now();
    
    // 1. Build generation prompt with diversity constraints
    const prompt = this.buildGenerationPrompt(userRequest, context, nCandidates);
    
    // 2. Generate proposals via LLM with Hermes protocol
    const proposals = await this.generateProposals(prompt, nCandidates);
    
    // 3. Parse and validate each proposal
    let candidates: BlueprintCandidate[] = [];
    for (const proposal of proposals) {
      try {
        const candidate = this.parseProposal(proposal);
        if (this.validateCandidate(candidate)) {
          candidates.push(candidate);
        }
      } catch (error) {
        logger.warn("Failed to parse proposal:", undefined, error);
      }
    }
    
    // 4. Enforce diversity if enabled
    if (this.config.enforceDiversity) {
      candidates = this.enforceDiversity(candidates, nCandidates);
    }
    
    const duration = Date.now() - startTime;
    
    logger.info(`Generated ${candidates.length} valid candidates in ${duration}ms`);
    
    return candidates;
  }

  /**
   * Build structured generation prompt
   */
  private buildGenerationPrompt(
    userRequest: string,
    context?: SynthesizeRequest["context"],
    nCandidates: number = this.config.nCandidates
  ): string {
    const orgId = context?.organizationId || 0;
    const preferredModels = context?.preferredModels?.join(", ") || "gemini-2.0-flash";
    
    return `
You are the Oddjob Mission Synthesis Engine. Generate mission blueprints based on user requests.

AVAILABLE RESOURCES:
- Agents: ${this.availableAgents.join(", ") || "general-purpose agent"}
- Tools: ${this.availableTools.join(", ") || "standard toolkit"}
- Models: ${preferredModels}

USER REQUEST:
"${userRequest}"

TASK: Generate ${nCandidates} diverse mission blueprints.

REQUIREMENTS for each blueprint:
1. Steps: ${this.config.minSteps}-${this.config.maxSteps} steps
2. Use Hermes protocol for agent reasoning
3. Include data validation steps
4. Handle errors gracefully
5. Target < ${context?.maxLatency || 30000}ms total latency
6. Stay under $${context?.maxCost || 0.5} estimated cost
7. The blueprint 'name' must describe the specific function or task it performs (e.g. 'PR Security Analyzer' or 'Slack Alert Dispatcher' rather than generic role/mission titles).
8. Each synthesized agent in the blueprint ('agents[].name') must be named dynamically based specifically on the core function or task the agent performs (e.g. 'Github PR Reviewer', 'SQL Vulnerability Tester', or 'Slack Alert Sender' rather than generic role titles like 'Engineer' or 'Admin').

DIVERSITY REQUIREMENTS:
Generate blueprints that differ in:
${this.config.diversityDimensions.map(d => `- ${d}`).join("\n")}

OUTPUT FORMAT (Hermes Protocol):

<thinking>
[Your analysis: What does the user need? What approach fits best?
How should this mission be structured? What agents/tools?]
</thinking>

<blueprint>
{
  "name": "descriptive mission name",
  "description": "what this mission accomplishes",
  "steps": [
    {
      "id": "step_1",
      "type": "agent|tool|decision|parallel",
      "name": "Human readable name",
      "description": "What this step does",
      "config": { "agentId": "...", "toolName": "...", "prompt": "..." },
      "dependsOn": ["step_0"]
    }
  ],
  "agents": [
    {
      "id": "agent_1",
      "name": "Agent name",
      "model": "gemini-2.0-flash",
      "temperature": 0.7,
      "maxTokens": 2000,
      "systemPrompt": "...",
      "allowedTools": ["tool1", "tool2"],
      "reasoningProtocol": "hermes_xml",
      "deliberationDepth": 2
    }
  ],
  "tools": [
    { "name": "tool_name", "version": "1.0", "required": true, "timeout": 5000, "retryCount": 2 }
  ],
  "inputSchema": { "type": "object", "properties": {...} },
  "outputSchema": { "type": "object", "properties": {...} },
  "maxDuration": 30,
  "retryPolicy": { "maxAttempts": 3, "backoffStrategy": "exponential", "backoffMs": 1000 }
}
</blueprint>

Generate ${nCandidates} different blueprints. Each should be a complete, valid JSON blueprint.
`.trim();
  }

  /**
   * Generate proposals via LLM
   * 
   * Uses temperature sampling to get diverse outputs
   */
  private async generateProposals(prompt: string, n: number): Promise<string[]> {
    const proposals: string[] = [];
    
    // Generate in batches to manage API limits
    const batchSize = 5;
    
    for (let i = 0; i < n; i += batchSize) {
      const batchPromises = Array(Math.min(batchSize, n - i))
        .fill(null)
        .map((_, idx) => this.generateSingleProposal(prompt, i + idx, n));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          proposals.push(result.value);
        }
      }
    }
    
    return proposals;
  }

  /**
   * Generate a single proposal
   */
  private async generateSingleProposal(
    prompt: string,
    seed: number,
    total: number = this.config.nCandidates
  ): Promise<string | null> {
    try {
      // Vary temperature slightly for diversity
      const temperature = Math.max(0.1, 
        this.config.temperature + (Math.random() - 0.5) * 0.2
      );
      
      const response = await this.client.execute({
        model: this.config.model,
        systemPrompt: HermesProtocolService.buildInstruction(),
        userPrompt: prompt + `\n\n[Generation ${seed + 1}/${total}]`,
        temperature,
        maxTokens: this.config.maxTokensPerCandidate
      });
      
      if (!response.success || !response.output) {
        logger.warn("LLM generation failed:", response.error);
        return null;
      }
      
      return response.output;
    } catch (error) {
      logger.error("Error generating proposal:", error);
      return null;
    }
  }

  /**
   * Parse Hermes-formatted proposal into BlueprintCandidate
   */
  private parseProposal(proposal: string): BlueprintCandidate {
    // Parse Hermes output
    const parsed = HermesProtocolService.parseResponse(proposal);
    
    // Extract blueprint JSON from <blueprint> tags
    const blueprintMatch = proposal.match(/<blueprint>([\s\S]*?)<\/blueprint>/);
    if (!blueprintMatch) {
      throw new Error("No <blueprint> tag found in proposal");
    }
    
    let blueprintJson = blueprintMatch[1].trim();
    
    // Strip markdown code blocks if present
    blueprintJson = blueprintJson.replace(/```json\n?|```/g, "").trim();
    
    let blueprint: MissionBlueprint;
    try {
      blueprint = JSON.parse(blueprintJson);
    } catch (error) {
      logger.error("Failed to parse blueprint JSON:", error);
      throw new Error("Invalid JSON in blueprint");
    }
    
    // Generate unique ID
    const id = uuidv4();
    
    // Extract reasoning from Hermes thinking block
    const reasoning = parsed.thought || "No reasoning provided";
    
    return {
      id,
      request: proposal, // Original request context
      blueprint,
      generation: {
        timestamp: new Date(),
        model: this.config.model,
        temperature: this.config.temperature,
        promptTokens: 0, // Would extract from API response
        completionTokens: proposal.length / 4, // Rough estimate
        generationMethod: "llm_proposal",
        generation: 1,
        parentIds: [],
        mutations: []
      },
      status: "generated",
      createdAt: new Date()
    };
  }

  /**
   * Validate candidate meets structural requirements
   */
  private validateCandidate(candidate: BlueprintCandidate): boolean {
    const bp = candidate.blueprint;
    
    // Check step count
    const stepCount = bp.steps?.length || 0;
    if (stepCount < this.config.minSteps || stepCount > this.config.maxSteps) {
      logger.debug(`Rejecting candidate ${candidate.id}: step count ${stepCount} out of range`);
      return false;
    }
    
    // Check for required tool categories
    const toolNames = bp.tools?.map((t: any) => t.name) || [];
    for (const required of this.config.requiredToolCategories) {
      if (!toolNames.some((t: string) => t.includes(required))) {
        logger.debug(`Rejecting candidate ${candidate.id}: missing required tool ${required}`);
        return false;
      }
    }
    
    // Check all steps have required fields
    for (const step of bp.steps || []) {
      if (!step.id || !step.type) {
        logger.debug(`Rejecting candidate ${candidate.id}: step missing id or type`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Enforce diversity across candidates
   * 
   * Uses clustering to ensure we have diverse approaches
   */
  private enforceDiversity(
    candidates: BlueprintCandidate[],
    nCandidates: number = this.config.nCandidates
  ): BlueprintCandidate[] {
    if (candidates.length <= 5) return candidates;
    
    // Group by agent selection strategy
    const byAgentStrategy = this.groupBy(candidates, c => {
      const agents = c.blueprint.agents?.map((a: any) => a.model).sort().join(",") || "none";
      return agents;
    });
    
    // Group by tool mix
    const byToolMix = this.groupBy(candidates, c => {
      const tools = c.blueprint.tools?.map((t: any) => t.name).sort().join(",") || "none";
      return tools;
    });
    
    // Select top from each diversity dimension
    const selected: BlueprintCandidate[] = [];
    const selectedIds = new Set<string>();
    
    // Take best from each agent strategy
    for (const group of Object.values(byAgentStrategy)) {
      if (group.length > 0 && !selectedIds.has(group[0].id)) {
        selected.push(group[0]);
        selectedIds.add(group[0].id);
      }
    }
    
    // Take best from each tool mix (if not already selected)
    for (const group of Object.values(byToolMix)) {
      const candidate = group.find(c => !selectedIds.has(c.id));
      if (candidate) {
        selected.push(candidate);
        selectedIds.add(candidate.id);
      }
    }
    
    // Fill remaining slots with highest diversity score
    const remaining = candidates.filter(c => !selectedIds.has(c.id));
    
    // Sort by diversity score (simplified: step count variation)
    remaining.sort((a, b) => {
      const aSteps = a.blueprint.steps?.length || 0;
      const bSteps = b.blueprint.steps?.length || 0;
      return bSteps - aSteps; // Prefer complexity variation
    });
    
    const targetCount = Math.min(nCandidates, 10);
    while (selected.length < targetCount && remaining.length > 0) {
      selected.push(remaining.shift()!);
    }
    
    logger.info(`Diversity enforcement: ${candidates.length} → ${selected.length} candidates`);
    
    return selected;
  }

  /**
   * Group array by key function
   */
  private groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    for (const item of array) {
      const key = keyFn(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }

  /**
   * Update available resources for generation
   */
  updateResources(agents: string[], tools: string[]): void {
    this.availableAgents = agents;
    this.availableTools = tools;
    logger.debug("Updated generator resources", { agents: agents.length, tools: tools.length });
  }
}

/**
 * Factory for creating configured generator
 */
export async function createBlueprintGenerator(
  config?: Partial<GeneratorConfig>
): Promise<BlueprintGenerator> {
  // Could load available agents/tools from registry here
  const agents = ["general-agent", "analyst-agent", "coder-agent", "writer-agent"];
  const tools = ["database_query", "api_call", "file_read", "file_write", "llm_generate", "send_email"];
  
  return new BlueprintGenerator(config, agents, tools);
}
