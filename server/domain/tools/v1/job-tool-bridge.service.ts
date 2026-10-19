import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./capabilities/types.js";
import { JobToToolMapper } from "./job-to-tool-mapper.js";
import { SchemaGenerator } from "./schema-generator.service.js";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("JobToolBridge");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Represents a Job in the bridge context
 */
export interface BridgeJob {
  id: number;
  type: string;
  name: string;
  description?: string;
  config?: any;
  organizationId: number;
  tool?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  configSchema?: z.ZodSchema;
}

/**
 * Result of Job → Tool conversion
 */
export interface JobToToolResult {
  success: boolean;
  tool?: ToolDefinition;
  error?: string;
  method: "handwritten" | "dynamic" | "generic";
  warnings?: string[];
}

/**
 * Result of Tool → Job conversion
 */
export interface ToolToJobResult {
  success: boolean;
  job?: Partial<InsertJobTemplate>;
  inferredType: string;
  confidence: number;
  error?: string;
  warnings?: string[];
}

/**
 * Job template for creating new jobs
 */
export interface InsertJobTemplate {
  type: string;
  name: string;
  description: string;
  config: any;
  organizationId: number;
  isActive: boolean;
  tool?: string;
}

/**
 * Sync detection result
 */
export interface SyncResult {
  updated: boolean;
  changes: string[];
  newTool?: ToolDefinition;
  previousVersion?: string;
  currentVersion?: string;
}

/**
 * Export/import format
 */
export interface ToolExport {
  version: string;
  exportedAt: Date;
  organizationId: number;
  tools: Array<{
    name: string;
    label: string;
    description: string;
    group?: string;
    parameters: any; // Serialized Zod schema
    inferredJobType: string;
  }>;
}

/**
 * Change log entry
 */
export interface ChangeLogEntry {
  timestamp: Date;
  jobId: number;
  jobName: string;
  version: string;
  changes: string[];
  toolName: string;
}

// ============================================================================
// JOB TYPE INFERENCE
// ============================================================================

/**
 * Maps tool characteristics to job types
 */
const TOOL_TO_JOB_TYPE_MAPPING: Array<{
  patterns: string[];
  jobType: string;
  confidence: number;
  configGenerator: (tool: ToolDefinition) => any;
}> = [
  {
    patterns: ["http", "api", "fetch", "request", "url", "endpoint"],
    jobType: "curl",
    confidence: 0.95,
    configGenerator: (tool) => ({
      url: "{{input.url}}",
      method: "{{input.method || 'GET'}}",
      headers: "{{input.headers}}",
      body: "{{input.body}}",
    }),
  },
  {
    patterns: ["sql", "query", "database", "db", "select", "insert"],
    jobType: "sql_query",
    confidence: 0.95,
    configGenerator: (tool) => ({
      query: "{{input.query}}",
      parameters: "{{input.parameters}}",
      outputMode: "list",
    }),
  },
  {
    patterns: ["ai", "llm", "gpt", "generate", "prompt", "completion", "chat"],
    jobType: "ai_api_call",
    confidence: 0.9,
    configGenerator: (tool) => ({
      model: "gpt-4",
      userPrompt: "{{input.prompt || input.text}}",
      temperature: 0.7,
    }),
  },
  {
    patterns: ["agent", "autonomous", "reason", "plan", "decide"],
    jobType: "ai_agent",
    confidence: 0.9,
    configGenerator: (tool) => ({
      model: "gpt-4",
      goal: "{{input.goal || input.task}}",
      persona: "generic",
      maxIterations: 10,
    }),
  },
  {
    patterns: ["slack", "message", "chat", "notify"],
    jobType: "slack_post",
    confidence: 0.95,
    configGenerator: (tool) => ({
      channelId: "{{input.channel}}",
      message: "{{input.message}}",
    }),
  },
  {
    patterns: ["email", "mail", "send"],
    jobType: "email_send",
    confidence: 0.95,
    configGenerator: (tool) => ({
      to: "{{input.to}}",
      subject: "{{input.subject}}",
      body: "{{input.body || input.message}}",
      isHtml: false,
    }),
  },
  {
    patterns: ["scrape", "browser", "web", "selenium", "extract"],
    jobType: "selenium",
    confidence: 0.9,
    configGenerator: (tool) => ({
      startUrl: "{{input.url}}",
      goal: "{{input.goal || 'Extract data'}}",
      mode: "auto_pilot",
    }),
  },
  {
    patterns: ["transform", "map", "convert", "reshape"],
    jobType: "transformer",
    confidence: 0.85,
    configGenerator: (tool) => ({
      rules: "{{input.rules || input.mappings}}",
      inputSource: "provided",
    }),
  },
  {
    patterns: ["file", "read", "write", "save", "load"],
    jobType: "file_ops",
    confidence: 0.8,
    configGenerator: (tool) => ({
      operation: "read",
      sourcePath: "{{input.path || input.file}}",
    }),
  },
  {
    patterns: ["python", "script", "code", "execute"],
    jobType: "python",
    confidence: 0.9,
    configGenerator: (tool) => ({
      scriptContent: "{{input.script || input.code}}",
      requirements: "{{input.requirements}}",
    }),
  },
  {
    patterns: ["shell", "bash", "command", "execute"],
    jobType: "shell",
    confidence: 0.9,
    configGenerator: (tool) => ({
      executable: "{{input.command || input.executable}}",
      parameters: "{{input.parameters || input.args}}",
    }),
  },
];

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * JobToolBridge
 *
 * Provides bidirectional conversion between Jobs and Tools.
 * Enables seamless exposure of jobs as tools and persistence of tools as jobs.
 */
