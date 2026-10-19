import { test, expect, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

type ForgeStatus = {
  status?: string;
  progress?: number;
  step?: string;
  message?: string;
  error?: string;
  appId?: number;
  slug?: string;
  blueprintSlug?: string;
  updatedAt?: string;
  readiness?: ReadinessReport;
};

type ReadinessCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  severity: "blocker" | "warning" | "info";
  message: string;
  detail?: Record<string, unknown>;
};

type ReadinessReport = {
  ready: boolean;
  appId?: number;
  slug: string;
  runtimeUrl?: string;
  checks: ReadinessCheck[];
  summary: {
    pass: number;
    fail: number;
    warn: number;
    skip: number;
  };
};

const terminalSuccessStatuses = new Set(["completed", "complete"]);
const terminalFailureStatuses = new Set(["failed", "error", "cancelled"]);
const suspendedStatuses = new Set([
  "awaiting_strategy_approval",
  "awaiting_architecture_approval",
  "awaiting_wave_approval",
  "awaiting_approval",
]);

const pollIntervalMs = Number(process.env.FORGE_E2E_POLL_INTERVAL_MS ?? 5000);
const maxPollMs = Number(process.env.FORGE_E2E_MAX_POLL_MS ?? 20 * 60 * 1000);
const staleStatusMs = Number(process.env.FORGE_E2E_STALE_STATUS_MS ?? 6 * 60 * 1000);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeArtifact(
  testInfo: TestInfo,
  artifactDir: string,
  name: string,
  body: unknown,
  contentType = "application/json",
) {
  await ensureDir(artifactDir);
  const filePath = path.join(artifactDir, name);
  const content = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await fs.writeFile(filePath, content);
  await testInfo.attach(name, { path: filePath, contentType });
  return filePath;
}

async function readJsonResponse(response: APIResponse) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawBody: text };
  }
}

function summarizeStatus(status: ForgeStatus) {
  return {
    status: status.status,
    progress: status.progress,
    step: status.step,
    message: status.message,
    error: status.error,
    appId: status.appId,
    updatedAt: status.updatedAt,
  };
}

function describeReadinessFailures(readiness: ReadinessReport) {
  return readiness.checks
    .filter((check) => check.status === "fail" || (check.severity === "blocker" && check.status !== "pass"))
    .map((check) => `${check.id}=${check.status}: ${check.message}`)
    .join("\n");
}

async function fetchForgeStatus(request: APIRequestContext, jobId: string) {
  const response = await request.get(`/api/apps/forge/status/${jobId}`);
  const data = await readJsonResponse(response);
  expect(response.ok(), `Forge status request failed (${response.status()}): ${JSON.stringify(data)}`).toBeTruthy();
  return data as ForgeStatus;
}

