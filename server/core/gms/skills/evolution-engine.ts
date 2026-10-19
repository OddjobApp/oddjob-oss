/**
 * Evolution Engine
 * 
 * Genetic algorithm for improving mission skills over time.
 * 
 * Based on:
 * - Tournament selection: High performers reproduce
 * - Crossover: Combine successful strategies
 * - Mutation: Random perturbations to explore space
 * - Fitness: Production success rate, efficiency, user satisfaction
 * 
 * When a skill degrades or performance plateaus, the evolution
 * engine generates new variants and validates them via shadow runs.
 */

import { createLogger } from "../../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import type {
  Skill,
  BlueprintCandidate,
  MissionBlueprint,
  MissionStepConfig,
  MutationRecord
} from "../common/types.js";
import type { ShadowOrchestrator } from "../shadow/shadow-orchestrator.js";

const logger = createLogger("EvolutionEngine");

export interface EvolutionConfig {
  // Population settings
  populationSize: number;        // Number of variants per generation
  maxGenerations: number;        // Stop after N generations
  
  // Selection
  tournamentSize: number;        // Compare K candidates, pick best
  elitism: number;               // Keep top N% unchanged
  
  // Crossover
  crossoverRate: number;         // Probability of crossover
  
  // Mutation
  mutationRate: number;          // Probability of mutation per gene
  mutationStrength: number;        // How much to perturb (0-1)
  
  // Fitness
  fitnessWeights: {
    successRate: number;
    efficiency: number;         // Latency/cost tradeoff
    novelty: number;              // Diversity bonus
  };
  
  // Termination
  convergenceThreshold: number;  // Stop if improvement < threshold
  patience: number;              // Generations to wait for improvement
}

const DEFAULT_CONFIG: EvolutionConfig = {
  populationSize: 10,
  maxGenerations: 5,
  tournamentSize: 3,
  elitism: 0.2,                  // Keep top 20%
  crossoverRate: 0.7,
  mutationRate: 0.1,
  mutationStrength: 0.3,
  fitnessWeights: {
    successRate: 0.5,
    efficiency: 0.3,
    novelty: 0.2
  },
  convergenceThreshold: 0.05,
  patience: 3
};

/**
 * Genome representation of a skill
 */
interface SkillGenome {
  // Structure genes
  stepTopology: string[];        // Step dependency graph
  stepTypes: string[];           // Agent/tool/decision mix
  
  // Agent genes
  agentModels: string[];
  agentTemperatures: number[];
  reasoningDepths: number[];
  
  // Tool genes
  toolInventory: string[];
  toolTimeouts: number[];
  
  // Meta genes
  systemPromptHash: string;
  retryPolicy: { maxAttempts: number; backoff: string };
}

/**
 * Evolved candidate with fitness score
 */
interface EvolvedCandidate {
  id: string;
  genome: SkillGenome;
  blueprint: MissionBlueprint;
  parentIds: string[];
  generation: number;
  mutations: MutationRecord[];
  
  // Fitness
  predictedFitness: number;
  shadowFitness?: number;
  
  // Validation status
  status: "generated" | "shadowing" | "validated" | "failed";
}

/**
 * Evolution Engine
 * 
 * Genetic algorithm for skill improvement.
 */
export class EvolutionEngine {
  private config: EvolutionConfig;
  private shadowOrchestrator: ShadowOrchestrator;
  
  // Track evolution runs
  private activeEvolutions: Map<string, {
    parent: Skill;
    generation: number;
    population: EvolvedCandidate[];
    bestFitness: number;
    stagnantGenerations: number;
  }> = new Map();

  constructor(
    shadowOrchestrator: ShadowOrchestrator,
    config: Partial<EvolutionConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.shadowOrchestrator = shadowOrchestrator;
  }