export class JobToolBridge {
  private changeLog: ChangeLogEntry[] = [];
  private maxChangeLogSize = 1000;

  /**
   * Convert a Job to a Tool
   *
   * @param job - The job to convert
   * @param options - Conversion options
   * @returns JobToToolResult with the tool definition
   */
  static jobToTool(
    job: BridgeJob,
    options: {
      useDynamicSchema?: boolean;
      fallbackToGeneric?: boolean;
    } = {}
  ): JobToToolResult {
    const { useDynamicSchema = false, fallbackToGeneric = true } = options;
    const warnings: string[] = [];

    try {
      // Method 1: Try handwritten mapping (most accurate)
      if (JobToToolMapper.hasHandwrittenMapping?.(job.type)) {
        const tool = JobToToolMapper.mapJobToTool(job);
        return {
          success: true,
          tool,
          method: "handwritten",
          warnings,
        };
      }

      // Method 2: Dynamic schema generation
      if (useDynamicSchema && job.configSchema) {
        try {
          const generated = SchemaGenerator.generateFromJobConfig(
            job.type,
            job.configSchema,
            job.name
          );

          const tool = this.buildToolFromGeneratedSchema(job, generated);
          return {
            success: true,
            tool,
            method: "dynamic",
            warnings,
          };
        } catch (error) {
          warnings.push(`Dynamic schema generation failed: ${error}`);
          if (!fallbackToGeneric) {
            return {
              success: false,
              error: `Failed to generate dynamic schema: ${error}`,
              method: "dynamic",
              warnings,
            };
          }
        }
      }

      // Method 3: Generic fallback
      if (fallbackToGeneric) {
        const tool = this.buildGenericTool(job);
        return {
          success: true,
          tool,
          method: "generic",
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

      return {
        success: false,
        error: "No conversion method available for this job type",
        method: "generic",
        warnings,
      };
    } catch (error) {
      logger.error(`Error converting job to tool: ${job.name}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        method: "generic",
        warnings,
      };
    }
  }

  /**
   * Convert a Tool to a Job template
   *
   * @param tool - The tool definition to convert
   * @param options - Conversion options
   * @returns ToolToJobResult with job template
   */
  static toolToJob(
    tool: ToolDefinition,
    options: {
      organizationId?: number;
      name?: string;
      description?: string;
    } = {}
  ): ToolToJobResult {
    const warnings: string[] = [];

    try {
      // Infer job type from tool characteristics
      const { jobType, confidence, config } = this.inferJobType(tool);

      const jobTemplate: Partial<InsertJobTemplate> = {
        type: jobType,
        name: options.name || tool.label || tool.name,
        description: options.description || tool.description || `Tool: ${tool.name}`,
        config,
        organizationId: options.organizationId != null ? assertOrgId(options.organizationId) : undefined,
        isActive: true,
        tool: tool.name,
      };

      return {
        success: true,
        job: jobTemplate,
        inferredType: jobType,
        confidence,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      logger.error(`Error converting tool to job: ${tool.name}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        inferredType: "unknown",
        confidence: 0,
        warnings,
      };
    }
  }

  /**
   * Detect changes between a job and its existing tool representation
   *
   * @param job - Current job state
   * @param existingTool - Previously generated tool (optional)
   * @returns SyncResult with detected changes
   */
  static syncJobToTool(job: BridgeJob, existingTool?: ToolDefinition): SyncResult {
    const changes: string[] = [];

    if (!existingTool) {
      // New job - needs full conversion
      const result = this.jobToTool(job);
      if (result.success && result.tool) {
        return {
          updated: true,
          changes: ["Initial tool creation"],
          newTool: result.tool,
          currentVersion: "1.0.0",
        };
      }
      return {
        updated: false,
        changes: ["Failed to create tool"],
      };
    }

    // Check for changes
    const currentHash = this.hashJobConfig(job.config);

    // Compare name
    if (existingTool.label !== job.name) {
      changes.push(`Name changed: "${existingTool.label}" → "${job.name}"`);
    }

    // Compare description
    if (existingTool.description !== job.description) {
      changes.push("Description updated");
    }

    // Compare parameters (simplified check)
    const newResult = this.jobToTool(job);
    if (newResult.success && newResult.tool) {
      const newTool = newResult.tool;

      // Check if parameter schema changed (compare shape keys)
      const existingShape = this.getSchemaShape(existingTool.parameters);
      const newShape = this.getSchemaShape(newTool.parameters);

      if (JSON.stringify(existingShape) !== JSON.stringify(newShape)) {
        changes.push("Parameter schema changed");
      }

      if (changes.length > 0) {
        return {
          updated: true,
          changes,
          newTool,
          previousVersion: "1.0.0", // Would be tracked in practice
          currentVersion: "1.0.1",
        };
      }
    }

    return {
      updated: false,
      changes: [],
    };
  }

  /**
   * Export all exposed tools from an organization
   */
  static async getExposedTools(
    jobs: BridgeJob[],
    options: {
      includeInactive?: boolean;
      category?: string;
    } = {}
  ): Promise<Array<{ job: BridgeJob; tool: ToolDefinition; method: string }>> {
    const { includeInactive = false, category } = options;

    const results: Array<{ job: BridgeJob; tool: ToolDefinition; method: string }> = [];

    for (const job of jobs) {
      if (!includeInactive && job.isActive === false) continue;
      if (category && !this.jobMatchesCategory(job, category)) continue;

      const result = this.jobToTool(job);
      if (result.success && result.tool) {
        results.push({ job, tool: result.tool, method: result.method });
      }
    }

    return results;
  }

  /**
   * Batch export jobs to tool definitions
   */
  static exportJobsAsTools(
    jobs: BridgeJob[],
    organizationId: number,
    options: {
      format?: "json" | "typescript";
      includeMetadata?: boolean;
    } = {}
  ): ToolExport | string {
    const { format = "json", includeMetadata = true } = options;

    const exportData: ToolExport = {
      version: "1.0.0",
      exportedAt: new Date(),
      organizationId,
      tools: [],
    };

    for (const job of jobs) {
      const result = this.jobToTool(job);
      if (result.success && result.tool) {
        const tool = result.tool;

        exportData.tools.push({
          name: tool.name,
          label: tool.label || tool.name,
          description: tool.description || `${job.type} job`,
          group: tool.group || "Jobs",
          parameters: this.serializeSchema(tool.parameters),
          inferredJobType: job.type,
        });
      }
    }

    if (format === "typescript") {
      return this.generateTypeScriptExport(exportData);
    }

    return exportData;
  }

  /**
   * Batch import tools as jobs
   */
  static importToolsAsJobs(
    tools: ToolDefinition[],
    organizationId: number,
    options: {
      validateOnly?: boolean;
    } = {}
  ): Array<ToolToJobResult & { toolName: string }> {
    const results: Array<ToolToJobResult & { toolName: string }> = [];

    for (const tool of tools) {
      const result = this.toolToJob(tool, { organizationId });
      results.push({ ...result, toolName: tool.name });
    }

    return results;
  }

  // ============================================================================
  // INSTANCE METHODS (for change tracking)
  // ============================================================================

  /**
   * Record a change in the change log
   */
  recordChange(entry: ChangeLogEntry): void {
    this.changeLog.unshift(entry);

    // Prune old entries
    if (this.changeLog.length > this.maxChangeLogSize) {
      this.changeLog = this.changeLog.slice(0, this.maxChangeLogSize);
    }

    logger.debug(`Recorded change: ${entry.jobName} v${entry.version}`);
  }

  /**
   * Get change log for a job
   */
  getChangeLog(jobId?: number): ChangeLogEntry[] {
    if (jobId) {
      return this.changeLog.filter((entry) => entry.jobId === jobId);
    }
    return [...this.changeLog];
  }

  /**
   * Get latest version for a job
   */
  getLatestVersion(jobId: number): string | undefined {
    const entries = this.changeLog.filter((e) => e.jobId === jobId);
    return entries[0]?.version;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private static buildToolFromGeneratedSchema(
    job: BridgeJob,
    generated: any
  ): ToolDefinition {
    return {
      name: job.tool || job.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      label: job.name,
      description: job.description || `${job.type} job`,
      group: this.inferToolGroup(job.type),
      parameters: generated.schema,
      execute: async (params: any, context: ToolContext) => {
        // This would be connected to actual job execution
        logger.info(`Executing tool for job ${job.id}`, { params });
        return {
          success: true,
          output: { message: `Executed ${job.name}`, params },
        };
      },
    };
  }

  private static buildGenericTool(job: BridgeJob): ToolDefinition {
    return {
      name: job.tool || job.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      label: job.name,
      description: job.description || `${job.type} job`,
      group: this.inferToolGroup(job.type),
      parameters: z.object({
        input: z.string().describe("Input parameters as JSON string"),
      }),
      execute: async (params: any, context: ToolContext) => {
        logger.info(`Executing generic tool for job ${job.id}`);
        return {
          success: true,
          output: { jobId: job.id, jobType: job.type, input: params.input },
        };
      },
    };
  }

  private static inferJobType(tool: ToolDefinition): {
    jobType: string;
    confidence: number;
    config: any;
  } {
    const toolText = `${tool.name} ${tool.label} ${tool.description} ${tool.group || ""}`.toLowerCase();
    const paramText = JSON.stringify(tool.parameters).toLowerCase();

    let bestMatch = { jobType: "ai_api_call", confidence: 0.5, config: {} };

    for (const mapping of TOOL_TO_JOB_TYPE_MAPPING) {
      let matchScore = 0;

      for (const pattern of mapping.patterns) {
        if (toolText.includes(pattern)) matchScore += 0.3;
        if (paramText.includes(pattern)) matchScore += 0.2;
      }

      if (matchScore > bestMatch.confidence) {
        bestMatch = {
          jobType: mapping.jobType,
          confidence: Math.min(matchScore, mapping.confidence),
          config: mapping.configGenerator(tool),
        };
      }
    }

    return bestMatch;
  }

  private static inferToolGroup(jobType: string): string {
    const groups: Record<string, string> = {
      curl: "HTTP",
      api: "HTTP",
      sql_query: "Database",
      ai_agent: "AI",
      ai_api_call: "AI",
      slack_post: "Integration",
      email_send: "Integration",
      selenium: "Automation",
      file_ops: "File System",
      transformer: "Data",
      python: "Scripting",
      shell: "Scripting",
    };

    return groups[jobType] || "Jobs";
  }

  private static jobMatchesCategory(job: BridgeJob, category: string): boolean {
    const group = this.inferToolGroup(job.type);
    return group.toLowerCase() === category.toLowerCase();
  }

  private static hashJobConfig(config: any): string {
    try {
      return JSON.stringify(config);
    } catch {
      return String(config);
    }
  }

  private static getSchemaShape(schema: z.ZodSchema): string[] {
    try {
      // Extract top-level keys from schema
      if (schema instanceof z.ZodObject) {
        return Object.keys(schema.shape).sort();
      }
      return ["unknown"];
    } catch {
      return ["unknown"];
    }
  }

  private static serializeSchema(schema: z.ZodSchema): any {
    // Simplified schema serialization
    try {
      if (schema instanceof z.ZodObject) {
        const shape: Record<string, string> = {};
        for (const [key, value] of Object.entries(schema.shape)) {
          shape[key] = this.describeZodType(value as z.ZodSchema);
        }
        return shape;
      }
      return { type: "unknown" };
    } catch {
      return { type: "unknown" };
    }
  }

  private static describeZodType(schema: z.ZodSchema): string {
    if (schema instanceof z.ZodString) return "string";
    if (schema instanceof z.ZodNumber) return "number";
    if (schema instanceof z.ZodBoolean) return "boolean";
    if (schema instanceof z.ZodArray) return "array";
    if (schema instanceof z.ZodObject) return "object";
    if (schema instanceof z.ZodOptional) return "optional";
    return "unknown";
  }

  private static generateTypeScriptExport(exportData: ToolExport): string {
    const lines = [
      `// Auto-generated tool exports from Oddjob`,
      `// Exported: ${exportData.exportedAt.toISOString()}`,
      `// Organization: ${exportData.organizationId}`,
      ``,
      `export const EXPOSED_TOOLS = {`,
    ];

    for (const tool of exportData.tools) {
      lines.push(`  // ${tool.label}`);
      lines.push(`  ${tool.name}: {`);
      lines.push(`    description: "${tool.description}",`);
      lines.push(`    group: "${tool.group || "Tools"}",`);
      lines.push(`    parameters: ${JSON.stringify(tool.parameters, null, 2).replace(/\n/g, "\n    ")},`);
      lines.push(`  },`);
    }

    lines.push(`};`);
    lines.push(``);
    lines.push(`export default EXPOSED_TOOLS;`);

    return lines.join("\n");
  }
}

// ============================================================================
// EXTEND JOB TO TOOL MAPPER
// ============================================================================

// JobToToolMapper.hasHandwrittenMapping is now public

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const jobToolBridge = new JobToolBridge();
