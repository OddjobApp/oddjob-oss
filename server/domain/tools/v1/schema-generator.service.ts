import { z } from "zod";
import type { ToolDefinition } from "./capabilities/types.js";
import { createLogger } from "@server/utils/logger.js";
import { JOB_SCHEMAS } from "../../../config/jobs/schemas.js";

const logger = createLogger("SchemaGenerator");

/**
 * SchemaMetadata provides human-readable descriptions and examples
 * for schema fields, sourced from JOB_SCHEMAS configuration
 */
export interface SchemaMetadata {
  description?: string;
  examples?: any[];
  defaultValue?: any;
  optional?: boolean;
}

/**
 * GeneratedToolSchema represents the output of schema generation
 */
export interface GeneratedToolSchema {
  schema: z.ZodSchema;
  metadata: Record<string, SchemaMetadata>;
  requiredFields: string[];
  optionalFields: string[];
}

/**
 * LRU Cache for generated schemas to avoid recomputation
 */
class SchemaCache {
  private cache = new Map<string, GeneratedToolSchema>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): GeneratedToolSchema | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (LRU)
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    return entry;
  }

  set(key: string, value: GeneratedToolSchema): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * SchemaGenerator
 *
 * Converts Zod job configuration schemas into AI-friendly tool parameter schemas.
 * Extracts types, descriptions, defaults, and handles complex nested structures.
 */
export class SchemaGenerator {
  private static cache = new SchemaCache(100);