  /**
   * Evolve a skill to improve performance
   * 
   * Main entry point for skill evolution.
   */
  async evolveSkill(
    parent: Skill,
    options: {
      fitnessTarget?: number;
      maxGenerations?: number;
    } = {}
  ): Promise<{
    success: boolean;
    bestVariant: BlueprintCandidate | null;
    generations: number;
    improvement: number;
  }> {
    const evolutionId = uuidv4();
    const maxGenerations = options.maxGenerations || this.config.maxGenerations;
    
    logger.info(`Starting evolution for skill ${parent.id}`, {
      evolutionId,
      targetGenerations: maxGenerations
    });
    
    // Initialize population
    const population = this.initializePopulation(parent);
    
    this.activeEvolutions.set(evolutionId, {
      parent,
      generation: 0,
      population,
      bestFitness: this.calculateFitness(parent),
      stagnantGenerations: 0
    });
    
    let bestVariant: EvolvedCandidate | null = null;
    
    // Evolution loop
    for (let gen = 0; gen < maxGenerations; gen++) {
      logger.debug(`Evolution ${evolutionId}, Generation ${gen + 1}/${maxGenerations}`);
      
      const state = this.activeEvolutions.get(evolutionId)!;
      state.generation = gen;
      
      // Evaluate population (predicted fitness)
      for (const candidate of state.population) {
        if (candidate.status === "generated") {
          candidate.predictedFitness = this.predictFitness(candidate, parent);
        }
      }
      
      // Select survivors
      const survivors = this.selectSurvivors(state.population);
      
      // Generate offspring
      const offspring = this.generateOffspring(survivors, gen + 1);
      
      // Form new population
      state.population = [...survivors, ...offspring];
      
      // Check for improvement
      const currentBest = this.findBest(state.population);
      const improvement = currentBest.predictedFitness - state.bestFitness;
      
      if (improvement > this.config.convergenceThreshold) {
        state.bestFitness = currentBest.predictedFitness;
        state.stagnantGenerations = 0;
        bestVariant = currentBest;
        
        logger.info(`Generation ${gen + 1}: New best fitness ${state.bestFitness.toFixed(3)}`);
      } else {
        state.stagnantGenerations++;
        
        if (state.stagnantGenerations >= this.config.patience) {
          logger.info(`Evolution converged after ${gen + 1} generations`);
          break;
        }
      }
    }
    
    // Validate best variant with shadow runs
    let finalVariant: BlueprintCandidate | null = null;
    let actualImprovement = 0;
    
    if (bestVariant) {
      const validated = await this.validateVariant(bestVariant, parent);
      
      if (validated.success) {
        finalVariant = validated.candidate;
        actualImprovement = validated.improvement;
      }
    }
    
    // Save generation count before cleanup
    const finalGenerations = this.activeEvolutions.get(evolutionId)?.generation ?? maxGenerations;

    // Cleanup
    this.activeEvolutions.delete(evolutionId);

    return {
      success: !!finalVariant,
      bestVariant: finalVariant,
      generations: finalGenerations,
      improvement: actualImprovement
    };
  }

  /**
   * Batch evolve multiple skills
   */
  async evolveBatch(
    skills: Skill[],
    options?: { fitnessTarget?: number; maxGenerations?: number }
  ): Promise<Array<{
    skillId: string;
    result: Awaited<ReturnType<EvolutionEngine["evolveSkill"]>>;
  }>> {
    const results: Array<{
      skillId: string;
      result: Awaited<ReturnType<EvolutionEngine["evolveSkill"]>>;
    }> = [];
    
    for (const skill of skills) {
      try {
        const result = await this.evolveSkill(skill, options);
        results.push({ skillId: skill.id, result });
      } catch (error) {
        logger.error(`Evolution failed for ${skill.id}:`, error);
        results.push({
          skillId: skill.id,
          result: { success: false, bestVariant: null, generations: 0, improvement: 0 }
        });
      }
    }
    
    return results;
  }

  /**
   * Get active evolution status
   */
  getEvolutionStatus(evolutionId: string): {
    generation: number;
    bestFitness: number;
    populationSize: number;
  } | null {
    const state = this.activeEvolutions.get(evolutionId);
    if (!state) return null;
    
    return {
      generation: state.generation,
      bestFitness: state.bestFitness,
      populationSize: state.population.length
    };
  }

  /**
   * Abort active evolution
   */
  abortEvolution(evolutionId: string): boolean {
    const state = this.activeEvolutions.get(evolutionId);
    if (!state) return false;
    
    this.activeEvolutions.delete(evolutionId);
    logger.info(`Evolution ${evolutionId} aborted`);
    return true;
  }

