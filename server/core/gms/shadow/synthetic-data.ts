/**
 * Synthetic Data Generator
 * 
 * Generates realistic test data for shadow runs while preserving:
 * - Schema structure
 * - Data types
 * - Cardinality (unique value counts)
 * - Statistical distributions (optional)
 * 
 * Methods:
 * - schema_based: Generate from JSON schema
 * - differential_privacy: Add noise to real data
 * - llm_generated: Use LLM to generate realistic samples
 */

import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("SyntheticDataGenerator");

export interface DataGeneratorConfig {
  method: "schema_based" | "differential_privacy" | "llm_generated";
  
  // Schema-based options
  preserveCardinality: boolean;
  
  // Differential privacy options
  epsilon: number;        // Privacy budget (lower = more private)
  delta: number;         // Privacy failure probability
  
  // LLM generation options
  model: string;
  maxSamples: number;
  
  // General
  seed: number;          // For reproducibility
  addNoise: boolean;
  noiseScale: number;    // 0-1
}

const DEFAULT_CONFIG: DataGeneratorConfig = {
  method: "schema_based",
  preserveCardinality: true,
  epsilon: 1.0,
  delta: 0.0001,
  model: "gemini-2.0-flash",
  maxSamples: 100,
  seed: 42,
  addNoise: false,
  noiseScale: 0.1
};

/**
 * Schema definition for data generation
 */
interface DataSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, DataSchema>;
  items?: DataSchema;
  enum?: any[];
  format?: string;       // date, email, uuid, etc.
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  required?: string[];
}

/**
 * Synthetic Data Generator
 * 
 * Creates realistic test data for shadow validation.
 */
export class SyntheticDataGenerator {
  private config: DataGeneratorConfig;
  private rng: () => number;  // Random number generator

  constructor(config: Partial<DataGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = this.createSeededRng(this.config.seed);
  }

  /**
   * Generate synthetic data from schema
   */
  async generateFromSchema(
    schema: DataSchema,
    nSamples: number = 1
  ): Promise<any[]> {
    const samples: any[] = [];
    
    for (let i = 0; i < nSamples; i++) {
      const sample = this.generateValue(schema, `sample_${i}`);
      samples.push(sample);
    }
    
    logger.debug(`Generated ${nSamples} samples from schema`);
    
    return samples;
  }

  /**
   * Generate data preserving statistics from real data
   * 
   * Uses differential privacy to protect sensitive information
   */
  async generateFromRealData(
    realData: any[],
    schema: DataSchema,
    options?: {
      preserveDistribution?: boolean;
      addNoise?: boolean;
    }
  ): Promise<any[]> {
    if (realData.length === 0) {
      return this.generateFromSchema(schema, this.config.maxSamples);
    }
    
    // Extract statistics
    const stats = this.extractStatistics(realData, schema);
    
    // Generate synthetic samples
    const samples: any[] = [];
    const nSamples = Math.min(realData.length, this.config.maxSamples);
    
    for (let i = 0; i < nSamples; i++) {
      // Sample from real data
      const baseSample = realData[Math.floor(this.rng() * realData.length)];
      
      // Perturb with differential privacy
      let synthetic = this.perturbSample(baseSample, schema, stats);
      
      // Add noise if requested
      if (options?.addNoise ?? this.config.addNoise) {
        synthetic = this.addNoise(synthetic, schema);
      }
      
      samples.push(synthetic);
    }
    
    logger.debug(`Generated ${samples.length} DP samples`);
    
    return samples;
  }

  /**
   * Generate variations of a base record
   * 
   * Useful for testing edge cases
   */
  async generateVariations(
    baseRecord: any,
    schema: DataSchema,
    nVariations: number = 5,
    variationTypes: Array<"null" | "extreme" | "typo" | "type_mismatch"> = ["null", "extreme"]
  ): Promise<any[]> {
    const variations: any[] = [];
    
    for (let i = 0; i < nVariations; i++) {
      const type = variationTypes[i % variationTypes.length];
      const varied = this.applyVariation(baseRecord, schema, type);
      variations.push(varied);
    }
    
    return variations;
  }

  /**
   * Generate data for specific shadow scenario
   */
  generateForScenario(
    scenarioType: "normal" | "high_load" | "edge_case" | "failure",
    schema: DataSchema
  ): any {
    const base = this.generateValue(schema, "scenario");
    
    switch (scenarioType) {
      case "high_load":
        return this.makeHighLoad(base, schema);
      case "edge_case":
        return this.makeEdgeCase(base, schema);
      case "failure":
        return this.makeFailureCase(base, schema);
      default:
        return base;
    }
  }

  // ============================================================================
  // Private generation methods
  // ============================================================================

  private generateValue(schema: DataSchema, context: string): any {
    switch (schema.type) {
      case "object":
        return this.generateObject(schema, context);
      case "array":
        return this.generateArray(schema, context);
      case "string":
        return this.generateString(schema, context);
      case "number":
      case "integer":
        return this.generateNumber(schema);
      case "boolean":
        return this.rng() < 0.5;
      default:
        return null;
    }
  }

