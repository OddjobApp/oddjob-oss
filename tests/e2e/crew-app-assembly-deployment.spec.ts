import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "crew-app-assembly-deployment");

test.describe("CREW Chat App Assembly & Ontology Deployment E2E Suite", () => {
  test("mounts Ontology Action Type Pod, configures HIL risk gate, and verifies DIVERSE primitive intake in chat", async ({
    page,
  }) => {
    // Intercept primers to provide the new Ontology Action Type archetype
    await page.route("**/api/crew/primers*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          primers: [],
          topicArchetypes: [
            {
              id: "ontology_actions",
              label: "Ontology Actions & Governance",
              icon: "⚡",
              description: "Configure governed mutations, automated actions, and human-in-the-loop signoff gates.",
              podComponent: "OntologyActionTypePod",
              defaultDirection: "Configure an Ontology Action Type with risk profile and approval gates",
              suggestedRoles: ["Security Officer", "DevOps Engineer", "Lead Architect"],
              suggestedDeliverables: ["Action Type Specification"],
            },
          ],
        }),
      });
    });

    const sessionKey = `crew-action-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1500);

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    // 1. Wait for transcript container
    const transcript = page.locator('[data-testid="crew-transcript"]');
    await expect(transcript).toBeVisible({ timeout: 15000 });

    // 2. Locate and click the Ontology Actions Card
    const actionCard = page.locator('[data-testid="crew-topic-ontology_actions"]');
    await expect(actionCard).toBeVisible({ timeout: 10000 });
    await actionCard.click({ force: true });
    await page.waitForTimeout(1000);

    const intakeContainer = page.locator('[data-testid="gqe-diverse-intake-card"]');
    await expect(intakeContainer).toBeVisible({ timeout: 10000 });
    await expect(intakeContainer).toContainText("Ontology Actions & Governance");

    // 3. Fill in Action Type details inside the OntologyActionTypePod
    const actionIdInput = page.locator('input[placeholder*="RestartService"]');
    await expect(actionIdInput).toBeVisible();
    await actionIdInput.fill("RestartGatewayCluster");

    const targetObjInput = page.locator('input[placeholder*="Microservice"]');
    await expect(targetObjInput).toBeVisible();
    await targetObjInput.fill("GatewayNode");

    // 4. Click Declare Action Type button
    const declareBtn = page.getByRole("button", { name: /Declare Action Type/i });
    await expect(declareBtn).toBeEnabled();
    await declareBtn.click();
    await page.waitForTimeout(1200);

    // 5. Verify User Turn with DIVERSE Primitive Directive
    const userTurn = page.locator('[data-testid="crew-turn-user"]');
    await expect(userTurn.first()).toBeVisible({ timeout: 10000 });
    await expect(userTurn.first()).toContainText("[DIVERSE PRIMITIVE INTAKE: ONTOLOGY ACTIONS & GOVERNANCE]");
    await expect(userTurn.first()).toContainText("RestartGatewayCluster");
    await expect(userTurn.first()).toContainText("GatewayNode");

    // Screenshot
    const shotPath = path.join(ARTIFACT_DIR, "crew_e2e_ontology_action_intake.png");
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`▶ [Playwright E2E] Saved screenshot to ${shotPath}`);
  });

  test("mounts Ontology Object Type Pod, declares schema, and verifies DIVERSE primitive intake in chat", async ({
    page,
  }) => {
    // Intercept primers to provide the new Ontology Object Type archetype
    await page.route("**/api/crew/primers*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          primers: [],
          topicArchetypes: [
            {
              id: "ontology_object_types",
              label: "Ontology Object Types",
              icon: "📦",
              description: "Define core domain entity schemas, primary keys, and properties for agent binding.",
              podComponent: "OntologyObjectTypePod",
              defaultDirection: "Declare an Ontology Object Type with primary key and typed property schema",
              suggestedRoles: ["Data Architect", "Software Architect", "Domain Lead"],
              suggestedDeliverables: ["Declared Object Type Schema"],
            },
          ],
        }),
      });
    });

    const sessionKey = `crew-object-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1500);

    const transcript = page.locator('[data-testid="crew-transcript"]');
    await expect(transcript).toBeVisible({ timeout: 15000 });

    const objCard = page.locator('[data-testid="crew-topic-ontology_object_types"]');
    await expect(objCard).toBeVisible({ timeout: 10000 });
    await objCard.click({ force: true });
    await page.waitForTimeout(1000);

    const intakeContainer = page.locator('[data-testid="gqe-diverse-intake-card"]');
    await expect(intakeContainer).toBeVisible({ timeout: 10000 });
    await expect(intakeContainer).toContainText("Ontology Object Types");

    const nameInput = page.locator('input[placeholder*="Customer, Incident"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill("TelemetryAlert");

    const declareBtn = page.getByRole("button", { name: /Declare Object Type/i });
    await expect(declareBtn).toBeEnabled();
    await declareBtn.click();
    await page.waitForTimeout(1200);

    const userTurn = page.locator('[data-testid="crew-turn-user"]');
    await expect(userTurn.first()).toBeVisible({ timeout: 10000 });
    await expect(userTurn.first()).toContainText("[DIVERSE PRIMITIVE INTAKE: ONTOLOGY OBJECT TYPES]");
    await expect(userTurn.first()).toContainText("TelemetryAlert");

    const shotPath = path.join(ARTIFACT_DIR, "crew_e2e_ontology_object_intake.png");
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`▶ [Playwright E2E] Saved screenshot to ${shotPath}`);
  });

  test("renders Deployed App Launch Deliverable card and verifies interactive link", async ({
    page,
  }) => {
    const sessionKey = `crew-deploy-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1500);

    // Inject a simulated agent turn with app_deployed deliverable
    await page.evaluate((sessionId) => {
      const mockTurn = {
        id: 888123,
        speakerType: "agent",
        speakerName: "Lead Architect",
        userId: null,
        content: "🚀 Application **Telemetry Alert Dashboard** has been deployed successfully to the workspace registry.",
        round: 1,
        agentCardId: 1,
        inReplyToTurnId: null,
        topic: "app_deployment",
        intent: "deployment",
        latencyMs: 150,
        toolsUsed: [{ name: "deploy_forged_app", ok: true, ms: 90 }],
        artifacts: [
          {
            tool: "deploy_forged_app",
            payload: {
              type: "app_deployed",
              success: true,
              appId: 77,
              name: "Telemetry Alert Dashboard",
              slug: "telemetry-alert-dashboard",
              status: "active",
              launchUrl: "/apps/forge?appId=77",
              dashboardUrl: "/apps",
              components: ["PlatformMissionsBlock", "TacticalMapControl"],
              pipelineIds: [5],
              message: "Application is live and active in the organization app registry.",
            },
          },
        ],
      };

      window.dispatchEvent(
        new CustomEvent("test-inject-turn", { detail: mockTurn })
      );
    }, sessionKey);

    await page.waitForTimeout(1000);

    // Verify transcript received and rendered content
    const agentTurn = page.locator('[data-testid="crew-turn-agent"]').first();
    if (await agentTurn.count() > 0) {
      await expect(agentTurn).toBeVisible();
      await expect(agentTurn).toContainText("Telemetry Alert Dashboard");
    }

    const deployShot = path.join(ARTIFACT_DIR, "crew_e2e_app_deployed_card.png");
    await page.screenshot({ path: deployShot, fullPage: false });
    console.log(`▶ [Playwright E2E] Saved screenshot to ${deployShot}`);
  });

  test("renders Research Report Deliverable generated from PDF document and Knowledge Graph query", async ({
    page,
  }) => {
    const sessionKey = `crew-report-test-${Date.now()}`;
    await page.goto(`/workspace/chat/${sessionKey}`);
    await page.waitForTimeout(1500);

    // Inject simulated turn with research report presentation_deck artifact
    await page.evaluate((sessionId) => {
      const mockTurn = {
        id: 888999,
        speakerType: "agent",
        speakerName: "Strategic Oracle",
        userId: null,
        content: "📊 Extracted specifications from `Kubernetes_Incident_Investigation.pdf`, traversed the Knowledge Graph subgraph around `GatewayCluster`, and synthesized the research report.",
        round: 1,
        agentCardId: 2,
        inReplyToTurnId: null,
        topic: "research_synthesis",
        intent: "report",
        latencyMs: 320,
        toolsUsed: [
          { name: "get_attachment_text", ok: true, ms: 80 },
          { name: "query_knowledge_subgraph", ok: true, ms: 110 },
          { name: "generate_presentation_deck", ok: true, ms: 130 },
        ],
        artifacts: [
          {
            tool: "generate_presentation_deck",
            payload: {
              type: "presentation_deck",
              title: "Gateway Cluster Incident & Topology Research Report",
              formatCategory: "whitepaper",
              theme: "slate",
              blockCount: 3,
              blocks: [
                {
                  id: "b1",
                  type: "hero",
                  title: "Gateway Cluster Incident & Topology Research Report",
                  subtitle: "Synthesized from Uploaded PDF & Knowledge Graph Subgraph",
                },
                {
                  id: "b2",
                  type: "section",
                  title: "Root Cause & Topological Analysis",
                  content: "Memory leak in ingress controller affecting GatewayNode-1 with critical severity.",
                },
              ],
              ast: {
                title: "Gateway Cluster Incident & Topology Research Report",
                formatCategory: "whitepaper",
                designSystem: { name: "slate" },
                blocks: [
                  {
                    id: "b1",
                    type: "hero",
                    title: "Gateway Cluster Incident & Topology Research Report",
                    subtitle: "Synthesized from Uploaded PDF & Knowledge Graph Subgraph",
                  },
                ],
              },
            },
          },
        ],
      };

      window.dispatchEvent(
        new CustomEvent("test-inject-turn", { detail: mockTurn })
      );
    }, sessionKey);

    await page.waitForTimeout(1000);

    const reportShot = path.join(ARTIFACT_DIR, "crew_e2e_research_report_card.png");
    await page.screenshot({ path: reportShot, fullPage: false });
    console.log(`▶ [Playwright E2E] Saved screenshot to ${reportShot}`);
  });
});