  // ============================================================================
  // Private evolution methods
  // ============================================================================

  private initializePopulation(parent: Skill): EvolvedCandidate[] {
    const population: EvolvedCandidate[] = [];
    const parentGenome = this.extractGenome(parent);
    
    // Start with parent (elitism)
    population.push({
      id: uuidv4(),
      genome: parentGenome,
      blueprint: parent.blueprint,
      parentIds: [parent.id],
      generation: 0,
      mutations: [],
      predictedFitness: this.calculateFitness(parent),
      status: "generated"
    });
    
    // Generate variants through mutation
    for (let i = 1; i < this.config.populationSize; i++) {
      const { genome, mutations } = this.mutateGenome(parentGenome, 0.5);
      
      population.push({
        id: uuidv4(),
        genome,
        blueprint: this.genomeToBlueprint(genome, parent.blueprint),
        parentIds: [parent.id],
        generation: 0,
        mutations,
        predictedFitness: 0,
        status: "generated"
      });
    }
    
    return population;
  }

  private selectSurvivors(population: EvolvedCandidate[]): EvolvedCandidate[] {
    // Tournament selection
    const survivors: EvolvedCandidate[] = [];
    const nElite = Math.floor(this.config.populationSize * this.config.elitism);
    
    // Elitism: Keep best performers
    const sorted = [...population].sort((a, b) => 
      b.predictedFitness - a.predictedFitness
    );
    survivors.push(...sorted.slice(0, nElite));
    
    // Tournament selection for rest
    const targetSurvivors = Math.max(1, Math.floor(this.config.populationSize / 2));
    while (survivors.length < targetSurvivors && survivors.length < population.length) {
      const tournament = this.sample(population, this.config.tournamentSize);
      const winner = tournament.reduce((best, c) => 
        c.predictedFitness > best.predictedFitness ? c : best
      );
      
      if (!survivors.find(s => s.id === winner.id)) {
        survivors.push(winner);
      }
    }
    
    return survivors;
  }

  private generateOffspring(
    parents: EvolvedCandidate[],
    generation: number
  ): EvolvedCandidate[] {
    const offspring: EvolvedCandidate[] = [];
    const targetSize = this.config.populationSize - parents.length;
    
    while (offspring.length < targetSize) {
      // Select two parents
      const parent1 = this.sample(parents, 1)[0];
      const parent2 = this.sample(parents, 1)[0];
      
      if (Math.random() < this.config.crossoverRate) {
        // Crossover
        const { genome, mutations } = this.crossover(parent1, parent2);
        
        // Apply additional mutation
        const { genome: mutatedGenome, mutations: additionalMutations } = 
          this.mutateGenome(genome, this.config.mutationRate);
        
        offspring.push({
          id: uuidv4(),
          genome: mutatedGenome,
          blueprint: this.genomeToBlueprint(mutatedGenome, parent1.blueprint),
          parentIds: [parent1.id, parent2.id],
          generation,
          mutations: [...mutations, ...additionalMutations],
          predictedFitness: 0,
          status: "generated"
        });
      } else {
        // Clone with mutation
        const { genome, mutations } = this.mutateGenome(
          parent1.genome, 
          this.config.mutationRate
        );
        
        offspring.push({
          id: uuidv4(),
          genome,
          blueprint: this.genomeToBlueprint(genome, parent1.blueprint),
          parentIds: [parent1.id],
          generation,
          mutations,
          predictedFitness: 0,
          status: "generated"
        });
      }
    }
    
    return offspring;
  }

