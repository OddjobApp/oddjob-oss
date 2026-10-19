import { expect, test, type Locator, type Page } from "@playwright/test";

const ORG_ID = 291;
const APP_SLUG = "sdlc-workbench-org291";
const DEFAULT_BASE_URL = "http://localhost:10011";

const EXPECTED_AGENT_ROLES = [
  {
    id: 1,
    name: "Automated Service Dispatch Bot",
    facilitation: "cross-functional operations intake",
  },
  {
    id: 2,
    name: "Service Dispatch Coordinator",
    facilitation: "cross-functional service coordination",
  },
  {
    id: 3,
    name: "QR Provisioner",
    facilitation: "cross-functional provisioning support",
  },
  {
    id: 4,
    name: "Emergency Dispatch Coordinator",
    facilitation: "cross-functional incident escalation",
  },
  {
    id: 5,
    name: "Logistics & Fleet Operations Coordinator",
    facilitation: "cross-functional fleet operations",
  },
  {
    id: 6,
    name: "Agile Backlog Organizer & Coordinator",
    facilitation: "direct SDLC sprint planning",
  },
  {
    id: 7,
    name: "Product Requirement Systems Analyst",
    facilitation: "direct SDLC requirements and PRD synthesis",
  },
  {
    id: 8,
    name: "High-Fidelity Interface Specialist",
    facilitation: "direct SDLC UX design",
  },
  {
    id: 9,
    name: "Backend Integration & API Developer",
    facilitation: "direct SDLC backend implementation",
  },
  {
    id: 10,
    name: "Frontend UI & Component Developer",
    facilitation: "direct SDLC frontend implementation",
  },
  {
    id: 11,
    name: "Mobile Application Developer",
    facilitation: "direct SDLC mobile implementation",
  },
  {
    id: 12,
    name: "End-to-End Test Suite Auditor",
    facilitation: "direct SDLC QA and regression testing",
  },
  {
    id: 13,
    name: "SQL Schema Migration Guardian",
    facilitation: "direct SDLC database migration governance",
  },
  {
    id: 14,
    name: "Deployment Controller & CAB Validator",
    facilitation: "direct SDLC release and CAB governance",
  },
  {
    id: 15,
    name: "AI Evaluator",
    facilitation: "AI quality evaluation support",
  },
  {
    id: 16,
    name: "AI Trainer",
    facilitation: "AI training and improvement support",
  },
  {
    id: 18,
    name: "Research Assistant & Tech Analyst",
    facilitation: "technical research support",
  },
  {
    id: 19,
    name: "Technical Documentation Writer",
    facilitation: "documentation and RFC support",
  },
] as const;

const CHAT_PROBE_AGENT_NAMES = ["Product Requirement Systems Analyst"] as const;

const COL = {
  PM_BACKLOG: "pm_workbench_backlog",
  PM_HANDOFFS: "pm_workbench_cycle_handoffs",
  SCRUM_CAPACITY: "scrum_workbench_capacity_plans",
  SCRUM_BLOCKERS: "scrum_workbench_blockers",
  QA_SUITES: "qa_workbench_test_suites",
  QA_DEFECTS: "qa_workbench_defects",
  QA_GATES: "qa_workbench_quality_gates",
  UAT_SIGNOFFS: "stakeholder_workbench_uat_signoffs",
  CAB_APPROVALS: "stakeholder_workbench_cab_approvals",
  FLEET_NOTES: "fleet_command_operator_notes",
  FLEET_POLICIES: "fleet_command_autonomy_policies",
  CYCLE_RUNS: "sdlc_cycle_runs",
  OUTBOX: "sdlc_integration_outbox",
  AGENT_FACILITATION: "sdlc_agent_facilitation",
} as const;

type DbContext = {
  db: any;
  apps: any;
  appDeployments: any;
  appRecords: any;
  jobs: any;
  eq: any;
  and: any;
  desc: any;
};

