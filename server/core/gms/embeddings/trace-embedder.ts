/**
 * Trace Embedding Engine
 * 
 * Generates vector embeddings from Hermes traces for:
 * - Similarity search (find traces like this one)
 * - Verifier input features
 * - Clustering and analysis
 * 
 * Uses existing AI client infrastructure (Gemini embeddings)
 */

import { createLogger } from "../../../utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import type { EnrichedHermesTrace, HermesTraceFeatures } from "../common/types.js";

const logger = createLogger("TraceEmbeddingEngine");

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  batchSize: number;
  normalize: boolean;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  model: "text-embedding-004", // Gemini embedding model
  dimensions: 768,
  batchSize: 100,
  normalize: true
};

/**
 * Feature extraction for structured embedding
 * 
 * Combines:
 * 1. Semantic embedding of thinking content (from LLM)
 * 2. Structured feature vector (tool usage patterns, reasoning depth, etc.)
 */
export class TraceEmbeddingEngine {
  private config: EmbeddingConfig;
  private client: any; // AI client
  private cache: Map<string, number[]> = new Map();
  
  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = AIClientFactory.getClient({ provider: "google" } as any);
  }

  /**
   * Generate embedding from Hermes trace
   * 
   * Strategy:
   * 1. Get semantic embedding of thinking content
   * 2. Concatenate with structured features
   * 3. Normalize
   */
  async embedTrace(trace: EnrichedHermesTrace): Promise<number[]> {
    const cacheKey = this.getCacheKey(trace);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    try {
      // 1. Semantic embedding of thinking content
      const semanticEmbedding = await this.embedText(trace.parsed.thought);
      
      // 2. Structured feature vector
      const featureVector = this.extractFeatureVector(trace.features);
      
      // 3. Concatenate and project to target dimensions
      const combined = this.combineEmbeddings(semanticEmbedding, featureVector);
      
      // 4. Normalize if configured
      const final = this.config.normalize ? this.normalize(combined) : combined;
      
      // Cache result
      this.cache.set(cacheKey, final);
      
      return final;
    } catch (error) {
      logger.error("Failed to generate trace embedding:", error);
      // Return zero vector as fallback
      return new Array(this.config.dimensions).fill(0);
    }
  }

  /**
   * Generate embedding for plain text (thinking content)
   */
  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(this.config.dimensions).fill(0);
    }
    
    try {
      // Use Gemini embedding API
      const response = await this.client.embedContent({
        model: `models/${this.config.model}`,
        content: {
          parts: [{ text: this.preprocessText(text) }]
        }
      });
      
      return response.embedding.values;
    } catch (error) {
      logger.error("Failed to generate text embedding:", error);
      throw error;
    }
  }

  /**
   * Batch embedding for efficiency
   */
  async embedTraces(traces: EnrichedHermesTrace[]): Promise<Map<string, number[]>> {
    const results = new Map<string, number[]>();
    
    // Process in batches
    for (let i = 0; i < traces.length; i += this.config.batchSize) {
      const batch = traces.slice(i, i + this.config.batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async trace => {
          const embedding = await this.embedTrace(trace);
          return { traceId: trace.traceId, embedding };
        })
      );
      
      for (const result of batchResults) {
        results.set(result.traceId, result.embedding);
      }
      
      logger.debug(`Embedded batch ${i / this.config.batchSize + 1}/${Math.ceil(traces.length / this.config.batchSize)}`);
    }
    
    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Embeddings must have same dimensions");
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find k nearest neighbors
   */
  findNearestNeighbors(
    query: number[],
    candidates: { id: string; embedding: number[] }[],
    k: number = 5
  ): { id: string; similarity: number }[] {
    const similarities = candidates.map(c => ({
      id: c.id,
      similarity: this.cosineSimilarity(query, c.embedding)
    }));
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  /**
   * Preprocess thinking text for embedding
   */
  private preprocessText(text: string): string {
    // Remove XML tags for cleaner semantic embedding
    return text
      .replace(/<thinking>|<\/thinking>/g, "")
      .replace(/<action[^>]*>.*?<\/action>/gs, "") // Remove tool calls from semantic embedding
      .replace(/<result[^>]*>.*?<\/result>/gs, "") // Remove results
      .trim()
      .substring(0, 8000); // Limit length
  }

  /**
   * Extract structured feature vector from trace features
   */
  private extractFeatureVector(features: HermesTraceFeatures): number[] {
    return [
      // Reasoning depth (normalized)
      Math.min(features.thoughtDepth / 10, 1),
      
      // Tool diversity
      features.toolDiversity,
      
      // Self-reflection (normalized)
      Math.min(features.selfReflectionIndicators.length / 5, 1),
      
      // Confidence (inverted - lower confidence = higher uncertainty)
      Math.min(features.confidenceMarkers / 10, 1),
      
      // Recursion depth (normalized)
      Math.min(features.recursionDepth / 5, 1),
      
      // Action chaining (normalized)
      Math.min(features.actionChaining / 10, 1)
    ];
  }

  /**
   * Combine semantic and feature embeddings
   * 
   * Strategy: Project to target dimensions using learned weights
   * For now, simple concatenation and truncation/padding
   */
  private combineEmbeddings(semantic: number[], features: number[]): number[] {
    const semanticWeight = 0.8;
    const featureWeight = 0.2;
    
    // Resize semantic embedding to leave room for features
    const targetSemanticDims = Math.floor(this.config.dimensions * semanticWeight);
    const resizedSemantic = this.resizeVector(semantic, targetSemanticDims);
    
    // Resize features
    const targetFeatureDims = this.config.dimensions - targetSemanticDims;
    const resizedFeatures = this.resizeVector(features, targetFeatureDims);
    
    // Concatenate
    return [...resizedSemantic, ...resizedFeatures];
  }

  /**
   * Resize vector to target dimensions (pad or truncate)
   */
  private resizeVector(vector: number[], targetDims: number): number[] {
    if (vector.length === targetDims) {
      return vector;
    }
    
    if (vector.length > targetDims) {
      // Truncate
      return vector.slice(0, targetDims);
    }
    
    // Pad with zeros
    const result = [...vector];
    while (result.length < targetDims) {
      result.push(0);
    }
    return result;
  }

  /**
   * L2 normalize vector
   */
  private normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    
    if (norm === 0) {
      return vector;
    }
    
    return vector.map(val => val / norm);
  }

  /**
   * Generate cache key for trace
   */
  private getCacheKey(trace: EnrichedHermesTrace): string {
    // Simple hash of thinking content
    let hash = 0;
    for (let i = 0; i < trace.parsed.thought.length; i++) {
      const char = trace.parsed.thought.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `trace_${hash}`;
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug("Embedding cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0 // Would need to track hits/misses
    };
  }
}

