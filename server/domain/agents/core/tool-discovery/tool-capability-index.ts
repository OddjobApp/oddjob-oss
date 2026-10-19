/**
 * Tool Capability Index
 * 
 * Semantic indexing of all available tools for intelligent discovery.
 * Uses vector embeddings to match tool capabilities with task requirements.
 */

import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("ToolCapabilityIndex");

// Tool capability description
export interface ToolCapability {
  toolId: string;
  name: string;
  description: string;
  category: string;
  inputSchema: any;
  outputSchema: any;
  examples: Array<{
    input: any;
    output: any;
    description: string;
  }>;
  capabilities: string[]; // Semantic capability tags
  constraints: string[]; // Limitations
  performance: {
    avgLatencyMs: number;
    successRate: number;
    qualityScore: number;
  };
  embedding?: number[]; // Vector embedding for semantic search
  lastUsed?: Date;
  usageCount: number;
}

// Task requirement for tool matching
export interface TaskRequirement {
  description: string;
  requiredCapabilities: string[];
  inputConstraints?: {
    type?: string;
    format?: string;
    size?: string;
  };
  outputRequirements?: {
    type?: string;
    format?: string;
    latency?: number;
  };
  qualityThreshold?: number;
}

// Tool match result
export interface ToolMatch {
  tool: ToolCapability;
  relevanceScore: number; // 0-1
  capabilityCoverage: number; // % of required capabilities matched
  matchReasoning: string;
  estimatedSuccess: number; // 0-1
  suggestedParameters?: Record<string, any>;
}

// Tool composition for complex tasks
export interface ToolComposition {
  id: string;
  description: string;
  tools: Array<{
    toolId: string;
    step: number;
    inputMapping: Record<string, string>; // How to map outputs to inputs
    condition?: string; // When to use this step
  }>;
  estimatedSteps: number;
  complexity: "simple" | "moderate" | "complex";
}

/**
 * Tool Capability Index
 * 
 * Manages semantic indexing and discovery of tools.
 */
export class ToolCapabilityIndex {
  private tools: Map<string, ToolCapability> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private embeddingModel: string = "text-embedding-004";

  /**
   * Register a tool in the index
   */
  async registerTool(tool: Omit<ToolCapability, "embedding" | "usageCount">): Promise<ToolCapability> {
    // Generate embedding for semantic search
    const embeddingText = this.generateEmbeddingText(tool);
    const embedding = await this.generateEmbedding(embeddingText);

    const fullTool: ToolCapability = {
      ...tool,
      embedding,
      usageCount: 0,
    };

    this.tools.set(tool.toolId, fullTool);
    this.embeddings.set(tool.toolId, embedding);

    // Index by category
    if (!this.categoryIndex.has(tool.category)) {
      this.categoryIndex.set(tool.category, new Set());
    }
    this.categoryIndex.get(tool.category)!.add(tool.toolId);

    // Index by capabilities
    for (const cap of tool.capabilities) {
      if (!this.capabilityIndex.has(cap)) {
        this.capabilityIndex.set(cap, new Set());
      }
      this.capabilityIndex.get(cap)!.add(tool.toolId);
    }

    logger.info(`[ToolCapabilityIndex] Registered tool ${tool.name} (${tool.toolId}) with ${tool.capabilities.length} capabilities`);
    return fullTool;
  }

  /**
   * Generate text representation for embedding
   */
  private generateEmbeddingText(tool: Omit<ToolCapability, "embedding" | "usageCount">): string {
    const parts = [
      tool.name,
      tool.description,
      `Category: ${tool.category}`,
      `Capabilities: ${tool.capabilities.join(", ")}`,
      `Input: ${JSON.stringify(tool.inputSchema)}`,
      `Output: ${JSON.stringify(tool.outputSchema)}`,
      `Examples: ${tool.examples.map(e => e.description).join("; ")}`,
    ];
    return parts.join(". ");
  }

