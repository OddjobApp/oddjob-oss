/**
 * Skill Library
 * 
 * Registry of validated, reusable mission skills.
 * 
 * Key responsibilities:
 * - Store skills with full lineage tracking
 * - Semantic search over skill capabilities
 * - Track usage statistics and performance
 * - Detect skill degradation over time
 * - Trigger evolution when performance drops
 * 
 * A "skill" is a validated blueprint with proven track record
 * that can be composed into larger missions.
 */

import { createLogger } from "../../../utils/logger.js";
import type { 
  Skill, 
  SkillComposition,
  BlueprintCandidate,
  MissionBlueprint,
  ShadowResult
} from "../common/types.js";

const logger = createLogger("SkillLibrary");

export interface LibraryConfig {
  maxSkills: number;              // Total skills to retain
  minSuccessRate: number;         // Threshold for retention
  retentionWindowDays: number;      // How long to keep unused skills
  
  // Search settings
  embeddingDimensions: number;
  similarityThreshold: number;
  
  // Evolution triggers
  evolutionThreshold: number;       // Performance drop before evolving
  maxGenerations: number;         // Prevent infinite evolution
}

const DEFAULT_CONFIG: LibraryConfig = {
  maxSkills: 500,
  minSuccessRate: 0.75,
  retentionWindowDays: 90,
  embeddingDimensions: 768,
  similarityThreshold: 0.75,
  evolutionThreshold: 0.15,       // 15% performance drop triggers evolution
  maxGenerations: 10
};

/**
 * Skill search result with relevance score
 */
export interface SkillSearchResult {
  skill: Skill;
  similarity: number;
  matchReasons: string[];
}

/**
 * Skill Library
 * 
 * Central registry for evolved mission skills.
 */
export class SkillLibrary {
  private config: LibraryConfig;
  private skills: Map<string, Skill> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private compositionCache: Map<string, SkillComposition> = new Map();
  
  // Track skill usage for LRU eviction
  private usageHistory: Array<{ skillId: string; timestamp: Date }> = [];

  constructor(config: Partial<LibraryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info("Skill Library initialized", { maxSkills: this.config.maxSkills });
  }

