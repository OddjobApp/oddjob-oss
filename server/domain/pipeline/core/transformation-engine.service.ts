/**
 * Transformation Engine Service
 * 
 * Executes data transformations with rule compilation and caching for performance
 */

import _ from "lodash";
const { get, set, cloneDeep } = _;
import type { TransformerConfig, TransformationRule } from "@shared/schema/index.js";

interface TransformationContext {
  inputData: any;
  previousStepOutput?: any;
}

export class TransformationEngine {
  private compiledRules: Map<string, Function> = new Map();
  private pathCache: Map<string, any> = new Map(); // Cache for path lookups

  /**
   * Compile transformation rule into optimized function
   */
  private compileRule(rule: TransformationRule): Function {
    const cacheKey = `${rule.type}-${rule.sourcePath}-${rule.targetPath}`;

    if (this.compiledRules.has(cacheKey)) {
      return this.compiledRules.get(cacheKey)!;
    }

    let fn: Function;

    switch (rule.type) {
      case "direct":
        fn = (data: any) => {
          try {
            return get(data, rule.sourcePath);
          } catch {
            return undefined;
          }
        };
        break;

      case "wrap_object":
        const wrapperKey = rule.config?.wrapperKey || "name";
        fn = (data: any) => {
          try {
            const value = get(data, rule.sourcePath);
            return value !== undefined && value !== null ? { [wrapperKey]: value } : undefined;
          } catch {
            return undefined;
          }
        };
        break;

      case "map_value":
        const mapping = rule.config?.mapping || {};
        const normalizedMapping = Object.entries(mapping).reduce((acc, [k, v]) => {
          acc[k.toLowerCase()] = v;
          return acc;
        }, {} as Record<string, any>);
        fn = (data: any) => {
          try {
            const value = get(data, rule.sourcePath);
            if (value === undefined || value === null) return undefined;
            const lookup = String(value).toLowerCase();
            return normalizedMapping[lookup] || value;
          } catch {
            return undefined;
          }
        };
        break;

      case "parse_json":
        fn = (data: any) => {
          try {
            const value = get(data, rule.sourcePath);
            if (typeof value !== 'string') return value;
            try {
              return JSON.parse(value);
            } catch {
              return value;
            }
          } catch {
            return undefined;
          }
        };
        break;

      case "to_string":
        fn = (data: any) => {
          try {
            const value = get(data, rule.sourcePath);
            return value !== undefined && value !== null ? String(value) : undefined;
          } catch {
            return undefined;
          }
        };
        break;

      case "extract_field":
        const extractPath = rule.config?.extractPath || "";
        fn = (data: any) => {
          try {
            const baseValue = get(data, rule.sourcePath);
            if (extractPath && typeof baseValue === 'object' && baseValue !== null) {
              return get(baseValue, extractPath);
            }
            return baseValue;
          } catch {
            return undefined;
          }
        };
        break;

      default:
        fn = (data: any) => {
          try {
            return get(data, rule.sourcePath);
          } catch {
            return undefined;
          }
        };
    }

    this.compiledRules.set(cacheKey, fn);
    return fn;
  }

  /**
   * Execute transformations with performance optimizations
   */
  executeTransformations(
    inputData: any,
    config: TransformerConfig,
    context?: TransformationContext
  ): any {
    // Use provided input or context
    const sourceData = inputData || context?.previousStepOutput || context?.inputData;

    if (!sourceData) {
      throw new Error("No input data provided for transformation");
    }

    // For arrays, process in batches to avoid memory issues
    if (Array.isArray(sourceData)) {
      return this.transformArray(sourceData, config);
    }

    // For single objects, transform directly
    return this.transformObject(sourceData, config);
  }