  /**
   * Generate embedding using AI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // For now, use fallback embedding
    // In production, this would call an embedding API
    return this.fallbackEmbedding(text);
  }

  /**
   * Simple fallback embedding (not semantic but deterministic)
   */
  private fallbackEmbedding(text: string): number[] {
    // Simple character frequency + bigram features
    const vector: number[] = new Array(128).fill(0);
    
    // Character frequencies
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i) % 64;
      vector[char] += 0.1;
    }
    
    // Bigram features
    for (let i = 0; i < text.length - 1; i++) {
      const bigram = (text.charCodeAt(i) + text.charCodeAt(i + 1)) % 64;
      vector[64 + bigram] += 0.1;
    }
    
    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }

  /**
   * Find tools matching task requirements
   */
  async findTools(requirement: TaskRequirement, topK: number = 5): Promise<ToolMatch[]> {
    // Generate embedding for requirement
    const reqText = `${requirement.description}. Capabilities needed: ${requirement.requiredCapabilities.join(", ")}`;
    const reqEmbedding = await this.generateEmbedding(reqText);

    // Score all tools
    const matches: ToolMatch[] = [];
    
    for (const tool of this.tools.values()) {
      const score = this.calculateMatchScore(tool, requirement, reqEmbedding);
      if (score.relevanceScore > 0.3) { // Threshold
        matches.push(score);
      }
    }

    // Sort by combined score
    matches.sort((a, b) => {
      const scoreA = a.relevanceScore * 0.5 + a.capabilityCoverage * 0.3 + a.estimatedSuccess * 0.2;
      const scoreB = b.relevanceScore * 0.5 + b.capabilityCoverage * 0.3 + b.estimatedSuccess * 0.2;
      return scoreB - scoreA;
    });

    return matches.slice(0, topK);
  }

  /**
   * Calculate match score between tool and requirement
   */
  private calculateMatchScore(
    tool: ToolCapability,
    requirement: TaskRequirement,
    reqEmbedding: number[]
  ): ToolMatch {
    // Semantic similarity
    let relevanceScore = 0;
    if (tool.embedding) {
      relevanceScore = this.cosineSimilarity(reqEmbedding, tool.embedding);
    }

    // Capability coverage
    const requiredCaps = new Set(requirement.requiredCapabilities);
    const matchedCaps = tool.capabilities.filter(c => 
      requiredCaps.has(c) || 
      this.isSemanticallyRelated(c, Array.from(requiredCaps))
    );
    const capabilityCoverage = requiredCaps.size > 0 
      ? matchedCaps.length / requiredCaps.size 
      : 0.5;

    // Performance factor
    const performanceScore = (
      tool.performance.successRate * 0.5 +
      Math.min(1, 1000 / (tool.performance.avgLatencyMs + 100)) * 0.3 +
      tool.performance.qualityScore * 0.2
    );

    // Experience bonus (tools that have been used successfully)
    const experienceBonus = Math.min(0.1, tool.usageCount / 100);

    // Calculate estimated success
    const estimatedSuccess = Math.min(1, 
      performanceScore * 0.4 + 
      relevanceScore * 0.4 + 
      capabilityCoverage * 0.2 + 
      experienceBonus
    );

    // Generate reasoning
    const reasoningParts: string[] = [];
    if (relevanceScore > 0.7) reasoningParts.push("High semantic match");
    if (capabilityCoverage > 0.8) reasoningParts.push("Covers most required capabilities");
    if (tool.performance.successRate > 0.8) reasoningParts.push("Proven track record");
    if (matchedCaps.length > 0) reasoningParts.push(`Matches: ${matchedCaps.join(", ")}`);

    return {
      tool,
      relevanceScore: Math.min(1, relevanceScore + experienceBonus),
      capabilityCoverage,
      matchReasoning: reasoningParts.join(". ") || "Moderate match",
      estimatedSuccess,
    };
  }

  /**
   * Check if capability is semantically related to requirements
   */
  private isSemanticallyRelated(capability: string, requirements: string[]): boolean {
    // Simple keyword matching
    const capWords = capability.toLowerCase().split(/[_\s-]/);
    for (const req of requirements) {
      const reqWords = req.toLowerCase().split(/[_\s-]/);
      for (const cw of capWords) {
        for (const rw of reqWords) {
          if (cw.includes(rw) || rw.includes(cw)) return true;
          // Common synonyms
          if (this.areSynonyms(cw, rw)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Simple synonym check
   */
  private areSynonyms(word1: string, word2: string): boolean {
    const synonyms: Record<string, string[]> = {
      search: ["find", "query", "lookup", "retrieve"],
      create: ["make", "generate", "build", "construct"],
      update: ["modify", "edit", "change", "patch"],
      delete: ["remove", "destroy", "eliminate"],
      analyze: ["examine", "study", "investigate", "assess"],
      transform: ["convert", "change", "mutate", "process"],
      validate: ["verify", "check", "confirm", "ensure"],
    };
    
    for (const [key, words] of Object.entries(synonyms)) {
      const set = new Set([key, ...words]);
      if (set.has(word1) && set.has(word2)) return true;
    }
    return false;
  }

  /**
   * Cosine similarity between vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find tool compositions for complex tasks
   */
  async findComposition(taskDescription: string, requiredSteps: string[]): Promise<ToolComposition[]> {
    const compositions: ToolComposition[] = [];

    // For each required step, find matching tools
    const stepMatches: Array<{ step: string; tools: ToolMatch[] }> = [];
    
    for (const step of requiredSteps) {
      const matches = await this.findTools({
        description: step,
        requiredCapabilities: [],
      }, 3);
      stepMatches.push({ step, tools: matches });
    }

    // Generate compositions
    if (stepMatches.length >= 2) {
      // Try to find chains of tools
      const chains = this.generateChains(stepMatches);
      
      for (const chain of chains.slice(0, 5)) {
        compositions.push({
          id: uuidv4(),
          description: `Tool chain for: ${taskDescription}`,
          tools: chain,
          estimatedSteps: chain.length,
          complexity: chain.length > 4 ? "complex" : chain.length > 2 ? "moderate" : "simple",
        });
      }
    }

    return compositions;
  }

  /**
   * Generate possible tool chains
   */
  private generateChains(stepMatches: Array<{ step: string; tools: ToolMatch[] }>): Array<ToolComposition["tools"]> {
    const chains: Array<ToolComposition["tools"]> = [];

    // Simple approach: take best match for each step
    const bestChain: ToolComposition["tools"] = [];
    for (let i = 0; i < stepMatches.length; i++) {
      const best = stepMatches[i].tools[0];
      if (best) {
        bestChain.push({
          toolId: best.tool.toolId,
          step: i + 1,
          inputMapping: i === 0 ? {} : { input: `step_${i}_output` },
        });
      }
    }
    chains.push(bestChain);

    // Try alternative combinations
    if (stepMatches[0].tools.length > 1) {
      const altChain: ToolComposition["tools"] = [];
      altChain.push({
        toolId: stepMatches[0].tools[1].tool.toolId,
        step: 1,
        inputMapping: {},
      });
      for (let i = 1; i < stepMatches.length; i++) {
        const best = stepMatches[i].tools[0];
        if (best) {
          altChain.push({
            toolId: best.tool.toolId,
            step: i + 1,
            inputMapping: { input: `step_${i}_output` },
          });
        }
      }
      chains.push(altChain);
    }

    return chains;
  }

  /**
   * Get tool by ID
   */
  getTool(toolId: string): ToolCapability | undefined {
    return this.tools.get(toolId);
  }

  /**
   * Get all tools in a category
   */
  getToolsByCategory(category: string): ToolCapability[] {
    const ids = this.categoryIndex.get(category);
    if (!ids) return [];
    return Array.from(ids).map(id => this.tools.get(id)!).filter(Boolean);
  }

  /**
   * Get tools by capability
   */
  getToolsByCapability(capability: string): ToolCapability[] {
    const ids = this.capabilityIndex.get(capability);
    if (!ids) return [];
    return Array.from(ids).map(id => this.tools.get(id)!).filter(Boolean);
  }

  /**
   * List all tools
   */
  listAllTools(): ToolCapability[] {
    return Array.from(this.tools.values());
  }

  /**
   * Record tool usage
   */
  recordUsage(toolId: string, success: boolean, latencyMs: number): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    tool.usageCount++;
    tool.lastUsed = new Date();

    // Update performance metrics
    const alpha = 0.1; // Smoothing factor
    tool.performance.successRate = 
      tool.performance.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
    tool.performance.avgLatencyMs = 
      tool.performance.avgLatencyMs * (1 - alpha) + latencyMs * alpha;
  }

  /**
   * Get tool statistics
   */
  getStats(): {
    totalTools: number;
    totalCategories: number;
    totalCapabilities: number;
    mostUsedTools: Array<{ toolId: string; name: string; usageCount: number }>;
    categoryDistribution: Record<string, number>;
  } {
    const tools = Array.from(this.tools.values());
    
    const mostUsed = tools
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
      .map(t => ({ toolId: t.toolId, name: t.name, usageCount: t.usageCount }));

    const categoryDist: Record<string, number> = {};
    for (const [cat, ids] of this.categoryIndex) {
      categoryDist[cat] = ids.size;
    }

    return {
      totalTools: tools.length,
      totalCategories: this.categoryIndex.size,
      totalCapabilities: this.capabilityIndex.size,
      mostUsedTools: mostUsed,
      categoryDistribution: categoryDist,
    };
  }
}

export const toolCapabilityIndex = new ToolCapabilityIndex();
