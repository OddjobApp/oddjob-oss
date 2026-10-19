import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Under the run's own output directory, like every other spec here.
 *
 * This was an absolute path into another tool's scratch directory on one
 * developer's machine, which meant the spec could only produce its evidence
 * there — on any other checkout, and on CI, it wrote screenshots into a
 * directory that has nothing to do with the run.
 */
const ARTIFACT_DIR = path.join(process.cwd(), "test-results", "hybrid-builder-pods");

/** Capture, and attach to the report so the evidence travels with the run. */
async function shoot(target: Page | Locator, testInfo: TestInfo, name: string, fullPage = false) {
  const filePath = path.join(ARTIFACT_DIR, name);
  await ("goto" in target
    ? (target as Page).screenshot({ path: filePath, fullPage })
    : (target as Locator).screenshot({ path: filePath }));
  await testInfo.attach(name, { path: filePath, contentType: "image/png" });
}

// Reset storageState for this spec so it does not rely on database auth session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Oddjob Hybrid Builder Pods Live Verification", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(ARTIFACT_DIR)) {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    }
  });

  test("renders and exercises all 4 hybrid builder pods with live interactions", async ({ page }, testInfo) => {
    // 1. Navigate to the live builder pods showcase page
    await page.goto("http://localhost:5000/external/builder-pods", { waitUntil: "networkidle" });
    await expect(page.getByTestId("pods-container")).toBeVisible({ timeout: 20000 });

    // ─── POD 1: ProjectPlanningPod ──────────────────────────────────────────
    const planningSection = page.getByTestId("section-project-planning");
    await expect(planningSection).toBeVisible();
    await expect(planningSection.getByText("SOC2 Compliance & Automated Enforcement")).toBeVisible();
    await expect(planningSection.getByText("750.00 USD")).toBeVisible();
    
    // Screenshot: Project Planning Pod
    await shoot(planningSection, testInfo, "pod-01-project-planning.png");

    // Click "Commit & Launch Cycle"
    const commitBtn = planningSection.getByRole("button", { name: /Commit & Launch Cycle/i });
    await commitBtn.click();
    await expect(page.getByText(/ProjectPlanningPod Committed/i)).toBeVisible();

    // ─── POD 2: DecisionMatrixPod ───────────────────────────────────────────
    const matrixSection = page.getByTestId("section-decision-matrix");
    await expect(matrixSection).toBeVisible();
    await expect(matrixSection.getByText(/Decision Matrix: Caching Infrastructure/i)).toBeVisible();
    await expect(matrixSection.getByText(/Consensus Target: 85%/i)).toBeVisible();

    // Screenshot: Decision Matrix Pod
    await shoot(matrixSection, testInfo, "pod-02-decision-matrix.png");

    // Click candidate option 2
    const candidate2 = matrixSection.getByTestId("candidate-card-cand-2");
    await candidate2.click();

    // Click "Ratify Decision & Commit to Blueprint"
    const ratifyBtn = matrixSection.getByTestId("decision-matrix-confirm");
    await ratifyBtn.click();
    await expect(page.getByText(/DecisionMatrixPod Ratified/i)).toBeVisible();

    // ─── POD 3: AgentUpskillingPod ──────────────────────────────────────────
    const upskillingSection = page.getByTestId("section-agent-upskilling");
    await expect(upskillingSection).toBeVisible();
    await expect(upskillingSection.getByText(/Agent Upskilling: Data Wrangler Prime/i)).toBeVisible();
    await expect(upskillingSection.getByText(/Target: Distributed Schema Normalization/i)).toBeVisible();

    // Switch strategy to Tier 2: Golden Samples
    const samplesStrategy = upskillingSection.getByTestId("strategy-samples");
    await samplesStrategy.click();

    // Screenshot: Agent Upskilling Pod
    await shoot(upskillingSection, testInfo, "pod-03-agent-upskilling.png");

    // Click "Ratify & Grant Competency"
    const grantBtn = upskillingSection.getByTestId("agent-upskilling-confirm");
    await grantBtn.click();
    await expect(page.getByText(/AgentUpskillingPod Promoted/i)).toBeVisible();

    // ─── POD 4: ToolScaffoldPod ─────────────────────────────────────────────
    const toolSection = page.getByTestId("section-tool-scaffold");
    await expect(toolSection).toBeVisible();
    await expect(toolSection.getByText(/Tool Forge: geocoding_lookup/i)).toBeVisible();

    // Run sandbox test
    const sandboxBtn = toolSection.getByTestId("tool-sandbox-run");
    await sandboxBtn.click();
    await expect(toolSection.getByText(/HTTP 200 OK/i)).toBeVisible();

    // Screenshot: Tool Scaffold Pod
    await shoot(toolSection, testInfo, "pod-04-tool-scaffold.png");

    // Click "Publish Tool & Equip Agent"
    const publishBtn = toolSection.getByTestId("tool-scaffold-confirm");
    await publishBtn.click();
    await expect(page.getByText(/ToolScaffoldPod Published/i)).toBeVisible();

    // Full page overview screenshot
    await shoot(page, testInfo, "builder-pods-full-showcase.png", true);
  });
});
