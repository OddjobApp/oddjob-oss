import { test, expect } from "@playwright/test";
import { heavyLogic } from "../../server/domain/tools/v1/capabilities/generation.js";
import { presentationCrewService } from "../../server/domain/crew/core/presentation-crew.service.js";
import { presentationAssemblyService } from "../../server/domain/knowledge/core/presentation-assembly.service.js";
import { crewToolsService } from "../../server/domain/crew/core/crew-tools.service.js";
import { deliverableService } from "../../server/domain/mission/core/deliverable.service.js";
import { fileStorageSuccess } from "../../server/domain/knowledge/core/file-storage.js";
import type { ToolContext } from "../../server/domain/tools/v1/capabilities/types.js";

test.describe("Document Generation Capabilities in Missions & CREW Chats", () => {

  const testContext: ToolContext = {
    organizationId: 1,
    missionId: 1,
    missionRunId: 1,
  };

  test("1. Verifies Headless PDF Generation using Playwright & Storage", async () => {
    const pdfPath = `test-output/audit-report-${Date.now()}.pdf`;
    const result = await heavyLogic.pdf({
      path: pdfPath,
      title: "Oddjob Security & Architecture Report",
      content: `
        <h1>Oddjob System Architecture</h1>
        <p>This report verifies automated PDF generation via Playwright headless Chromium.</p>
        <table>
          <tr><th>Component</th><th>Status</th></tr>
          <tr><td>Control Plane</td><td>Operational</td></tr>
          <tr><td>CREW Orchestration</td><td>Active</td></tr>
        </table>
      `,
    }, testContext);

    expect(result).toContain(`Successfully generated PDF at ${pdfPath}`);
    const buffer = await fileStorageSuccess.readBuffer(1, pdfPath);
    expect(buffer).not.toBeNull();
    expect(buffer.length).toBeGreaterThan(0);
    // PDF Magic bytes check: '%PDF-'
    expect(buffer.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  test("2. Verifies Word (.docx) Generation & Formatting", async () => {
    const docxPath = `test-output/project-brief-${Date.now()}.docx`;
    const result = await heavyLogic.word({
      path: docxPath,
      title: "Autonomous Mission Specification",
      content: "Phase 1: Research & Discovery.\n\nPhase 2: Execution & Synthesis.\n\nPhase 3: Final Sign-off.",
    }, testContext);

    expect(result).toContain(`Successfully generated Word document at ${docxPath}`);
    const buffer = await fileStorageSuccess.readBuffer(1, docxPath);
    expect(buffer).not.toBeNull();
    expect(buffer.length).toBeGreaterThan(0);
    // DOCX files are zip archives starting with 'PK\x03\x04'
    expect(buffer.toString("binary", 0, 2)).toBe("PK");
  });

  test("3. Verifies Excel (.xlsx) Dataset Generation", async () => {
    const xlsxPath = `test-output/mission-metrics-${Date.now()}.xlsx`;
    const result = await heavyLogic.excel({
      path: xlsxPath,
      sheetName: "Performance Metrics",
      data: [
        { Step: "Step 1: Ingestion", LatencyMs: 120, Status: "Passed" },
        { Step: "Step 2: Analysis", LatencyMs: 340, Status: "Passed" },
        { Step: "Step 3: Document Export", LatencyMs: 210, Status: "Passed" },
      ],
    }, testContext);

    expect(result).toContain(`Successfully generated Excel file at ${xlsxPath}`);
    const buffer = await fileStorageSuccess.readBuffer(1, xlsxPath);
    expect(buffer).not.toBeNull();
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString("binary", 0, 2)).toBe("PK");
  });

  test("4. Verifies Mermaid.js Architectural Diagram Generation", async () => {
    const diagramPath = `test-output/architecture-${Date.now()}.mermaid`;
    const diagramCode = `graph TD\n  A[CREW Chat] --> B[Tool Resolver]\n  B --> C[Generation Engine]\n  C --> D[Mission Deliverable]`;

    const result = await heavyLogic.diagram({
      path: diagramPath,
      title: "Oddjob Dataflow Diagram",
      code: diagramCode,
    }, testContext);

    expect(result).toContain(`Successfully generated Mermaid diagram at ${diagramPath}`);
    expect(result).toContain("```mermaid");

    const content = await fileStorageSuccess.readFile(1, diagramPath);
    expect(content).toContain("graph TD");
    expect(content).toContain("CREW Chat");
  });

  test("5. Verifies 4-Agent Creative Presentation Crew Pipeline & Compilers", async () => {
    const rawMarkdown = `
# Autonomous Control Plane Overview

## System Architecture
- 5-Layer Governed Control Stack
- Real-Time Telemetry Engine
- Eulerian Spatial Analytics

## Key Performance Indicators
System achieved 99.98% reliability across 12,000 mission cycles.
`;

    // 5.1 Orchestrate 4-Agent Creative Crew
    const crewResult = await presentationCrewService.orchestrateCreativeCrew(rawMarkdown, {
      title: "Oddjob Enterprise Deck",
      formatCategory: "presentation_deck",
      preferredThemeId: "dark_cyberpunk",
    });

    expect(crewResult.assignedRoster.length).toBe(4);
    expect(crewResult.executionPhases.length).toBe(4);
    expect(crewResult.ast.blocks.length).toBeGreaterThanOrEqual(2);
    expect(crewResult.ast.designSystem.id).toBe("dark_cyberpunk");

    // 5.2 Verify HTML Web Deck Compilation
    const htmlWebDeck = presentationAssemblyService.compileToWebDeck(crewResult.ast);
    expect(htmlWebDeck).toContain("<!DOCTYPE html>");
    expect(htmlWebDeck).toContain("Oddjob Enterprise Deck");
    expect(htmlWebDeck).toContain("slide-frame");

    // 5.3 Verify Markdown Summary Compilation
    const mdSummary = presentationAssemblyService.compileToMarkdownSummary(crewResult.ast);
    expect(mdSummary).toContain("# Oddjob Enterprise Deck");
    expect(mdSummary).toContain("Dark Cyberpunk");
  });

  test("6. Verifies CREW Chat Tools Resolution & Artifact Detection", async () => {
    const dummyAgentCard: any = {
      id: "agent-strategist",
      name: "Lead Strategist",
      role: "strategist",
      tools: ["search_unified_knowledge", "run_dependency_audit"],
    };

    // 6.1 Verify all document generation tools are resolved
    const resolvedTools = await crewToolsService.resolveForCard(dummyAgentCard);
    const toolNames = resolvedTools.map((t) => t.definition.name);

    expect(toolNames).toContain("generate_pdf");
    expect(toolNames).toContain("generate_excel");
    expect(toolNames).toContain("generate_word");
    expect(toolNames).toContain("generate_google_doc");
    expect(toolNames).toContain("generate_mermaid_diagram");
    expect(toolNames).toContain("generate_presentation_deck");
    expect(toolNames).toContain("list_document_templates");
    expect(toolNames).toContain("get_document_template");

    // 6.2 Verify execute() detects presentation_deck artifact
    const { record, output, artifact } = await crewToolsService.execute(
      "generate_presentation_deck",
      {
        title: "Executive Synthesis",
        content: "# Brief\n- Point 1\n- Point 2",
        themeId: "dark_cyberpunk",
        formatCategory: "presentation_deck",
      },
      resolvedTools,
      testContext
    );

    expect(record.ok).toBe(true);
    expect(artifact).not.toBeNull();
    expect(artifact?.payload.type).toBe("presentation_deck");
    expect(artifact?.payload.title).toBe("Executive Synthesis");
    expect(output).toContain("Rendered a \"presentation_deck\" surface");
  });

  test("7. Verifies Mission Deliverable Service & API Integration", async ({ request }) => {
    // 7.1 Record deliverable in database
    const deliverable = await deliverableService.recordDeliverable({
      missionId: 1,
      missionRunId: 1,
      name: "Playwright Verified Deliverable",
      content: "# Verification Report\n\nAutomated E2E document generation verified successfully.",
      type: "specification",
      metadata: { verifiedBy: "playwright", timestamp: Date.now() },
    });

    expect(deliverable).toBeDefined();
    expect(deliverable.id).toBeGreaterThan(0);

    // 7.2 Fetch via API endpoint
    const response = await request.get(`/api/missions/1/deliverables`);
    expect(response.ok()).toBeTruthy();

    const deliverables = await response.json();
    expect(Array.isArray(deliverables)).toBe(true);
    const found = deliverables.find((d: any) => d.id === deliverable.id);
    expect(found).toBeDefined();
    expect(found.name).toBe("Playwright Verified Deliverable");
    expect(found.type).toBe("specification");
  });

  test("8. Verifies CREW Chat UI Navigation with Playwright Browser", async ({ page }) => {
    // Navigate to Chat interface
    await page.goto("/workspace/chat", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 15000 });

    // Locate composer / chat input area
    const chatInput = page.locator('textarea, input[type="text"]').last();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    // Take verification screenshot of chat surface
    const screenshotPath = "test-results/crew-chat-verification.png";
    await page.screenshot({ path: screenshotPath, fullPage: false });
  });

  test("9. Verifies Operations Missions Surface with Playwright Browser", async ({ page }) => {
    // Navigate to Operations / Missions
    await page.goto("/operations", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 15000 });

    // Take verification screenshot of operations surface
    const screenshotPath = "test-results/operations-verification.png";
    await page.screenshot({ path: screenshotPath, fullPage: false });
  });
});
