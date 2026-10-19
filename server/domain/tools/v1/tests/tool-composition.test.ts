import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ToolCompositionService,
  CompositeToolBuilder,
  VariableResolver,
  ConditionEvaluator,
  createComposite,
  CompositionPatterns,
  type CompositeTool,
  type CompositeStep,
  type InputMapping,
} from "../tool-composition.service.js";
import { jobExecutorRegistry } from "../../../jobs/core/executors/index.js";

// Mock the job service
vi.mock("../../../jobs/job.service.js", () => ({
  jobService: {
    getById: vi.fn(async (id) => ({
      id,
      type: "generic",
      organizationId: 1,
      config: {},
    })),
  },
}));

// Mock the job executor registry
// Using vi.mock only for the path, implementations handled via spy in beforeEach
vi.mock("../../../jobs/core/executors/index.js", () => ({
  jobExecutorRegistry: {
    getExecutor: vi.fn(),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("ToolCompositionService", () => {
  let service: ToolCompositionService;

  beforeEach(() => {
    service = new ToolCompositionService();
    
    // Default executor mock
    vi.mocked(jobExecutorRegistry.getExecutor).mockReturnValue({
      execute: vi.fn(async (job, config) => ({
        success: true,
        output: { success: true, type: job?.type || "generic", config },
        status: "success"
      })),
    } as any);
  });

  describe("Basic Execution", () => {
    it("should execute a single-step composite tool", async () => {
      const composite: CompositeTool = {
        id: "test-1",
        name: "single_step",
        label: "Single Step",
        description: "A simple one-step tool",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: { url: { value: "https://api.example.com" } },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].status).toBe("success");
    });

    it("should execute multiple steps sequentially", async () => {
      const composite: CompositeTool = {
        id: "test-2",
        name: "multi_step",
        label: "Multi Step",
        description: "A multi-step tool",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: { url: { value: "https://api.example.com" } },
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: { data: { fromStep: { stepIndex: 0, field: "success" } } },
          },
          {
            id: "step-2",
            jobId: 3,
            inputMapping: { result: { fromStep: { stepIndex: 1, field: "data" } } },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      expect(result.stepResults).toHaveLength(3);
      expect(result.stepResults.every((r) => r.status === "success")).toBe(true);
    });
  });

  describe("Data Mapping", () => {
    it("should map input values to steps", async () => {
      const composite: CompositeTool = {
        id: "test-3",
        name: "input_mapping",
        label: "Input Mapping",
        description: "Maps input to step",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {
              url: { fromInput: "apiUrl" },
              method: { value: "GET" },
            },
          },
        ],
      };

      const input = { apiUrl: "https://api.example.com/data" };
      const result = await service.execute(composite, input, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      // The input mapping should have been resolved
      expect(result.stepResults[0].status).toBe("success");
    });

    it("should map between steps", async () => {
      const step1Output = { data: "transformed_value", status: "ok" };

      const composite: CompositeTool = {
        id: "test-4",
        name: "step_mapping",
        label: "Step Mapping",
        description: "Maps output from step 0 to step 1",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: { value: { value: "initial" } },
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {
              previousData: { fromStep: { stepIndex: 0, field: "data" } },
            },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      expect(result.stepResults[1].status).toBe("success");
    });

    it("should support template strings", async () => {
      const composite: CompositeTool = {
        id: "test-5",
        name: "template_mapping",
        label: "Template Mapping",
        description: "Uses templates",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {
              url: { template: "https://api.example.com/{{input.endpoint}}" },
            },
          },
        ],
      };

      const input = { endpoint: "users" };
      const result = await service.execute(composite, input, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
    });
  });

  describe("Conditional Execution", () => {
    it("should skip step when condition is false and action is skip", async () => {
      const composite: CompositeTool = {
        id: "test-6",
        name: "conditional_skip",
        label: "Conditional Skip",
        description: "Skips based on condition",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: { shouldRun: { value: false } },
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {},
            condition: {
              expression: "{{step0.output.shouldRun}} === true",
              action: "skip",
            },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      expect(result.stepResults[1].status).toBe("skipped");
    });

    it("should fail step when condition is false and action is fail", async () => {
      const composite: CompositeTool = {
        id: "test-7",
        name: "conditional_fail",
        label: "Conditional Fail",
        description: "Fails based on condition",
        settings: { stopOnError: false },
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {},
            condition: {
              expression: "false",
              action: "fail",
            },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("partial");
      expect(result.stepResults[1].status).toBe("failed");
    });
  });

  describe("Error Handling", () => {
    it("should stop on error by default", async () => {
      // Mock a failing executor
      const { jobExecutorRegistry } = await import("../../../jobs/core/executors/index.js");
      vi.mocked(jobExecutorRegistry.getExecutor).mockReturnValueOnce({
        execute: vi.fn().mockRejectedValue(new Error("Step failed")),
      } as any);

      const composite: CompositeTool = {
        id: "test-8",
        name: "error_stop",
        label: "Error Stop",
        description: "Stops on error",
        settings: { stopOnError: true },
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {},
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("failed");
      expect(result.stepResults[0].status).toBe("failed");
    });

    it("should continue on error when configured", async () => {
      const { jobExecutorRegistry } = await import("../../../jobs/core/executors/index.js");
      vi.mocked(jobExecutorRegistry.getExecutor)
        .mockReturnValueOnce({
          execute: vi.fn().mockRejectedValue(new Error("Step 0 failed")),
        } as any)
        .mockReturnValueOnce({
          execute: vi.fn().mockResolvedValue({ output: { success: true } }),
        } as any);

      const composite: CompositeTool = {
        id: "test-9",
        name: "error_continue",
        label: "Error Continue",
        description: "Continues despite errors",
        settings: { stopOnError: false },
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
            errorHandling: { strategy: "continue" },
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {},
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("partial");
      expect(result.stepResults[0].status).toBe("failed");
      expect(result.stepResults[1].status).toBe("success");
    });

    it("should retry on failure when configured", async () => {
      const executeMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("Retryable error"))
        .mockResolvedValueOnce({ output: { success: true } });

      const { jobExecutorRegistry } = await import("../../../jobs/core/executors/index.js");
      vi.mocked(jobExecutorRegistry.getExecutor).mockReturnValue({
        execute: executeMock,
      } as any);

      const composite: CompositeTool = {
        id: "test-10",
        name: "retry_test",
        label: "Retry Test",
        description: "Retries on failure",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
            errorHandling: {
              strategy: "retry",
              maxRetries: 2,
              retryDelayMs: 10,
            },
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.status).toBe("success");
      expect(result.stepResults[0].status).toBe("success");
      expect(result.stepResults[0].retryCount).toBe(1);
      expect(executeMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("Execution Metadata", () => {
    it("should track execution duration", async () => {
      const composite: CompositeTool = {
        id: "test-11",
        name: "duration_test",
        label: "Duration Test",
        description: "Tests duration tracking",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
          },
        ],
      };

      const startTime = Date.now();
      const result = await service.execute(composite, {}, { organizationId: 1 } as any);
      const endTime = Date.now();

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeLessThanOrEqual(endTime - startTime + 100);
      expect(result.metadata.stepsCompleted).toBe(1);
      expect(result.metadata.stepsFailed).toBe(0);
    });

    it("should include step-by-step results", async () => {
      const composite: CompositeTool = {
        id: "test-12",
        name: "detailed_results",
        label: "Detailed Results",
        description: "Tests detailed result tracking",
        steps: [
          {
            id: "step-0",
            jobId: 1,
            inputMapping: {},
          },
          {
            id: "step-1",
            jobId: 2,
            inputMapping: {},
          },
        ],
      };

      const result = await service.execute(composite, {}, { organizationId: 1 } as any);

      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].stepId).toBe("step-0");
      expect(result.stepResults[1].stepId).toBe("step-1");
      expect(result.stepResults[0].startedAt).toBeInstanceOf(Date);
      expect(result.stepResults[0].completedAt).toBeInstanceOf(Date);
    });
  });
});

describe("VariableResolver", () => {
  describe("Template Resolution", () => {
    it("should resolve {{input.field}} references", () => {
      const template = "Hello {{input.name}}!";
      const context = {
        input: { name: "World" },
        stepResults: new Map(),
      };

      const result = VariableResolver.resolveTemplate(template, context);
      expect(result).toBe("Hello World!");
    });

    it("should resolve {{stepN.output.field}} references", () => {
      const template = "Result: {{step0.output.value}}";
      const stepResults = new Map([
        ["step-0", { output: { value: 42 }, status: "success" } as any],
      ]);
      const context = {
        input: {},
        stepResults,
      };

      const result = VariableResolver.resolveTemplate(template, context);
      expect(result).toBe("Result: 42");
    });

    it("should resolve {{stepN.output}} for entire output", () => {
      const template = "Data: {{step0.output}}";
      const stepResults = new Map([
        ["step-0", { output: { a: 1, b: 2 }, status: "success" } as any],
      ]);
      const context = {
        input: {},
        stepResults,
      };

      const result = VariableResolver.resolveTemplate(template, context);
      expect(result).toBe('Data: {"a":1,"b":2}');
    });

    it("should handle multiple variables in one template", () => {
      const template = "{{input.greeting}} {{input.name}}! Count: {{step0.output.count}}";
      const stepResults = new Map([
        ["step-0", { output: { count: 5 }, status: "success" } as any],
      ]);
      const context = {
        input: { greeting: "Hello", name: "User" },
        stepResults,
      };

      const result = VariableResolver.resolveTemplate(template, context);
      expect(result).toBe("Hello User! Count: 5");
    });

    it("should leave unknown variables unchanged", () => {
      const template = "{{input.unknown}} and {{step99.output.missing}}";
      const context = {
        input: {},
        stepResults: new Map(),
      };

      const result = VariableResolver.resolveTemplate(template, context);
      expect(result).toBe("{{input.unknown}} and {{step99.output.missing}}");
    });
  });

  describe("Input Mapping Resolution", () => {
    it("should resolve direct values", () => {
      const mapping: InputMapping = { value: "direct_value" };
      const context = { input: {}, stepResults: new Map() };

      const result = VariableResolver.resolveMapping(mapping, context);
      expect(result).toBe("direct_value");
    });

    it("should resolve from input", () => {
      const mapping: InputMapping = { fromInput: "userId" };
      const context = { input: { userId: 123 }, stepResults: new Map() };

      const result = VariableResolver.resolveMapping(mapping, context);
      expect(result).toBe(123);
    });

    it("should resolve from previous step", () => {
      const mapping: InputMapping = { fromStep: { stepIndex: 0, field: "data.id" } };
      const stepResults = new Map([
        ["step-0", { output: { data: { id: "abc123" } }, status: "success" } as any],
      ]);
      const context = { input: {}, stepResults };

      const result = VariableResolver.resolveMapping(mapping, context);
      expect(result).toBe("abc123");
    });

    it("should resolve templates", () => {
      const mapping: InputMapping = { template: "User: {{input.username}}" };
      const context = { input: { username: "john_doe" }, stepResults: new Map() };

      const result = VariableResolver.resolveMapping(mapping, context);
      expect(result).toBe("User: john_doe");
    });

    it("should build complete step input from mappings", () => {
      const step: CompositeStep = {
        id: "step-0",
        jobId: 1,
        inputMapping: {
          url: { value: "https://api.example.com" },
          method: { fromInput: "httpMethod" },
          body: { template: '{"id": {{input.userId}}}' },
        },
      };
      const context = {
        input: { httpMethod: "POST", userId: 42 },
        stepResults: new Map(),
      };

      const result = VariableResolver.buildStepInput(step, context);
      expect(result).toEqual({
        url: "https://api.example.com",
        method: "POST",
        body: '{"id": 42}',
      });
    });
  });
});

describe("ConditionEvaluator", () => {
  describe("Basic Comparisons", () => {
    it("should evaluate equality with ===", () => {
      const context = { input: { status: "active" }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.status === 'active'", context);
      expect(result).toBe(true);
    });

    it("should evaluate inequality with !==", () => {
      const context = { input: { status: "inactive" }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.status !== 'active'", context);
      expect(result).toBe(true);
    });

    it("should evaluate greater than", () => {
      const context = { input: { count: 10 }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.count > 5", context);
      expect(result).toBe(true);
    });

    it("should evaluate less than", () => {
      const context = { input: { count: 3 }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.count < 5", context);
      expect(result).toBe(true);
    });
  });

  describe("Step Output Comparisons", () => {
    it("should evaluate against step output", () => {
      const stepResults = new Map([
        ["step-0", { output: { success: true }, status: "success" } as any],
      ]);
      const context = { input: {}, stepResults };
      const result = ConditionEvaluator.evaluate("steps.0.success === true", context);
      expect(result).toBe(true);
    });

    it("should evaluate step output equality", () => {
      const stepResults = new Map([
        ["step-0", { output: { status: "ok" }, status: "success" } as any],
      ]);
      const context = { input: {}, stepResults };
      const result = ConditionEvaluator.evaluate("steps.0.status === 'ok'", context);
      expect(result).toBe(true);
    });
  });

  describe("Truthiness", () => {
    it("should check truthy values", () => {
      const context = { input: { value: "hello" }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.value", context);
      expect(result).toBe(true);
    });

    it("should check falsy values with negation", () => {
      const context = { input: { value: null }, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("!input.value", context);
      expect(result).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should return false for invalid expressions", () => {
      const context = { input: {}, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("invalid syntax here @#$", context);
      expect(result).toBe(false);
    });

    it("should handle missing paths gracefully", () => {
      const context = { input: {}, stepResults: new Map() };
      const result = ConditionEvaluator.evaluate("input.nonexistent === 'value'", context);
      expect(result).toBe(false);
    });
  });
});

describe("CompositeToolBuilder", () => {
  it("should build a simple composite tool", () => {
    const composite = new CompositeToolBuilder("test-1", "simple_tool")
      .label("Simple Tool")
      .description("A simple test tool")
      .group("Test")
      .step(1, { url: { value: "https://api.example.com" } })
      .build();

    expect(composite.id).toBe("test-1");
    expect(composite.name).toBe("simple_tool");
    expect(composite.label).toBe("Simple Tool");
    expect(composite.description).toBe("A simple test tool");
    expect(composite.group).toBe("Test");
    expect(composite.steps).toHaveLength(1);
  });

  it("should support fluent API chaining", () => {
    const composite = createComposite("chain-test", "chained_tool")
      .label("Chained Tool")
      .description("Testing chain methods")
      .group("Development")
      .step(1, { a: { value: 1 } }, "First step")
      .step(2, { b: { fromStep: { stepIndex: 0, field: "a" } } }, "Second step")
      .step(3, { c: { template: "Result: {{step1.output}}" } }, "Third step")
      .tags("test", "chain", "demo")
      .settings({ stopOnError: false, enableParallelism: true })
      .outputFormat("JSON object with result")
      .build();

    expect(composite.steps).toHaveLength(3);
    expect(composite.metadata?.tags).toEqual(["test", "chain", "demo"]);
    expect(composite.settings?.stopOnError).toBe(false);
    expect(composite.outputFormat).toBe("JSON object with result");
  });

  it("should auto-generate labels and descriptions if not provided", () => {
    const composite = createComposite("minimal", "minimal_tool").step(1, {}).build();

    expect(composite.label).toBe("minimal_tool");
    expect(composite.description).toBe("Composite tool: minimal_tool");
  });

  it("should support complex step configurations", () => {
    const composite = createComposite("complex", "complex_tool")
      .addStep({
        jobId: 1,
        description: "API call with retry",
        inputMapping: { url: { value: "https://api.example.com" } },
        errorHandling: {
          strategy: "retry",
          maxRetries: 3,
          retryDelayMs: 1000,
        },
        timeoutMs: 30000,
        parallel: false,
      })
      .addStep({
        jobId: 2,
        description: "Conditional processing",
        inputMapping: { data: { fromStep: { stepIndex: 0, field: "response" } } },
        condition: {
          expression: "{{step0.output.status}} === 200",
          action: "skip",
        },
        dependsOn: ["step-0"],
      })
      .build();

    expect(composite.steps[0].errorHandling?.strategy).toBe("retry");
    expect(composite.steps[0].errorHandling?.maxRetries).toBe(3);
    expect(composite.steps[1].condition?.action).toBe("skip");
    expect(composite.steps[1].dependsOn).toEqual(["step-0"]);
  });
});

describe("CompositionPatterns", () => {
  it("should create a data pipeline pattern", () => {
    const pipeline = CompositionPatterns.dataPipeline("user_sync", {
      fetchJobId: 1,
      transformJobId: 2,
      saveJobId: 3,
      apiUrlMapping: { fromInput: "apiUrl" },
      transformRulesMapping: { value: [{ source: "name", target: "user_name" }] },
      targetTableMapping: { fromInput: "table" },
    });

    expect(pipeline.name).toBe("user_sync");
    expect(pipeline.steps).toHaveLength(3);
    expect(pipeline.group).toBe("Data Pipeline");
  });

  it("should create a web scrape pattern", () => {
    const scraper = CompositionPatterns.webScrapeNotify("price_monitor", {
      seleniumJobId: 1,
      transformJobId: 2,
      notifyJobId: 3,
      urlMapping: { fromInput: "productUrl" },
      channelMapping: { value: "#alerts" },
    });

    expect(scraper.name).toBe("price_monitor");
    expect(scraper.steps).toHaveLength(3);
    expect(scraper.group).toBe("Web Automation");
  });
});

describe("Integration Examples", () => {
  let service: ToolCompositionService;

  beforeEach(() => {
    service = new ToolCompositionService();
  });

  it("should handle a real-world ETL scenario", async () => {
    // ETL: Extract from API → Transform → Load to Database → Notify
    const etlPipeline = createComposite("etl-1", "daily_sync")
      .label("Daily Data Sync")
      .description("Extract data from external API, transform, and load to database")
      .group("ETL")
      .step(101, {
        url: { fromInput: "sourceApi" },
        method: { value: "GET" },
        headers: { value: { Authorization: "Bearer token123" } },
      }, "Fetch from API")
      .step(102, {
        input: { fromStep: { stepIndex: 0, field: "data" } },
        rules: { value: [{ sourcePath: "$.users", targetPath: "$.customers" }] },
      }, "Transform data")
      .step(103, {
        query: {
          template: "INSERT INTO {{input.table}} SELECT * FROM json_array({{step1.output}})",
        },
      }, "Load to database")
      .step(104, {
        channel: { value: "#data-team" },
        message: {
          template: "ETL complete: {{step2.output.rowsInserted}} rows inserted",
        },
      }, "Notify team")
      .build();

    const input = {
      sourceApi: "https://api.company.com/daily-data",
      table: "daily_imports",
    };

    const result = await service.execute(etlPipeline, input, { organizationId: 1 } as any);

    if (result.status === "failed") {
      console.error("ETL scenario failed:", result.error);
      console.error("Step results:", JSON.stringify(result.stepResults, null, 2));
    }
    expect(result.status).toBe("success");
    expect(result.stepResults).toHaveLength(4);
    expect(result.metadata.stepsCompleted).toBe(4);
  });

  it("should handle conditional branching based on data quality", async () => {
    // Data quality check with conditional notification
    const qualityPipeline = createComposite("quality-1", "data_quality_check")
      .label("Data Quality Check")
      .description("Validate data quality and notify if issues found")
      .group("Quality")
      .step(201, {
        query: { fromInput: "validationQuery" },
      }, "Run validation query")
      .step(202, {
        channel: { value: "#data-quality" },
        message: {
          template: "Data quality issues found: {{step0.output.issues}}",
        },
      }, "Notify on issues")
      .settings({ stopOnError: false })
      .build();

    // Modify step 1 to add condition
    qualityPipeline.steps[1].condition = {
      expression: "{{step0.output.issues}} > 0",
      action: "skip",
    };

    const input = { validationQuery: "SELECT COUNT(*) as issues FROM bad_records" };

    const result = await service.execute(qualityPipeline, input, { organizationId: 1 } as any);

    if (result.status === "failed") {
      console.error("Branching scenario failed:", result.error);
      console.error("Step results:", JSON.stringify(result.stepResults, null, 2));
    }
    expect(result.status).toBe("success");
    // Second step should be skipped if no issues
    expect(result.stepResults[1].status).toBe("skipped");
  });
});
