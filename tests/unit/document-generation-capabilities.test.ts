import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GENERATION_TOOLS, heavyLogic } from "../../server/domain/tools/v1/capabilities/generation.js";
import { fileStorageSuccess } from "../../server/domain/knowledge/core/file-storage.js";
import { crewToolsService } from "../../server/domain/crew/core/crew-tools.service.js";
import { presentationCrewService } from "../../server/domain/crew/core/presentation-crew.service.js";
import { presentationAssemblyService } from "../../server/domain/knowledge/core/presentation-assembly.service.js";
import { deliverableService } from "../../server/domain/mission/core/deliverable.service.js";
import { DEFAULT_TOPIC_ARCHETYPES } from "../../client/src/components/agent-chat/AgentChatPanel.js";
import fs from "node:fs";
import path from "node:path";

describe("Document & Presentation Deck Generation Capabilities Suite", () => {
  it("exposes all core document generation tools in GENERATION_TOOLS", () => {
    expect(GENERATION_TOOLS.generate_pdf).toBeDefined();
    expect(GENERATION_TOOLS.generate_word).toBeDefined();
    expect(GENERATION_TOOLS.generate_excel).toBeDefined();
    expect(GENERATION_TOOLS.generate_google_doc).toBeDefined();
    expect(GENERATION_TOOLS.generate_mermaid_diagram).toBeDefined();
    expect(GENERATION_TOOLS.generate_presentation_deck).toBeDefined();
    expect(GENERATION_TOOLS.ai_translate).toBeDefined();
  });

  it("executes generate_presentation_deck and returns a valid AST with summary", async () => {
    const rawResult = await GENERATION_TOOLS.generate_presentation_deck.execute({
      title: "Oddjob 5-Layer Platform Architecture",
      content: "Overview of Layer 1 to Layer 5 governance and telemetry.",
      themeId: "dark_cyberpunk",
      formatCategory: "presentation_deck",
    });

    const parsed = JSON.parse(rawResult);
    expect(parsed.type).toBe("presentation_deck");
    expect(parsed.title).toBe("Oddjob 5-Layer Platform Architecture");
    expect(parsed.formatCategory).toBe("presentation_deck");
    expect(parsed.blockCount).toBeGreaterThanOrEqual(1);
    expect(parsed.ast).toBeDefined();
    expect(parsed.ast.blocks).toBeDefined();
    expect(parsed.ast.designSystem).toBeDefined();
  });

  it("compiles presentation AST to standalone HTML web deck", async () => {
    const crewResult = await presentationCrewService.orchestrateCreativeCrew(
      "Executive summary and system metrics.",
      {
        title: "Compiled HTML Web Deck Test",
        preferredThemeId: "glass_corporate",
        formatCategory: "presentation_deck",
      }
    );

    const htmlDeck = presentationAssemblyService.compileToWebDeck(crewResult.ast);
    expect(htmlDeck).toContain("<!DOCTYPE html>");
    expect(htmlDeck).toContain("Compiled HTML Web Deck Test");
    expect(htmlDeck).toContain("slide-frame");
    expect(htmlDeck).toContain("hero-slide");
  });

  it("resolves generation tools in CREW chat universal tool set", async () => {
    const mockCard = {
      id: 999,
      name: "Lead Strategist",
      description: "Strategic lead agent",
      personaType: "Strategist",
      capabilities: ["strategic-planning"],
      tools: [],
      soulArchetype: "Strategic Oracle",
      legend: "Chief of Strategy",
      enabled: true,
    };

    const resolved = await crewToolsService.resolveForCard(mockCard as any);
    const toolNames = resolved.map((t) => t.definition.name);

    expect(toolNames).toContain("generate_presentation_deck");
    expect(toolNames).toContain("generate_pdf");
    expect(toolNames).toContain("generate_word");
    expect(toolNames).toContain("generate_excel");
    expect(toolNames).toContain("generate_mermaid_diagram");
    expect(toolNames).toContain("search_unified_knowledge");
    expect(toolNames).toContain("propose_mission");
  });

  it("detects and extracts presentation_deck artifact correctly", async () => {
    const mockCard = {
      id: 999,
      name: "Lead Strategist",
      description: "Strategic lead agent",
      personaType: "Strategist",
      capabilities: ["strategic-planning"],
      tools: [],
      soulArchetype: "Strategic Oracle",
      legend: "Chief of Strategy",
      enabled: true,
    };

    const resolvedTools = await crewToolsService.resolveForCard(mockCard as any);
    const { output, artifact } = await crewToolsService.execute(
      "generate_presentation_deck",
      {
        title: "Interactive AST Deck",
        content: "Core architectural primitives and blocks.",
        themeId: "dark_cyberpunk",
        formatCategory: "presentation_deck",
      },
      resolvedTools,
      { organizationId: 1, userId: "user-1" } as any
    );

    expect(artifact).not.toBeNull();
    expect(artifact?.tool).toBe("generate_presentation_deck");
    expect(artifact?.payload.type).toBe("presentation_deck");
    expect(artifact?.payload.title).toBe("Interactive AST Deck");
    expect(output).toContain('Rendered a "presentation_deck" surface');
  });

  it("includes presentation_deck_studio in default topic archetypes for CREW chat UI", () => {
    const deckArchetype = DEFAULT_TOPIC_ARCHETYPES.find(
      (a) => a.id === "presentation_deck_studio"
    );
    expect(deckArchetype).toBeDefined();
    expect(deckArchetype?.label).toContain("Deck");
    expect(deckArchetype?.podComponent).toBe("DocumentDeckPod");
    expect(deckArchetype?.suggestedDeliverables.length).toBeGreaterThan(0);
  });

  it("verifies capability documentation file exists and has non-placeholder markdown", () => {
    const docPath = path.resolve(process.cwd(), "docs/capabilities/generate_presentation_deck.md");
    expect(fs.existsSync(docPath)).toBe(true);

    const docContent = fs.readFileSync(docPath, "utf-8");
    expect(docContent).not.toContain('{"answer":');
    expect(docContent).toContain("Generate Presentation Deck");
    expect(docContent).toContain("generate_presentation_deck");
  });

  it("compiles DocumentBlockAST with all block types into a valid styled DOCX buffer", async () => {
    const mockAst: any = {
      id: "test-doc-ast",
      title: "Quarterly Systems & Strategic Review",
      subtitle: "Autonomous Agent Orchestration and Telemetry Summary",
      formatCategory: "whitepaper",
      designSystem: {
        id: "glass_corporate",
        name: "Glass Corporate",
        isDark: true,
        colors: {
          primary: "#3b82f6",
          secondary: "#10b981",
          accent: "#f59e0b",
          background: "#0f172a",
          surface: "#1e293b",
          textPrimary: "#ffffff",
          textSecondary: "#94a3b8",
        },
      },
      blocks: [
        {
          id: "b1",
          type: "hero_header",
          headline: "Executive Summary: Autonomous Scale",
          subheadline: "Deploying 50+ governed AI agents across multi-cluster nodes.",
          ctaText: "Explore Telemetry",
        },
        {
          id: "b2",
          type: "slide_frame",
          slideNumber: 1,
          headline: "Cluster Health & Metrics",
          bodyMarkdown: "System operating at 99.98% reliability across all regional zones.",
          bulletPoints: ["Zero downtime failovers", "Sub-50ms token latency"],
          speakerNotes: "Emphasize stability under peak load.",
        },
        {
          id: "b3",
          type: "magazine_ad",
          headline: "Next-Gen AI Control Plane",
          bodyText: "Hermes distributed tracing and forensic telemetry unify operational visibility.",
          quote: "The single most resilient workflow engine we have deployed.",
          author: "Lead Architect",
          supportingPoints: ["Enterprise security", "Full audit trail"],
        },
        {
          id: "b4",
          type: "feature_grid",
          title: "Core Capabilities",
          cards: [
            { title: "Dynamic Rerouting", description: "Real-time circuit breaker triggers.", highlightTag: "High-Priority" },
            { title: "RAG Governance", description: "Knowledge retrieval with entity lineage." },
          ],
        },
        {
          id: "b5",
          type: "stat_callout",
          title: "Key Performance Indicators",
          stats: [
            { label: "Throughput", value: "14.2k ops/sec", delta: "+28%", isPositive: true },
            { label: "Error Rate", value: "0.001%", isPositive: true },
          ],
        },
        {
          id: "b6",
          type: "comparison_matrix",
          title: "Architecture Comparison",
          competitorName: "Legacy Scripts",
          ourName: "Oddjob CREW",
          rows: [
            { feature: "Agent Deliberation", competitorValue: "Manual", ourValue: "Autonomous War Room", isOurAdvantage: true },
            { feature: "Traceability", competitorValue: "Basic Logs", ourValue: "W3C Distributed Tracing", isOurAdvantage: true },
          ],
        },
        {
          id: "b7",
          type: "timeline",
          title: "Deployment Milestones",
          events: [
            { dateOrPhase: "Phase 1", title: "Kernel Ingestion", description: "Completed data lake connector.", status: "completed" },
            { dateOrPhase: "Phase 2", title: "CREW Integration", description: "Live multi-agent deliberation.", status: "active" },
          ],
        },
      ],
    };

    const docxBuffer = await presentationAssemblyService.compileASTToDocx(mockAst);
    expect(docxBuffer).toBeDefined();
    expect(docxBuffer.length).toBeGreaterThan(1000);
    // Standard DOCX zip header magic bytes: PK (0x50, 0x4B)
    expect(docxBuffer[0]).toBe(0x50);
    expect(docxBuffer[1]).toBe(0x4B);
  });

  it("includes print stylesheet and page-break rules in compiled HTML web deck", async () => {
    const crewResult = await presentationCrewService.orchestrateCreativeCrew(
      "Whitepaper on AI safety and multi-agent governance.",
      {
        title: "AI Safety Whitepaper",
        preferredThemeId: "editorial_magazine",
        formatCategory: "whitepaper",
      }
    );

    const html = presentationAssemblyService.compileToWebDeck(crewResult.ast);
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("exposes extended design and creative crew parameters on PDF and Word generation tools", () => {
    const pdfParams = GENERATION_TOOLS.generate_pdf.parameters.shape as any;
    expect(pdfParams.themeId).toBeDefined();
    expect(pdfParams.formatCategory).toBeDefined();
    expect(pdfParams.useCreativeCrew).toBeDefined();

    const wordParams = GENERATION_TOOLS.generate_word.parameters.shape as any;
    expect(wordParams.themeId).toBeDefined();
    expect(wordParams.formatCategory).toBeDefined();
    expect(wordParams.useCreativeCrew).toBeDefined();
  });

  it("compiles DocumentBlockAST with interactive ChartBlock and DiagramBlock into HTML and DOCX", async () => {
    const visualAst: any = {
      id: "visual-doc-ast",
      title: "Real-Time Telemetry & Architecture Spec",
      subtitle: "Chart & Diagram Blocks Demonstration",
      formatCategory: "whitepaper",
      designSystem: {
        id: "dark_cyberpunk",
        name: "Dark Cyberpunk",
        isDark: true,
        colors: {
          primary: "#a855f7",
          secondary: "#06b6d4",
          accent: "#ec4899",
          background: "#0b0f19",
          surface: "#182238",
          textPrimary: "#f8fafc",
          textSecondary: "#a1a1aa",
        },
      },
      blocks: [
        {
          id: "b-chart-1",
          type: "chart",
          title: "Quarterly Throughput Growth",
          chartType: "bar",
          labels: ["Q1", "Q2", "Q3", "Q4"],
          unit: "k ops/s",
          description: "Sustained throughput across all governed nodes.",
          datasets: [
            { label: "Throughput", data: [45, 82, 120, 195], color: "#06b6d4" },
          ],
        },
        {
          id: "b-diag-1",
          type: "diagram",
          title: "Distributed Tracing Architecture",
          diagramType: "mermaid",
          code: "flowchart LR\n  A[Incident Signal] --> B[CREW War Room]\n  B --> C[Tactical Dispatch]\n  C --> D[Field Confirmation]",
          caption: "W3C Trace Context Propagation Pipeline",
        },
      ],
    };

    // 1. Verify HTML compilation
    const htmlDeck = presentationAssemblyService.compileToWebDeck(visualAst);
    expect(htmlDeck).toContain("chart-block-container");
    expect(htmlDeck).toContain("Quarterly Throughput Growth");
    expect(htmlDeck).toContain("diagram-block-container");
    expect(htmlDeck).toContain("Distributed Tracing Architecture");
    expect(htmlDeck).toContain("W3C Trace Context Propagation Pipeline");

    // 2. Verify DOCX compilation
    const docxBuffer = await presentationAssemblyService.compileASTToDocx(visualAst);
    expect(docxBuffer).toBeDefined();
    expect(docxBuffer.length).toBeGreaterThan(1000);
    expect(docxBuffer[0]).toBe(0x50);
    expect(docxBuffer[1]).toBe(0x4B);

    // 3. Verify Markdown summary compilation
    const mdSummary = presentationAssemblyService.compileToMarkdownSummary(visualAst);
    expect(mdSummary).toContain("Quarterly Throughput Growth");
    expect(mdSummary).toContain("Distributed Tracing Architecture");
    expect(mdSummary).toContain("```mermaid");
  });

  it("compiles DocumentBlockAST into a valid native PowerPoint (.pptx) presentation buffer", async () => {
    expect(GENERATION_TOOLS.generate_powerpoint).toBeDefined();

    const pptxAst: any = {
      id: "pptx-doc-ast",
      title: "Enterprise Autonomous AI Platform",
      subtitle: "Q3 Architecture & Governance Briefing",
      formatCategory: "presentation_deck",
      designSystem: {
        id: "dark_cyberpunk",
        name: "Dark Cyberpunk",
        isDark: true,
        colors: {
          primary: "#a855f7",
          secondary: "#06b6d4",
          accent: "#ec4899",
          background: "#0b0f19",
          surface: "#182238",
          textPrimary: "#f8fafc",
          textSecondary: "#a1a1aa",
        },
      },
      blocks: [
        {
          id: "p1",
          type: "hero_header",
          headline: "Oddjob 5-Layer AI Control Plane",
          subheadline: "Real-Time Telemetry and Autonomous Deliberation",
          ctaText: "Launch Studio",
        },
        {
          id: "p2",
          type: "stat_callout",
          title: "Platform Metrics",
          stats: [
            { label: "Active Squads", value: "24 Agents", isPositive: true },
            { label: "Token Efficiency", value: "+38%", delta: "MoM", isPositive: true },
          ],
        },
        {
          id: "p3",
          type: "comparison_matrix",
          title: "Competitive Landscape",
          competitorName: "Traditional Automation",
          ourName: "Oddjob Autonomous CREW",
          rows: [
            { feature: "Multi-Agent Deliberation", competitorValue: "Sequential scripts", ourValue: "Autonomous War Room", isOurAdvantage: true },
            { feature: "Governance Layer", competitorValue: "Manual review", ourValue: "Swiss-Cheese Guardrails", isOurAdvantage: true },
          ],
        },
        {
          id: "p4",
          type: "chart",
          title: "Throughput Trajectory",
          chartType: "bar",
          labels: ["Jan", "Feb", "Mar", "Apr"],
          unit: "k ops",
          datasets: [{ label: "Operations", data: [12, 28, 45, 95] }],
        },
      ],
    };

    const pptxBuffer = await presentationAssemblyService.compileASTToPptx(pptxAst);
    expect(pptxBuffer).toBeDefined();
    expect(pptxBuffer.length).toBeGreaterThan(5000);
    // Standard PPTX zip magic bytes (PK - 0x50, 0x4B)
    expect(pptxBuffer[0]).toBe(0x50);
    expect(pptxBuffer[1]).toBe(0x4B);
  });

  it("performs conversational in-place mutations (modify, add, remove, change_theme) on DocumentBlockAST", async () => {
    expect(GENERATION_TOOLS.update_document_ast).toBeDefined();

    const baseAst: any = {
      id: "mutate-ast",
      title: "Initial Strategic Brief",
      formatCategory: "whitepaper",
      designSystem: {
        id: "dark_cyberpunk",
        name: "Dark Cyberpunk",
        colors: { primary: "#a855f7", textPrimary: "#ffffff" },
      },
      blocks: [
        { id: "b1", type: "hero_header", headline: "Initial Headline" },
        { id: "b2", type: "slide_frame", slideNumber: 1, headline: "Slide 1", bodyMarkdown: "Body 1", bulletPoints: [] },
      ],
    };

    // 1. modify_block
    const modAst = presentationAssemblyService.mutateBlockAST(baseAst, {
      action: "modify_block",
      blockId: "b1",
      updatedBlock: { headline: "Updated Punchy Headline" },
    });
    expect((modAst.blocks[0] as any).headline).toBe("Updated Punchy Headline");

    // 2. add_block
    const addAst = presentationAssemblyService.mutateBlockAST(modAst, {
      action: "add_block",
      targetIndex: 1,
      block: {
        id: "b-stat",
        type: "stat_callout",
        title: "Key Stats",
        stats: [{ label: "Efficiency", value: "99.9%", isPositive: true }],
      } as any,
    });
    expect(addAst.blocks.length).toBe(3);
    expect(addAst.blocks[1].id).toBe("b-stat");

    // 3. remove_block
    const rmAst = presentationAssemblyService.mutateBlockAST(addAst, {
      action: "remove_block",
      blockId: "b2",
    });
    expect(rmAst.blocks.length).toBe(2);
    expect(rmAst.blocks.find(b => b.id === "b2")).toBeUndefined();

    // 4. change_theme
    const themeAst = presentationAssemblyService.mutateBlockAST(rmAst, {
      action: "change_theme",
      themeId: "glass_corporate",
    });
    expect(themeAst.designSystem.id).toBe("glass_corporate");
    expect(themeAst.designSystem.name).toBe("Glass Corporate");

    // 5. Test update_document_ast tool execution
    const toolResultRaw = await GENERATION_TOOLS.update_document_ast.execute({
      ast: themeAst,
      operation: {
        action: "modify_block",
        blockId: "b1",
        updatedBlock: { headline: "Final Polished Headline" },
      },
    }, {} as any);

    const toolParsed = JSON.parse(toolResultRaw);
    expect(toolParsed.type).toBe("presentation_deck");
    expect(toolParsed.blocks[0].headline).toBe("Final Polished Headline");
    expect(toolParsed.summary).toContain("Updated Document AST via \"modify_block\"");
  });

  it("generates advanced styled Excel workbooks with multi-sheets, auto-filters, and summary formula rows", async () => {
    expect(GENERATION_TOOLS.generate_excel).toBeDefined();

    const saveSpy = vi.spyOn(fileStorageSuccess, "saveFile").mockResolvedValue({
      id: "excel-file-id",
      url: "storage/reports/financial_summary.xlsx",
    } as any);

    const result = await heavyLogic.excel({
      path: "reports/financial_summary.xlsx",
      themeId: "dark_cyberpunk",
      sheets: [
        {
          name: "Q3 Performance",
          title: "Quarterly Squad Operations & Cost Breakdown",
          data: [
            { squad: "Incident Triagers", runs: 1240, tokenCost: 450.25, successRate: 0.99 },
            { squad: "Forensic Analysts", runs: 850, tokenCost: 310.50, successRate: 0.98 },
            { squad: "Code Synthesizers", runs: 2100, tokenCost: 890.00, successRate: 0.95 },
          ],
          autoFilter: true,
          includeSummaryRow: true,
        },
        {
          name: "Region Metrics",
          title: "Spatial Mesh Cell Density",
          data: [
            { h3Index: "8828308281fffff", activeNodes: 42, latencyMs: 14.5 },
            { h3Index: "8828308283fffff", activeNodes: 38, latencyMs: 18.2 },
          ],
          autoFilter: true,
          includeSummaryRow: true,
        },
      ],
    }, { organizationId: "org-123" } as any);

    expect(result).toContain("Successfully generated styled Excel file");
    expect(result).toContain("5 rows");
    expect(result).toContain("2 sheet(s)");
    expect(saveSpy).toHaveBeenCalled();
  });

  it("renders Knowledge Graph citations and provenance badges across HTML, DOCX, PPTX, and Markdown compilers", async () => {
    const citedAst: any = {
      id: "cited-doc-ast",
      title: "Knowledge Graph Provenance Brief",
      formatCategory: "whitepaper",
      designSystem: {
        id: "glass_corporate",
        name: "Glass Corporate",
        colors: { primary: "#3b82f6", textPrimary: "#ffffff" },
      },
      blocks: [
        {
          id: "hero-kg",
          type: "hero_header",
          headline: "Verified Intelligence Report",
          citations: [
            {
              entityId: "node-kg-99",
              entityName: "Cluster Telemetry Graph",
              entityType: "telemetry_mesh",
              sourceQueryId: 104,
              confidenceScore: 0.98,
            },
            {
              entityId: "node-audit-12",
              entityName: "Security Baseline Specification",
              entityType: "system_spec",
              confidenceScore: 1.0,
            },
          ],
          provenance: {
            source: "W3C Distributed Tracing Mesh",
            verified: true,
            timestamp: "2026-08-21T20:00:00Z",
          },
        },
      ],
    };

    // 1. HTML Web Deck
    const html = presentationAssemblyService.compileToWebDeck(citedAst);
    expect(html).toContain("block-citations");
    expect(html).toContain("Cluster Telemetry Graph");
    expect(html).toContain("Security Baseline Specification");
    expect(html).toContain("Provenance: W3C Distributed Tracing Mesh (Verified)");

    // 2. DOCX
    const docx = await presentationAssemblyService.compileASTToDocx(citedAst);
    expect(docx).toBeDefined();
    expect(docx.length).toBeGreaterThan(1000);

    // 3. PPTX
    const pptx = await presentationAssemblyService.compileASTToPptx(citedAst);
    expect(pptx).toBeDefined();
    expect(pptx.length).toBeGreaterThan(1000);

    // 4. Markdown Summary
    const md = presentationAssemblyService.compileToMarkdownSummary(citedAst);
    expect(md).toContain("*Sources: [Cluster Telemetry Graph], [Security Baseline Specification]*");
  });
});

