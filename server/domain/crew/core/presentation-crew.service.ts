import { DocumentBlockAST, StatCalloutBlock } from "@shared/schema/document-block.schema.js";
import { PRESENTATION_SPECIALIST_ROSTER, PresentationAgentPersona } from "./presentation-agent-roster.js";
import {
  presentationAssemblyService,
  extractMetrics,
  auditThemeContrast,
} from "@domain/knowledge/core/presentation-assembly.service.js";
import { presentationMediaService } from "@domain/knowledge/core/presentation-media.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PresentationCrewService");

export interface CreativeCrewOrchestrationOptions {
  title?: string;
  formatCategory?: "presentation_deck" | "magazine_ad" | "whitepaper" | "executive_brief";
  preferredThemeId?: string;
  requireHilSignoff?: boolean;
}

export interface CreativeCrewResult {
  ast: DocumentBlockAST;
  assignedRoster: PresentationAgentPersona[];
  executionPhases: {
    phase: string;
    agentId: string;
    agentName: string;
    status: "completed" | "skipped";
    summary: string;
  }[];
  requiresHilSignoff: boolean;
}

export class PresentationCrewService {
  /**
   * Orchestrates the 4-agent Creative Crew pipeline to produce a polished DocumentBlockAST deliverable.
   */
  async orchestrateCreativeCrew(
    rawInput: string,
    options: CreativeCrewOrchestrationOptions = {}
  ): Promise<CreativeCrewResult> {
    const title = options.title || "Creative Presentation Deliverable";
    const formatCategory = options.formatCategory || "presentation_deck";
    const themeId = options.preferredThemeId || "dark_cyberpunk";
    const assignedRoster = Object.values(PRESENTATION_SPECIALIST_ROSTER);

    logger.info(`Orchestrating Creative Crew for "${title}" using ${assignedRoster.length} specialist agents`);

    const executionPhases: CreativeCrewResult["executionPhases"] = [];

    // Phase 1: Information Architect Distillation
    const infoAgent = PRESENTATION_SPECIALIST_ROSTER["information_architect"];
    let ast = presentationAssemblyService.distillContentToBlockAST(
      rawInput,
      title,
      formatCategory,
      themeId,
      false
    );
    executionPhases.push({
      phase: "1. Information Architecture & Block Sculpting",
      agentId: infoAgent.id,
      agentName: infoAgent.name,
      status: "completed",
      summary: `Sculpted raw content into ${ast.blocks.length} atomic document blocks.`,
    });

    // Phase 2: Data Storyteller Metric Callout Injection
    //
    // This phase used to execute nothing and report "Extracted key metrics and
    // structured card grid layouts" regardless. It now actually extracts, and
    // reports honestly when the source carried no figures — a document with no
    // numbers in it should not claim a metrics pass found any.
    const dataAgent = PRESENTATION_SPECIALIST_ROSTER["data_storyteller"];
    const metrics = extractMetrics(rawInput);
    if (metrics.length > 0) {
      ast = {
        ...ast,
        blocks: [
          ...ast.blocks,
          {
            id: "block-metrics",
            type: "stat_callout",
            title: "Figures cited in this document",
            stats: metrics.map((m) => ({ value: m.value, label: m.label, isPositive: true })),
          } as StatCalloutBlock,
        ],
      };
    }
    executionPhases.push({
      phase: "2. Data Storytelling & Metric Extraction",
      agentId: dataAgent.id,
      agentName: dataAgent.name,
      status: metrics.length > 0 ? "completed" : "skipped",
      summary: metrics.length > 0
        ? `Extracted ${metrics.length} figure(s) from the source and surfaced them as a callout: ${metrics.map((m) => m.value).join(", ")}.`
        : "No figures were present in the source content; no metrics callout was added.",
    });

    // Phase 3: Art Director Theme & Media Asset Synthesis
    const artAgent = PRESENTATION_SPECIALIST_ROSTER["art_director"];
    ast = presentationAssemblyService.applyDesignSystem(ast, themeId);
    ast = await presentationMediaService.synthesizeMediaForBlockAST(ast);
    executionPhases.push({
      phase: "3. Art Direction & Visual Media Synthesis",
      agentId: artAgent.id,
      agentName: artAgent.name,
      status: "completed",
      summary: `Applied ${ast.designSystem.name} theme and synthesized theme-matched hero imagery.`,
    });

    // Phase 4: Brand Guardian Hygiene & Compliance Check
    //
    // "Verified WCAG contrast standards" was asserted by a phase that measured
    // nothing. It measures now: real relative-luminance ratios against the
    // theme's own surfaces, and it names the pairs that fail rather than
    // claiming a pass on their behalf.
    const brandAgent = PRESENTATION_SPECIALIST_ROSTER["brand_guardian"];
    const requiresHilSignoff = options.requireHilSignoff || formatCategory === "magazine_ad";
    const contrast = auditThemeContrast(ast.designSystem);
    const failures = contrast.filter((c) => !c.passesAA);
    const contrastSummary = failures.length === 0
      ? `Checked ${contrast.length} colour pair(s) against WCAG AA (4.5:1); all pass.`
      : `Checked ${contrast.length} colour pair(s) against WCAG AA (4.5:1); ${failures.length} below threshold: ` +
        failures.map((f) => `${f.pair} at ${f.ratio === null ? "unparseable" : f.ratio.toFixed(2)}:1`).join(", ") + ".";

    executionPhases.push({
      phase: "4. Brand Hygiene & Compliance Audit",
      agentId: brandAgent.id,
      agentName: brandAgent.name,
      status: "completed",
      summary: requiresHilSignoff
        ? `${contrastSummary} Mounted HIL sign-off gate for publication approval.`
        : contrastSummary,
    });

    return {
      ast,
      assignedRoster,
      executionPhases,
      requiresHilSignoff,
    };
  }
}

export const presentationCrewService = new PresentationCrewService();