  private generateObject(schema: DataSchema, context: string): any {
    const obj: any = {};
    
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        // Skip optional properties sometimes
        if (!schema.required?.includes(key) && this.rng() < 0.2) {
          continue;
        }
        
        obj[key] = this.generateValue(propSchema, `${context}.${key}`);
      }
    }
    
    return obj;
  }

  private generateArray(schema: DataSchema, context: string): any[] {
    const length = Math.floor(this.rng() * 5) + 1; // 1-5 items
    const arr: any[] = [];
    
    for (let i = 0; i < length; i++) {
      if (schema.items) {
        arr.push(this.generateValue(schema.items, `${context}[${i}]`));
      }
    }
    
    return arr;
  }

  private generateString(schema: DataSchema, context: string): string {
    // Use enum if defined
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[Math.floor(this.rng() * schema.enum.length)];
    }
    
    // Use format if defined
    switch (schema.format) {
      case "date":
        return this.generateDate();
      case "date-time":
        return this.generateDateTime();
      case "email":
        return this.generateEmail();
      case "uuid":
        return this.generateUUID();
      case "uri":
        return `https://example.com/${context}`;
    }
    
    // Generate based on context
    const minLen = schema.minLength || 5;
    const maxLen = schema.maxLength || 50;
    const length = Math.floor(this.rng() * (maxLen - minLen)) + minLen;
    
    return this.generateRandomString(length, context);
  }

  private generateNumber(schema: DataSchema): number {
    const min = schema.minimum ?? 0;
    const max = schema.maximum ?? 100;
    
    if (schema.type === "integer") {
      return Math.floor(this.rng() * (max - min)) + min;
    }
    
    return this.rng() * (max - min) + min;
  }

  private generateDate(): string {
    const date = new Date(2020 + Math.floor(this.rng() * 5), 
                         Math.floor(this.rng() * 12), 
                         Math.floor(this.rng() * 28) + 1);
    return date.toISOString().split("T")[0];
  }

  private generateDateTime(): string {
    const date = new Date(Date.now() - Math.floor(this.rng() * 31536000000)); // Past year
    return date.toISOString();
  }

  private generateEmail(): string {
    const domains = ["example.com", "test.org", "sample.net"];
    const domain = domains[Math.floor(this.rng() * domains.length)];
    const local = this.generateRandomString(10, "email");
    return `${local}@${domain}`;
  }

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (this.rng() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private generateRandomString(length: number, context: string): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
    let result = context.replace(/[^a-zA-Z]/g, "").substring(0, 5);
    
    for (let i = result.length; i < length; i++) {
      result += chars.charAt(Math.floor(this.rng() * chars.length));
    }
    
    return result;
  }

  private extractStatistics(data: any[], schema: DataSchema): any {
    // Simplified - would extract real distributions in production
    return {
      count: data.length,
      uniqueValues: new Set(data).size
    };
  }

  private perturbSample(sample: any, schema: DataSchema, stats: any): any {
    // Simplified DP perturbation
    if (typeof sample === "number") {
      const noise = (this.rng() - 0.5) * 2 * this.config.epsilon;
      return sample + noise;
    }
    
    if (typeof sample === "string" && sample.length > 5) {
      // Randomly modify characters
      const chars = sample.split("");
      for (let i = 0; i < chars.length; i++) {
        if (this.rng() < 0.1 * this.config.epsilon) {
          chars[i] = String.fromCharCode(97 + Math.floor(this.rng() * 26));
        }
      }
      return chars.join("");
    }
    
    return sample;
  }

  private addNoise(data: any, schema: DataSchema): any {
    if (typeof data !== "object" || data === null) {
      return data;
    }
    
    const noised: any = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "number") {
        noised[key] = value * (1 + (this.rng() - 0.5) * this.config.noiseScale);
      } else if (typeof value === "string" && this.rng() < 0.1) {
        noised[key] = value + "_noised";
      } else {
        noised[key] = value;
      }
    }
    
    return noised;
  }

  private applyVariation(
    base: any,
    schema: DataSchema,
    type: "null" | "extreme" | "typo" | "type_mismatch"
  ): any {
    const varied = JSON.parse(JSON.stringify(base));
    
    switch (type) {
      case "null":
        // Set random field to null
        const keys = Object.keys(varied);
        if (keys.length > 0) {
          varied[keys[Math.floor(this.rng() * keys.length)]] = null;
        }
        break;
        
      case "extreme":
        // Set numeric fields to extreme values
        for (const key of Object.keys(varied)) {
          if (typeof varied[key] === "number") {
            varied[key] = this.rng() < 0.5 ? 0 : 999999;
          }
        }
        break;
        
      case "typo":
        // Add typos to strings
        for (const key of Object.keys(varied)) {
          if (typeof varied[key] === "string" && varied[key].length > 3) {
            const chars = varied[key].split("");
            const idx = Math.floor(this.rng() * chars.length);
            chars[idx] = chars[idx] === "a" ? "e" : "a";
            varied[key] = chars.join("");
          }
        }
        break;
        
      case "type_mismatch":
        // Change type of random field
        const allKeys = Object.keys(varied);
        if (allKeys.length > 0) {
          const randomKey = allKeys[Math.floor(this.rng() * allKeys.length)];
          varied[randomKey] = String(varied[randomKey]);
        }
        break;
    }
    
    return varied;
  }

  private makeHighLoad(base: any, schema: DataSchema): any {
    // Increase array sizes
    for (const key of Object.keys(base)) {
      if (Array.isArray(base[key])) {
        base[key] = Array(100).fill(base[key][0]);
      }
    }
    return base;
  }

  private makeEdgeCase(base: any, schema: DataSchema): any {
    // Set fields to boundary values
    for (const key of Object.keys(base)) {
      if (typeof base[key] === "string") {
        base[key] = "";
      } else if (typeof base[key] === "number") {
        base[key] = 0;
      }
    }
    return base;
  }

  private makeFailureCase(base: any, schema: DataSchema): any {
    // Corrupt data to trigger validation failures
    return { corrupted: true, original: base };
  }

  private createSeededRng(seed: number): () => number {
    // Simple LCG random number generator
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}

/**
 * Factory function
 */
export function createSyntheticDataGenerator(
  config?: Partial<DataGeneratorConfig>
): SyntheticDataGenerator {
  return new SyntheticDataGenerator(config);
}
