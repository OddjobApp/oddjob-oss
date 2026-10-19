/**
 * Skill Composer
 * 
 * Assembles multiple skills into complex missions.
 * 
 * Key capabilities:
 * - Data flow mapping between skills
 * - Dependency resolution and ordering
 * - Parallel execution detection
 * - Error propagation handling
 * 
 * Example composition:
 * Skill A (data extraction) → Skill B (analysis) → Skill C (reporting)
 */

import { createLogger } from "../../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import type { 
  Skill, 
  SkillComposition,
  ComposedSkill,
  DataFlowEdge,
  ControlFlowEdge,
  MissionBlueprint,
  BlueprintCandidate,
  VerifierScore
} from "../common/types.js";
import type { SkillLibrary } from "./skill-library.js";

const logger = createLogger("SkillComposer");

export interface ComposerConfig {
  maxCompositionDepth: number;      // How many levels deep
  maxSkillsPerComposition: number;   // Total skills allowed
  allowCircular: boolean;            // Allow feedback loops?
  parallelThreshold: number;         // Min latency savings to parallelize
}

const DEFAULT_CONFIG: ComposerConfig = {
  maxCompositionDepth: 3,
  maxSkillsPerComposition: 10,
  allowCircular: false,
  parallelThreshold: 1000           // 1 second savings required
};

/**
 * Composition analysis result
 */
export interface CompositionAnalysis {
  valid: boolean;
  errors: string[];
  warnings: string[];
  estimatedLatency: number;
  estimatedCost: number;
  successProbability: number;
  canParallelize: boolean;
  criticalPath: string[];           // Skill IDs in critical path
}

/**
 * Skill Composer
 * 
 * Builds complex missions from reusable skill components.
 */
export class SkillComposer {
  private config: ComposerConfig;
  private skillLibrary: SkillLibrary;

  constructor(
    skillLibrary: SkillLibrary,
    config: Partial<ComposerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.skillLibrary = skillLibrary;
  }

  /**
   * Compose skills into a mission blueprint
   * 
   * Main entry point for skill-based mission creation.
   */
  async compose(
    goal: string,
    skillIds: string[],
    options: {
      dataMappings?: Array<{ from: string; to: string; transform?: string }>;
      autoConnect?: boolean;  // Auto-infer data flow
    } = {}
  ): Promise<SkillComposition | null> {
    logger.info(`Composing mission from ${skillIds.length} skills`, { goal });
    
    // Fetch skills
    const skills: Skill[] = [];
    for (const id of skillIds) {
      const skill = this.skillLibrary.getSkill(id);
      if (skill) {
        skills.push(skill);
      } else {
        logger.warn(`Skill ${id} not found in library`);
      }
    }
    
    if (skills.length === 0) {
      logger.error("No valid skills found for composition");
      return null;
    }
    
    // Build composition graph
    const composition = await this.buildComposition(skills, goal, options);
    
    // Validate composition
    const analysis = this.analyzeComposition(composition);
    
    if (!analysis.valid) {
      logger.error("Invalid composition:", analysis.errors);
      return null;
    }
    
    if (analysis.warnings.length > 0) {
      logger.warn("Composition warnings:", analysis.warnings);
    }
    
    logger.info(`Composition created: ${composition.subSkills.length} skills, ` +
                `estimated latency: ${analysis.estimatedLatency}ms`);
    
    return composition;
  }