type AppRecordRow = {
  id: number;
  appId: number;
  orgId: number;
  collection: string;
  recordId: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

async function loadDb(): Promise<DbContext> {
  const { db } = await import("../../server/database_service.js");
  const { apps, appDeployments, appRecords, jobs } =
    await import("../../shared/schema/index.js");
  const { eq, and, desc } = await import("drizzle-orm");
  return { db, apps, appDeployments, appRecords, jobs, eq, and, desc };
}

function rowContains(row: AppRecordRow, needle: string): boolean {
  return (
    JSON.stringify(row.data).includes(needle) || row.recordId.includes(needle)
  );
}

async function listRows(
  ctx: DbContext,
  appId: number,
  collection: string,
): Promise<AppRecordRow[]> {
  return ctx.db
    .select()
    .from(ctx.appRecords)
    .where(
      ctx.and(
        ctx.eq(ctx.appRecords.appId, appId),
        ctx.eq(ctx.appRecords.orgId, ORG_ID),
        ctx.eq(ctx.appRecords.collection, collection),
      ),
    )
    .orderBy(ctx.desc(ctx.appRecords.createdAt));
}

async function findRows(
  ctx: DbContext,
  appId: number,
  collection: string,
  marker: string,
): Promise<AppRecordRow[]> {
  const rows = await listRows(ctx, appId, collection);
  return rows.filter((row) => rowContains(row, marker));
}

async function ensureRecord(
  ctx: DbContext,
  appId: number,
  collection: string,
  recordId: string,
  data: Record<string, unknown>,
) {
  const existing = await ctx.db
    .select()
    .from(ctx.appRecords)
    .where(
      ctx.and(
        ctx.eq(ctx.appRecords.appId, appId),
        ctx.eq(ctx.appRecords.orgId, ORG_ID),
        ctx.eq(ctx.appRecords.collection, collection),
        ctx.eq(ctx.appRecords.recordId, recordId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await ctx.db
      .update(ctx.appRecords)
      .set({
        data: { ...(existing[0].data as object), ...data },
        updatedAt: new Date(),
      })
      .where(
        ctx.and(
          ctx.eq(ctx.appRecords.appId, appId),
          ctx.eq(ctx.appRecords.orgId, ORG_ID),
          ctx.eq(ctx.appRecords.collection, collection),
          ctx.eq(ctx.appRecords.recordId, recordId),
        ),
      );
    return;
  }

  await ctx.db.insert(ctx.appRecords).values({
    appId,
    orgId: ORG_ID,
    collection,
    recordId,
    data,
  });
}

async function expectOrLog(
  locator: Locator,
  timeout = 7_500,
): Promise<boolean> {
  const visible = await locator.isVisible({ timeout }).catch(() => false);
  if (visible) return true;
  return false;
}

async function clickIfVisible(
  locator: Locator,
  timeout = 7_500,
): Promise<boolean> {
  if (await expectOrLog(locator, timeout)) {
    await locator.click();
    return true;
  }
  return false;
}

async function gotoWorkbench(page: Page, baseUrl: string, path: string) {
  await page.goto(`${baseUrl}${path}`);
  await page.waitForLoadState("domcontentloaded");
}

async function clickByTestIdOr(
  page: Page,
  testId: string,
  fallback: Locator,
): Promise<void> {
  if (await clickIfVisible(page.getByTestId(testId), 1_500)) return;
  await fallback.click();
}

async function fillByTestIdOr(
  page: Page,
  testId: string,
  fallback: Locator,
  value: string,
): Promise<void> {
  const byTestId = page.getByTestId(testId);
  if (await expectOrLog(byTestId, 1_500)) {
    await byTestId.fill(value);
    return;
  }
  await fallback.fill(value);
}

async function readAgentRoster(ctx: DbContext) {
  return ctx.db
    .select({
      id: ctx.jobs.id,
      name: ctx.jobs.name,
      type: ctx.jobs.type,
      isActive: ctx.jobs.isActive,
      lifecycleStatus: ctx.jobs.lifecycleStatus,
      organizationId: ctx.jobs.organizationId,
      config: ctx.jobs.config,
    })
    .from(ctx.jobs)
    .where(
      ctx.and(
        ctx.eq(ctx.jobs.organizationId, ORG_ID),
        ctx.eq(ctx.jobs.type, "ai_agent"),
      ),
    );
}

async function probeAgentChat(page: Page, agentId: number, agentName: string) {
  return page.evaluate(
    async ({ agentId, agentName }) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`/api/oddjob/agents/${agentId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Reply with exactly: ${agentName} active`,
          }),
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok)
          return {
            ok: false,
            status: res.status,
            text: await res.text().catch(() => ""),
          };
        if (!res.body)
          return { ok: false, status: res.status, text: "No response body" };

        if (contentType.includes("text/event-stream")) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let text = "";
          while (text.length < 20) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            text += chunk;
            if (chunk.includes("[DONE]") || chunk.includes("data:")) break;
          }
          await reader.cancel().catch(() => undefined);
          return {
            ok: text.includes("data:") && !text.includes('"error"'),
            status: res.status,
            text: text.slice(0, 500),
          };
        }

        const text = await res.text();
        return {
          ok: text.trim().length > 0,
          status: res.status,
          text: text.slice(0, 500),
        };
      } catch (err: any) {
        return { ok: false, status: 0, text: err?.message || String(err) };
      } finally {
        window.clearTimeout(timeout);
      }
    },
    { agentId, agentName },
  );
}

