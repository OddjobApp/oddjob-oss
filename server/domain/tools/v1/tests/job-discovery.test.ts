import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  JobDiscoveryService,
  jobDiscoveryService,
  type CapabilityRequirements,
  type SuggestionContext,
  type JobCapability,
} from "../job-discovery.service.js";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("JobDiscoveryService", () => {
  let service: JobDiscoveryService;

  beforeEach(() => {
    service = new JobDiscoveryService();
    service.clearIndex();
  });

  describe("Capability Definitions", () => {
    it("should return capability for known job types", () => {
      const curlCap = service.getCapability("curl");
      expect(curlCap).toBeDefined();
      expect(curlCap?.category).toBe("http");
      expect(curlCap?.actions).toContain("fetch");
    });

    it("should return undefined for unknown job types", () => {
      const cap = service.getCapability("unknown_job_type");
      expect(cap).toBeUndefined();
    });

    it("should infer capability from job type name", () => {
      const inferred = service.inferCapability("curl_job_123", "HTTP request job");
      expect(inferred.category).toBe("http");
      expect(inferred.actions).toContain("fetch");
    });

    it("should infer capability from description", () => {
      const inferred = service.inferCapability(
        "custom_job",
        "Execute SQL queries against the database"
      );
      expect(inferred.category).toBe("database");
    });

    it("should return unknown capability for unrecognized types", () => {
      const inferred = service.inferCapability("xyz_abc", "Something vague");
      expect(inferred.category).toBe("unknown");
    });
  });

  describe("Job Indexing", () => {
    it("should index a job with inferred capabilities", () => {
      const job = {
        id: 1,
        type: "curl",
        name: "Fetch API Data",
        description: "Fetch data from external API",
        organizationId: 1,
      };

      const entry = service.indexJob(job);

      expect(entry.jobType).toBe("curl");
      expect(entry.name).toBe("Fetch API Data");
      expect(entry.capability.category).toBe("http");
      expect(entry.lastIndexedAt).toBeInstanceOf(Date);
    });

    it("should index multiple jobs", async () => {
      const jobs = [
        { type: "curl", name: "API Job", organizationId: 1 },
        { type: "sql_query", name: "DB Job", organizationId: 1 },
        { type: "slack_post", name: "Notify Job", organizationId: 1 },
      ];

      await service.indexJobs(jobs as any, 1);

      const stats = service.getStats();
      expect(stats.totalJobs).toBe(3);
    });

    it("should track usage score", () => {
      const job = {
        type: "curl",
        name: "Popular Job",
        organizationId: 1,
      };

      const entry = service.indexJob(job, 100);
      expect(entry.usageScore).toBe(100);
    });
  });

  describe("Capability Matching", () => {
    beforeEach(async () => {
      // Index some test jobs
      await service.indexJobs(
        [
          { id: 1, type: "curl", name: "HTTP Client", organizationId: 1 },
          { id: 2, type: "sql_query", name: "DB Query", organizationId: 1 },
          { id: 3, type: "slack_post", name: "Slack Notify", organizationId: 1 },
          { id: 4, type: "ai_agent", name: "AI Worker", organizationId: 1 },
          { id: 5, type: "python", name: "Python Script", organizationId: 1 },
        ],
        1
      );
    });

    it("should find jobs by category", async () => {
      const results = await service.findByCapability(
        { category: "http" },
        1,
        { limit: 10 }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].jobType).toBe("curl");
      expect(results[0].matchReasons).toContain("Category: http");
    });

    it("should find jobs by actions", async () => {
      const results = await service.findByCapability(
        { actions: ["fetch", "get"] },
        1,
        { limit: 10 }
      );

      const curlResult = results.find((r) => r.jobType === "curl");
      expect(curlResult).toBeDefined();
      expect(curlResult?.relevanceScore).toBeGreaterThan(0.5);
    });

    it("should find jobs by input/output types", async () => {
      const results = await service.findByCapability(
        { inputTypes: ["sql"], outputTypes: ["rows"] },
        1,
        { limit: 10 }
      );

      const sqlResult = results.find((r) => r.jobType === "sql_query");
      expect(sqlResult).toBeDefined();
    });

    it("should filter by sideEffects", async () => {
      const results = await service.findByCapability(
        { sideEffects: false },
        1,
        { limit: 10 }
      );

      // Most jobs have side effects, so we should get fewer results
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("should respect match threshold", async () => {
      // Very specific requirements that won't match well
      const results = await service.findByCapability(
        { category: "cloud", actions: ["deploy", "scale"] },
        1,
        { matchThreshold: 0.9, limit: 10 }
      );

      expect(results.length).toBe(0);
    });

    it("should limit results", async () => {
      const results = await service.findByCapability({}, 1, { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return empty for non-existent organization", async () => {
      const results = await service.findByCapability({}, 999, { limit: 10 });
      expect(results.length).toBe(0);
    });
  });

  describe("Semantic Search", () => {
    beforeEach(async () => {
      await service.indexJobs(
        [
          { id: 1, type: "curl", name: "API Client", description: "Fetch from APIs", organizationId: 1 },
          { id: 2, type: "sql_query", name: "Database Query", description: "Run SQL queries", organizationId: 1 },
          { id: 3, type: "slack_post", name: "Slack Notifier", description: "Send Slack messages", organizationId: 1 },
          { id: 4, type: "selenium", name: "Web Scraper", description: "Scrape websites", organizationId: 1 },
          { id: 5, type: "ai_agent", name: "AI Assistant", description: "AI-powered analysis", organizationId: 1 },
        ],
        1
      );
    });

    it("should find jobs by keyword", async () => {
      const results = await service.semanticSearch("fetch api data", 1);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].jobType).toBe("curl");
      expect(results[0].relevanceScore).toBeGreaterThan(0.5);
    });

    it("should find jobs by use case description", async () => {
      const results = await service.semanticSearch("query database records", 1);

      const sqlResult = results.find((r) => r.jobType === "sql_query");
      expect(sqlResult).toBeDefined();
    });

    it("should rank results by relevance", async () => {
      const results = await service.semanticSearch("web scraping", 1);

      expect(results[0].jobType).toBe("selenium");
      expect(results[0].relevanceScore).toBeGreaterThan(results[1]?.relevanceScore || 0);
    });

    it("should return match reasons", async () => {
      const results = await service.semanticSearch("send message", 1);

      expect(results[0].matchReasons.length).toBeGreaterThan(0);
    });

    it("should mark exact matches", async () => {
      const results = await service.semanticSearch("curl", 1);

      const curlResult = results.find((r) => r.jobType === "curl");
      expect(curlResult?.isExactMatch).toBe(true);
    });

    it("should return empty for no matches", async () => {
      const results = await service.semanticSearch("xyz nonexistent abc123", 1);
      expect(results.length).toBe(0);
    });

    it("should limit results", async () => {
      const results = await service.semanticSearch("data", 1, { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Contextual Suggestions", () => {
    beforeEach(async () => {
      await service.indexJobs(
        [
          { id: 1, type: "curl", name: "HTTP Client", organizationId: 1 },
          { id: 2, type: "transformer", name: "Data Transformer", organizationId: 1 },
          { id: 3, type: "sql_query", name: "Database", organizationId: 1 },
          { id: 4, type: "slack_post", name: "Slack", organizationId: 1 },
          { id: 5, type: "selenium", name: "Browser", organizationId: 1 },
          { id: 6, type: "ai_agent", name: "AI", organizationId: 1 },
          { id: 7, type: "python", name: "Python", organizationId: 1 },
          { id: 8, type: "file_writer", name: "File Writer", organizationId: 1 },
        ],
        1
      );
    });

    it("should suggest transformer after curl", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "curl" },
        1,
        { limit: 5 }
      );

      const transformer = suggestions.find((s) => s.jobType === "transformer");
      expect(transformer).toBeDefined();
      expect(transformer?.reason).toContain("Transform");
    });

    it("should suggest sql_query after transformer", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "transformer" },
        1,
        { limit: 5 }
      );

      const sql = suggestions.find((s) => s.jobType === "sql_query");
      expect(sql).toBeDefined();
    });

    it("should suggest notification after python", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "python" },
        1,
        { limit: 5 }
      );

      const slack = suggestions.find((s) => s.jobType === "slack_post");
      expect(slack).toBeDefined();
      expect(slack?.reason).toContain("Notify");
    });

    it("should suggest based on goal", async () => {
      const suggestions = await service.suggestForContext(
        { goal: "analyze data with machine learning" },
        1,
        { limit: 5 }
      );

      const ai = suggestions.find((s) => s.jobType === "ai_agent" || s.jobType === "python");
      expect(ai).toBeDefined();
    });

    it("should not suggest already used jobs", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "curl", usedJobTypes: ["transformer"] },
        1,
        { limit: 5 }
      );

      expect(suggestions.find((s) => s.jobType === "transformer")).toBeUndefined();
    });

    it("should include confidence scores", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "curl" },
        1,
        { limit: 5 }
      );

      expect(suggestions[0].confidence).toBeGreaterThan(0);
      expect(suggestions[0].confidence).toBeLessThanOrEqual(1);
    });

    it("should include suggested input mappings", async () => {
      const suggestions = await service.suggestForContext(
        { currentJobType: "curl" },
        1,
        { limit: 5 }
      );

      const transformer = suggestions.find((s) => s.jobType === "transformer");
      expect(transformer?.suggestedInputMapping).toBeDefined();
    });
  });

  describe("Utility Methods", () => {
    beforeEach(async () => {
      await service.indexJobs(
        [
          { type: "curl", name: "Job 1", organizationId: 1 },
          { type: "sql_query", name: "Job 2", organizationId: 1 },
          { type: "slack_post", name: "Job 3", organizationId: 2 },
        ],
        1
      );

      await service.indexJobs(
        [{ type: "python", name: "Job 4", organizationId: 2 }],
        2
      );
    });

    it("should get available job types for organization", async () => {
      const types = await service.getAvailableJobTypes(1);
      expect(types).toContain("curl");
      expect(types).toContain("sql_query");
      expect(types).not.toContain("python"); // Belongs to org 2
    });

    it("should get job details", async () => {
      const details = await service.getJobDetails("curl", 1);
      expect(details?.jobType).toBe("curl");
      expect(details?.name).toBe("Job 1");
    });

    it("should return undefined for non-existent job", async () => {
      const details = await service.getJobDetails("nonexistent", 1);
      expect(details).toBeUndefined();
    });

    it("should get statistics", () => {
      const stats = service.getStats();
      expect(stats.totalOrganizations).toBe(2);
      expect(stats.totalJobs).toBe(3); // Org 1 only
      expect(stats.jobTypes.length).toBeGreaterThan(0);
    });

    it("should clear specific organization index", async () => {
      service.clearIndex(1);
      const types = await service.getAvailableJobTypes(1);
      expect(types.length).toBe(0);
    });

    it("should clear all indexes", () => {
      service.clearIndex();
      const stats = service.getStats();
      expect(stats.totalOrganizations).toBe(0);
    });
  });

  describe("Singleton Instance", () => {
    it("should export singleton instance", () => {
      expect(jobDiscoveryService).toBeInstanceOf(JobDiscoveryService);
    });
  });
});

