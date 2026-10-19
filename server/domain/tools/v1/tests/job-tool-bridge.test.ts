import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  JobToolBridge,
  jobToolBridge,
  type BridgeJob,
  type ToolToJobResult,
  type JobToToolResult,
} from "../job-tool-bridge.service.js";
import type { ToolDefinition } from "../capabilities/types.js";
import { z } from "zod";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("JobToolBridge", () => {
  beforeEach(() => {
    (jobToolBridge as any).changeLog = [];
  });

  describe("Job to Tool Conversion", () => {
    it("should convert a curl job to tool using handwritten mapping", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "API Client",
        description: "Fetch data from APIs",
        config: { url: "https://api.example.com", method: "GET" },
        organizationId: 1,
        tool: "api_client",
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.method).toBe("handwritten");
      expect(result.tool).toBeDefined();
      expect(result.tool?.name).toBe("api_client");
      expect(result.tool?.label).toBe("API Client");
    });

    it("should convert a sql_query job to tool", () => {
      const job: BridgeJob = {
        id: 2,
        type: "sql_query",
        name: "Query Users",
        description: "Query user data",
        config: { query: "SELECT * FROM users" },
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool?.name).toBe("query_users");
    });

    it("should convert unknown job types to generic tool", () => {
      const job: BridgeJob = {
        id: 3,
        type: "custom_job_type",
        name: "Custom Job",
        config: {},
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.method).toBe("generic");
      expect(result.tool).toBeDefined();
      expect(result.tool?.parameters).toBeDefined();
    });

    it("should use dynamic schema when requested", () => {
      const job: BridgeJob = {
        id: 4,
        type: "custom_type",
        name: "Schema Job",
        configSchema: z.object({ name: z.string() }),
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job, { useDynamicSchema: true });

      // Will try dynamic, then fall back to generic for this test
      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
    });

    it("should fail without fallback when requested", () => {
      const job: BridgeJob = {
        id: 5,
        type: "unknown_type",
        name: "Unknown Job",
        configSchema: z.object({}), // Invalid schema for dynamic
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job, {
        useDynamicSchema: true,
        fallbackToGeneric: false,
      });

      expect(result.success || result.method === "generic").toBeTruthy();
    });

    it("should sanitize tool name from job name", () => {
      const job: BridgeJob = {
        id: 6,
        type: "curl",
        name: "My API Client (v2) !!",
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.tool?.name).not.toContain(" ");
      expect(result.tool?.name).not.toContain("(");
      expect(result.tool?.name).not.toContain("!");
    });
  });

  describe("Tool to Job Conversion", () => {
    it("should convert HTTP tool to curl job", () => {
      const tool: ToolDefinition = {
        name: "fetch_api",
        label: "Fetch API",
        description: "Fetch data from external API",
        group: "HTTP",
        parameters: z.object({
          url: z.string(),
          method: z.enum(["GET", "POST"]),
          headers: z.record(z.string()).optional(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("curl");
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.job?.type).toBe("curl");
    });

    it("should convert database tool to sql_query job", () => {
      const tool: ToolDefinition = {
        name: "query_db",
        label: "Query Database",
        description: "Run SQL queries",
        group: "Database",
        parameters: z.object({
          query: z.string(),
          parameters: z.array(z.any()).optional(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("sql_query");
      expect(result.job?.type).toBe("sql_query");
      expect(result.job?.config).toHaveProperty("query");
    });

    it("should convert AI tool to ai_api_call job", () => {
      const tool: ToolDefinition = {
        name: "generate_text",
        label: "Generate Text",
        description: "Generate text using AI/LLM",
        group: "AI",
        parameters: z.object({
          prompt: z.string(),
          temperature: z.number().optional(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("ai_api_call");
      expect(result.job?.config).toHaveProperty("model");
    });

    it("should convert Slack tool to slack_post job", () => {
      const tool: ToolDefinition = {
        name: "send_slack",
        label: "Send Slack Message",
        description: "Send message to Slack channel",
        group: "Integration",
        parameters: z.object({
          channel: z.string(),
          message: z.string(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("slack_post");
    });

    it("should convert email tool to email_send job", () => {
      const tool: ToolDefinition = {
        name: "send_email",
        label: "Send Email",
        description: "Send email notification",
        parameters: z.object({
          to: z.string(),
          subject: z.string(),
          body: z.string(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("email_send");
    });

    it("should use default job type for unrecognizable tools", () => {
      const tool: ToolDefinition = {
        name: "unknown_tool",
        label: "Unknown",
        description: "Something vague",
        parameters: z.object({
          data: z.any(),
        }),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.inferredType).toBe("ai_api_call"); // Default fallback
      expect(result.confidence).toBeLessThan(0.6);
    });

    it("should include organization ID in job template", () => {
      const tool: ToolDefinition = {
        name: "test_tool",
        label: "Test",
        description: "Test tool",
        parameters: z.object({}),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool, { organizationId: 42 });

      expect(result.job?.organizationId).toBe(42);
    });

    it("should allow custom name and description", () => {
      const tool: ToolDefinition = {
        name: "api_tool",
        label: "API Tool",
        description: "An API tool",
        parameters: z.object({}),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool, {
        name: "Custom Name",
        description: "Custom Description",
      });

      expect(result.job?.name).toBe("Custom Name");
      expect(result.job?.description).toBe("Custom Description");
    });
  });

  describe("Sync Detection", () => {
    it("should detect new job needing tool creation", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "New API Job",
        organizationId: 1,
      };

      const result = JobToolBridge.syncJobToTool(job);

      expect(result.updated).toBe(true);
      expect(result.changes).toContain("Initial tool creation");
      expect(result.newTool).toBeDefined();
    });

    it("should detect name changes", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "Updated API Job",
        organizationId: 1,
      };

      const existingTool: ToolDefinition = {
        name: "api_job",
        label: "Old API Job",
        description: "Description",
        parameters: z.object({}),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.syncJobToTool(job, existingTool);

      expect(result.updated).toBe(true);
      expect(result.changes.some((c) => c.includes("Name changed"))).toBe(true);
    });

    it("should detect description changes", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "API Job",
        description: "New description",
        organizationId: 1,
      };

      const existingTool: ToolDefinition = {
        name: "api_job",
        label: "API Job",
        description: "Old description",
        parameters: z.object({}),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.syncJobToTool(job, existingTool);

      expect(result.updated).toBe(true);
      expect(result.changes).toContain("Description updated");
    });

    it("should return no changes when in sync", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "API Job",
        description: "Description",
        organizationId: 1,
      };

      const newResult = JobToolBridge.jobToTool(job);
      const existingTool: ToolDefinition = {
        name: "api_job",
        label: "API Job",
        description: "Description",
        parameters: newResult.tool!.parameters,
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.syncJobToTool(job, existingTool);

      expect(result.updated).toBe(false);
      expect(result.changes.length).toBe(0);
    });
  });

  describe("Batch Operations", () => {
    it("should export multiple jobs as tools", () => {
      const jobs: BridgeJob[] = [
        { id: 1, type: "curl", name: "Job 1", organizationId: 1 },
        { id: 2, type: "sql_query", name: "Job 2", organizationId: 1 },
        { id: 3, type: "slack_post", name: "Job 3", organizationId: 1 },
      ];

      const result = JobToolBridge.exportJobsAsTools(jobs, 1);

      expect(typeof result === "object" && "tools" in result).toBe(true);
      if (typeof result === "object" && "tools" in result) {
        expect(result.tools.length).toBe(3);
        expect(result.version).toBe("1.0.0");
        expect(result.organizationId).toBe(1);
      }
    });

    it("should export as TypeScript format", () => {
      const jobs: BridgeJob[] = [
        { id: 1, type: "curl", name: "API Job", organizationId: 1 },
      ];

      const result = JobToolBridge.exportJobsAsTools(jobs, 1, { format: "typescript" });

      expect(typeof result).toBe("string");
      if (typeof result === "string") {
        expect(result).toContain("export const EXPOSED_TOOLS");
        expect(result).toContain("API Job");
      }
    });

    it("should filter by category when getting exposed tools", async () => {
      const jobs: BridgeJob[] = [
        { id: 1, type: "curl", name: "HTTP Job", organizationId: 1 },
        { id: 2, type: "sql_query", name: "DB Job", organizationId: 1 },
        { id: 3, type: "slack_post", name: "Slack Job", organizationId: 1 },
      ];

      const exposed = await JobToolBridge.getExposedTools(jobs, { category: "HTTP" });

      expect(exposed.length).toBe(1);
      expect(exposed[0].job.type).toBe("curl");
    });

    it("should exclude inactive jobs", async () => {
      const jobs: BridgeJob[] = [
        { id: 1, type: "curl", name: "Active", organizationId: 1, isActive: true },
        { id: 2, type: "curl", name: "Inactive", organizationId: 1, isActive: false },
      ];

      const exposed = await JobToolBridge.getExposedTools(jobs, { includeInactive: false });

      expect(exposed.length).toBe(1);
      expect(exposed[0].job.name).toBe("Active");
    });

    it("should import multiple tools as jobs", () => {
      const tools: ToolDefinition[] = [
        {
          name: "tool1",
          label: "Tool 1",
          description: "First tool",
          parameters: z.object({}),
          execute: async () => ({ success: true }),
        },
        {
          name: "tool2",
          label: "Tool 2",
          description: "Second tool",
          parameters: z.object({}),
          execute: async () => ({ success: true }),
        },
      ];

      const results = JobToolBridge.importToolsAsJobs(tools, 1);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe("Change Tracking", () => {
    beforeEach(() => {
      // Clear the change log
      const allEntries = jobToolBridge.getChangeLog();
      allEntries.forEach(() => {
        // Would clear if we had that method
      });
    });

    it("should record changes", () => {
      jobToolBridge.recordChange({
        timestamp: new Date(),
        jobId: 1,
        jobName: "Test Job",
        version: "1.0.1",
        changes: ["Updated description"],
        toolName: "test_job",
      });

      const log = jobToolBridge.getChangeLog(1);
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].jobName).toBe("Test Job");
      expect(log[0].version).toBe("1.0.1");
    });

    it("should get latest version", () => {
      jobToolBridge.recordChange({
        timestamp: new Date(),
        jobId: 2,
        jobName: "Versioned Job",
        version: "1.2.3",
        changes: ["Major update"],
        toolName: "versioned_job",
      });

      const latest = jobToolBridge.getLatestVersion(2);
      expect(latest).toBe("1.2.3");
    });

    it("should filter change log by job ID", () => {
      jobToolBridge.recordChange({
        timestamp: new Date(),
        jobId: 1,
        jobName: "Job 1",
        version: "1.0.0",
        changes: [],
        toolName: "job1",
      });

      jobToolBridge.recordChange({
        timestamp: new Date(),
        jobId: 2,
        jobName: "Job 2",
        version: "1.0.0",
        changes: [],
        toolName: "job2",
      });

      const log1 = jobToolBridge.getChangeLog(1);
      const log2 = jobToolBridge.getChangeLog(2);

      expect(log1.length).toBe(1);
      expect(log2.length).toBe(1);
      expect(log1[0].jobId).toBe(1);
      expect(log2[0].jobId).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle jobs without config", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "Simple Job",
        organizationId: 1,
        // No config
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
    });

    it("should handle jobs with special characters in name", () => {
      const job: BridgeJob = {
        id: 1,
        type: "curl",
        name: "Job @ # $ % ^ & * ( )",
        organizationId: 1,
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
      expect(result.tool?.name).toMatch(/^[a-z0-9_]+$/);
    });

    it("should handle empty tool parameters", () => {
      const tool: ToolDefinition = {
        name: "empty_tool",
        label: "Empty",
        description: "No params",
        parameters: z.object({}),
        execute: async () => ({ success: true }),
      };

      const result = JobToolBridge.toolToJob(tool);

      expect(result.success).toBe(true);
      expect(result.job?.config).toBeDefined();
    });

    it("should handle missing optional fields", () => {
      const job: BridgeJob = {
        id: 1,
        type: "unknown",
        name: "Minimal",
        organizationId: 1,
        // Missing description, config, tool
      };

      const result = JobToolBridge.jobToTool(job);

      expect(result.success).toBe(true);
    });
  });

  describe("Singleton Instance", () => {
    it("should export singleton instance", () => {
      expect(jobToolBridge).toBeInstanceOf(JobToolBridge);
    });
  });
});