  /**
   * Analyze composition feasibility
   */
  analyzeComposition(composition: SkillComposition): CompositionAnalysis {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check for cycles
    if (!this.config.allowCircular && this.hasCycles(composition)) {
      errors.push("Circular dependency detected in composition");
    }
    
    // Check data flow completeness
    const unmappedInputs = this.findUnmappedInputs(composition);
    if (unmappedInputs.length > 0) {
      warnings.push(`Unmapped inputs: ${unmappedInputs.join(", ")}`);
    }
    
    // Calculate estimated metrics
    let totalLatency = 0;
    let totalCost = 0;
    let successProb = 1;
    
    for (const cs of composition.subSkills) {
      const skill = this.skillLibrary.getSkill(cs.skillId);
      if (skill) {
        totalLatency += skill.productionStats.avgLatency;
        totalCost += skill.productionStats.avgCost;
        const skillSuccessRate = skill.productionStats.successfulRuns / 
                                 (skill.productionStats.totalRuns || 1);
        successProb *= Math.max(0.5, skillSuccessRate);
      }
    }
    
    // Identify parallelization opportunities
    const canParallelize = this.detectParallelization(composition).length > 0;
    
    // Find critical path
    const criticalPath = this.findCriticalPath(composition);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      estimatedLatency: Math.round(totalLatency),
      estimatedCost: Math.round(totalCost * 1000) / 1000,
      successProbability: Math.round(successProb * 1000) / 1000,
      canParallelize,
      criticalPath
    };
  }

  /**
   * Optimize composition for parallel execution
   */
  optimizeParallel(composition: SkillComposition): SkillComposition {
    const parallelGroups = this.detectParallelization(composition);
    
    if (parallelGroups.length === 0) {
      return composition;
    }
    
    logger.info(`Optimizing composition: ${parallelGroups.length} parallel groups found`);
    
    // Update composition with parallel steps
    const optimized: SkillComposition = {
      ...composition,
      controlFlow: composition.controlFlow.map(edge => ({
        ...edge,
        parallelGroup: parallelGroups.findIndex(g => 
          g.includes(edge.from) && g.includes(edge.to)
        )
      }))
    };
    
    return optimized;
  }

  /**
   * Convert composition to executable blueprint
   */
  toBlueprint(composition: SkillComposition): MissionBlueprint {
    const steps: MissionBlueprint["steps"] = [];
    const agents: MissionBlueprint["agents"] = [];
    const tools: MissionBlueprint["tools"] = [];
    
    // Collect all components from sub-skills
    for (const cs of composition.subSkills) {
      const skill = this.skillLibrary.getSkill(cs.skillId);
      if (!skill) continue;
      
      // Add steps with namespace to avoid ID collisions
      for (const step of skill.blueprint.steps || []) {
        steps.push({
          ...step,
          id: `${cs.skillId}_${step.id}`,
          name: `${skill.name}: ${step.name}`
        });
      }
      
      // Add agents
      for (const agent of skill.blueprint.agents || []) {
        if (!agents.find(a => a.id === agent.id)) {
          agents.push(agent);
        }
      }
      
      // Add tools
      for (const tool of skill.blueprint.tools || []) {
        if (!tools.find(t => t.name === tool.name)) {
          tools.push(tool);
        }
      }
    }
    
    // Build data flow connections
    for (const flow of composition.dataFlow) {
      const fromStep = steps.find(s => s.id.includes(flow.from.skillId));
      const toStep = steps.find(s => s.id.includes(flow.to.skillId));
      
      if (fromStep && toStep) {
        toStep.dependsOn = [...(toStep.dependsOn || []), fromStep.id];
      }
    }
    
    const firstSkill = composition.subSkills[0]?.skillId
      ? this.skillLibrary.getSkill(composition.subSkills[0].skillId)
      : undefined;
    const lastSkill = composition.subSkills[composition.subSkills.length - 1]?.skillId
      ? this.skillLibrary.getSkill(composition.subSkills[composition.subSkills.length - 1].skillId)
      : undefined;

    return {
      name: `Composed: ${composition.name}`,
      description: composition.description,
      version: "1.0.0",
      steps,
      agents,
      tools,
      inputSchema: firstSkill?.blueprint.inputSchema || { type: "object" },
      outputSchema: lastSkill?.blueprint.outputSchema || { type: "object" },
      maxDuration: 300,
      retryPolicy: { maxAttempts: 3, backoffStrategy: "exponential", backoffMs: 1000 },
      reasoningConfig: { protocol: "hermes_xml", depth: 2, selfReflect: true, verifyActions: true }
    };
  }

  /**
   * Auto-compose from goal description
   * 
   * Finds and assembles relevant skills automatically.
   */
  async autoCompose(
    goal: string,
    options: {
      maxSkills?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<SkillComposition | null> {
    // Find relevant skills
    const relevantSkills = await this.skillLibrary.findComposableSkills(
      goal,
      { maxSkills: options.maxSkills || 5 }
    );
    
    if (relevantSkills.length === 0) {
      logger.warn(`No relevant skills found for: ${goal}`);
      return null;
    }
    
    logger.info(`Auto-composing from ${relevantSkills.length} skills`);
    
    // Build automatic data flow mappings
    const dataMappings = this.inferDataFlow(relevantSkills);
    
    return this.compose(
      goal,
      relevantSkills.map(s => s.id),
      { dataMappings, autoConnect: true }
    );
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async buildComposition(
    skills: Skill[],
    goal: string,
    options: {
      dataMappings?: Array<{ from: string; to: string; transform?: string }>;
      autoConnect?: boolean;
    }
  ): Promise<SkillComposition> {
    const id = uuidv4();
    
    // Create composed skill entries
    const subSkills: ComposedSkill[] = skills.map((skill, i) => ({
      skillId: skill.id,
      role: this.inferRole(skill, i, skills.length),
      inputMapping: skill.blueprint.inputSchema.properties || {},
      outputMapping: skill.blueprint.outputSchema.properties || {}
    }));
    
    // Build data flow edges
    const dataFlow: DataFlowEdge[] = [];
    
    if (options.dataMappings) {
      for (const mapping of options.dataMappings) {
        const fromSkill = subSkills.find(s => s.skillId === mapping.from);
        const toSkill = subSkills.find(s => s.skillId === mapping.to);
        
        if (fromSkill && toSkill) {
          dataFlow.push({
            from: { skillId: mapping.from, output: "output" },
            to: { skillId: mapping.to, input: "input" },
            transform: mapping.transform
          });
        }
      }
    }
    
    // Auto-connect if requested
    if (options.autoConnect && dataFlow.length === 0) {
      for (let i = 0; i < subSkills.length - 1; i++) {
        dataFlow.push({
          from: { skillId: subSkills[i].skillId, output: "output" },
          to: { skillId: subSkills[i + 1].skillId, input: "input" }
        });
      }
    }
    
    // Build control flow (execution order)
    const controlFlow: ControlFlowEdge[] = [];
    for (let i = 0; i < subSkills.length - 1; i++) {
      controlFlow.push({
        from: subSkills[i].skillId,
        to: subSkills[i + 1].skillId
      });
    }
    
    return {
      id,
      name: `Composition for: ${goal.substring(0, 50)}`,
      description: `Automatically composed from ${skills.length} skills`,
      rootSkillId: subSkills[0].skillId,
      subSkills,
      dataFlow,
      controlFlow,
      composedVerifierScore: {
        successProbability: 0.7,
        confidence: 0.5,
        latencyEstimate: 10000,
        costEstimate: 0.1,
        riskFactors: []
      }
    };
  }

  private inferRole(skill: Skill, position: number, total: number): string {
    if (position === 0) return "input_processor";
    if (position === total - 1) return "output_generator";
    return "transformer";
  }

  private inferDataFlow(skills: Skill[]): Array<{ from: string; to: string }> {
    const mappings: Array<{ from: string; to: string }> = [];
    
    for (let i = 0; i < skills.length - 1; i++) {
      // Check output/input compatibility
      const currentOutput = skills[i].blueprint.outputSchema;
      const nextInput = skills[i + 1].blueprint.inputSchema;
      
      if (this.areSchemasCompatible(currentOutput, nextInput)) {
        mappings.push({ from: skills[i].id, to: skills[i + 1].id });
      }
    }
    
    return mappings;
  }

  private areSchemasCompatible(output: any, input: any): boolean {
    // Simplified compatibility check
    if (output.type !== input.type) return false;
    
    if (output.type === "object" && input.type === "object") {
      const outputProps = Object.keys(output.properties || {});
      const inputProps = Object.keys(input.properties || {});
      
      // Check if input properties are subset of output properties
      return inputProps.every(p => outputProps.includes(p));
    }
    
    return true;
  }

  private hasCycles(composition: SkillComposition): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (skillId: string): boolean => {
      visited.add(skillId);
      recursionStack.add(skillId);
      
      const edges = composition.controlFlow.filter(e => e.from === skillId);
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          if (dfs(edge.to)) return true;
        } else if (recursionStack.has(edge.to)) {
          return true;
        }
      }
      
      recursionStack.delete(skillId);
      return false;
    };
    
    for (const skill of composition.subSkills) {
      if (!visited.has(skill.skillId)) {
        if (dfs(skill.skillId)) return true;
      }
    }
    
    return false;
  }

  private findUnmappedInputs(composition: SkillComposition): string[] {
    const mapped = new Set<string>();
    
    for (const flow of composition.dataFlow) {
      mapped.add(`${flow.to.skillId}.${flow.to.input}`);
    }
    
    const unmapped: string[] = [];
    for (const skill of composition.subSkills) {
      const required = Object.keys(skill.inputMapping);
      for (const input of required) {
        const key = `${skill.skillId}.${input}`;
        if (!mapped.has(key)) {
          unmapped.push(key);
        }
      }
    }
    
    return unmapped;
  }

  private detectParallelization(composition: SkillComposition): string[][] {
    // Find independent skills that can run in parallel
    const independent: string[][] = [];
    const dependencyGraph = this.buildDependencyGraph(composition);
    
    // Find skills with no dependencies between them
    for (let i = 0; i < composition.subSkills.length; i++) {
      for (let j = i + 1; j < composition.subSkills.length; j++) {
        const skillA = composition.subSkills[i].skillId;
        const skillB = composition.subSkills[j].skillId;
        
        // Check if A and B are independent
        if (!this.hasPath(dependencyGraph, skillA, skillB) &&
            !this.hasPath(dependencyGraph, skillB, skillA)) {
          // Check latency savings
          const skillAData = this.skillLibrary.getSkill(skillA);
          const skillBData = this.skillLibrary.getSkill(skillB);
          
          if (skillAData && skillBData) {
            const minLatency = Math.min(
              skillAData.productionStats.avgLatency,
              skillBData.productionStats.avgLatency
            );
            
            if (minLatency > this.config.parallelThreshold) {
              independent.push([skillA, skillB]);
            }
          }
        }
      }
    }
    
    return independent;
  }

  private buildDependencyGraph(composition: SkillComposition): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    for (const cs of composition.subSkills) {
      graph.set(cs.skillId, new Set());
    }
    
    for (const edge of composition.controlFlow) {
      graph.get(edge.from)?.add(edge.to);
    }
    
    return graph;
  }

  private hasPath(graph: Map<string, Set<string>>, from: string, to: string): boolean {
    const visited = new Set<string>();
    const queue = [from];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      
      if (!visited.has(current)) {
        visited.add(current);
        const neighbors = graph.get(current) || new Set();
        queue.push(...neighbors);
      }
    }
    
    return false;
  }

  private findCriticalPath(composition: SkillComposition): string[] {
    // Find longest path through composition
    const path: string[] = [];
    const graph = this.buildDependencyGraph(composition);
    
    // Topological sort to find order
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    const visit = (skillId: string): void => {
      if (temp.has(skillId)) return; // Cycle detected
      if (visited.has(skillId)) return;
      
      temp.add(skillId);
      
      const neighbors = graph.get(skillId) || new Set();
      for (const neighbor of neighbors) {
        visit(neighbor);
      }
      
      temp.delete(skillId);
      visited.add(skillId);
      path.unshift(skillId);
    };
    
    for (const cs of composition.subSkills) {
      if (!visited.has(cs.skillId)) {
        visit(cs.skillId);
      }
    }
    
    return path;
  }
}

/**
 * Factory function
 */
export function createSkillComposer(
  skillLibrary: SkillLibrary,
  config?: Partial<ComposerConfig>
): SkillComposer {
  return new SkillComposer(skillLibrary, config);
}