  private transformObject(data: any, config: TransformerConfig): any {
    const output: any = {};

    // Lazy evaluation: only process rules that are actually needed
    // For now, we process all rules, but this structure allows for future optimization
    // where we could track which paths are actually accessed

    for (const rule of config.rules) {
      try {
        const transformFn = this.compileRule(rule);

        // Use cached path lookup if available
        const cacheKey = `source:${rule.sourcePath}`;
        let sourceValue: any;

        if (this.pathCache.has(cacheKey)) {
          sourceValue = this.pathCache.get(cacheKey);
        } else {
          // Get value using lodash (which is already optimized)
          sourceValue = get(data, rule.sourcePath);
          // Cache the result for this path (useful when same path is accessed multiple times)
          this.pathCache.set(cacheKey, sourceValue);
        }

        // Apply transformation
        const transformedValue = transformFn(data);

        if (transformedValue !== undefined) {
          set(output, rule.targetPath, transformedValue);
        }
      } catch (error) {
        console.error(`[Transformation] Error applying rule ${rule.id}:`, error);
        // Continue with other rules
      }
    }

    // Clear path cache after processing this object (to avoid stale data)
    this.pathCache.clear();

    return output;
  }

  private transformArray(data: any[], config: TransformerConfig): any[] {
    // Process in batches to avoid memory issues
    const BATCH_SIZE = 100;
    const results: any[] = [];

    // Pre-compile all rules once for the entire array (performance optimization)
    const compiledRules = config.rules.map((rule: any) => ({
      rule,
      transformFn: this.compileRule(rule),
    }));

    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const transformedBatch = batch.map(item => {
        const output: any = {};

        for (const { rule, transformFn } of compiledRules) {
          try {
            const transformedValue = transformFn(item);

            if (transformedValue !== undefined) {
              set(output, rule.targetPath, transformedValue);
            }
          } catch (error) {
            console.error(`[Transformation] Error applying rule ${rule.id}:`, error);
            // Continue with other rules
          }
        }

        return output;
      });
      results.push(...transformedBatch);
    }

    return results;
  }

  /**
   * Validate transformation rules against schemas
   */
  validateRules(
    rules: TransformationRule[],
    inputSchema?: Record<string, any>,
    outputSchema?: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const rule of rules) {
      // Validate source path exists in input schema
      if (inputSchema && !this.isPathValid(rule.sourcePath, inputSchema)) {
        errors.push(`Source path "${rule.sourcePath}" not found in input schema`);
      }

      // Validate target path format
      if (!rule.targetPath || rule.targetPath.trim() === '') {
        errors.push(`Rule ${rule.id} has empty target path`);
      }

      // Validate rule type specific config
      if (rule.type === "wrap_object" && !rule.config?.wrapperKey) {
        errors.push(`Rule ${rule.id} (wrap_object) requires wrapperKey in config`);
      }

      if (rule.type === "map_value" && !rule.config?.mapping) {
        errors.push(`Rule ${rule.id} (map_value) requires mapping in config`);
      }

      if (rule.type === "extract_field" && !rule.config?.extractPath) {
        errors.push(`Rule ${rule.id} (extract_field) requires extractPath in config`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if a path is valid in the schema
   */
  private isPathValid(path: string, schema: Record<string, any>): boolean {
    // Check exact match
    if (path in schema) {
      return true;
    }

    // Check if path matches array pattern (e.g., "items[].field" matches "items[].field")
    const arrayPattern = path.replace(/\[\]/g, '[]');
    if (arrayPattern in schema) {
      return true;
    }

    // Check if parent path exists (for nested paths)
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join('.');
      if (parentPath in schema) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clear compiled rule cache (useful for testing or when rules change)
   */
  clearCache(): void {
    this.compiledRules.clear();
    this.pathCache.clear();
  }

  /**
   * Get cache statistics (useful for monitoring and debugging)
   */
  getCacheStats(): { compiledRules: number; pathCacheSize: number } {
    return {
      compiledRules: this.compiledRules.size,
      pathCacheSize: this.pathCache.size,
    };
  }
}