  private crossover(
    parent1: EvolvedCandidate,
    parent2: EvolvedCandidate
  ): { genome: SkillGenome; mutations: MutationRecord[] } {
    const mutations: MutationRecord[] = [];
    
    // Uniform crossover - randomly pick genes from each parent
    const genome: SkillGenome = {
      stepTopology: Math.random() < 0.5 
        ? parent1.genome.stepTopology 
        : parent2.genome.stepTopology,
      stepTypes: Math.random() < 0.5
        ? parent1.genome.stepTypes
        : parent2.genome.stepTypes,
      agentModels: Math.random() < 0.5
        ? parent1.genome.agentModels
        : parent2.genome.agentModels,
      agentTemperatures: this.averageArrays(
        parent1.genome.agentTemperatures,
        parent2.genome.agentTemperatures
      ),
      reasoningDepths: Math.random() < 0.5
        ? parent1.genome.reasoningDepths
        : parent2.genome.reasoningDepths,
      toolInventory: [...new Set([
        ...parent1.genome.toolInventory,
        ...parent2.genome.toolInventory
      ])],
      toolTimeouts: this.averageArrays(
        parent1.genome.toolTimeouts,
        parent2.genome.toolTimeouts
      ),
      systemPromptHash: Math.random() < 0.5
        ? parent1.genome.systemPromptHash
        : parent2.genome.systemPromptHash,
      retryPolicy: Math.random() < 0.5
        ? parent1.genome.retryPolicy
        : parent2.genome.retryPolicy
    };
    
    mutations.push({
      type: "structure",
      description: `Crossover between ${parent1.id} and ${parent2.id}`,
      impact: "neutral"
    });
    
    return { genome, mutations };
  }

  private mutateGenome(
    genome: SkillGenome,
    rate: number
  ): { genome: SkillGenome; mutations: MutationRecord[] } {
    const mutations: MutationRecord[] = [];
    const mutated = { ...genome };
    
    // Mutate temperatures
    if (Math.random() < rate) {
      mutated.agentTemperatures = genome.agentTemperatures.map(t => {
        const delta = (Math.random() - 0.5) * this.config.mutationStrength;
        return Math.max(0, Math.min(1, t + delta));
      });
      
      mutations.push({
        type: "temperature",
        description: "Adjusted agent temperature",
        impact: Math.random() > 0.5 ? "positive" : "negative"
      });
    }
    
    // Mutate reasoning depth
    if (Math.random() < rate) {
      mutated.reasoningDepths = genome.reasoningDepths.map(d => {
        const delta = Math.floor((Math.random() - 0.5) * 2);
        return Math.max(1, d + delta);
      });
      
      mutations.push({
        type: "prompt",
        description: "Adjusted reasoning depth",
        impact: "neutral"
      });
    }
    
    // Mutate timeouts
    if (Math.random() < rate) {
      mutated.toolTimeouts = genome.toolTimeouts.map(t => {
        const factor = 1 + (Math.random() - 0.5) * this.config.mutationStrength;
        return Math.round(t * factor);
      });
      
      mutations.push({
        type: "tool",
        description: "Adjusted tool timeouts",
        impact: "neutral"
      });
    }
    
    return { genome: mutated, mutations };
  }

  private extractGenome(skill: Skill): SkillGenome {
    const bp = skill.blueprint;
    
    return {
      stepTopology: bp.steps?.map(s => s.id) || [],
      stepTypes: bp.steps?.map(s => s.type) || [],
      agentModels: bp.agents?.map(a => a.model) || [],
      agentTemperatures: bp.agents?.map(a => a.temperature) || [],
      reasoningDepths: bp.agents?.map(a => a.deliberationDepth) || [],
      toolInventory: bp.tools?.map(t => t.name) || [],
      toolTimeouts: bp.tools?.map(t => t.timeout) || [],
      systemPromptHash: this.hashString(
        bp.agents?.map(a => a.systemPrompt).join("") || ""
      ),
      retryPolicy: {
        maxAttempts: bp.retryPolicy?.maxAttempts || 3,
        backoff: bp.retryPolicy?.backoffStrategy || "exponential"
      }
    };
  }

  private genomeToBlueprint(
    genome: SkillGenome,
    template: MissionBlueprint
  ): MissionBlueprint {
    // Reconstruct blueprint from genome
    const blueprint: MissionBlueprint = {
      ...template,
      steps: genome.stepTopology.map((id, i) => ({
        ...template.steps?.[i],
        id,
        type: (genome.stepTypes[i] || "agent") as MissionStepConfig["type"]
      })),
      agents: genome.agentModels.map((model, i) => ({
        ...template.agents?.[i],
        model,
        temperature: genome.agentTemperatures[i] || 0.7,
        deliberationDepth: genome.reasoningDepths[i] || 2
      })),
      tools: genome.toolInventory.map((name, i) => ({
        name,
        version: "1.0",
        required: true,
        timeout: genome.toolTimeouts[i] || 5000,
        retryCount: genome.retryPolicy.maxAttempts
      }))
    };
    
    return blueprint;
  }

