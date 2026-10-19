import { describe, it, expect } from "vitest";
import { PRESENTATION_SPECIALIST_ROSTER } from "../core/presentation-agent-roster.js";
import { presentationCrewService } from "../core/presentation-crew.service.js";
import { presentationMediaService } from "@domain/knowledge/core/presentation-media.service.js";
import { PREBUILT_PRESENTATION_THEMES } from "@shared/schema/document-block.schema.js";

describe("Specialized Creative Presentation Crew & Midjourney Model Bindings", () => {
  it("binds specialized LLM/image models to agent personas", () => {
    const artDirector = PRESENTATION_SPECIALIST_ROSTER["art_director"];
    expect(artDirector.name).toContain("Pixel Maestro");
    expect(artDirector.preferredModelProvider).toBe("midjourney");
    expect(artDirector.imageModelBinding).toBe("midjourney-v6");
    expect(artDirector.capabilities).toContain("midjourney_v6_prompting");

    const infoArchitect = PRESENTATION_SPECIALIST_ROSTER["information_architect"];
    expect(infoArchitect.name).toContain("Copy & Block Sculptor");
    expect(infoArchitect.preferredModelProvider).toBe("anthropic");

    const dataStoryteller = PRESENTATION_SPECIALIST_ROSTER["data_storyteller"];
    expect(dataStoryteller.preferredModelProvider).toBe("openai");
  });

  it("formats Midjourney-compliant prompt parameter strings (--ar 16:9 --v 6.0)", () => {
    const mockBlock: any = { type: "slide_frame", headline: "Enterprise Platform" };
    const theme = PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];

    const midjourneyPrompt = presentationMediaService.generateArtDirectionPrompt(mockBlock, theme, "midjourney");
    expect(midjourneyPrompt).toContain("--ar 16:9");
    expect(midjourneyPrompt).toContain("--v 6.0");
    expect(midjourneyPrompt).toContain("--stylize 250");

    const magazineBlock: any = { type: "magazine_ad", headline: "Brand Campaign" };
    const magazinePrompt = presentationMediaService.generateArtDirectionPrompt(magazineBlock, theme, "midjourney");
    expect(magazinePrompt).toContain("--ar 4:5");
  });

  it("orchestrates the 4-phase creative crew execution pipeline cleanly", async () => {
    const rawMarkdown = `
# Autonomous Platform Launch

## Executive Summary
Oddjob 5-Layer AI Control Plane delivers 10x velocity across enterprise workflows.

## Key Performance Indicators
- 99.9% Autonomous Task Accuracy
- 0 Manual Configuration Overhead
- 500+ Scanned AST Nodes
`;

    const result = await presentationCrewService.orchestrateCreativeCrew(rawMarkdown, {
      title: "Platform Launch Deck",
      preferredThemeId: "glass_corporate",
      formatCategory: "presentation_deck",
    });

    expect(result.assignedRoster).toHaveLength(4);
    expect(result.executionPhases).toHaveLength(4);
    expect(result.ast.title).toBe("Platform Launch Deck");
    expect(result.ast.designSystem.id).toBe("glass_corporate");
    expect((result.ast.blocks[0] as any).imageUrl).toBeDefined();
    expect(result.executionPhases[0].status).toBe("completed");
    expect(result.executionPhases[2].status).toBe("completed");
  });
});