  /**
   * Register a new skill from validated blueprint
   * 
   * Called after shadow validation confirms blueprint quality.
   */
  registerSkill(
    candidate: BlueprintCandidate,
    shadowResult: ShadowResult,
    options: {
      tags?: string[];
      autoTag?: boolean;
    } = {}
  ): Skill {
    const id = `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Auto-generate tags if requested
    const tags = options.autoTag 
      ? this.autoTagSkill(candidate.blueprint)
      : (options.tags || []);
    
    const skill: Skill = {
      id,
      name: candidate.blueprint.name,
      description: candidate.blueprint.description,
      
      blueprint: candidate.blueprint,
      
      verifierScore: candidate.verifierScore!,
      shadowResult,
      productionStats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        avgLatency: shadowResult.avgLatency,
        // Guard against an empty runs array (0/0 = NaN, or x/0 = Infinity), which
        // would otherwise poison the avgCost moving average on every future run.
        avgCost: shadowResult.runs.length > 0
          ? shadowResult.totalCost / shadowResult.runs.length
          : 0,
        successRateTrend: "stable"
      },
      
      generation: candidate.generation.generation || 1,
      parentIds: candidate.generation.parentIds || [],
      childrenIds: [],
      mutations: candidate.generation.mutations || [],
      evolutionLineage: candidate.generation.parentIds 
        ? [...candidate.generation.parentIds, id]
        : [id],
      
      tags,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      usageCount: 0
    };
    
    // Check if we need to evict old skills
    if (this.skills.size >= this.config.maxSkills) {
      this.evictLRUSkill();
    }
    
    this.skills.set(id, skill);
    
    // Generate and store embedding for search
    this.embeddings.set(id, this.generateSkillEmbedding(skill));
    
    // Update parent skills to reference this child
    for (const parentId of skill.parentIds) {
      const parent = this.skills.get(parentId);
      if (parent) {
        parent.childrenIds.push(id);
      }
    }
    
    logger.info(`Skill registered: ${id} (${skill.name})`, {
      successRate: shadowResult.successRate,
      tags: tags.length
    });
    
    return skill;
  }

  /**
   * Find skills matching a natural language query
   * 
   * Uses semantic similarity search over skill embeddings.
   */
  async findSkills(
    query: string,
    options: {
      limit?: number;
      requiredTags?: string[];
      minSuccessRate?: number;
    } = {}
  ): Promise<SkillSearchResult[]> {
    const limit = options.limit || 5;
    const queryEmbedding = this.embedText(query);
    
    const results: SkillSearchResult[] = [];
    
    for (const [id, skill] of this.skills) {
      // Filter by requirements
      if (options.requiredTags) {
        const hasAllTags = options.requiredTags.every(t => skill.tags.includes(t));
        if (!hasAllTags) continue;
      }
      
      if (options.minSuccessRate !== undefined) {
        const successRate = skill.productionStats.successfulRuns / 
                           (skill.productionStats.totalRuns || 1);
        if (successRate < options.minSuccessRate) continue;
      }
      
      // Calculate similarity
      const skillEmbedding = this.embeddings.get(id);
      if (!skillEmbedding) continue;
      
      const similarity = this.cosineSimilarity(queryEmbedding, skillEmbedding);
      
      if (similarity >= this.config.similarityThreshold) {
        results.push({
          skill,
          similarity,
          matchReasons: this.explainMatch(query, skill)
        });
      }
    }
    
    // Sort by similarity and return top-K
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Find composable skills for a complex mission
   * 
   * Returns skills that can be stitched together to achieve a goal.
   */
  async findComposableSkills(
    goal: string,
    options: {
      maxSkills?: number;
      maxDepth?: number;
    } = {}
  ): Promise<Skill[]> {
    // First, find directly relevant skills
    const directMatches = await this.findSkills(goal, { limit: 3 });
    
    if (directMatches.length > 0 && directMatches[0].similarity > 0.9) {
      // High confidence direct match
      return [directMatches[0].skill];
    }
    
    // Otherwise, find complementary skills
    const keywords = this.extractKeywords(goal);
    const related: Skill[] = [];
    
    for (const keyword of keywords) {
      const matches = await this.findSkills(keyword, { limit: 2 });
      for (const match of matches) {
        if (!related.find(s => s.id === match.skill.id)) {
          related.push(match.skill);
        }
      }
    }
    
    return related.slice(0, options.maxSkills || 5);
  }

  /**
   * Get skill by ID
   */
  getSkill(id: string): Skill | undefined {
    const skill = this.skills.get(id);
    if (skill) {
      this.recordUsage(id);
    }
    return skill;
  }

  /**
   * Update skill statistics after production use
   */
  recordProductionRun(
    skillId: string,
    outcome: {
      success: boolean;
      latency: number;
      cost: number;
      timestamp?: Date;
    }
  ): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    
    skill.productionStats.totalRuns++;
    if (outcome.success) {
      skill.productionStats.successfulRuns++;
    } else {
      skill.productionStats.failedRuns++;
    }
    
    // Update moving averages
    const n = skill.productionStats.totalRuns;
    skill.productionStats.avgLatency = 
      (skill.productionStats.avgLatency * (n - 1) + outcome.latency) / n;
    skill.productionStats.avgCost = 
      (skill.productionStats.avgCost * (n - 1) + outcome.cost) / n;
    
    skill.lastUsedAt = outcome.timestamp || new Date();
    skill.usageCount++;
    
    this.recordUsage(skillId);
    
    // Check for degradation
    this.checkSkillHealth(skillId);
  }

  /**
   * Check if skill needs evolution
   */
  checkSkillHealth(skillId: string): {
    status: "healthy" | "degraded" | "needs_evolution" | "deprecate";
    reason?: string;
  } {
    const skill = this.skills.get(skillId);
    if (!skill) return { status: "deprecate", reason: "Skill not found" };
    
    // Assess degradation only once we have production evidence. A freshly
    // registered skill with no runs has no measured success rate, so comparing
    // against 0 would wrongly flag it as fully degraded / needs_evolution.
    if (skill.productionStats.totalRuns > 0) {
      const currentSuccessRate = skill.productionStats.successfulRuns /
                                 skill.productionStats.totalRuns;
      const expectedSuccessRate = skill.shadowResult.successRate;

      const degradation = expectedSuccessRate - currentSuccessRate;

      if (degradation > this.config.evolutionThreshold) {
        return {
          status: "needs_evolution",
          reason: `Performance degraded by ${(degradation * 100).toFixed(1)}% ` +
                  `(expected ${(expectedSuccessRate * 100).toFixed(1)}%, ` +
                  `actual ${(currentSuccessRate * 100).toFixed(1)}%)`
        };
      }

      if (degradation > this.config.evolutionThreshold / 2) {
        return {
          status: "degraded",
          reason: `Performance declining (${(degradation * 100).toFixed(1)}% drop)`
        };
      }
    }

    // Check staleness
    const daysSinceUse = (Date.now() - skill.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUse > this.config.retentionWindowDays) {
      return { status: "deprecate", reason: "Skill unused for 90+ days" };
    }
    
    return { status: "healthy" };
  }

  /**
   * Get evolution candidates (skills that need improvement)
   */
  getEvolutionCandidates(): Skill[] {
    const candidates: Skill[] = [];
    
    for (const skill of this.skills.values()) {
      const health = this.checkSkillHealth(skill.id);
      if (health.status === "needs_evolution" || health.status === "degraded") {
        candidates.push(skill);
      }
    }
    
    return candidates.sort((a, b) => {
      // Prioritize high-usage degraded skills. The (totalRuns || 1) guard mirrors
      // the rest of this file and avoids a 0/0 = NaN comparator (unstable sort).
      const aScore = a.usageCount * (a.productionStats.successfulRuns / (a.productionStats.totalRuns || 1));
      const bScore = b.usageCount * (b.productionStats.successfulRuns / (b.productionStats.totalRuns || 1));
      return bScore - aScore;
    });
  }

  /**
   * Get skill lineage (ancestry and descendants)
   */
  getLineage(skillId: string): {
    ancestors: Skill[];
    skill: Skill;
    descendants: Skill[];
  } | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    
    const ancestors = skill.parentIds
      .map(id => this.skills.get(id))
      .filter((s): s is Skill => !!s);
    
    const descendants = skill.childrenIds
      .map(id => this.skills.get(id))
      .filter((s): s is Skill => !!s);
    
    return { ancestors, skill, descendants };
  }

  /**
   * Get library statistics
   */
  getStats(): {
    totalSkills: number;
    byGeneration: Record<number, number>;
    avgSuccessRate: number;
    totalUsage: number;
    topSkills: Skill[];
  } {
    const skills = Array.from(this.skills.values());
    
    const byGeneration: Record<number, number> = {};
    let totalSuccessRate = 0;
    let totalUsage = 0;
    
    for (const skill of skills) {
      byGeneration[skill.generation] = (byGeneration[skill.generation] || 0) + 1;
      
      const successRate = skill.productionStats.successfulRuns / 
                         (skill.productionStats.totalRuns || 1);
      totalSuccessRate += successRate;
      totalUsage += skill.usageCount;
    }
    
    const topSkills = skills
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);
    
    return {
      totalSkills: skills.length,
      byGeneration,
      avgSuccessRate: skills.length > 0 ? totalSuccessRate / skills.length : 0,
      totalUsage,
      topSkills
    };
  }

  /**
   * Export library for persistence
   */
  export(): {
    skills: Skill[];
    version: string;
    timestamp: Date;
  } {
    return {
      skills: Array.from(this.skills.values()),
      version: "1.0",
      timestamp: new Date()
    };
  }

  /**
   * Import library from persistence
   */
  import(data: { skills: Skill[] }): void {
    for (const skill of data.skills) {
      this.skills.set(skill.id, skill);
      this.embeddings.set(skill.id, this.generateSkillEmbedding(skill));
    }
    
    logger.info(`Imported ${data.skills.length} skills into library`);
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private autoTagSkill(blueprint: MissionBlueprint): string[] {
    const tags: string[] = [];
    
    // Tag by tool usage
    for (const tool of blueprint.tools || []) {
      tags.push(`tool:${tool.name}`);
    }
    
    // Tag by agent models
    for (const agent of blueprint.agents || []) {
      tags.push(`model:${agent.model}`);
    }
    
    // Tag by step types
    const stepTypes = new Set(blueprint.steps?.map(s => s.type));
    for (const type of stepTypes) {
      tags.push(`type:${type}`);
    }
    
    // Tag by complexity
    const stepCount = blueprint.steps?.length || 0;
    if (stepCount < 3) tags.push("complexity:simple");
    else if (stepCount < 7) tags.push("complexity:medium");
    else tags.push("complexity:complex");
    
    return [...new Set(tags)];
  }

  private generateSkillEmbedding(skill: Skill): number[] {
    // Combine description, tags, and blueprint structure
    const text = [
      skill.name,
      skill.description,
      ...skill.tags,
      ...(skill.blueprint.steps?.map(s => s.name) || [])
    ].join(" ");
    
    return this.embedText(text);
  }

  private embedText(text: string): number[] {
    // Simplified embedding - would use real embedding model in production
    // Create a simple hash-based embedding for demo
    const embedding = new Array(this.config.embeddingDimensions).fill(0);
    const normalizedText = text.toLowerCase();
    
    for (let i = 0; i < normalizedText.length; i++) {
      const char = normalizedText.charCodeAt(i);
      embedding[i % this.config.embeddingDimensions] += char / 255;
    }
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      return embedding.map(v => v / norm);
    }
    
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  private explainMatch(query: string, skill: Skill): string[] {
    const reasons: string[] = [];
    const queryLower = query.toLowerCase();
    
    if (skill.name.toLowerCase().includes(queryLower)) {
      reasons.push("Name match");
    }
    
    if (skill.description.toLowerCase().includes(queryLower)) {
      reasons.push("Description match");
    }
    
    const matchingTags = skill.tags.filter(t => 
      queryLower.includes(t.toLowerCase()) || 
      t.toLowerCase().includes(queryLower)
    );
    if (matchingTags.length > 0) {
      reasons.push(`Tags: ${matchingTags.join(", ")}`);
    }
    
    return reasons;
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"]);
    
    return text
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 5);
  }

  private recordUsage(skillId: string): void {
    this.usageHistory.push({ skillId, timestamp: new Date() });
    
    // Keep only recent history
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    this.usageHistory = this.usageHistory.filter(h => h.timestamp > cutoff);
  }

  private evictLRUSkill(): void {
    if (this.skills.size === 0) return;
    
    // Find least recently used skill
    let lruId: string | null = null;
    let lruTime = Date.now();
    
    for (const [id, skill] of this.skills) {
      if (skill.lastUsedAt.getTime() < lruTime) {
        lruTime = skill.lastUsedAt.getTime();
        lruId = id;
      }
    }
    
    if (lruId) {
      this.skills.delete(lruId);
      this.embeddings.delete(lruId);
      logger.debug(`Evicted LRU skill: ${lruId}`);
    }
  }
}

/**
 * Factory function
 */
export function createSkillLibrary(
  config?: Partial<LibraryConfig>
): SkillLibrary {
  return new SkillLibrary(config);
}