async function pollForgeToCompletion(
  request: APIRequestContext,
  jobId: string,
  artifactDir: string,
  testInfo: TestInfo,
) {
  const startedAt = Date.now();
  let lastChangeAt = startedAt;
  let lastSignature = "";
  const timeline: Array<ForgeStatus & { observedAt: string; elapsedMs: number }> = [];

  while (Date.now() - startedAt < maxPollMs) {
    const status = await fetchForgeStatus(request, jobId);
    const observed = {
      ...status,
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
    };
    timeline.push(observed);

    const signature = JSON.stringify([
      status.status,
      status.progress,
      status.step,
      status.message,
      status.error,
      status.appId,
      status.updatedAt,
    ]);

    if (signature !== lastSignature) {
      lastSignature = signature;
      lastChangeAt = Date.now();
      console.log(`[FORGE] ${jobId}: ${JSON.stringify(summarizeStatus(status))}`);
      await writeArtifact(testInfo, artifactDir, "forge-status-latest.json", status);
    }

    if (status.status && terminalSuccessStatuses.has(status.status)) {
      await writeArtifact(testInfo, artifactDir, "forge-status-timeline.json", timeline);
      return status;
    }

    if (status.status && terminalFailureStatuses.has(status.status)) {
      await writeArtifact(testInfo, artifactDir, "forge-status-timeline.json", timeline);
      throw new Error(`Forge failed at "${status.step ?? status.status}": ${status.error ?? status.message ?? "no failure message"}`);
    }

    if (status.status && suspendedStatuses.has(status.status)) {
      await writeArtifact(testInfo, artifactDir, "forge-status-timeline.json", timeline);
      throw new Error(`Forge suspended in "${status.status}" during Scenario A; this gate expects a fully pre-approved lifecycle.`);
    }

    if (Date.now() - lastChangeAt > staleStatusMs) {
      await writeArtifact(testInfo, artifactDir, "forge-status-timeline.json", timeline);
      throw new Error(`Forge status stalled for ${Math.round(staleStatusMs / 1000)}s at ${JSON.stringify(summarizeStatus(status))}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await writeArtifact(testInfo, artifactDir, "forge-status-timeline.json", timeline);
  const last = timeline.at(-1);
  throw new Error(`Forge did not complete within ${Math.round(maxPollMs / 1000)}s. Last status: ${JSON.stringify(last ? summarizeStatus(last) : null)}`);
}

async function captureRuntimeEvidence(page: Page, artifactDir: string, testInfo: TestInfo, slug: string) {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown failure"}`);
  });

  const response = await page.goto(`/forged/${slug}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  expect(response, `No navigation response returned for /forged/${slug}/`).not.toBeNull();
  expect(response!.status(), `Forged app returned HTTP ${response!.status()} at ${response!.url()}`).toBeLessThan(500);

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  await expect(page.locator("body"), "Forged app body should render").toBeVisible();
  await expect(page.locator("body *").first(), "Forged app should mount visible UI").toBeVisible({ timeout: 30_000 });

  const screenshotPath = path.join(artifactDir, "runtime-full-page.png");
  await ensureDir(artifactDir);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("runtime-full-page.png", { path: screenshotPath, contentType: "image/png" });

  const html = await page.content();
  await writeArtifact(testInfo, artifactDir, "runtime.html", html, "text/html");

  expect(html.length, "Forged app should return a substantive document").toBeGreaterThan(1000);
  expect(html, "Forged app should not render a Next.js fatal error page").not.toContain("__next_error__");
  expect(html, "Forged app should not render the platform 503 starting response").not.toContain("App is starting");
  expect(pageErrors, `Browser runtime errors:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(
    failedRequests.filter((entry) => !entry.includes("/favicon")),
    `Network failures:\n${failedRequests.join("\n")}`,
  ).toEqual([]);

  await writeArtifact(testInfo, artifactDir, "runtime-observability.json", {
    url: page.url(),
    title: await page.title(),
    consoleMessages,
    pageErrors,
    failedRequests,
  });
}

test.describe("Mission Scenario A: App Forge Lifecycle Gate", () => {
  test("forges, deploys, probes, and renders a custom CRUD app", async ({ request, page }, testInfo) => {
    test.setTimeout(maxPollMs + 240_000);

    const runId = Date.now();
    const testAppSlug = `scenario-a-delivery-verifier-${runId}`;
    const artifactDir = path.join(process.cwd(), "test-results", "forge-verification", testAppSlug);

    await writeArtifact(testInfo, artifactDir, "request.json", {
      slug: testAppSlug,
      blueprint: "crud-app",
      runId,
      startedAt: new Date().toISOString(),
    });

    const forgeResponse = await request.post("/api/apps/forge", {
      data: {
        name: "Scenario A Delivery Verifier",
        slug: testAppSlug,
        description:
          "Mission Scenario A completion gate: a CRUD application that manages delivery verification tasks with assignment and status tracking.",
        blueprint: "crud-app",
        skipToAssembly: true,
        approvedPlan: {
          scenario: "Mission Scenario A",
          objective: "Verify the full App Forge lifecycle from request through deployed runtime.",
          approvedAt: new Date().toISOString(),
        },
        defaultCollections: ["verification_tasks"],
        blackboard: {
          target_collection: "verification_tasks",
          entity_singular: "VerificationTask",
          columns: [
            { key: "title", label: "Task Title", type: "text" },
            { key: "status", label: "Status", type: "text" },
            { key: "assigned_to", label: "Assigned To", type: "text" },
          ],
          metrics: [
            { label: "Total Tasks", valueAccessor: "count", iconName: "Layers" },
            { label: "Pending Tasks", valueAccessor: "pending_count", iconName: "Clock" },
          ],
        },
      },
    });
    const forgeBody = await readJsonResponse(forgeResponse);
    await writeArtifact(testInfo, artifactDir, "forge-create-response.json", forgeBody);

    expect(forgeResponse.ok(), `Forge create failed (${forgeResponse.status()}): ${JSON.stringify(forgeBody)}`).toBeTruthy();
    expect(forgeBody.jobId, "Forge create response must include a jobId").toEqual(expect.any(String));
    const jobId = forgeBody.jobId as string;

    const completedStatus = await pollForgeToCompletion(request, jobId, artifactDir, testInfo);
    expect(completedStatus.appId, `Completed forge status must include appId: ${JSON.stringify(completedStatus)}`).toEqual(expect.any(Number));
    expect(completedStatus.progress, "Completed forge progress should be 100").toBe(100);
    expect(completedStatus.slug, "Completed forge status should preserve slug").toBe(testAppSlug);
    const appId = completedStatus.appId!;

    const readinessResponse = await request.get(`/api/apps/${appId}/readiness?probe=true`);
    const readiness = (await readJsonResponse(readinessResponse)) as ReadinessReport;
    await writeArtifact(testInfo, artifactDir, "readiness.json", readiness);

    expect(readinessResponse.ok(), `Readiness request failed (${readinessResponse.status()}): ${JSON.stringify(readiness)}`).toBeTruthy();
    expect(readiness.appId, "Readiness report should belong to forged app").toBe(appId);
    expect(readiness.slug, "Readiness report should belong to forged slug").toBe(testAppSlug);
    expect(readiness.ready, `Readiness blocker failures:\n${describeReadinessFailures(readiness)}`).toBe(true);

    for (const requiredCheck of ["app_registry", "org_deployment", "workspace_exists", "workspace_files", "runtime_url", "runtime_probe"]) {
      const check = readiness.checks.find((candidate) => candidate.id === requiredCheck);
      expect(check, `Missing readiness check "${requiredCheck}"`).toBeDefined();
      expect(check!.status, `Readiness check "${requiredCheck}" failed: ${check!.message}`).toBe("pass");
    }

    const deploymentResponse = await request.get(`/api/apps/${appId}/deploy`);
    const deployment = await readJsonResponse(deploymentResponse);
    await writeArtifact(testInfo, artifactDir, "deployment.json", deployment);
    expect(deploymentResponse.ok(), `Deployment lookup failed (${deploymentResponse.status()}): ${JSON.stringify(deployment)}`).toBeTruthy();
    expect(deployment.appId ?? deployment.id, "Deployment response should identify the forged app or deployment").toBeDefined();

    await captureRuntimeEvidence(page, artifactDir, testInfo, testAppSlug);

    await writeArtifact(testInfo, artifactDir, "completion-manifest.json", {
      scenario: "Mission Scenario A",
      slug: testAppSlug,
      jobId,
      appId,
      completedStatus: summarizeStatus(completedStatus),
      readinessSummary: readiness.summary,
      runtimeUrl: readiness.runtimeUrl,
      completedAt: new Date().toISOString(),
    });
  });
});
