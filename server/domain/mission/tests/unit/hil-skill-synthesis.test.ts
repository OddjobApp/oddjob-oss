// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    selectResults: [] as any[],
    insertedSkill: null as any,
    insertedVersion: null as any,
    updatedApproval: null as any,
    aiClientExecute: vi.fn(),
    resolveOrgTextAiKey: vi.fn(),
  };
});

vi.mock("@server/database_service.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => hoisted.selectResults.shift() || [],
          }),
          limit: () => hoisted.selectResults.shift() || [],
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        const row = { id: 101, ...values, createdAt: new Date(), updatedAt: new Date() };
        if (values.language) {
          hoisted.insertedSkill = row;
        } else if (values.source) {
          hoisted.insertedVersion = row;
        }
        return {
          returning: () => [row],
        };
      },
    }),
    update: () => ({
      set: (values: any) => {
        hoisted.updatedApproval = values;
        return {
          where: () => ({
            returning: () => [values],
          }),
        };
      },
    }),
  },
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
  AIClientFactory: {
    getClient: () => ({
      execute: hoisted.aiClientExecute,
    }),
  },
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({
      provider: "google",
      model: "gemini-2.0-flash",
      apiKey: "test-api-key",
    }),
  },
}));

vi.mock("@domain/ai/core/org-gemini-key.js", () => ({
  resolveOrgTextAiKey: hoisted.resolveOrgTextAiKey,
  developmentProviderKey: () => "test-dev-key",
}));

import { skillGeneratorService } from "../../core/skill-generator.service.js";

describe("SkillGeneratorService - HIL Skill Synthesis (O3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.selectResults = [];
    hoisted.insertedSkill = null;
    hoisted.insertedVersion = null;
    hoisted.updatedApproval = null;
    hoisted.resolveOrgTextAiKey.mockResolvedValue("org-byok-key-xyz");
  });

  it("throws BadRequestError if organizationId is missing", async () => {
    await expect(
      skillGeneratorService.synthesizeFromIntervention({
        approvalRequestId: 1,
        organizationId: undefined as any,
      }),
    ).rejects.toThrow("organizationId is required");
  });

  it("throws BadRequestError if neither approvalRequestId nor missionRunId is provided", async () => {
    await expect(
      skillGeneratorService.synthesizeFromIntervention({
        organizationId: 42,
      }),
    ).rejects.toThrow("Either approvalRequestId or missionRunId must be specified");
  });

  it("prevents cross-tenant synthesis when approval belongs to a different organization", async () => {
    // Return approval from organization 999
    hoisted.selectResults = [
      [
        {
          id: 55,
          organizationId: 999,
          toolName: "fetch_restricted_dataset",
          toolArgs: { url: "https://internal.corp" },
          modifiedOutput: { url: "https://sanitized.corp" },
          status: "approved",
        },
      ],
    ];

    await expect(
      skillGeneratorService.synthesizeFromIntervention({
        approvalRequestId: 55,
        organizationId: 42, // Caller is org 42
      }),
    ).rejects.toThrow("belongs to another organization");
  });

  it("synthesizes an autonomous skill from verified approval intervention with AI LLM", async () => {
    // 1. Approval lookup
    const approvalRow = {
      id: 77,
      organizationId: 42,
      missionId: 10,
      toolName: "query_jira_issues",
      toolArgs: { jql: "project = PROJ AND status = Open" },
      modifiedOutput: {
        jql: "project = PROJ AND status in ('Open', 'In Progress') AND sprint in openSprints()",
        includeChangelog: true,
      },
      comments: "Ensure in-flight sprint items are captured and include changelog for velocity metrics",
      selectionList: ["PROJ-101", "PROJ-102"],
      status: "approved",
    };

    // 2. Skill name collision check (none exists)
    hoisted.selectResults = [
      [approvalRow], // Approval lookup
      [],            // Name collision lookup
    ];

    // Mock AI synthesis response
    hoisted.aiClientExecute.mockResolvedValueOnce({
      success: true,
      output: JSON.stringify({
        skillName: "smart_jira_sprint_query",
        description: "Executes optimized JIRA query capturing active sprint issues and changelogs.",
        strategyDescription: "Codified sprint scope and changelog flags from operator approval #77.",
        triggerConditions: ["When querying active project issues for velocity analysis"],
        parametersSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
          },
          required: ["project"],
        },
        code: `async function execute(params = {}) {
  const project = params.project || "PROJ";
  return {
    jql: \`project = \${project} AND status in ('Open', 'In Progress') AND sprint in openSprints()\`,
    includeChangelog: true
  };
}
module.exports = { execute };`,
      }),
    });

    const result = await skillGeneratorService.synthesizeFromIntervention({
      approvalRequestId: 77,
      organizationId: 42,
      userId: "operator_alice",
      customInstructions: "Prioritize open sprints",
    });

    // Verify AI call used org-scoped credentials
    expect(hoisted.resolveOrgTextAiKey).toHaveBeenCalledWith(42);
    expect(hoisted.aiClientExecute).toHaveBeenCalledTimes(1);

    // Verify persisted skill
    expect(result.skill).toBeDefined();
    expect(result.skill.name).toBe("smart_jira_sprint_query");
    expect(result.skill.organizationId).toBe(42);
    expect(result.skill.language).toBe("javascript");
    expect((result.skill.metadata as any)?.source).toBe("hil_synthesis");
    expect((result.skill.metadata as any)?.approvalRequestId).toBe(77);

    // Verify version history snapshot
    expect(result.version).toBeDefined();
    expect(result.version.source).toBe("hil_synthesis");
    expect(result.version.promotedBy).toBe("operator_alice");
    expect(result.strategyDescription).toContain("Codified sprint scope");

    // Verify approval marked evolutionary
    expect(hoisted.updatedApproval).toEqual({ isEvolutionary: true });
  });

  it("gracefully falls back to deterministic code template if AI synthesis encounters an error", async () => {
    const approvalRow = {
      id: 88,
      organizationId: 42,
      toolName: "scrape_supplier_catalog",
      toolArgs: { timeoutMs: 5000 },
      modifiedOutput: { timeoutMs: 30000, retryLimit: 5, userAgent: "OddjobBot/2.0" },
      comments: "Increase timeout and add realistic user agent header",
      status: "approved",
    };

    hoisted.selectResults = [
      [approvalRow], // Approval lookup
      [],            // Name collision lookup
    ];

    // AI execution fails
    hoisted.aiClientExecute.mockRejectedValueOnce(new Error("AI rate limit exceeded"));

    const result = await skillGeneratorService.synthesizeFromIntervention({
      approvalRequestId: 88,
      organizationId: 42,
      userId: "operator_bob",
    });

    // Does not throw; creates fallback skill
    expect(result.skill).toBeDefined();
    expect(result.skill.name).toContain("scrape_supplier_catalog");
    expect(result.skill.code).toContain("appliedCorrection: true");
    expect(result.skill.code).toContain("30000");

    // Version history snapshot preserved
    expect(result.version.source).toBe("hil_synthesis");
    expect(result.version.promotedBy).toBe("operator_bob");
    expect(hoisted.updatedApproval).toEqual({ isEvolutionary: true });
  });
});