/**
 * Simple in-memory embedding service for testing
 * Uses random projections (not semantically meaningful, but consistent)
 */
export class MockEmbeddingEngine {
  private projectionMatrix: number[][];
  private dimensions: number;
  
  constructor(dimensions: number = 768) {
    this.dimensions = dimensions;
    
    // Generate random projection matrix
    this.projectionMatrix = Array(dimensions)
      .fill(null)
      .map(() => 
        Array(100).fill(null).map(() => (Math.random() - 0.5) * 2)
      );
  }

  async embedTrace(trace: any): Promise<number[]> {
    return this.embedText(trace.parsed?.thought || "");
  }

  async embedText(text: string): Promise<number[]> {
    // Simple character frequency projection
    const charFreq = new Array(100).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = text.charCodeAt(i) % 100;
      charFreq[idx] += 1;
    }
    
    // Project to higher dimensions
    const embedding = this.projectionMatrix.map(row => 
      row.reduce((sum, val, i) => sum + val * charFreq[i], 0)
    );
    
    return this.l2Normalize(embedding);
  }

  async embedTraces(traces: any[]): Promise<Map<string, number[]>> {
    const results = new Map<string, number[]>();
    for (const trace of traces) {
      const embedding = await this.embedTrace(trace);
      results.set(trace.traceId, embedding);
    }
    return results;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Embeddings must have same dimensions");
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
  }
}