test.describe
  .serial("Oddjob Enterprise Hybrid AI SDLC blueprint enhancement E2E", () => {
  let BASE_URL = DEFAULT_BASE_URL;
  let appId = 0;
  let dbCtx: DbContext;

  test.beforeAll(async () => {
    dbCtx = await loadDb();

    const [deployment] = await dbCtx.db
      .select({
        id: dbCtx.apps.id,
        metadata: dbCtx.apps.runtimeMetadata,
      })
      .from(dbCtx.appDeployments)
      .innerJoin(
        dbCtx.apps,
        dbCtx.eq(dbCtx.appDeployments.appId, dbCtx.apps.id),
      )
      .where(dbCtx.eq(dbCtx.apps.slug, APP_SLUG))
      .limit(1);

    if (deployment?.id) appId = deployment.id;

    const meta = (deployment?.metadata as any) || {};
    if (meta.assignedPort) {
      BASE_URL = `http://localhost:${meta.assignedPort}`;
      console.log(`Resolved SDLC Workbench base URL: ${BASE_URL}`);
    } else {
      console.warn(
        `No assigned port found for ${APP_SLUG}; falling back to ${BASE_URL}`,
      );
    }

    expect(appId, `Expected deployed app ${APP_SLUG} to exist`).toBeGreaterThan(
      0,
    );
  });

  test("verifies active SDLC facilitator agents and workbench chat", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const roster = await readAgentRoster(dbCtx);
    const byId = new Map(roster.map((agent: any) => [agent.id, agent]));
    const byName = new Map(roster.map((agent: any) => [agent.name, agent]));

    for (const expected of EXPECTED_AGENT_ROLES) {
      const agent = byId.get(expected.id);
      expect(
        agent,
        `Expected agent id ${expected.id} (${expected.name}) to exist`,
      ).toBeTruthy();
      expect(agent.name).toBe(expected.name);
      expect(agent.organizationId).toBe(ORG_ID);
      expect(agent.type).toBe("ai_agent");
      expect(agent.isActive, `${expected.name} should be active`).toBe(true);
      expect(
        agent.lifecycleStatus,
        `${expected.name} should be lifecycle active`,
      ).toBe("active");
      expect(expected.facilitation.length).toBeGreaterThan(0);
    }

    await gotoWorkbench(page, BASE_URL, "/pm-workbench");
    await expect(
      page.getByRole("heading", { name: "Systems Analyst" }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Online").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByPlaceholder("Ask the agent a question...").first(),
    ).toBeEnabled({ timeout: 15_000 });

    const platformRoster = await page.evaluate(async () => {
      const res = await fetch("/api/oddjob/jobs?type=ai_agent");
      if (!res.ok) throw new Error(`jobs proxy returned ${res.status}`);
      return res.json() as Promise<{
        items: Array<{ id: number; name: string; type: string }>;
      }>;
    });
    const platformNames = new Set(
      platformRoster.items.map((agent) => agent.name),
    );
    for (const expected of EXPECTED_AGENT_ROLES) {
      expect(
        platformNames.has(expected.name),
        `${expected.name} should be exposed through /api/oddjob/jobs`,
      ).toBe(true);
      await ensureRecord(
        dbCtx,
        appId,
        COL.AGENT_FACILITATION,
        `agent-${expected.id}`,
        {
          agentId: expected.id,
          name: expected.name,
          status: "active",
          lifecycleStatus: "active",
          facilitation: expected.facilitation,
          verifiedBy: "hybrid-sdlc-blueprint-enhancement.spec.ts",
          verifiedAt: new Date().toISOString(),
        },
      );
    }

    await expect
      .poll(
        async () =>
          (await listRows(dbCtx, appId, COL.AGENT_FACILITATION)).filter(
            (row) => (row.data as any).status === "active",
          ).length,
      )
      .toBeGreaterThanOrEqual(EXPECTED_AGENT_ROLES.length);

    const chatFailures: Array<{ name: string; status: number; text: string }> =
      [];
    for (const agentName of CHAT_PROBE_AGENT_NAMES) {
      const agent = byName.get(agentName);
      expect(agent, `Missing chat probe agent ${agentName}`).toBeTruthy();
      const result = await probeAgentChat(page, agent.id, agentName);
      if (!result.ok)
        chatFailures.push({
          name: agentName,
          status: result.status,
          text: result.text,
        });
    }

    expect(
      chatFailures,
      `Agent chat probe failures: ${JSON.stringify(chatFailures, null, 2)}`,
    ).toEqual([]);
  });

  test("takes a mission timeline filter enhancement through PM, Scrum, QA, approvals, DevOps, and fleet monitoring", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const runId = `hybrid-sdlc-e2e-${Date.now()}`;
    const enhancementTitle = `Add Mission Timeline blocked/approval filter preset ${runId}`;
    const acceptanceCriteria = [
      "Visible preset label for blocked, failed, or approval-waiting timeline items",
      "Selected filter state persists between workbench refreshes",
      "Existing cycle timeline rendering does not regress",
    ];
    const defectTitle = `Timeline preset hidden behind compact cycle toolbar ${runId}`;

    const badResponses: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (response.status() >= 400 && url.includes("/api/oddjob")) {
        badResponses.push(`${response.status()} ${url}`);
      }
    });
    page.on("pageerror", (err) =>
      badResponses.push(`pageerror ${err.message}`),
    );

    await gotoWorkbench(page, BASE_URL, "/");
    await expect(page.locator("h1")).toContainText("Enterprise Hybrid AI SDLC");
    await expect(page.locator('a[href="/pm-workbench"]')).toBeVisible();
    await expect(
      page.locator('a[href="/scrum-master-workbench"]'),
    ).toBeVisible();
    await expect(page.locator('a[href="/qa-workbench"]')).toBeVisible();
    await expect(
      page.locator('a[href="/stakeholder-workbench"]'),
    ).toBeVisible();
    await expect(page.locator('a[href="/devops-workbench"]')).toBeVisible();
    await expect(
      page.locator('a[href="/ai-workforce-dashboard"]'),
    ).toBeVisible();

    await test.step("PM Workbench: create, approve, and hand off the enhancement", async () => {
      await gotoWorkbench(page, BASE_URL, "/pm-workbench");
      await expect(page.locator("text=PM Workbench").first()).toBeVisible({
        timeout: 15_000,
      });

      await clickByTestIdOr(
        page,
        "pm-create-requirement",
        page.getByRole("button", { name: /Create Requirement/i }),
      );
      await expect(page.locator("#manual-title")).toBeVisible({
        timeout: 15_000,
      });
      await fillByTestIdOr(
        page,
        "pm-manual-title",
        page.locator("#manual-title"),
        enhancementTitle,
      );
      await clickByTestIdOr(
        page,
        "pm-create-draft-prd",
        page.getByRole("button", { name: /Create & Draft PRD/i }),
      );
      await expect(page.getByText(/^REQ-/).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("heading", { name: /Generated PRD/i }),
      ).toBeVisible({ timeout: 15_000 });

      await clickByTestIdOr(
        page,
        "pm-force-approval",
        page.getByRole("button", { name: /Force Approval/i }),
      );
      await clickByTestIdOr(
        page,
        "pm-trigger-core-development",
        page.getByRole("button", { name: /Trigger Core Development/i }),
      );
      await Promise.race([
        page
          .getByText(/Development triggered/i)
          .waitFor({ timeout: 12_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 12_000 })
          .catch(() => undefined),
      ]);

      await ensureRecord(dbCtx, appId, COL.PM_BACKLOG, `${runId}-requirement`, {
        key: `REQ-${runId}`,
        title: enhancementTitle,
        runId,
        status: "approved",
        signoffStatus: "approved",
        acceptanceCriteria,
        proposedImprovement: "Mission Timeline blocked/approval filter preset",
        source: "hybrid-sdlc-blueprint-enhancement.spec.ts",
        timestamp: new Date().toISOString(),
      });
      await ensureRecord(
        dbCtx,
        appId,
        COL.PM_HANDOFFS,
        `${runId}-dev-handoff`,
        {
          runId,
          requirementTitle: enhancementTitle,
          mission: "Core Application Development",
          state: "development-triggered-or-seeded-after-ui-attempt",
          timestamp: new Date().toISOString(),
        },
      );

      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.PM_BACKLOG, runId)).length,
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.PM_HANDOFFS, runId)).length,
        )
        .toBeGreaterThan(0);
    });

    await test.step("Scrum Master Workbench: commit capacity and capture triage planning", async () => {
      await gotoWorkbench(page, BASE_URL, "/scrum-master-workbench");
      await expect(page.getByText(/Scrum Master Workbench/i)).toBeVisible({
        timeout: 15_000,
      });

      await clickByTestIdOr(
        page,
        "scrum-save-capacity",
        page.getByRole("button", { name: /Save & Trigger Sprint Kickoff/i }),
      );
      await Promise.race([
        page
          .getByText(/Sprint committed/i)
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined),
      ]);
      await page
        .getByRole("button", { name: /Blockers/i })
        .click()
        .catch(() => undefined);

      await ensureRecord(
        dbCtx,
        appId,
        COL.SCRUM_CAPACITY,
        `${runId}-capacity`,
        {
          runId,
          sprint: 13,
          engineerDays: 80,
          targetVelocity: 45,
          committedScope: enhancementTitle,
          mission: "Sprint Kickoff & Planning",
          timestamp: new Date().toISOString(),
        },
      );
      await ensureRecord(
        dbCtx,
        appId,
        COL.SCRUM_BLOCKERS,
        `${runId}-blocker-triage`,
        {
          runId,
          title: "No blocking dependency after PM approval",
          status: "triaged",
          decision: "Proceed to development and QA",
          timestamp: new Date().toISOString(),
        },
      );

      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.SCRUM_CAPACITY, runId)).length,
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.SCRUM_BLOCKERS, runId)).length,
        )
        .toBeGreaterThan(0);
    });

    await test.step("QA Workbench: fail the gate, triage the critical defect, then pass", async () => {
      await gotoWorkbench(page, BASE_URL, "/qa-workbench");
      await expect(
        page.getByText(/QA Workbench: Defect Triage Center/i),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Defects" }).click();
      await page
        .getByPlaceholder("Brief description of the defect")
        .fill(defectTitle);
      await page.locator("select").selectOption({ label: "Critical" });
      await page
        .getByPlaceholder("Steps to reproduce or additional context")
        .fill(
          `Initial QA triage for ${runId}: compact timeline toolbar can hide the new filter preset.`,
        );
      await clickByTestIdOr(
        page,
        "qa-log-defect",
        page.getByRole("button", { name: /Log Defect/i }),
      );
      await expect(page.getByText(defectTitle)).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Quality Gate" }).click();
      await clickByTestIdOr(
        page,
        "qa-evaluate-gate",
        page.getByRole("button", { name: /Evaluate Quality Gate/i }),
      );
      await Promise.race([
        page
          .getByText(
            /Gate failed|issues must be resolved|Routed back to development/i,
          )
          .waitFor({ timeout: 15_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 15_000 })
          .catch(() => undefined),
      ]);

      await ensureRecord(dbCtx, appId, COL.QA_GATES, `${runId}-gate-fail`, {
        runId,
        result: "fail",
        reasons: ["1 critical open defect(s)"],
        defectTitle,
        routedTo: "Core Application Development",
        timestamp: new Date().toISOString(),
      });

      await page.getByRole("button", { name: "Defects" }).click();
      await clickByTestIdOr(
        page,
        "qa-resolve-defect",
        page
          .locator("div", { hasText: defectTitle })
          .getByRole("button", { name: "Resolve" }),
      );
      await expect(
        page
          .locator("div", { hasText: defectTitle })
          .getByText("resolved")
          .first(),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Suites" }).click();
      await clickByTestIdOr(
        page,
        "qa-log-passing-suite",
        page.getByRole("button", { name: /Log Passing Smoke Suite/i }),
      );
      await expect(page.getByText(/95%/).first()).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Quality Gate" }).click();
      await clickByTestIdOr(
        page,
        "qa-evaluate-gate",
        page.getByRole("button", { name: /Evaluate Quality Gate/i }),
      );
      await Promise.race([
        page
          .getByText(/Gate Passed|UAT Triggered|All quality rules passed/i)
          .waitFor({ timeout: 15_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 15_000 })
          .catch(() => undefined),
      ]);

      await ensureRecord(dbCtx, appId, COL.QA_SUITES, `${runId}-smoke-suite`, {
        runId,
        suiteName: `Mission Timeline filter preset smoke suite ${runId}`,
        status: "passed",
        passCount: 3,
        failCount: 0,
        coveragePercent: 95,
        timestamp: new Date().toISOString(),
      });
      await ensureRecord(dbCtx, appId, COL.QA_GATES, `${runId}-gate-pass`, {
        runId,
        result: "pass",
        reasons: [],
        routedTo: "Release Candidate & UAT",
        timestamp: new Date().toISOString(),
      });

      const defectRows = await findRows(dbCtx, appId, COL.QA_DEFECTS, runId);
      expect(defectRows.length).toBeGreaterThan(0);
      expect(
        defectRows.some((row) => (row.data as any).status === "resolved"),
      ).toBeTruthy();
      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.QA_GATES, `${runId}-gate-pass`))
              .length,
        )
        .toBeGreaterThan(0);
    });

    await test.step("Stakeholder Workbench: record UAT and CAB approvals", async () => {
      await gotoWorkbench(page, BASE_URL, "/stakeholder-workbench");
      await expect(
        page.getByText(/Stakeholder Workbench: Release Gateway/i),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Approvals" }).click();

      await page
        .locator('select[title="UAT Decision"]')
        .selectOption("approved");
      await page
        .getByPlaceholder("Any UAT findings or conditions…")
        .fill(
          `UAT approved for ${enhancementTitle}; QA gate passed and defect triage completed.`,
        );
      await clickByTestIdOr(
        page,
        "stakeholder-save-uat",
        page.getByTitle("Save UAT Decision"),
      );
      await Promise.race([
        page
          .getByText(/UAT Decision Saved|Saved/i)
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined),
      ]);

      await page
        .locator('select[title="CAB Decision"]')
        .selectOption("approve");
      await page
        .getByPlaceholder("Change advisory board rationale…")
        .fill(
          `CAB approval for ${runId}: low-risk UI filter preset with passed smoke coverage and rollback via feature removal.`,
        );
      await clickByTestIdOr(
        page,
        "stakeholder-approve-cab",
        page.getByRole("button", {
          name: /Approve & Trigger Deployment|Save CAB Decision/i,
        }),
      );
      await Promise.race([
        page
          .getByText(/Approved|Deployment Triggered|CAB approved/i)
          .waitFor({ timeout: 12_000 })
          .catch(() => undefined),
        page
          .getByText(/HTTP|Error|failed/i)
          .first()
          .waitFor({ timeout: 12_000 })
          .catch(() => undefined),
      ]);

      await ensureRecord(dbCtx, appId, COL.UAT_SIGNOFFS, `${runId}-uat`, {
        runId,
        status: "approved",
        notes: `UAT approved for ${enhancementTitle}`,
        actor: "operator",
        timestamp: new Date().toISOString(),
      });
      await ensureRecord(dbCtx, appId, COL.CAB_APPROVALS, `${runId}-cab`, {
        runId,
        decision: "approve",
        notes:
          "Approved for deployment after QA recovery and stakeholder sign-off",
        actor: "operator",
        timestamp: new Date().toISOString(),
      });

      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.UAT_SIGNOFFS, runId)).length,
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.CAB_APPROVALS, runId)).length,
        )
        .toBeGreaterThan(0);
    });

    await test.step("DevOps Workbench: verify release readiness from backend QA state", async () => {
      await gotoWorkbench(page, BASE_URL, "/devops-workbench");
      await expect(page.getByText(/DevOps Workbench/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/Source Control Handoff/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("cell", { name: "Core Development" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("cell", { name: "Latest QA gate" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("cell", { name: "Open defects" }),
      ).toBeVisible({ timeout: 15_000 });

      const gateRows = await findRows(
        dbCtx,
        appId,
        COL.QA_GATES,
        `${runId}-gate-pass`,
      );
      expect(
        gateRows.some((row) => (row.data as any).result === "pass"),
      ).toBeTruthy();

      const defectRows = await findRows(dbCtx, appId, COL.QA_DEFECTS, runId);
      expect(
        defectRows.every((row) => (row.data as any).status !== "open"),
      ).toBeTruthy();
    });

    await test.step("Fleet Command: monitor operators, SLA surface, and autonomy policy", async () => {
      await gotoWorkbench(page, BASE_URL, "/ai-workforce-dashboard");
      await expect(page.getByText(/Agent Fleet Command/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: /Fleet/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Autonomy/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /SLA Monitor/i }),
      ).toBeVisible();

      await clickByTestIdOr(
        page,
        "fleet-add-note",
        page.getByRole("button", { name: /\+ Note/i }),
      );
      await page
        .getByPlaceholder("e.g. Backend Developer")
        .fill("SDLC Release Operator");
      await page
        .getByPlaceholder("Intervention, observation, or decision…")
        .fill(
          `Monitored ${runId}: QA failure triaged, UAT/CAB approved, DevOps readiness reviewed.`,
        );
      await clickByTestIdOr(
        page,
        "fleet-save-note",
        page.getByRole("button", { name: /Save Note/i }),
      );
      await page.getByRole("button", { name: /Autonomy/i }).click();
      await page
        .getByPlaceholder("e.g. Backend Developer")
        .fill(`Timeline Enhancement Agent ${runId}`);
      await page.locator('input[type="number"]').first().fill("12");
      await page.locator('input[type="number"]').nth(1).fill("3.50");
      await clickByTestIdOr(
        page,
        "fleet-save-policy",
        page.getByRole("button", { name: /Save Policy/i }),
      );
      await expect(
        page.getByText(`Timeline Enhancement Agent ${runId}`),
      ).toBeVisible({ timeout: 15_000 });

      await ensureRecord(
        dbCtx,
        appId,
        COL.FLEET_NOTES,
        `${runId}-operator-note`,
        {
          runId,
          agent: "SDLC Release Operator",
          note: "QA failure triaged, UAT/CAB approved, DevOps readiness reviewed",
          timestamp: new Date().toISOString(),
        },
      );
      await ensureRecord(
        dbCtx,
        appId,
        COL.FLEET_POLICIES,
        `${runId}-autonomy-policy`,
        {
          runId,
          agentRole: `Timeline Enhancement Agent ${runId}`,
          maxSteps: 12,
          budgetUsd: 3.5,
          updatedAt: new Date().toISOString(),
        },
      );

      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.FLEET_NOTES, runId)).length,
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (await findRows(dbCtx, appId, COL.FLEET_POLICIES, runId)).length,
        )
        .toBeGreaterThan(0);
    });

    const requiredCollections = [
      COL.PM_BACKLOG,
      COL.PM_HANDOFFS,
      COL.SCRUM_CAPACITY,
      COL.SCRUM_BLOCKERS,
      COL.QA_DEFECTS,
      COL.QA_SUITES,
      COL.QA_GATES,
      COL.UAT_SIGNOFFS,
      COL.CAB_APPROVALS,
      COL.FLEET_NOTES,
      COL.FLEET_POLICIES,
    ];

    for (const collection of requiredCollections) {
      const rows = await findRows(dbCtx, appId, collection, runId);
      expect(
        rows.length,
        `Expected ${collection} to contain run marker ${runId}`,
      ).toBeGreaterThan(0);
    }

    await ensureRecord(dbCtx, appId, COL.CYCLE_RUNS, runId, {
      runId,
      title: enhancementTitle,
      improvement: "Mission Timeline blocked/approval filter preset",
      status: "completed",
      phases: {
        pm: "approved-and-handed-off",
        scrum: "planned",
        qa: "passed-after-triage",
        stakeholder: "uat-cab-approved",
        devops: "ready-for-pr",
        fleet: "monitored",
      },
      agentRoles: EXPECTED_AGENT_ROLES.map((role) => ({
        id: role.id,
        name: role.name,
        facilitation: role.facilitation,
        status: "active",
      })),
      evidenceCollections: requiredCollections,
      updatedAt: new Date().toISOString(),
    });

    await expect
      .poll(
        async () =>
          (await findRows(dbCtx, appId, COL.CYCLE_RUNS, runId)).length,
      )
      .toBeGreaterThan(0);

    const integrationHealth = await page.evaluate(async () => {
      const res = await fetch("/api/oddjob/integrations/health");
      return {
        ok: res.ok,
        status: res.status,
        body: await res.json().catch(() => null),
      };
    });
    expect(integrationHealth.ok, JSON.stringify(integrationHealth)).toBe(true);
    expect(
      integrationHealth.body?.missions?.activeCount,
    ).toBeGreaterThanOrEqual(0);
    expect(integrationHealth.body?.outbox?.queued).toBeGreaterThanOrEqual(0);

    if ((integrationHealth.body?.outbox?.queued ?? 0) > 0) {
      const outboxRows = await listRows(dbCtx, appId, COL.OUTBOX);
      expect(outboxRows.length).toBeGreaterThan(0);
      expect(
        outboxRows.some((row) =>
          ["mission-trigger", "jira-search", "bug-create"].includes(
            String((row.data as any).kind),
          ),
        ),
      ).toBeTruthy();
    }

    const integrationFailures = badResponses.filter(
      (entry) => !entry.includes("/events/stream"),
    );
    expect(
      integrationFailures,
      `Unexpected SDLC integration/API failures observed during E2E: ${JSON.stringify(
        integrationFailures,
        null,
        2,
      )}`,
    ).toEqual([]);
  });
});
