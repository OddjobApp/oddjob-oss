import { describe, it, expect } from "vitest";
import {
  DocumentBlockASTSchema,
  HeroHeaderBlockSchema,
  SlideFrameBlockSchema,
  MagazineAdBlockSchema,
  FeatureGridBlockSchema,
  StatCalloutBlockSchema,
  PREBUILT_PRESENTATION_THEMES,
} from "@shared/schema/document-block.schema.js";
import { presentationAssemblyService } from "../core/presentation-assembly.service.js";
import { presentationMediaService } from "../core/presentation-media.service.js";
import { PresentationAssemblyExecutor } from "../../jobs/core/executors/presentation-assembly-executor.js";

describe("Document Blocking & Presentation Assembly Engine", () => {

  it("validates all atomic document block schemas", () => {
    const hero = HeroHeaderBlockSchema.parse({
      id: "h1",
      type: "hero_header",
      headline: "Autonomous Control Plane",
      subheadline: "5-Layer Governed Control & Assembly",
      ctaText: "Get Started",
      layout: "split_left",
    });
    expect(hero.type).toBe("hero_header");

    const slide = SlideFrameBlockSchema.parse({
      id: "s1",
      type: "slide_frame",
      slideNumber: 1,
      headline: "Market Architecture",
      bodyMarkdown: "Detailed breakdown of market components.",
      bulletPoints: ["Scale", "Speed", "Security"],
      layout: "three_cards",
    });
    expect(slide.bulletPoints).toHaveLength(3);

    const magazine = MagazineAdBlockSchema.parse({
      id: "m1",
      type: "magazine_ad",
      headline: "Redefining Agentic Operations",
      bodyText: "Full-spectrum autonomous campaign management.",
      quote: "The future of automation.",
      author: "Chief Architect",
      layout: "editorial_asymmetric",
    });
    expect(magazine.quote).toBe("The future of automation.");

    const featureGrid = FeatureGridBlockSchema.parse({
      id: "f1",
      type: "feature_grid",
      title: "Core Engines",
      cards: [
        { title: "DAG Resolver", description: "Topological prerequisite execution" },
        { title: "X-Ray Graph", description: "System topology index" },
      ],
      columns: 2,
    });
    expect(featureGrid.cards).toHaveLength(2);

    const stats = StatCalloutBlockSchema.parse({
      id: "st1",
      type: "stat_callout",
      title: "Key Metrics",
      stats: [
        { value: "99.9%", label: "Uptime", delta: "+2%", isPositive: true },
      ],
    });
    expect(stats.stats[0].value).toBe("99.9%");
  });

  it("distills raw markdown text into a valid DocumentBlockAST with auto-generated media", () => {
    const rawMarkdown = `
# Executive Strategic Brief

## Market Overview
- Rapid expansion across enterprise cloud accounts.
- Increasing demand for autonomous governance quorums.

## Financial Forecast
Strong Q3 margins driven by automated dispatch engines.
`;

    const ast = presentationAssemblyService.distillContentToBlockAST(
      rawMarkdown,
      "Oddjob Q3 Strategy",
      "presentation_deck",
      "dark_cyberpunk",
      true
    );

    expect(ast.title).toBe("Oddjob Q3 Strategy");
    expect(ast.designSystem.id).toBe("dark_cyberpunk");
    expect(ast.blocks.length).toBeGreaterThanOrEqual(2);
    expect((ast.blocks[0] as any).imageUrl).toContain("data:image/svg+xml");
    expect(DocumentBlockASTSchema.safeParse(ast).success).toBe(true);
  });

  it("synthesizes theme-matched art direction prompts and media placeholders", async () => {
    const rawMarkdown = "# Product Vision\nBuilding composable AI workbenches.";
    const ast = presentationAssemblyService.distillContentToBlockAST(rawMarkdown, "Vision");

    const prompt = presentationMediaService.generateArtDirectionPrompt(ast.blocks[0], PREBUILT_PRESENTATION_THEMES["editorial_magazine"]);
    expect(prompt).toContain("Editorial fashion photography");

    const enrichedAst = await presentationMediaService.synthesizeMediaForBlockAST(ast);
    expect((enrichedAst.blocks[0] as any).imageUrl).toContain("data:image/svg+xml");
  });

  it("applies prebuilt design system themes correctly", () => {
    const rawMarkdown = "# Product Vision\nBuilding composable AI workbenches.";
    const initialAst = presentationAssemblyService.distillContentToBlockAST(rawMarkdown, "Vision");

    const updatedAst = presentationAssemblyService.applyDesignSystem(initialAst, "editorial_magazine");
    expect(updatedAst.designSystem.id).toBe("editorial_magazine");
    expect(updatedAst.designSystem.isDark).toBe(false);
    expect(updatedAst.designSystem.typography.fontFamilyHeading).toContain("Playfair");
  });

  it("compiles DocumentBlockAST into a standalone HTML web presentation deck with hero media", () => {
    const rawMarkdown = "# Executive Brief\n- Key Point A\n- Key Point B";
    const ast = presentationAssemblyService.distillContentToBlockAST(rawMarkdown, "Executive Deck");

    const html = presentationAssemblyService.compileToWebDeck(ast);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Executive Deck");
    expect(html).toContain("media-frame");
    expect(html).toContain("slide-frame");
  });

  it("executes PresentationAssemblyExecutor contract cleanly", async () => {
    const executor = new PresentationAssemblyExecutor();
    expect(executor.canExecute("presentation_document_assembly")).toBe(true);

    const mockJob: any = {
      id: 99,
      name: "Generate Executive Presentation",
      organizationId: 1,
      description: "# Mission Report\nAll operational cycles completed.",
    };

    const mockContext: any = {
      evaluate: (expr: string) => null,
    };

    const result = await executor.execute(
      mockJob,
      { themeId: "glass_corporate", formatCategory: "presentation_deck" },
      {} as any,
      mockContext
    );

    expect(result.success).toBe(true);

    // Step output travels as a string through the pipeline runner, so the
    // executor serializes its result. Parsing here asserts the contract the
    // runner actually sees rather than an object it would never receive.
    const output = JSON.parse(result.output);
    expect(output.themeId).toBe("glass_corporate");
    expect(output.blockCount).toBeGreaterThan(0);
    expect(output.htmlWebDeck).toContain("<!DOCTYPE html>");
  });
});