describe("Text Similarity", () => {
  // TextSimilarity is tested indirectly through semantic search tests above
  // Additional edge case tests:

  it("should handle empty strings", async () => {
    const service = new JobDiscoveryService();
    await service.indexJobs([{ type: "curl", name: "Test", organizationId: 1 }], 1);

    const results = await service.semanticSearch("", 1);
    expect(results.length).toBe(0);
  });

  it("should handle very long queries", async () => {
    const service = new JobDiscoveryService();
    await service.indexJobs([{ type: "curl", name: "Test", organizationId: 1 }], 1);

    const longQuery = "fetch ".repeat(100) + "api data";
    const results = await service.semanticSearch(longQuery, 1);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle special characters", async () => {
    const service = new JobDiscoveryService();
    await service.indexJobs([{ type: "curl", name: "Test", organizationId: 1 }], 1);

    const results = await service.semanticSearch("fetch @#$%^&*() api", 1);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("Integration Scenarios", () => {
  let service: JobDiscoveryService;

  beforeEach(async () => {
    service = new JobDiscoveryService();
    service.clearIndex();

    // Index a realistic set of jobs
    await service.indexJobs(
      [
        { id: 1, type: "curl", name: "API Client", description: "HTTP requests", organizationId: 1 },
        { id: 2, type: "sql_query", name: "DB Read", description: "Query database", organizationId: 1 },
        { id: 3, type: "sql_query", name: "DB Write", description: "Insert records", organizationId: 1 },
        { id: 4, type: "transformer", name: "Data Transform", description: "Reshape JSON", organizationId: 1 },
        { id: 5, type: "slack_post", name: "Notify Slack", description: "Send messages", organizationId: 1 },
        { id: 6, type: "selenium", name: "Web Scraper", description: "Extract data", organizationId: 1 },
        { id: 7, type: "ai_agent", name: "AI Analyzer", description: "Analyze with AI", organizationId: 1 },
        { id: 8, type: "python", name: "Python Script", description: "Custom logic", organizationId: 1 },
        { id: 9, type: "file_ops", name: "File Manager", description: "File operations", organizationId: 1 },
        { id: 10, type: "folder_import", name: "Import Folder", description: "Import files", organizationId: 1 },
      ],
      1
    );
  });

  it("should support ETL workflow discovery", async () => {
    // Step 1: Find data extraction job
    const extractResults = await service.semanticSearch("fetch external data", 1);
    expect(extractResults[0].jobType).toBe("curl");

    // Step 2: Find transformation job
    const transformResults = await service.findByCapability(
      { category: "flow", actions: ["transform"] },
      1
    );
    expect(transformResults.find((r) => r.jobType === "transformer")).toBeDefined();

    // Step 3: Find storage job
    const storeResults = await service.findByCapability(
      { category: "database", actions: ["write", "insert"] },
      1
    );
    expect(storeResults.find((r) => r.jobType === "sql_query")).toBeDefined();
  });

  it("should support web scraping workflow", async () => {
    // User wants to scrape and analyze
    const suggestions = await service.suggestForContext(
      { currentJobType: "selenium", goal: "analyze scraped content" },
      1
    );

    // Should suggest AI or transformation
    expect(
      suggestions.some((s) => s.jobType === "ai_agent" || s.jobType === "transformer")
    ).toBe(true);
  });

  it("should support notification workflows", async () => {
    // After any data processing, suggest notification
    const suggestions = await service.suggestForContext(
      { currentJobType: "python", goal: "notify team about results" },
      1
    );

    expect(suggestions.find((s) => s.jobType === "slack_post")).toBeDefined();
  });

  it("should help discover unknown job types", async () => {
    // User describes what they need, system finds matching jobs
    const results = await service.semanticSearch("automatically browse website and click buttons", 1);

    expect(results.find((r) => r.jobType === "selenium")).toBeDefined();
  });
});