  /**
   * Generate a tool parameter schema from a job configuration schema
   *
   * @param jobType - The type of job (e.g., 'curl', 'ai_agent')
   * @param configSchema - The Zod schema for job configuration
   * @param jobName - Optional job name for cache key
   * @returns GeneratedToolSchema with schema and metadata
   */
  static generateFromJobConfig(
    jobType: string,
    configSchema: z.ZodSchema,
    jobName?: string
  ): GeneratedToolSchema {
    const cacheKey = `${jobType}:${jobName || "default"}:${this.getSchemaHash(configSchema)}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for schema: ${cacheKey}`);
      return cached;
    }

    logger.debug(`Generating schema for ${jobType} job`);

    // Get metadata from JOB_SCHEMAS
    const jobSchemaMetadata = JOB_SCHEMAS[jobType as keyof typeof JOB_SCHEMAS];

    // Convert the Zod schema to a tool-friendly schema
    const { schema, metadata, requiredFields, optionalFields } =
      this.convertZodSchema(configSchema, jobSchemaMetadata);

    const result: GeneratedToolSchema = {
      schema,
      metadata,
      requiredFields,
      optionalFields,
    };

    // Cache the result
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Convert a Zod schema into a tool parameter schema
   */
  private static convertZodSchema(
    zodSchema: z.ZodSchema,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    // Handle different Zod types
    const schemaType = this.getZodType(zodSchema);

    switch (schemaType) {
      case "ZodObject":
        return this.convertObjectSchema(
          zodSchema as z.ZodObject<any>,
          jobMetadata,
          path
        );

      case "ZodUnion":
      case "ZodDiscriminatedUnion":
        return this.convertUnionSchema(
          zodSchema as z.ZodUnion<any> | z.ZodDiscriminatedUnion<any, any>,
          jobMetadata,
          path
        );

      case "ZodArray":
        return this.convertArraySchema(
          zodSchema as z.ZodArray<any>,
          jobMetadata,
          path
        );

      case "ZodOptional":
        return this.convertOptionalSchema(
          zodSchema as z.ZodOptional<any>,
          jobMetadata,
          path
        );

      case "ZodNullable":
        return this.convertNullableSchema(
          zodSchema as z.ZodNullable<any>,
          jobMetadata,
          path
        );

      case "ZodDefault":
        return this.convertDefaultSchema(
          zodSchema as z.ZodDefault<any>,
          jobMetadata,
          path
        );

      case "ZodEnum":
        return this.convertEnumSchema(
          zodSchema as z.ZodEnum<any>,
          jobMetadata,
          path
        );

      case "ZodLiteral":
        return this.convertLiteralSchema(
          zodSchema as z.ZodLiteral<any>,
          jobMetadata,
          path
        );

      case "ZodString":
      case "ZodNumber":
      case "ZodBoolean":
      case "ZodDate":
      case "ZodRecord":
      case "ZodEffects":
        return this.convertPrimitiveSchema(zodSchema, jobMetadata, path);

      default:
        logger.warn(`Unhandled Zod type: ${schemaType}, using string fallback`);
        return {
          schema: z.string(),
          metadata: {
            [path]: {
              description: `Complex field (type: ${schemaType}) - provide as JSON string`,
            },
          },
          requiredFields: path ? [path] : [],
          optionalFields: [],
        };
    }
  }

  /**
   * Convert an object schema (ZodObject)
   */
  private static convertObjectSchema(
    schema: z.ZodObject<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const shape = schema.shape;
    const fieldSchemas: Record<string, z.ZodSchema> = {};
    const metadata: Record<string, SchemaMetadata> = {};
    const requiredFields: string[] = [];
    const optionalFields: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const fieldResult = this.convertZodSchema(
        value as z.ZodSchema,
        jobMetadata?.config?.[key],
        fieldPath
      );

      fieldSchemas[key] = fieldResult.schema;

      // Merge metadata
      Object.entries(fieldResult.metadata).forEach(([k, v]) => {
        metadata[k] = v;
      });

      // Track required/optional
      if (fieldResult.requiredFields.length > 0) {
        requiredFields.push(key);
      } else {
        optionalFields.push(key);
      }
    }

    return {
      schema: z.object(fieldSchemas),
      metadata,
      requiredFields,
      optionalFields,
    };
  }

  /**
   * Convert a union schema (ZodUnion, ZodDiscriminatedUnion)
   */
  private static convertUnionSchema(
    schema: z.ZodUnion<any> | z.ZodDiscriminatedUnion<any, any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    // For discriminated unions, we preserve the discriminator field
    // For regular unions, we create a flexible object that accepts any union member

    let options: z.ZodSchema[];
    let discriminator: string | undefined;

    if (schema instanceof z.ZodDiscriminatedUnion) {
      options = schema.options;
      discriminator = schema.discriminator;
    } else {
      options = schema.options;
    }

    // Convert each option
    const convertedOptions = options.map((opt, idx) => {
      const result = this.convertZodSchema(
        opt,
        jobMetadata,
        `${path}[${idx}]`
      );
      return result.schema;
    });

    // Create a union of all options
    // For tool parameters, we use the first option as the base structure
    // but make all fields optional to allow flexibility
    const baseSchema = convertedOptions[0];

    if (baseSchema instanceof z.ZodObject) {
      // Make all fields optional for union flexibility
      const shape = baseSchema.shape;
      const flexibleShape: Record<string, z.ZodSchema> = {};

      for (const [key, value] of Object.entries(shape)) {
        flexibleShape[key] = (value as z.ZodSchema).optional();
      }

      return {
        schema: z.object(flexibleShape),
        metadata: {
          [path]: {
            description: `Union type${discriminator ? ` (discriminator: ${discriminator})` : ""}. Supports multiple object variants.`,
          },
        },
        requiredFields: [],
        optionalFields: Object.keys(shape),
      };
    }

    return {
      schema: z.union(convertedOptions as any),
      metadata: {
        [path]: {
          description: "Union type - can be one of multiple variants",
        },
      },
      requiredFields: path ? [path] : [],
      optionalFields: [],
    };
  }

  /**
   * Convert an array schema (ZodArray)
   */
  private static convertArraySchema(
    schema: z.ZodArray<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const elementResult = this.convertZodSchema(
      schema.element,
      jobMetadata,
      `${path}[]`
    );

    return {
      schema: z.array(elementResult.schema),
      metadata: {
        [path]: {
          description: `Array of items`,
          ...(jobMetadata?.description && {
            description: `${jobMetadata.description} (array)`,
          }),
        },
        ...elementResult.metadata,
      },
      requiredFields: [path],
      optionalFields: [],
    };
  }

  /**
   * Convert an optional schema (ZodOptional)
   */
  private static convertOptionalSchema(
    schema: z.ZodOptional<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const innerResult = this.convertZodSchema(
      schema.unwrap(),
      jobMetadata,
      path
    );

    return {
      schema: innerResult.schema.optional(),
      metadata: {
        ...innerResult.metadata,
        [path]: {
          ...innerResult.metadata[path],
          optional: true,
        },
      },
      requiredFields: [],
      optionalFields: [path.split(".").pop() || path],
    };
  }

  /**
   * Convert a nullable schema (ZodNullable)
   */
  private static convertNullableSchema(
    schema: z.ZodNullable<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const innerResult = this.convertZodSchema(
      schema.unwrap(),
      jobMetadata,
      path
    );

    return {
      schema: innerResult.schema.nullable(),
      metadata: {
        ...innerResult.metadata,
        [path]: {
          ...innerResult.metadata[path],
          optional: true,
        },
      },
      requiredFields: [],
      optionalFields: [path.split(".").pop() || path],
    };
  }

  /**
   * Convert a default schema (ZodDefault)
   */
  private static convertDefaultSchema(
    schema: z.ZodDefault<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const innerResult = this.convertZodSchema(
      schema.removeDefault(),
      jobMetadata,
      path
    );

    const defaultValue = schema._def.defaultValue();

    return {
      schema: innerResult.schema.default(defaultValue),
      metadata: {
        ...innerResult.metadata,
        [path]: {
          ...innerResult.metadata[path],
          defaultValue,
          optional: true,
        },
      },
      requiredFields: [],
      optionalFields: [path.split(".").pop() || path],
    };
  }

  /**
   * Convert an enum schema (ZodEnum)
   */
  private static convertEnumSchema(
    schema: z.ZodEnum<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const values = schema._def.values as [string, ...string[]];

    return {
      schema: z.enum(values),
      metadata: {
        [path]: {
          description:
            jobMetadata?.description || `One of: ${values.join(", ")}`,
          examples: values.slice(0, 3),
        },
      },
      requiredFields: [path],
      optionalFields: [],
    };
  }

  /**
   * Convert a literal schema (ZodLiteral)
   */
  private static convertLiteralSchema(
    schema: z.ZodLiteral<any>,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const value = schema._def.value;

    return {
      schema: z.literal(value),
      metadata: {
        [path]: {
          description: jobMetadata?.description || `Must be: ${value}`,
        },
      },
      requiredFields: [path],
      optionalFields: [],
    };
  }

  /**
   * Convert primitive schemas (string, number, boolean, date, record)
   */
  private static convertPrimitiveSchema(
    schema: z.ZodSchema,
    jobMetadata?: any,
    path = ""
  ): GeneratedToolSchema {
    const schemaType = this.getZodType(schema);
    let resultSchema: z.ZodSchema = schema;

    // Handle refined schemas (e.g., email validation, min length)
    if (schemaType === "ZodEffects" || schema instanceof z.ZodEffects) {
      // For effects, we extract the inner schema but keep the type
      const effectsSchema = schema as z.ZodEffects<any>;
      const inner = effectsSchema._def.schema;
      resultSchema = this.simplifySchema(inner);
    } else {
      resultSchema = this.simplifySchema(schema);
    }

    return {
      schema: resultSchema,
      metadata: {
        [path]: {
          description: jobMetadata?.description,
          examples: jobMetadata?.examples,
        },
      },
      requiredFields: [path],
      optionalFields: [],
    };
  }

  /**
   * Simplify complex schemas to their base type for tool parameters
   */
  private static simplifySchema(schema: z.ZodSchema): z.ZodSchema {
    const type = this.getZodType(schema);

    switch (type) {
      case "ZodString":
        return z.string();
      case "ZodNumber":
        return z.number();
      case "ZodBoolean":
        return z.boolean();
      case "ZodDate":
        return z.string(); // Dates as ISO strings for tools
      case "ZodRecord":
        return z.record(z.string(), z.any());
      default:
        return z.string();
    }
  }

  /**
   * Get the Zod type name from a schema
   */
  private static getZodType(schema: z.ZodSchema): string {
    if (!schema || !schema._def) {
      return "Unknown";
    }

    const def = schema._def as { typeName?: string };
    const typeName = def.typeName;
    if (typeName) {
      return typeName;
    }

    // Fallback: check constructor name
    const constructorName = schema.constructor.name;
    if (constructorName.startsWith("Zod")) {
      return constructorName;
    }

    return "Unknown";
  }

  /**
   * Generate a simple hash for schema caching
   */
  private static getSchemaHash(schema: z.ZodSchema): string {
    // Use JSON.stringify of the schema's shape as a simple hash
    // This is not cryptographically secure but sufficient for caching
    try {
      const shape = this.extractShape(schema);
      return this.simpleHash(JSON.stringify(shape));
    } catch {
      return "unknown";
    }
  }

  /**
   * Extract a simplified shape representation from a schema
   */
  private static extractShape(schema: z.ZodSchema): any {
    const type = this.getZodType(schema);

    if (type === "ZodObject") {
      const shape: Record<string, any> = {};
      const objSchema = schema as z.ZodObject<any>;
      for (const [key, value] of Object.entries(objSchema.shape)) {
        shape[key] = this.extractShape(value as z.ZodSchema);
      }
      return { type: "object", shape };
    }

    if (type === "ZodArray") {
      const arrSchema = schema as z.ZodArray<any>;
      return { type: "array", element: this.extractShape(arrSchema.element) };
    }

    if (type === "ZodOptional") {
      const optSchema = schema as z.ZodOptional<any>;
      return { type: "optional", inner: this.extractShape(optSchema.unwrap()) };
    }

    if (type === "ZodEnum") {
      const enumSchema = schema as z.ZodEnum<any>;
      return { type: "enum", values: enumSchema._def.values };
    }

    return { type: type.replace("Zod", "").toLowerCase() };
  }

  /**
   * Simple string hash function
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Clear the schema cache
   */
  static clearCache(): void {
    this.cache.clear();
    logger.info("Schema cache cleared");
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size(),
      maxSize: 100,
    };
  }
}

/**
 * Helper to add descriptions to a generated schema
 */
export function withDescriptions(
  schema: z.ZodSchema,
  metadata: Record<string, SchemaMetadata>
): z.ZodSchema {
  // For now, descriptions are stored in metadata
  // Future: Could attach to schema using z.describe()
  return schema;
}

/**
 * Create a tool parameter schema from job config with full metadata
 */
export function createToolSchema(
  jobType: string,
  configSchema: z.ZodSchema,
  jobName?: string
): GeneratedToolSchema {
  return SchemaGenerator.generateFromJobConfig(jobType, configSchema, jobName);
}
