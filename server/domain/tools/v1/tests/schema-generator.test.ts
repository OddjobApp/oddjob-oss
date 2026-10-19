import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  SchemaGenerator,
  createToolSchema,
  type GeneratedToolSchema,
} from "../schema-generator.service.js";

// Import job config schemas for testing
import {
  curlConfigSchema,
} from "@shared/schema/jobs/config-integration.js";
import {
  aiApiCallConfigSchema,
  aiAgentConfigSchema,
} from "@shared/schema/jobs/config-ai.js";
import {
  shellConfigSchema,
  pythonConfigSchema,
} from "@shared/schema/jobs/config-automation.js";
import { sqlQueryConfigSchema } from "@shared/schema/jobs/config-data.js";

describe("SchemaGenerator", () => {
  beforeEach(() => {
    // Clear cache before each test
    SchemaGenerator.clearCache();
  });

  describe("Basic Schema Conversion", () => {
    it("should convert a simple string field", () => {
      const schema = z.object({
        name: z.string(),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema, "Test Job");

      expect(result.schema).toBeInstanceOf(z.ZodObject);
      expect(result.requiredFields).toContain("name");
      expect(result.optionalFields).toHaveLength(0);
    });

    it("should convert multiple primitive types", () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
        active: z.boolean(),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toEqual(
        expect.arrayContaining(["name", "count", "active"])
      );
      expect(result.requiredFields).toHaveLength(3);
    });

    it("should handle optional fields", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toContain("required");
      expect(result.optionalFields).toContain("optional");
    });

    it("should handle default values", () => {
      const schema = z.object({
        withDefault: z.string().default("default_value"),
        withoutDefault: z.string(),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.optionalFields).toContain("withDefault");
      expect(result.metadata["withDefault"].defaultValue).toBe("default_value");
    });
  });

  describe("Complex Types", () => {
    it("should handle nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.schema).toBeInstanceOf(z.ZodObject);
      expect(result.requiredFields).toContain("user");
    });

    it("should handle arrays", () => {
      const schema = z.object({
        items: z.array(z.string()),
        numbers: z.array(z.number()),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toEqual(
        expect.arrayContaining(["items", "numbers"])
      );
    });

    it("should handle arrays of objects", () => {
      const schema = z.object({
        users: z.array(
          z.object({
            name: z.string(),
            age: z.number(),
          })
        ),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toContain("users");
    });

    it("should handle enums", () => {
      const schema = z.object({
        status: z.enum(["active", "inactive", "pending"]),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toContain("status");
      expect(result.metadata["status"].description).toContain("active");
      expect(result.metadata["status"].description).toContain("inactive");
    });

    it("should handle record types", () => {
      const schema = z.object({
        metadata: z.record(z.string(), z.any()),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.requiredFields).toContain("metadata");
    });
  });

  describe("Curl Job Schema", () => {
    it("should generate schema for curl config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "curl",
        curlConfigSchema,
        "HTTP Request"
      );

      // Should have URL and method as required
      expect(result.schema).toBeInstanceOf(z.ZodObject);
      expect(result.requiredFields).toContain("url");
      expect(result.requiredFields).toContain("method");

      // Headers, queryParams, body should be optional
      expect(result.optionalFields).toContain("headers");
      expect(result.optionalFields).toContain("queryParams");
      expect(result.optionalFields).toContain("body");
    });

    it("should cache curl schema", () => {
      const result1 = SchemaGenerator.generateFromJobConfig(
        "curl",
        curlConfigSchema,
        "HTTP Request"
      );
      const result2 = SchemaGenerator.generateFromJobConfig(
        "curl",
        curlConfigSchema,
        "HTTP Request"
      );

      expect(SchemaGenerator.getCacheStats().size).toBe(1);
    });
  });

  describe("Shell Job Schema", () => {
    it("should generate schema for shell config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "shell",
        shellConfigSchema,
        "Shell Command"
      );

      expect(result.requiredFields).toContain("executable");
      expect(result.optionalFields).toContain("parameters");
      expect(result.optionalFields).toContain("workingDirectory");
    });
  });

  describe("Python Job Schema", () => {
    it("should generate schema for python config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "python",
        pythonConfigSchema,
        "Python Script"
      );

      expect(result.requiredFields).toContain("scriptContent");
      expect(result.optionalFields).toContain("requirements");
    });
  });

  describe("SQL Query Job Schema", () => {
    it("should generate schema for SQL query config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "sql_query",
        sqlQueryConfigSchema,
        "SQL Query"
      );

      expect(result.requiredFields).toContain("query");
      expect(result.requiredFields).toContain("credentialId");
      expect(result.optionalFields).toContain("parameters");
      expect(result.optionalFields).toContain("outputMode");
    });
  });

  describe("AI Agent Job Schema", () => {
    it("should generate schema for AI agent config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "ai_agent",
        aiAgentConfigSchema,
        "AI Agent"
      );

      // Core required fields
      expect(result.requiredFields).toContain("credentialId");
      expect(result.requiredFields).toContain("model");
      expect(result.requiredFields).toContain("goal");

      // Many optional configuration fields
      expect(result.optionalFields.length).toBeGreaterThan(5);
    });
  });

  describe("AI API Call Job Schema", () => {
    it("should generate schema for AI API call config", () => {
      const result = SchemaGenerator.generateFromJobConfig(
        "ai_api_call",
        aiApiCallConfigSchema,
        "AI API Call"
      );

      expect(result.requiredFields).toContain("model");
      expect(result.requiredFields).toContain("userPrompt");
      expect(result.optionalFields).toContain("systemPrompt");
      expect(result.optionalFields).toContain("temperature");
    });
  });

  describe("Caching", () => {
    it("should cache generated schemas", () => {
      const schema = z.object({ test: z.string() });

      SchemaGenerator.generateFromJobConfig("test", schema, "Job 1");
      expect(SchemaGenerator.getCacheStats().size).toBe(1);

      SchemaGenerator.generateFromJobConfig("test", schema, "Job 2");
      expect(SchemaGenerator.getCacheStats().size).toBe(2);
    });

    it("should return cached result for identical schemas", () => {
      const schema = z.object({ test: z.string() });

      const result1 = SchemaGenerator.generateFromJobConfig("test", schema, "Same");
      const result2 = SchemaGenerator.generateFromJobConfig("test", schema, "Same");

      // Same reference means it was cached
      expect(result1).toBe(result2);
    });

    it("should clear cache when requested", () => {
      const schema = z.object({ test: z.string() });
      SchemaGenerator.generateFromJobConfig("test", schema);

      expect(SchemaGenerator.getCacheStats().size).toBe(1);

      SchemaGenerator.clearCache();
      expect(SchemaGenerator.getCacheStats().size).toBe(0);
    });
  });

  describe("Metadata Extraction", () => {
    it("should include descriptions when available", () => {
      const schema = z.object({
        url: z.string().describe("The URL to fetch"),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      // The schema itself might have the description
      const parsed = result.schema.safeParse({ url: "http://example.com" });
      expect(parsed.success).toBe(true);
    });

    it("should track examples for enums", () => {
      const schema = z.object({
        color: z.enum(["red", "green", "blue"]),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.metadata["color"].examples).toBeDefined();
      expect(result.metadata["color"].examples?.length).toBeLessThanOrEqual(3);
    });

    it("should preserve default values in metadata", () => {
      const schema = z.object({
        timeout: z.number().default(30),
        retries: z.number().default(3),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.metadata["timeout"].defaultValue).toBe(30);
      expect(result.metadata["retries"].defaultValue).toBe(3);
    });
  });

  describe("createToolSchema helper", () => {
    it("should create tool schema using helper function", () => {
      const schema = z.object({ name: z.string() });

      const result = createToolSchema("test", schema, "Test");

      expect(result.schema).toBeInstanceOf(z.ZodObject);
      expect(result.requiredFields).toContain("name");
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown Zod types gracefully", () => {
      // Create a schema with a custom refinement that might confuse the generator
      const schema = z.object({
        email: z.string().email(),
      });

      // Should not throw
      expect(() => {
        SchemaGenerator.generateFromJobConfig("test", schema);
      }).not.toThrow();
    });

    it("should handle deeply nested structures", () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value: z.string(),
            }),
          }),
        }),
      });

      const result = SchemaGenerator.generateFromJobConfig("test", schema);

      expect(result.schema).toBeInstanceOf(z.ZodObject);
    });
  });
});

describe("GeneratedToolSchema Validation", () => {
  it("should validate against generated curl schema", () => {
    const result = SchemaGenerator.generateFromJobConfig(
      "curl",
      curlConfigSchema,
      "HTTP"
    );

    // Valid input
    const valid = result.schema.safeParse({
      url: "https://api.example.com",
      method: "GET",
    });
    expect(valid.success).toBe(true);

    // Invalid - missing required field
    const invalid = result.schema.safeParse({
      method: "GET",
    });
    expect(invalid.success).toBe(false);
  });

  it("should validate against generated AI agent schema", () => {
    const result = SchemaGenerator.generateFromJobConfig(
      "ai_agent",
      aiAgentConfigSchema,
      "Agent"
    );

    // Valid input with all required fields
    const valid = result.schema.safeParse({
      credentialId: 1,
      model: "gpt-4",
      goal: "Analyze data",
    });
    expect(valid.success).toBe(true);

    // Invalid - missing goal
    const invalid = result.schema.safeParse({
      credentialId: 1,
      model: "gpt-4",
    });
    expect(invalid.success).toBe(false);
  });
});