  private predictFitness(candidate: EvolvedCandidate, parent: Skill): number {
    // Predict fitness based on genome similarity to high-performing parent
    const parentGenome = this.extractGenome(parent);
    const similarity = this.genomeSimilarity(candidate.genome, parentGenome);
    
    // Base fitness on parent performance
    const parentFitness = this.calculateFitness(parent);
    
    // Adjust by mutation novelty (exploration bonus)
    const noveltyBonus = candidate.mutations.length * this.config.fitnessWeights.novelty * 0.1;
    
    return parentFitness * similarity + noveltyBonus;
  }

  private calculateFitness(skill: Skill): number {
    const stats = skill.productionStats;
    
    // Success rate component
    const successRate = stats.totalRuns > 0
      ? stats.successfulRuns / stats.totalRuns
      : skill.shadowResult.successRate;
    
    // Efficiency component (lower latency/cost = better)
    const efficiency = 1 / (1 + stats.avgLatency / 1000 + stats.avgCost * 10);
    
    return (
      this.config.fitnessWeights.successRate * successRate +
      this.config.fitnessWeights.efficiency * efficiency
    );
  }

  private async validateVariant(
    candidate: EvolvedCandidate,
    parent: Skill
  ): Promise<{ success: boolean; candidate: BlueprintCandidate | null; improvement: number }> {
    // Convert to blueprint candidate
    const blueprintCandidate: BlueprintCandidate = {
      id: candidate.id,
      request: `Evolved from ${parent.id}`,
      blueprint: candidate.blueprint,
      generation: {
        timestamp: new Date(),
        model: "evolution",
        temperature: 0,
        promptTokens: 0,
        completionTokens: 0,
        generationMethod: "evolution",
        generation: candidate.generation,
        parentIds: candidate.parentIds,
        mutations: candidate.mutations
      },
      status: "generated",
      createdAt: new Date()
    };
    
    // Quick shadow validation
    const validation = await this.shadowOrchestrator.quickValidate(blueprintCandidate);
    
    if (validation.recommendation === "proceed") {
      return {
        success: true,
        candidate: blueprintCandidate,
        improvement: validation.shadowResult.successRate - parent.shadowResult.successRate
      };
    }
    
    return { success: false, candidate: null, improvement: 0 };
  }

  private findBest(population: EvolvedCandidate[]): EvolvedCandidate {
    return population.reduce((best, c) => 
      c.predictedFitness > best.predictedFitness ? c : best
    );
  }

  private genomeSimilarity(g1: SkillGenome, g2: SkillGenome): number {
    // Simplified similarity - compare gene overlap
    const compareArrays = <T>(a: T[], b: T[]): number => {
      const setA = new Set(a);
      const setB = new Set(b);
      const denom = Math.max(setA.size, setB.size);
      // Two empty gene sets are identical; guard against 0/0 = NaN, which would
      // otherwise poison predictFitness and silently break selection (findBest).
      if (denom === 0) return 1;
      const intersection = [...setA].filter(x => setB.has(x)).length;
      return intersection / denom;
    };
    
    const similarities = [
      compareArrays(g1.stepTopology, g2.stepTopology),
      compareArrays(g1.agentModels, g2.agentModels),
      compareArrays(g1.toolInventory, g2.toolInventory)
    ];
    
    return similarities.reduce((a, b) => a + b, 0) / similarities.length;
  }

  private averageArrays(a: number[], b: number[]): number[] {
    const maxLen = Math.max(a.length, b.length);
    const result: number[] = [];
    
    for (let i = 0; i < maxLen; i++) {
      const valA = a[i] || 0;
      const valB = b[i] || 0;
      result.push((valA + valB) / 2);
    }
    
    return result;
  }

  private sample<T>(array: T[], n: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

/**
 * Factory function
 */
export function createEvolutionEngine(
  shadowOrchestrator: ShadowOrchestrator,
  config?: Partial<EvolutionConfig>
): EvolutionEngine {
  return new EvolutionEngine(shadowOrchestrator, config);
}
