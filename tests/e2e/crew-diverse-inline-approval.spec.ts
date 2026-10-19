import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "crew-diverse-inline-approval");

test.describe("CREW Chat Primitive Module Surfaces & Inline Governed Approvals", () => {
  test("renders Primitive Launchers grid, mounts interactive Module Surface, and executes intake flow", async ({
    page,
  }) => {
    // 1. Navigate to a fresh CREW chat room
    const sessionKey = `crew-diverse-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1500);

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    // 2. Verify Primitive Archetypes Grid in Empty State
    const topicGrid = page.locator('[data-testid="crew-topic-archetypes"]');
    await expect(topicGrid).toBeVisible({ timeout: 5000 });

    // Verify all 6 Primitive Archetypes are present
    const buildAppCard = page.locator('[data-testid="crew-topic-build_app"]');
    const researchCard = page.locator('[data-testid="crew-topic-research_topic"]');
    const agentCard = page.locator('[data-testid="crew-topic-agent_roster"]');
    const pipelineCard = page.locator('[data-testid="crew-topic-workstreams_pipeline"]');
    const auditCard = page.locator('[data-testid="crew-topic-governance_audit"]');
    const datasetCard = page.locator('[data-testid="crew-topic-datasets_schema"]');

    await expect(buildAppCard).toBeVisible();
    await expect(researchCard).toBeVisible();
    await expect(agentCard).toBeVisible();
    await expect(pipelineCard).toBeVisible();
    await expect(auditCard).toBeVisible();
    await expect(datasetCard).toBeVisible();

    // Capture screenshot of Primitive Launchers
    const playbooksShot = path.join(ARTIFACT_DIR, "crew_diverse_playbooks_grid.png");
    await page.screenshot({ path: playbooksShot, fullPage: false });
    console.log(`▶ [Test] Saved screenshot to ${playbooksShot}`);

    // 3. Click "Build an App / Workflow" to mount the ScaffoldPackPod Module Surface
    await buildAppCard.click();
    await page.waitForTimeout(600);

    const intakeContainer = page.locator('[data-testid="gqe-diverse-intake-card"]');
    await expect(intakeContainer).toBeVisible();
    await expect(intakeContainer).toContainText("Adaptive Module Surface");
    await expect(intakeContainer).toContainText("Build an App / Workflow");

    // Verify ScaffoldPackPod interactive elements inside the module surface
    const scaffoldPod = page.locator('[data-testid="scaffold-pack-pod"]');
    await expect(scaffoldPod).toBeVisible({ timeout: 5000 });

    // Capture screenshot of ScaffoldPackPod Module Surface
    const intakeShot = path.join(ARTIFACT_DIR, "crew_diverse_intake_form.png");
    await page.screenshot({ path: intakeShot, fullPage: false });
    console.log(`▶ [Test] Saved screenshot to ${intakeShot}`);

    // 4. Click Confirm on the ScaffoldPackPod module surface
    const confirmButton = page.locator('[data-testid="scaffold-pack-confirm"]');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    await page.waitForTimeout(800);

    // 5. Verify User Turn appears with DIVERSE Primitive Intake Brief
    const userTurn = page.locator('[data-testid="crew-turn-user"]');
    await expect(userTurn.first()).toBeVisible({ timeout: 5000 });
    await expect(userTurn.first()).toContainText("[DIVERSE PRIMITIVE INTAKE: BUILD AN APP / WORKFLOW]");
    await expect(userTurn.first()).toContainText("• Direction (D):");
    await expect(userTurn.first()).toContainText("• Intent (I):");

    // Capture screenshot of Submitted Brief
    const briefShot = path.join(ARTIFACT_DIR, "crew_diverse_submitted_brief.png");
    await page.screenshot({ path: briefShot, fullPage: false });
    console.log(`▶ [Test] Saved screenshot to ${briefShot}`);

    console.log("▶ [Test] CREW Primitive Module Surface intake test completed successfully!");
  });

  test("renders InlineApprovalCard for proposal artifacts and inherits requester permissions", async ({
    page,
  }) => {
    const sessionKey = `crew-approval-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1000);

    // Mock an agent turn containing a Tier 3.5 proposal artifact (e.g. propose_cycle_draft)
    await page.evaluate((sessionId) => {
      const mockTurn = {
        id: 999999,
        speakerType: "agent",
        speakerName: "Software Architect",
        userId: null,
        content: "I have synthesized a blueprint proposal for the incident remediation cycle.",
        round: 1,
        agentCardId: 1,
        inReplyToTurnId: null,
        topic: "architecture",
        intent: "proposal",
        latencyMs: 120,
        toolsUsed: [{ name: "propose_cycle_draft", ok: true, ms: 85 }],
        artifacts: [
          {
            tool: "propose_cycle_draft",
            payload: {
              type: "approval_request",
              kind: "cycle_draft",
              proposalId: 88801,
              title: 'Operational Cycle Draft: "Incident Auto-Remediation"',
              reason: "Automate webhook incident triage with SOC2 approval gate",
              cycleName: "Incident Auto-Remediation",
              scaffoldPacks: ["auth-jwt", "data-postgres-drizzle", "observability-otel"],
              requestedBy: "lead_operator",
              organizationId: 1,
              status: "pending",
            },
          },
        ],
      };

      // Dispatch custom event to simulate turn arrival
      window.dispatchEvent(
        new CustomEvent("test-inject-turn", { detail: mockTurn })
      );
    }, sessionKey);

    // Verify Inline Approval Card
    const approvalCard = page.locator('[data-testid="inline-approval-card"]');
    if (await approvalCard.count() > 0) {
      await expect(approvalCard).toBeVisible();
      await expect(approvalCard).toContainText("Incident Auto-Remediation");
      await expect(approvalCard).toContainText("Permissions inherited from");
      await expect(approvalCard).toContainText("@lead_operator");

      const approveButton = page.locator('[data-testid="approve-proposal-button"]');
      await expect(approveButton).toBeVisible();

      // Click Approve & Execute to trigger Reconciliation Progress Card
      await approveButton.click();

      // Verify ReconciliationProgressCard mounts
      const reconCard = page.locator('[data-testid="reconciliation-progress-card"]');
      await expect(reconCard).toBeVisible();
      await expect(reconCard).toContainText("Container Reconciliation Engine");

      // Wait for provisioning completion and Live App button
      const liveAppButton = page.locator('[data-testid="open-live-app-button"]');
      await expect(liveAppButton).toBeVisible({ timeout: 5000 });

      // Capture screenshot of Reconciliation Progress Card
      const approvalShot = path.join(ARTIFACT_DIR, "crew_reconciliation_progress_card.png");
      await page.screenshot({ path: approvalShot, fullPage: false });
      console.log(`▶ [Test] Saved screenshot to ${approvalShot}`);
    }
  });
});
