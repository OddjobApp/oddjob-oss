import type _PptxGenJS from "pptxgenjs";
import type { CjsDefault } from "@shared/cjs-interop.js";

/** The constructor half of pptxgenjs's class/namespace merge. See its use below. */
type PptxGenCtor = CjsDefault<typeof _PptxGenJS>;
import {
  DocumentBlockAST,
  DocumentBlock,
  PresentationDesignSystem,
  PREBUILT_PRESENTATION_THEMES,
  HeroHeaderBlock,
  SlideFrameBlock,
  MagazineAdBlock,
  FeatureGridBlock,
  StatCalloutBlock,
  ComparisonMatrixBlock,
  TimelineBlock,
  ChartBlock,
  DiagramBlock,
} from "@shared/schema/document-block.schema.js";
import { presentationMediaService } from "./presentation-media.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PresentationAssemblyService");

export type ASTMutationOperation =
  | { action: "modify_block"; blockId: string; updatedBlock: Partial<DocumentBlock> | DocumentBlock }
  | { action: "add_block"; block: DocumentBlock; targetIndex?: number }
  | { action: "remove_block"; blockId: string }
  | { action: "change_theme"; themeId: string }
  | { action: "reorder_blocks"; fromIndex: number; toIndex: number };

/**
 * Renders a JSON payload as markdown so the distiller can structure it.
 *
 * Returns null for anything that is not JSON, so callers fall through to the
 * raw text path. Object keys become headings, scalars become bullets, and
 * arrays of scalars become bullet lists — the shape tool output actually takes.
 */
export function jsonToMarkdown(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const humanise = (key: string) =>
    key
      .replace(/[_\-.]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (c) => c.toUpperCase());

  const lines: string[] = [];

  const walk = (value: unknown, label: string, depth: number): void => {
    // Past three levels the nesting is structural detail, not content; render
    // it as one compact line rather than a cascade of near-empty headings.
    if (depth > 3) {
      lines.push(`- ${humanise(label)}: ${JSON.stringify(value)}`);
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`- ${humanise(label)}: none`);
        return;
      }
      if (value.every((v) => v === null || typeof v !== "object")) {
        lines.push(`## ${humanise(label)}`);
        for (const v of value) lines.push(`- ${String(v)}`);
        return;
      }
      lines.push(`## ${humanise(label)}`);
      value.forEach((v, i) => walk(v, `${label} ${i + 1}`, depth + 1));
      return;
    }

    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        lines.push(`- ${humanise(label)}: none`);
        return;
      }
      if (depth > 0) lines.push(`## ${humanise(label)}`);
      const scalars = entries.filter(([, v]) => v === null || typeof v !== "object");
      const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
      for (const [k, v] of scalars) lines.push(`- ${humanise(k)}: ${String(v)}`);
      for (const [k, v] of nested) walk(v, k, depth + 1);
      return;
    }

    lines.push(`- ${humanise(label)}: ${String(value)}`);
  };

  if (Array.isArray(parsed)) {
    walk(parsed, "Items", 0);
  } else {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const scalars = entries.filter(([, v]) => v === null || typeof v !== "object");
    const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
    if (scalars.length > 0) {
      lines.push("## Summary");
      for (const [k, v] of scalars) lines.push(`- ${humanise(k)}: ${String(v)}`);
    }
    for (const [k, v] of nested) walk(v, k, 1);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Pulls figures that are actually present in the source text.
 *
 * This is the Data Storyteller phase's real work. That phase previously
 * reported "Extracted key metrics and structured card grid layouts" while
 * executing no code at all, so the claim was true of no document it described.
 * Nothing is invented here: a metric appears only if its digits appear in the
 * input, and the label is the surrounding words.
 */
export function extractMetrics(text: string): Array<{ value: string; label: string }> {
  const found: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  // "Failed jobs: 19", "spend is $284.17", "82% complete", "1,432 executions"
  const patterns = [
    /([A-Za-z][\w \-]{2,40}?)\s*[:=]\s*(\$?-?[\d,]+(?:\.\d+)?%?)/g,
    /(\$-?[\d,]+(?:\.\d+)?)\s+([a-z][\w \-]{2,40})/gi,
    /(-?[\d,]+(?:\.\d+)?%)\s+([a-z][\w \-]{2,40})/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const numericFirst = /^[$\d-]/.test(m[1]);
      const value = (numericFirst ? m[1] : m[2]).trim();
      const label = (numericFirst ? m[2] : m[1]).trim();
      if (!/\d/.test(value)) continue;
      const key = `${value}|${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ value, label: label.replace(/^./, (c) => c.toUpperCase()) });
      if (found.length >= 6) return found;
    }
  }

  return found;
}

/** Relative luminance per WCAG 2.1, from a #rgb or #rrggbb string. */
function relativeLuminance(hex: string): number | null {
  const raw = (hex ?? "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, or null if either is unparseable. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastFinding {
  pair: string;
  ratio: number | null;
  passesAA: boolean;
}

/**
 * Checks a theme's text colours against its surfaces.
 *
 * The Brand Guardian phase asserted "Verified WCAG contrast standards" without
 * measuring anything. This measures. 4.5:1 is the AA threshold for body text.
 */
export function auditThemeContrast(design: PresentationDesignSystem): ContrastFinding[] {
  const c = design.colors;
  const candidates: Array<[string, string, string]> = [
    ["primary text on background", c.textPrimary, c.background],
    ["primary text on surface", c.textPrimary, c.surface],
    ["secondary text on surface", c.textSecondary, c.surface],
    ["accent on background", c.accent, c.background],
  ];

  return candidates
    .filter(([, fg, bg]) => typeof fg === "string" && typeof bg === "string")
    .map(([pair, fg, bg]) => {
      const ratio = contrastRatio(fg, bg);
      return { pair, ratio, passesAA: ratio !== null && ratio >= 4.5 };
    });
}

/** Design-system values interpolated by the web deck stylesheet. */
interface DeckStyleTokens {
  colors: any;
  typography: any;
  borderRadius: string;
  glassmorphism: boolean;
  isDarkSurface: boolean;
  isProseDocument: boolean;
  isBrief: boolean;
}

export class PresentationAssemblyService {
  /**
   * Distills unstructured text or markdown into a structured DocumentBlockAST.
   */
  distillContentToBlockAST(
    rawText: string,
    title: string = "Presentation Deliverable",
    formatCategory: "presentation_deck" | "magazine_ad" | "whitepaper" | "executive_brief" = "presentation_deck",
    themeId: string = "dark_cyberpunk",
    autoGenerateMedia: boolean = true
  ): DocumentBlockAST {
    const designSystem = PREBUILT_PRESENTATION_THEMES[themeId] || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];
    const blocks: DocumentBlock[] = [];

    // Tool output arrives as JSON far more often than as markdown — an agent
    // that gathers with get_system_health and hands the result straight to this
    // method used to get a slide containing pretty-printed JSON, one brace per
    // paragraph. Structure it first; the markdown path below then sees headings
    // and bullets like any other input.
    const normalised = jsonToMarkdown(rawText) ?? rawText;

    // Documents are read, not projected: per-section stock imagery belongs on a
    // slide and looks like clip-art in a whitepaper or a one-page brief.
    const illustrateSections = formatCategory === "presentation_deck" || formatCategory === "magazine_ad";

    const lines = normalised.split("\n");
    let currentSlideTitle = "";
    let currentBullets: string[] = [];
    let currentParagraphs: string[] = [];
    let slideCounter = 1;

    // Helper to flush accumulated text into a slide or block
    const flushSlide = () => {
      if (!currentSlideTitle && currentBullets.length === 0 && currentParagraphs.length === 0) return;

      const bodyText = currentParagraphs.join("\n\n");
      const headline = currentSlideTitle || `Key Insight ${slideCounter}`;

      if (formatCategory === "magazine_ad" && slideCounter === 1) {
        const adBlock: MagazineAdBlock = {
          id: `block-${slideCounter}`,
          type: "magazine_ad",
          headline,
          // No invented strapline when the section had no prose: an editorial
          // block with nothing to say should say nothing.
          bodyText: bodyText || currentBullets.join(" "),
          quote: currentBullets[0] || undefined,
          // Everything the pull-quote did not take. Previously discarded.
          supportingPoints: currentBullets.slice(1),
          accentTag: "FEATURED EDITORIAL",
          layout: "editorial_asymmetric",
          heroImageUrl: autoGenerateMedia ? presentationMediaService.generateSvgPlaceholder(headline, designSystem) : undefined,
        };
        blocks.push(adBlock);
      } else {
        const slideBlock: SlideFrameBlock = {
          id: `block-${slideCounter}`,
          type: "slide_frame",
          slideNumber: slideCounter,
          headline,
          bodyMarkdown: bodyText || currentBullets.join("\n"),
          bulletPoints: currentBullets,
          layout: currentBullets.length > 0 ? "three_cards" : "split_text_image",
          imageUrl: autoGenerateMedia && illustrateSections
            ? presentationMediaService.generateSvgPlaceholder(headline, designSystem)
            : undefined,
        };
        blocks.push(slideBlock);
      }

      slideCounter++;
      currentSlideTitle = "";
      currentBullets = [];
      currentParagraphs = [];
    };

    // 1. Initial Hero Block
    const heroBlock: HeroHeaderBlock = {
      id: "hero-1",
      type: "hero_header",
      title: title,
      headline: title,
      subheadline: lines.find(l => l.trim().length > 10 && !l.startsWith("#")) || "Autonomous Mission Deliverable & Strategic Brief",
      ctaText: "Explore Presentation",
      layout: "split_left",
      imageUrl: autoGenerateMedia ? presentationMediaService.generateSvgPlaceholder(title, designSystem) : undefined,
    };
    blocks.push(heroBlock);

    // 2. Parse Markdown blocks & section headings
    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.startsWith("---") || line.toLowerCase().startsWith("# slide")) {
        flushSlide();
        continue;
      }

      if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ")) {
        if (currentSlideTitle || currentBullets.length > 0 || currentParagraphs.length > 0) {
          flushSlide();
        }
        currentSlideTitle = line.replace(/^#+\s*/, "");
        continue;
      }

      if (line.startsWith("- ") || line.startsWith("* ")) {
        currentBullets.push(line.replace(/^[-*]\s*/, ""));
        continue;
      }

      if (line.length > 0) {
        currentParagraphs.push(line);
      }
    }

    flushSlide();

    // 3. Nothing was gathered. Say so.
    //
    // This branch used to pad the document with a feature grid ("Autonomous
    // Synthesis", "Structured Layout", "Executive Export") and a stat callout
    // reading 99.4% Synthesis Accuracy / 10x Delivery Velocity / 0 Manual
    // Formatting Overhead. None of those numbers were measured, or derived from
    // the input, or true — they were literals chosen to make an empty deck look
    // full, and they rendered identically to figures that had been gathered.
    // A deck built after a search returned nothing therefore presented invented
    // metrics about Oddjob to whoever it was shown to.
    //
    // An empty result is information. Report it and let the reader decide.
    if (blocks.length <= 1) {
      const emptyStateBlock: SlideFrameBlock = {
        id: "block-no-content",
        type: "slide_frame",
        slideNumber: 1,
        headline: "No content was gathered",
        bodyMarkdown:
          "This document was requested but no source material was supplied to build it from. " +
          "Nothing here has been inferred or filled in.",
        bulletPoints: [
          "Gather the underlying data first, then regenerate this document.",
          "If a search returned no results, that absence is the finding — it is not a formatting problem.",
        ],
        layout: "title_only",
        imageUrl: undefined,
      };
      blocks.push(emptyStateBlock);
    }

    return {
      id: `doc-ast-${Date.now()}`,
      title,
      subtitle: "Assembled via Oddjob Blocking & Assembly Engine",
      formatCategory,
      designSystem,
      blocks,
      // `metadata` carries `.default({})`, so it is optional on the way IN and
      // required on the way OUT — and DocumentBlockAST is z.infer, i.e. the
      // output type. Omitting it left every AST this method builds failing to
      // type-check against the schema it claims to satisfy.
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Applies a specific design system theme to a DocumentBlockAST.
   */
  applyDesignSystem(
    ast: DocumentBlockAST,
    themeIdOrSystem: string | PresentationDesignSystem
  ): DocumentBlockAST {
    const designSystem: PresentationDesignSystem = typeof themeIdOrSystem === "string"
      ? (PREBUILT_PRESENTATION_THEMES[themeIdOrSystem] || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"])
      : themeIdOrSystem;

    // Refresh media placeholders matching new theme styling
    const updatedBlocks = ast.blocks.map(b => {
      const topic = (b as any).headline || (b as any).title || ast.title;
      const themeMedia = presentationMediaService.generateSvgPlaceholder(topic, designSystem);
      if (b.type === "hero_header") return { ...b, imageUrl: themeMedia };
      if (b.type === "slide_frame") return { ...b, imageUrl: themeMedia };
      if (b.type === "magazine_ad") return { ...b, heroImageUrl: themeMedia };
      return b;
    });

    return {
      ...ast,
      designSystem,
      blocks: updatedBlocks,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Performs an in-place conversational mutation on a DocumentBlockAST.
   */
  mutateBlockAST(ast: DocumentBlockAST, operation: ASTMutationOperation): DocumentBlockAST {
    // update_document_ast types `ast` as z.record(z.any()), so callers can hand over a
    // bare { title, blocks }. Without these defaults, `[...ast.blocks]` throws on a
    // missing blocks array and auditThemeContrast dereferences design.colors on an
    // absent designSystem. compileToWebDeck already defaults the same way.
    let updatedBlocks = [...(ast.blocks ?? [])];
    let updatedDesignSystem = ast.designSystem ?? PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];

    switch (operation.action) {
      case "modify_block": {
        const idx = updatedBlocks.findIndex((b) => b.id === operation.blockId);
        if (idx !== -1) {
          updatedBlocks[idx] = {
            ...updatedBlocks[idx],
            ...operation.updatedBlock,
            id: operation.blockId,
          } as DocumentBlock;
        }
        break;
      }

      case "add_block": {
        const targetIdx = operation.targetIndex !== undefined
          ? Math.max(0, Math.min(operation.targetIndex, updatedBlocks.length))
          : updatedBlocks.length;
        updatedBlocks.splice(targetIdx, 0, operation.block);
        break;
      }

      case "remove_block": {
        updatedBlocks = updatedBlocks.filter((b) => b.id !== operation.blockId);
        break;
      }

      case "change_theme": {
        const themeId = operation.themeId;
        return this.applyDesignSystem(
          {
            ...ast,
            blocks: updatedBlocks,
            updatedAt: new Date().toISOString(),
          },
          themeId
        );
      }

      case "reorder_blocks": {
        const { fromIndex, toIndex } = operation;
        if (
          fromIndex >= 0 &&
          fromIndex < updatedBlocks.length &&
          toIndex >= 0 &&
          toIndex < updatedBlocks.length
        ) {
          const [moved] = updatedBlocks.splice(fromIndex, 1);
          updatedBlocks.splice(toIndex, 0, moved);
        }
        break;
      }

      default:
        break;
    }

    return {
      ...ast,
      designSystem: updatedDesignSystem,
      blocks: updatedBlocks,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Compiles the DocumentBlockAST into a standalone HTML/CSS web presentation deck.
   */
  /**
   * The web deck stylesheet. Extracted verbatim from compileToWebDeck, which was
   * ~757 lines of which this CSS was ~435 — it dominated the method while being
   * the part least related to block compilation. Output is byte-identical.
   */
  private renderDeckStylesheet(t: DeckStyleTokens): string {
    const { colors, typography, borderRadius, glassmorphism, isDarkSurface, isProseDocument, isBrief } = t;
    return `    :root {
      --bg: ${colors.background};
      --surface: ${colors.surface};
      --primary: ${colors.primary};
      --secondary: ${colors.secondary};
      --accent: ${colors.accent};
      --text-primary: ${colors.textPrimary};
      --text-secondary: ${colors.textSecondary};
      --border: ${colors.border};
      --gradient: ${colors.gradient};
      --font-heading: ${typography.fontFamilyHeading};
      --font-body: ${typography.fontFamilyBody};
      --radius: ${borderRadius};
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-primary);
      font-family: var(--font-body);
      line-height: 1.6;
      overflow-x: hidden;
    }

    .slide-frame {
      min-height: 100vh;
      padding: 4rem 6rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      border-bottom: 1px solid var(--border);
      ${glassmorphism ? "backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);" : ""}
    }

    .hero-split, .slide-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
    }

    .media-frame {
      width: 100%;
      height: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }

    .hero-slide {
      background: radial-gradient(circle at top right, rgba(139, 92, 246, 0.15), transparent 60%);
    }

    .badge {
      display: inline-block;
      align-self: flex-start;
      padding: 0.35rem 1rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--primary);
      margin-bottom: 1.5rem;
    }

    .headline {
      font-family: var(--font-heading);
      font-size: 3.75rem;
      font-weight: 900;
      line-height: 1.1;
      background: var(--gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 1.5rem;
    }

    .subheadline {
      font-size: 1.25rem;
      color: var(--text-secondary);
      max-width: 800px;
      margin-bottom: 2.5rem;
    }

    .cta-button {
      padding: 1rem 2rem;
      background: var(--primary);
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      align-self: flex-start;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }

    .slide-title {
      font-family: var(--font-heading);
      font-size: 2.75rem;
      margin-bottom: 2rem;
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.5rem;
      margin-top: 1.5rem;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .feature-grid {
      display: grid;
      gap: 1.5rem;
    }
    .cols-2 { grid-template-columns: repeat(2, 1fr); }
    .cols-3 { grid-template-columns: repeat(3, 1fr); }
    .cols-4 { grid-template-columns: repeat(4, 1fr); }

    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2rem;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 2rem;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2.5rem;
      text-align: center;
    }

    .stat-value {
      font-family: var(--font-heading);
      font-size: 4rem;
      font-weight: 900;
      color: var(--primary);
      line-height: 1;
      margin-bottom: 0.5rem;
    }

    .magazine-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 3rem;
      align-items: center;
    }

    .editorial-headline {
      font-family: var(--font-heading);
      font-size: 3.5rem;
      line-height: 1.1;
      margin-bottom: 1.5rem;
    }

    .slide-number {
      position: absolute;
      top: 2rem;
      right: 3rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-secondary);
      letter-spacing: 0.1em;
    }

    /* Editorial supporting points — the bullets the magazine format used to drop. */
    .editorial-points {
      margin: 1.5rem 0 0 1.1rem;
      display: grid;
      gap: 0.5rem;
      color: var(--text-secondary);
      font-size: 1rem;
    }
    .editorial-points li { line-height: 1.55; }

    /* --- whitepaper: continuous, numbered, read top to bottom --- */
    body.format-whitepaper {
      max-width: 46rem;
      margin: 0 auto;
      padding: 4rem 2rem 6rem;
      line-height: 1.75;
    }
    body.format-whitepaper .slide-frame.hero-slide {
      min-height: auto;
      padding: 0 0 3rem;
      border-bottom: 2px solid var(--border);
      margin-bottom: 3rem;
    }
    body.format-whitepaper .hero-media { display: none; }
    .doc-section { padding: 0 0 2.75rem; }
    .doc-section-title {
      font-family: var(--font-heading);
      font-size: 1.5rem;
      margin-bottom: 0.9rem;
      color: var(--text-primary);
    }
    .doc-section-number { color: var(--accent); margin-right: 0.5rem; }
    .doc-paragraph { color: var(--text-secondary); margin-bottom: 1rem; }
    .doc-list { margin: 0 0 0 1.25rem; color: var(--text-secondary); display: grid; gap: 0.45rem; }

    /* --- executive brief: one dense page, scannable --- */
    body.format-executive_brief {
      max-width: 60rem;
      margin: 0 auto;
      padding: 3rem 2rem 4rem;
    }
    body.format-executive_brief .slide-frame.hero-slide {
      min-height: auto;
      padding: 0 0 2rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid var(--accent);
    }
    body.format-executive_brief .hero-media { display: none; }
    body.format-executive_brief .brief-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
      gap: 1.25rem;
    }
    .brief-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.4rem;
    }
    .brief-heading {
      font-family: var(--font-heading);
      font-size: 1.05rem;
      margin-bottom: 0.6rem;
      color: var(--text-primary);
    }
    .brief-body { color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 0.6rem; }
    .brief-points { margin-left: 1.1rem; color: var(--text-secondary); font-size: 0.92rem; display: grid; gap: 0.35rem; }

    /* Comparison Matrix Styles */
    .matrix-table-container {
      width: 100%;
      margin: 1.5rem 0;
      border-radius: var(--radius);
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 1rem;
    }
    .matrix-table th {
      background: var(--surface);
      padding: 1rem 1.25rem;
      font-weight: 700;
      border-bottom: 2px solid var(--border);
    }
    .matrix-table th.our-col {
      color: var(--primary);
    }
    .matrix-table td {
      padding: 0.9rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    .matrix-table tr.advantage-row {
      background: rgba(255, 255, 255, 0.02);
    }
    .matrix-table tr.advantage-row .our-val {
      font-weight: 700;
      color: var(--secondary);
    }

    /* Timeline Styles */
    .timeline-container {
      display: grid;
      gap: 1.25rem;
      margin: 1.5rem 0;
      border-left: 3px solid var(--primary);
      padding-left: 1.5rem;
    }
    .timeline-item {
      position: relative;
    }
    .timeline-badge {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .timeline-content h3 {
      font-size: 1.2rem;
      margin-bottom: 0.4rem;
    }
    .status-pill {
      font-size: 0.75rem;
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      margin-left: 0.5rem;
    }

    /* Chart & Diagram Block Styles */
    .chart-block-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2rem;
      margin: 1.5rem 0;
    }
    .chart-description {
      color: var(--text-secondary);
      margin-bottom: 1.25rem;
    }
    .chart-bars {
      display: grid;
      gap: 1rem;
    }
    .chart-bar-group {
      display: grid;
      grid-template-columns: 140px 1fr 80px;
      align-items: center;
      gap: 1rem;
    }
    .chart-bar-label {
      font-weight: 600;
      font-size: 0.95rem;
    }
    .chart-bar-track {
      background: rgba(255, 255, 255, 0.08);
      height: 1.25rem;
      border-radius: 6px;
      overflow: hidden;
    }
    .chart-bar-fill {
      height: 100%;
      background: var(--gradient);
      border-radius: 6px;
      transition: width 0.5s ease-out;
    }
    .chart-bar-val {
      font-weight: 700;
      font-size: 0.95rem;
      text-align: right;
      color: var(--secondary);
    }
    .chart-legend {
      display: flex;
      gap: 1.5rem;
      margin-top: 1.5rem;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .legend-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 0.35rem;
    }

    .diagram-block-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2rem;
      margin: 1.5rem 0;
      text-align: center;
    }
    /* Citation & Provenance Styles */
    .block-citations {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--border);
    }
    .citation-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      font-weight: 500;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: var(--primary);
    }
    .provenance-tag {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
      font-style: italic;
    }

    /* --- Print & PDF Media Styles --- */
    @media print {
      @page {
        size: A4;
        margin: 1.5cm;
      }
      body {
        background: #ffffff !important;
        color: #0f172a !important;
        padding: 0 !important;
      }
      .slide-frame, .brief-block, .feature-card, .matrix-table, .timeline-event {
        page-break-inside: avoid;
        box-shadow: none !important;
      }
      .slide-frame:not(:last-child) {
        page-break-after: always;
      }
    }`;
  }

  compileToWebDeck(ast: DocumentBlockAST): string {
    const { blocks, title } = ast;
    const ds = ast.designSystem || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];
    const colors = ds.colors || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"].colors;

    // Relative luminance of the deck background, so the mermaid runtime below picks a
    // theme that is legible on it rather than always assuming a dark deck.
    const isDarkSurface = (() => {
      const hex = String(colors.background || "#0f172a").replace("#", "");
      if (hex.length !== 6) return true;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.5;
    })();
    const typography = ds.typography || {
      fontFamilyHeading: "'Outfit', sans-serif",
      fontFamilyBody: "'Inter', sans-serif",
      headingWeight: "800",
      bodyWeight: "400",
    };
    const borderRadius = ds.borderRadius || "12px";
    const glassmorphism = ds.glassmorphism ?? true;

    const isProseDocument = ast.formatCategory === "whitepaper";
    const isBrief = ast.formatCategory === "executive_brief";

    const renderBlockFooter = (b: DocumentBlock) => {
      const citations = b.citations && b.citations.length > 0 ? `
        <div class="block-citations">
          ${b.citations.map(c => `<span class="citation-badge" title="Type: ${c.entityType} | Confidence: ${Math.round((c.confidenceScore ?? 1) * 100)}%"><span class="citation-icon">🔗</span> ${c.entityName}</span>`).join("")}
        </div>
      ` : "";

      const provenance = b.provenance ? `
        <div class="provenance-tag">✓ Provenance: ${b.provenance.source} ${b.provenance.verified ? '(Verified)' : ''}</div>
      ` : "";

      return (citations || provenance) ? `<div class="block-attribution-footer">${citations}${provenance}</div>` : "";
    };

    // Bundle of the design-system values the stylesheet interpolates. Kept as one
    // object so the ~435-line stylesheet can live in its own method without a
    // ten-parameter signature.
    const styleTokens: DeckStyleTokens = {
      colors, typography, borderRadius, glassmorphism, isDarkSurface, isProseDocument, isBrief,
    };

    const blockMarkupParts = blocks.map((block, index) => {
      switch (block.type) {
        case "hero_header":
          return `
            <section class="slide-frame hero-slide" id="slide-${index + 1}">
              <div class="hero-split">
                <div class="hero-content">
                  <div class="badge">${block.badgeText || "OFFICIAL DELIVERABLE"}</div>
                  <h1 class="headline">${block.headline}</h1>
                  ${block.subheadline ? `<p class="subheadline">${block.subheadline}</p>` : ""}
                  ${block.ctaText ? `<button class="cta-button">${block.ctaText} &rarr;</button>` : ""}
                  ${renderBlockFooter(block)}
                </div>
                ${block.imageUrl ? `
                  <div class="hero-media">
                    <img src="${block.imageUrl}" alt="${block.headline}" class="media-frame" />
                  </div>
                ` : ""}
              </div>
            </section>
          `;

        case "slide_frame": {
          // A slide is paginated and captioned "SLIDE n"; a whitepaper section
          // is numbered prose; an executive brief is a dense block on a single
          // page. Same content, three genuinely different documents — before
          // this, whitepaper and executive_brief compiled to markup that was
          // byte-identical to the deck.
          if (isProseDocument) {
            return `
            <section class="doc-section" id="section-${index + 1}">
              <h2 class="doc-section-title"><span class="doc-section-number">${block.slideNumber}.</span> ${block.headline}</h2>
              ${block.bodyMarkdown ? `<p class="doc-paragraph">${block.bodyMarkdown}</p>` : ""}
              ${block.bulletPoints && block.bulletPoints.length > 0 ? `
                <ul class="doc-list">
                  ${block.bulletPoints.map(b => `<li>${b}</li>`).join("")}
                </ul>
              ` : ""}
            </section>
          `;
          }

          if (isBrief) {
            return `
            <section class="brief-block" id="brief-${index + 1}">
              <h2 class="brief-heading">${block.headline}</h2>
              ${block.bodyMarkdown ? `<p class="brief-body">${block.bodyMarkdown}</p>` : ""}
              ${block.bulletPoints && block.bulletPoints.length > 0 ? `
                <ul class="brief-points">
                  ${block.bulletPoints.map(b => `<li>${b}</li>`).join("")}
                </ul>
              ` : ""}
            </section>
          `;
          }

          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <div class="slide-number">SLIDE ${block.slideNumber}</div>
              <h2 class="slide-title">${block.headline}</h2>
              <div class="slide-grid">
                <div class="slide-body">
                  ${block.bodyMarkdown ? `<p>${block.bodyMarkdown}</p>` : ""}
                  ${block.bulletPoints && block.bulletPoints.length > 0 ? `
                    <div class="card-grid">
                      ${block.bulletPoints.map(b => `<div class="card"><span class="icon">&check;</span><div>${b}</div></div>`).join("")}
                    </div>
                  ` : ""}
                </div>
                ${block.imageUrl ? `
                  <div class="slide-media">
                    <img src="${block.imageUrl}" alt="${block.headline}" class="media-frame" />
                  </div>
                ` : ""}
              </div>
            </section>
          `;
        }

        case "magazine_ad":
          return `
            <section class="slide-frame magazine-ad-slide" id="slide-${index + 1}">
              <div class="magazine-grid">
                <div class="editorial-main">
                  <div class="accent-tag">${block.accentTag || "FEATURED EDITORIAL"}</div>
                  <h2 class="editorial-headline">${block.headline}</h2>
                  <p class="editorial-body">${block.bodyText}</p>
                  ${block.supportingPoints && block.supportingPoints.length > 0 ? `
                    <ul class="editorial-points">
                      ${block.supportingPoints.map(p => `<li>${p}</li>`).join("")}
                    </ul>
                  ` : ""}
                </div>
                ${block.heroImageUrl ? `
                  <div class="magazine-media">
                    <img src="${block.heroImageUrl}" alt="${block.headline}" class="media-frame" />
                    ${block.quote ? `
                      <blockquote class="editorial-quote">
                        "${block.quote}"
                        ${block.author ? `<cite>&mdash; ${block.author}</cite>` : ""}
                      </blockquote>
                    ` : ""}
                  </div>
                ` : block.quote ? `
                  <blockquote class="editorial-quote">
                    "${block.quote}"
                    ${block.author ? `<cite>&mdash; ${block.author}</cite>` : ""}
                  </blockquote>
                ` : ""}
              </div>
            </section>
          `;

        case "feature_grid":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Key Features"}</h2>
              <div class="feature-grid cols-${block.columns || 3}">
                ${block.cards.map(c => `
                  <div class="feature-card">
                    ${c.highlightTag ? `<span class="card-tag">${c.highlightTag}</span>` : ""}
                    <h3>${c.title}</h3>
                    <p>${c.description}</p>
                  </div>
                `).join("")}
              </div>
            </section>
          `;

        case "stat_callout":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Metrics & Impact"}</h2>
              <div class="stat-grid">
                ${block.stats.map(s => `
                  <div class="stat-card">
                    <div class="stat-value">${s.value}</div>
                    <div class="stat-label">${s.label}</div>
                    ${s.delta ? `<div class="stat-delta ${s.isPositive ? 'positive' : 'negative'}">${s.delta}</div>` : ""}
                  </div>
                `).join("")}
              </div>
            </section>
          `;

        case "comparison_matrix":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Comparative Evaluation"}</h2>
              <div class="matrix-table-container">
                <table class="matrix-table">
                  <thead>
                    <tr>
                      <th>Feature / Dimension</th>
                      <th>${block.competitorName || "Standard Alternative"}</th>
                      <th class="our-col">${block.ourName || "Oddjob"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${block.rows.map(r => `
                      <tr class="${r.isOurAdvantage ? 'advantage-row' : ''}">
                        <td class="feature-name">${r.feature}</td>
                        <td class="comp-val">${r.competitorValue}</td>
                        <td class="our-val">${r.ourValue}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </section>
          `;

        case "timeline":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Execution Timeline"}</h2>
              <div class="timeline-container">
                ${block.events.map(ev => `
                  <div class="timeline-item status-${ev.status}">
                    <div class="timeline-badge">${ev.dateOrPhase}</div>
                    <div class="timeline-content">
                      <h3>${ev.title} <span class="status-pill">${ev.status}</span></h3>
                      <p>${ev.description}</p>
                    </div>
                  </div>
                `).join("")}
              </div>
            </section>
          `;

        case "chart":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Data Analytics"}</h2>
              ${block.description ? `<p class="chart-description">${block.description}</p>` : ""}
              <div class="chart-block-container chart-${block.chartType}">
                <div class="chart-bars">
                  ${block.labels.map((lbl, li) => {
                    const primaryVal = block.datasets[0]?.data[li] ?? 0;
                    const maxVal = Math.max(...(block.datasets[0]?.data || [100]), 1);
                    const pct = Math.min(Math.round((primaryVal / maxVal) * 100), 100);
                    return `
                      <div class="chart-bar-group">
                        <div class="chart-bar-label">${lbl}</div>
                        <div class="chart-bar-track">
                          <div class="chart-bar-fill" style="width: ${pct}%;"></div>
                        </div>
                        <div class="chart-bar-val">${primaryVal}${block.unit || ""}</div>
                      </div>
                    `;
                  }).join("")}
                </div>
                ${block.datasets.length > 1 ? `
                  <div class="chart-legend">
                    ${block.datasets.map(d => `<span class="legend-item"><span class="legend-dot" style="background: ${d.color || 'var(--primary)'}"></span> ${d.label}</span>`).join("")}
                  </div>
                ` : ""}
              </div>
            </section>
          `;

        case "diagram":
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2 class="slide-title">${block.title || "Architecture & Process Flow"}</h2>
              <div class="diagram-block-container">
                <pre class="mermaid">${block.code}</pre>
                ${block.caption ? `<div class="diagram-caption">${block.caption}</div>` : ""}
              </div>
            </section>
          `;

        default:
          return `
            <section class="slide-frame" id="slide-${index + 1}">
              <h2>${(block as any).title || "Document Section"}</h2>
            </section>
          `;
      }
    });

    // The brief lays its sections out as a card grid, but the cover block heads
    // the page rather than sitting in a cell.
    const heroCount = blocks[0]?.type === "hero_header" ? 1 : 0;
    const blockMarkup = isBrief
      ? `${blockMarkupParts.slice(0, heroCount).join("\n")}\n<div class="brief-grid">${blockMarkupParts.slice(heroCount).join("\n")}</div>`
      : blockMarkupParts.join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Outfit:wght@700;800;900&family=Playfair+Display:ital,wght@0,700;1,400&display=swap" rel="stylesheet">
  <style>
${this.renderDeckStylesheet(styleTokens)}
  </style>
</head>
<body class="format-${ast.formatCategory}">
  ${blockMarkup}
  <!--
    Diagram blocks emit <pre class="mermaid">. Without a runtime the deck showed the
    raw "flowchart LR ..." source, both in the HTML export and in the PDF built from
    it. Loaded from CDN like the webfonts above; the PDF path waits for networkidle,
    so the render completes before printing.
  -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <script>
    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: true,
        securityLevel: "strict",
        theme: ${isDarkSurface ? '"dark"' : '"default"'}
      });
    }
  </script>
</body>
</html>`;
  }

  /**
   * Compiles the DocumentBlockAST into a high-fidelity formatted Word (.docx) buffer.
   */
  async compileASTToDocx(ast: DocumentBlockAST): Promise<Buffer> {
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      HeadingLevel,
      Table,
      TableRow,
      TableCell,
      WidthType,
      ShadingType,
    } = await import("docx");

    const cleanHex = (color?: string, fallback = "2563EB") => {
      if (!color) return fallback;
      const stripped = color.trim().replace(/^#/, "");
      return /^[0-9a-fA-F]{6}$/.test(stripped) ? stripped.toUpperCase() : fallback;
    };

    const primaryColor = cleanHex(ast.designSystem?.colors?.primary, "3B82F6");
    const secondaryColor = cleanHex(ast.designSystem?.colors?.secondary, "10B981");
    const accentColor = cleanHex(ast.designSystem?.colors?.accent, "F59E0B");
    const textSecondaryColor = cleanHex(ast.designSystem?.colors?.textSecondary, "64748B");
    const surfaceColor = ast.designSystem?.isDark ? "1E293B" : "F1F5F9";

    const children: any[] = [];

    // Document Title & Cover Header
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: ast.title,
            bold: true,
            size: 48, // 24pt
            color: primaryColor,
          }),
        ],
        heading: HeadingLevel.TITLE,
        spacing: { after: 120 },
      })
    );

    if (ast.subtitle) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: ast.subtitle,
              italics: true,
              size: 28, // 14pt
              color: textSecondaryColor,
            }),
          ],
          spacing: { after: 240 },
        })
      );
    }

    // Metadata Tag
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Theme: ${ast.designSystem?.name || "Standard"} | Category: ${(ast.formatCategory || "document").replace(/_/g, " ").toUpperCase()}`,
            size: 18,
            color: textSecondaryColor,
          }),
        ],
        spacing: { after: 360 },
      })
    );

    for (const block of ast.blocks) {
      switch (block.type) {
        case "hero_header": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.headline,
                  bold: true,
                  size: 36, // 18pt
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 },
            })
          );
          if (block.subheadline) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: block.subheadline,
                    size: 24,
                    color: textSecondaryColor,
                  }),
                ],
                spacing: { after: 160 },
              })
            );
          }
          if (block.ctaText) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `[ ${block.ctaText} ]`,
                    bold: true,
                    size: 20,
                    color: accentColor,
                  }),
                ],
                spacing: { after: 200 },
              })
            );
          }
          break;
        }

        case "slide_frame": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Slide ${block.slideNumber}: ${block.headline}`,
                  bold: true,
                  size: 32, // 16pt
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 120 },
            })
          );

          if (block.bodyMarkdown) {
            const paras = block.bodyMarkdown.split("\n\n");
            for (const p of paras) {
              if (p.trim()) {
                children.push(
                  new Paragraph({
                    children: [new TextRun({ text: p.trim(), size: 22 })],
                    spacing: { after: 120 },
                  })
                );
              }
            }
          }

          if (block.bulletPoints && block.bulletPoints.length > 0) {
            for (const bp of block.bulletPoints) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: bp, size: 22 })],
                  bullet: { level: 0 },
                  spacing: { after: 80 },
                })
              );
            }
          }

          if (block.speakerNotes) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Speaker Notes: ${block.speakerNotes}`,
                    italics: true,
                    size: 18,
                    color: textSecondaryColor,
                  }),
                ],
                spacing: { before: 100, after: 180 },
              })
            );
          }
          break;
        }

        case "magazine_ad": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.headline,
                  bold: true,
                  size: 34,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 120 },
            })
          );

          if (block.quote) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `"${block.quote}"`,
                    italics: true,
                    bold: true,
                    size: 26,
                    color: accentColor,
                  }),
                  new TextRun({
                    text: block.author ? ` — ${block.author}` : "",
                    size: 20,
                    color: textSecondaryColor,
                  }),
                ],
                indent: { left: 400 },
                spacing: { before: 120, after: 160 },
              })
            );
          }

          if (block.bodyText) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: block.bodyText, size: 22 })],
                spacing: { after: 140 },
              })
            );
          }

          if (block.supportingPoints && block.supportingPoints.length > 0) {
            for (const sp of block.supportingPoints) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: sp, size: 22 })],
                  bullet: { level: 0 },
                  spacing: { after: 80 },
                })
              );
            }
          }
          break;
        }

        case "feature_grid": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Key Features",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          for (const card of block.cards) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: card.title,
                    bold: true,
                    size: 24,
                    color: primaryColor,
                  }),
                  card.highlightTag
                    ? new TextRun({
                        text: ` [${card.highlightTag}]`,
                        bold: true,
                        size: 18,
                        color: accentColor,
                      })
                    : new TextRun({ text: "" }),
                ],
                spacing: { before: 100, after: 60 },
              }),
              new Paragraph({
                children: [new TextRun({ text: card.description, size: 22 })],
                spacing: { after: 120 },
              })
            );
          }
          break;
        }

        case "stat_callout": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Key Metrics & Data",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          const statRows = block.stats.map((s) => {
            return new TableRow({
              children: [
                new TableCell({
                  width: { size: 3500, type: WidthType.DXA },
                  shading: { fill: surfaceColor, type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: s.value,
                          bold: true,
                          size: 28,
                          color: s.isPositive ? secondaryColor : accentColor,
                        }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  width: { size: 5500, type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: s.label, bold: true, size: 22 }),
                        s.delta
                          ? new TextRun({
                              text: ` (${s.delta})`,
                              italics: true,
                              size: 20,
                              color: textSecondaryColor,
                            })
                          : new TextRun({ text: "" }),
                      ],
                    }),
                  ],
                }),
              ],
            });
          });

          children.push(
            new Table({
              rows: statRows,
              width: { size: 9000, type: WidthType.DXA },
            }),
            new Paragraph({ text: "", spacing: { after: 180 } })
          );
          break;
        }

        case "comparison_matrix": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Comparison Analysis",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          const headerRow = new TableRow({
            children: [
              new TableCell({
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: primaryColor, type: ShadingType.CLEAR },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: "Feature / Dimension", bold: true, color: "FFFFFF" })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: "64748B", type: ShadingType.CLEAR },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: block.competitorName || "Standard", bold: true, color: "FFFFFF" })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: secondaryColor, type: ShadingType.CLEAR },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: block.ourName || "Our Solution", bold: true, color: "FFFFFF" })],
                  }),
                ],
              }),
            ],
          });

          const dataRows = block.rows.map((r) => {
            return new TableRow({
              children: [
                new TableCell({
                  width: { size: 3000, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: r.feature, bold: true, size: 20 })] })],
                }),
                new TableCell({
                  width: { size: 3000, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: r.competitorValue, size: 20 })] })],
                }),
                new TableCell({
                  width: { size: 3000, type: WidthType.DXA },
                  shading: r.isOurAdvantage ? { fill: surfaceColor, type: ShadingType.CLEAR } : undefined,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: r.ourValue,
                          bold: r.isOurAdvantage,
                          color: r.isOurAdvantage ? primaryColor : undefined,
                          size: 20,
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            });
          });

          children.push(
            new Table({
              rows: [headerRow, ...dataRows],
              width: { size: 9000, type: WidthType.DXA },
            }),
            new Paragraph({ text: "", spacing: { after: 180 } })
          );
          break;
        }

        case "timeline": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Strategic Timeline & Phases",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          for (const ev of block.events) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `[${ev.dateOrPhase}] `,
                    bold: true,
                    color: ev.status === "completed" ? secondaryColor : ev.status === "active" ? accentColor : textSecondaryColor,
                    size: 22,
                  }),
                  new TextRun({
                    text: ev.title,
                    bold: true,
                    size: 22,
                    color: primaryColor,
                  }),
                  new TextRun({
                    text: ` (${ev.status})`,
                    italics: true,
                    size: 18,
                    color: textSecondaryColor,
                  }),
                ],
                spacing: { before: 100, after: 40 },
              }),
              new Paragraph({
                children: [new TextRun({ text: ev.description, size: 20 })],
                indent: { left: 300 },
                spacing: { after: 120 },
              })
            );
          }
          break;
        }

        case "chart": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Data & Metrics Analytics",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          if (block.description) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: block.description, italics: true, size: 20, color: textSecondaryColor })],
                spacing: { after: 140 },
              })
            );
          }

          const chartHeader = new TableRow({
            children: [
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                shading: { fill: primaryColor, type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Metric / Dimension", bold: true, color: "FFFFFF" })] })],
              }),
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                shading: { fill: secondaryColor, type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: `Value (${block.unit || "Units"})`, bold: true, color: "FFFFFF" })] })],
              }),
            ],
          });

          const chartRows = block.labels.map((lbl, li) => {
            const val = block.datasets[0]?.data[li] ?? 0;
            return new TableRow({
              children: [
                new TableCell({
                  width: { size: 4500, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: lbl, bold: true, size: 20 })] })],
                }),
                new TableCell({
                  width: { size: 4500, type: WidthType.DXA },
                  shading: { fill: surfaceColor, type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: `${val}${block.unit ? " " + block.unit : ""}`, bold: true, size: 20, color: primaryColor })],
                    }),
                  ],
                }),
              ],
            });
          });

          children.push(
            new Table({
              rows: [chartHeader, ...chartRows],
              width: { size: 9000, type: WidthType.DXA },
            }),
            new Paragraph({ text: "", spacing: { after: 180 } })
          );
          break;
        }

        case "diagram": {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.title || "Process & Architecture Diagram",
                  bold: true,
                  size: 30,
                  color: primaryColor,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 140 },
            })
          );

          children.push(
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 9000, type: WidthType.DXA },
                      shading: { fill: surfaceColor, type: ShadingType.CLEAR },
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: `[Diagram (${block.diagramType.toUpperCase()})]\n${block.code}`,
                              font: "Courier New",
                              size: 18,
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
              width: { size: 9000, type: WidthType.DXA },
            })
          );

          if (block.caption) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `Caption: ${block.caption}`, italics: true, size: 18, color: textSecondaryColor })],
                spacing: { before: 80, after: 160 },
              })
            );
          } else {
            children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
          }
          break;
        }

        default:
          break;
      }

      if (block.citations && block.citations.length > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "Sources / Citations: " + block.citations.map(c => `${c.entityName} [${c.entityType}]`).join(", "),
                italics: true,
                size: 18,
                color: textSecondaryColor,
              }),
            ],
            spacing: { before: 100, after: 100 },
          })
        );
      }
      if (block.provenance) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Provenance: ${block.provenance.source} ${block.provenance.verified ? '(Verified)' : ''}`,
                italics: true,
                size: 18,
                color: textSecondaryColor,
              }),
            ],
            spacing: { before: 60, after: 120 },
          })
        );
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * Compiles the DocumentBlockAST to a plain text / Markdown summary.
   */
  compileToMarkdownSummary(ast: DocumentBlockAST): string {
    const parts: string[] = [`# ${ast.title}`];
    if (ast.subtitle) parts.push(`*${ast.subtitle}*`);
    parts.push(`**Theme**: ${ast.designSystem.name} | **Category**: ${ast.formatCategory}\n---`);

    for (const block of ast.blocks) {
      switch (block.type) {
        case "hero_header":
          parts.push(`## ${block.headline}\n${block.subheadline || ""}`);
          break;
        case "slide_frame":
          parts.push(`### Slide ${block.slideNumber}: ${block.headline}\n${block.bodyMarkdown}`);
          if (block.bulletPoints.length > 0) {
            parts.push(block.bulletPoints.map(b => `- ${b}`).join("\n"));
          }
          break;
        case "magazine_ad":
          parts.push(`### Editorial: ${block.headline}\n${block.bodyText}`);
          if (block.quote) parts.push(`> "${block.quote}" - ${block.author || "Editorial"}`);
          if (block.supportingPoints && block.supportingPoints.length > 0) {
            parts.push(block.supportingPoints.map(p => `- ${p}`).join("\n"));
          }
          break;
        case "feature_grid":
          parts.push(`### ${block.title || "Key Features"}`);
          parts.push(block.cards.map(c => `- **${c.title}**: ${c.description}`).join("\n"));
          break;
        case "stat_callout":
          parts.push(`### ${block.title || "Metrics"}`);
          parts.push(block.stats.map(s => `- **${s.label}**: ${s.value} (${s.delta || ""})`).join("\n"));
          break;
        case "comparison_matrix":
          parts.push(`### ${block.title || "Comparison Analysis"}`);
          parts.push(block.rows.map(r => `- **${r.feature}**: ${block.ourName || "Our Engine"} (${r.ourValue}) vs ${block.competitorName || "Competitor"} (${r.competitorValue})`).join("\n"));
          break;
        case "timeline":
          parts.push(`### ${block.title || "Timeline"}`);
          parts.push(block.events.map(e => `- [${e.dateOrPhase}] **${e.title}** (${e.status}): ${e.description}`).join("\n"));
          break;
        case "chart":
          parts.push(`### ${block.title || "Chart Analytics"} (${block.chartType})`);
          if (block.description) parts.push(`*${block.description}*`);
          parts.push(block.labels.map((lbl, idx) => `- **${lbl}**: ${block.datasets[0]?.data[idx] ?? 0} ${block.unit || ""}`).join("\n"));
          break;
        case "diagram":
          parts.push(`### ${block.title || "Diagram"} (${block.diagramType})\n\`\`\`mermaid\n${block.code}\n\`\`\``);
          if (block.caption) parts.push(`*${block.caption}*`);
          break;
        default:
          break;
      }

      if (block.citations && block.citations.length > 0) {
        parts.push(`*Sources: ${block.citations.map(c => `[${c.entityName}]`).join(", ")}*`);
      }
      parts.push("\n---");
    }

    return parts.join("\n\n");
  }

  /**
   * Compiles the DocumentBlockAST into a native Microsoft PowerPoint (.pptx) presentation buffer.
   */
  async compileASTToPptx(ast: DocumentBlockAST): Promise<Buffer> {
    // Same CommonJS interop as ajv in artifact-contract-validator.ts; see
    // CjsDefault in shared/cjs-interop.ts. Type assertion only.
    const PptxGen = (await import("pptxgenjs")).default as unknown as PptxGenCtor;
    const pptx = new PptxGen();
    // LAYOUT_16x9 is 10" x 5.625" in pptxgenjs; every coordinate below is authored
    // against a 13.33" x 7.5" stage (w: 11.7, footers at y: 6.8), so 16x9 pushed
    // most of each slide off-canvas. LAYOUT_WIDE is the 13.33" x 7.5" preset.
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = ast.title;

    const cleanHex = (color?: string, fallback = "2563EB") => {
      if (!color) return fallback;
      const stripped = color.trim().replace(/^#/, "");
      return /^[0-9a-fA-F]{6}$/.test(stripped) ? stripped.toUpperCase() : fallback;
    };

    const ds = ast.designSystem || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];
    const isDark = ds.isDark ?? true;
    const primaryColor = cleanHex(ds.colors?.primary, "3B82F6");
    const secondaryColor = cleanHex(ds.colors?.secondary, "10B981");
    const accentColor = cleanHex(ds.colors?.accent, "F59E0B");
    const bgColor = cleanHex(ds.colors?.background, isDark ? "0B0F19" : "FAFAFA");
    const surfaceColor = cleanHex(ds.colors?.surface, isDark ? "182238" : "FFFFFF");
    const textPrimary = cleanHex(ds.colors?.textPrimary, isDark ? "F8FAFC" : "0F172A");
    const textSecondary = cleanHex(ds.colors?.textSecondary, isDark ? "94A3B8" : "64748B");

    // Title / Cover Slide
    const coverSlide = pptx.addSlide();
    coverSlide.background = { color: bgColor };

    coverSlide.addText(ast.title, {
      x: 1.0,
      y: 2.0,
      w: 11.3,
      h: 1.8,
      fontSize: 38,
      bold: true,
      color: primaryColor,
      fontFace: "Calibri",
      valign: "top",
    });

    if (ast.subtitle) {
      coverSlide.addText(ast.subtitle, {
        x: 1.0,
        y: 3.8,
        w: 11.3,
        h: 1.0,
        fontSize: 20,
        italic: true,
        color: textSecondary,
        fontFace: "Calibri",
        valign: "top",
      });
    }

    coverSlide.addText(`Oddjob CREW • ${ds.name || "Design System"} • ${(ast.formatCategory || "presentation_deck").replace(/_/g, " ").toUpperCase()}`, {
      x: 1.0,
      y: 5.5,
      w: 11.3,
      h: 0.5,
      fontSize: 12,
      color: accentColor,
      fontFace: "Calibri",
    });

    // Body Block Slides
    for (const [index, block] of ast.blocks.entries()) {
      const slide = pptx.addSlide();
      slide.background = { color: bgColor };

      // Header ribbon on every slide
      slide.addText(`0${index + 1} / ${ast.title}`, {
        x: 0.8,
        y: 0.4,
        w: 10.0,
        h: 0.4,
        fontSize: 10,
        bold: true,
        color: textSecondary,
      });

      switch (block.type) {
        case "hero_header": {
          slide.addText(block.headline, {
            x: 0.8,
            y: 1.2,
            w: 11.7,
            h: 1.5,
            fontSize: 32,
            bold: true,
            color: primaryColor,
          });
          if (block.subheadline) {
            slide.addText(block.subheadline, {
              x: 0.8,
              y: 2.8,
              w: 11.7,
              h: 1.5,
              fontSize: 18,
              color: textSecondary,
            });
          }
          if (block.ctaText) {
            slide.addShape(pptx.ShapeType.roundRect, {
              x: 0.8,
              y: 4.8,
              w: 3.5,
              h: 0.8,
              fill: { color: primaryColor },
              rectRadius: 0.2,
            });
            slide.addText(block.ctaText, {
              x: 0.8,
              y: 4.8,
              w: 3.5,
              h: 0.8,
              fontSize: 14,
              bold: true,
              color: "FFFFFF",
              align: "center",
              valign: "middle",
            });
          }
          break;
        }

        case "slide_frame": {
          slide.addText(block.headline, {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 1.0,
            fontSize: 26,
            bold: true,
            color: primaryColor,
          });

          if (block.bodyMarkdown) {
            slide.addText(block.bodyMarkdown, {
              x: 0.8,
              y: 2.1,
              w: 6.0,
              h: 4.2,
              fontSize: 15,
              color: textPrimary,
              valign: "top",
            });
          }

          if (block.bulletPoints && block.bulletPoints.length > 0) {
            const bulletText = block.bulletPoints.map((bp) => ({
              text: bp + "\n",
              options: { bullet: true, fontSize: 14, color: textPrimary },
            }));
            slide.addText(bulletText as any, {
              x: block.bodyMarkdown ? 7.0 : 0.8,
              y: 2.1,
              w: block.bodyMarkdown ? 5.5 : 11.7,
              h: 4.2,
              valign: "top",
            });
          }
          break;
        }

        case "stat_callout": {
          slide.addText(block.title || "Key Metrics & Impact", {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 0.8,
            fontSize: 26,
            bold: true,
            color: primaryColor,
          });

          const statCount = Math.min(block.stats.length, 4);
          const cardWidth = 11.7 / Math.max(statCount, 1) - 0.3;

          block.stats.slice(0, 4).forEach((st, idx) => {
            const cardX = 0.8 + idx * (cardWidth + 0.3);
            slide.addShape(pptx.ShapeType.roundRect, {
              x: cardX,
              y: 2.2,
              w: cardWidth,
              h: 3.5,
              fill: { color: surfaceColor },
              line: { color: primaryColor, width: 1 },
              rectRadius: 0.15,
            });

            slide.addText(st.value, {
              x: cardX + 0.2,
              y: 2.6,
              w: cardWidth - 0.4,
              h: 1.2,
              fontSize: 30,
              bold: true,
              color: st.isPositive ? secondaryColor : accentColor,
              align: "center",
              valign: "middle",
            });

            slide.addText(st.label + (st.delta ? ` (${st.delta})` : ""), {
              x: cardX + 0.2,
              y: 4.0,
              w: cardWidth - 0.4,
              h: 1.2,
              fontSize: 14,
              bold: true,
              color: textPrimary,
              align: "center",
              valign: "top",
            });
          });
          break;
        }

        case "feature_grid": {
          slide.addText(block.title || "Key Capabilities", {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 0.8,
            fontSize: 26,
            bold: true,
            color: primaryColor,
          });

          const cardCount = Math.min(block.cards.length, 3);
          const cardWidth = 11.7 / Math.max(cardCount, 1) - 0.3;

          block.cards.slice(0, 3).forEach((card, idx) => {
            const cardX = 0.8 + idx * (cardWidth + 0.3);
            slide.addShape(pptx.ShapeType.roundRect, {
              x: cardX,
              y: 2.0,
              w: cardWidth,
              h: 4.5,
              fill: { color: surfaceColor },
              line: { color: primaryColor, width: 1 },
              rectRadius: 0.15,
            });

            slide.addText(card.title, {
              x: cardX + 0.3,
              y: 2.3,
              w: cardWidth - 0.6,
              h: 0.8,
              fontSize: 18,
              bold: true,
              color: primaryColor,
            });

            slide.addText(card.description, {
              x: cardX + 0.3,
              y: 3.2,
              w: cardWidth - 0.6,
              h: 3.0,
              fontSize: 13,
              color: textPrimary,
              valign: "top",
            });
          });
          break;
        }

        case "comparison_matrix": {
          slide.addText(block.title || "Competitive Analysis", {
            x: 0.8,
            y: 0.9,
            w: 11.7,
            h: 0.7,
            fontSize: 24,
            bold: true,
            color: primaryColor,
          });

          const tableRows: any[] = [
            [
              { text: "Dimension / Feature", options: { bold: true, fill: { color: primaryColor }, color: "FFFFFF" } },
              { text: block.competitorName || "Standard", options: { bold: true, fill: { color: "64748B" }, color: "FFFFFF" } },
              { text: block.ourName || "Oddjob Engine", options: { bold: true, fill: { color: secondaryColor }, color: "FFFFFF" } },
            ],
          ];

          for (const row of block.rows.slice(0, 5)) {
            tableRows.push([
              { text: row.feature, options: { color: textPrimary, bold: true } },
              { text: row.competitorValue, options: { color: textSecondary } },
              { text: row.ourValue, options: { color: row.isOurAdvantage ? secondaryColor : textPrimary, bold: row.isOurAdvantage } },
            ]);
          }

          slide.addTable(tableRows, {
            x: 0.8,
            y: 1.8,
            w: 11.7,
            fill: { color: surfaceColor },
            color: textPrimary,
            fontSize: 13,
          });
          break;
        }

        case "timeline": {
          slide.addText(block.title || "Deployment Phases & Timeline", {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 0.8,
            fontSize: 26,
            bold: true,
            color: primaryColor,
          });

          const evCount = Math.min(block.events.length, 4);
          const evWidth = 11.7 / Math.max(evCount, 1) - 0.25;

          block.events.slice(0, 4).forEach((ev, idx) => {
            const evX = 0.8 + idx * (evWidth + 0.25);
            slide.addShape(pptx.ShapeType.roundRect, {
              x: evX,
              y: 2.2,
              w: evWidth,
              h: 4.2,
              fill: { color: surfaceColor },
              line: { color: ev.status === "completed" ? secondaryColor : accentColor, width: 2 },
              rectRadius: 0.15,
            });

            slide.addText(`[${ev.dateOrPhase}]`, {
              x: evX + 0.2,
              y: 2.4,
              w: evWidth - 0.4,
              h: 0.4,
              fontSize: 11,
              bold: true,
              color: accentColor,
            });

            slide.addText(ev.title, {
              x: evX + 0.2,
              y: 2.9,
              w: evWidth - 0.4,
              h: 0.8,
              fontSize: 15,
              bold: true,
              color: primaryColor,
            });

            slide.addText(ev.description, {
              x: evX + 0.2,
              y: 3.8,
              w: evWidth - 0.4,
              h: 2.3,
              fontSize: 12,
              color: textPrimary,
              valign: "top",
            });
          });
          break;
        }

        case "chart": {
          slide.addText(block.title || "Data Analytics", {
            x: 0.8,
            y: 0.9,
            w: 11.7,
            h: 0.7,
            fontSize: 24,
            bold: true,
            color: primaryColor,
          });

          if (block.description) {
            slide.addText(block.description, {
              x: 0.8,
              y: 1.6,
              w: 11.7,
              h: 0.5,
              fontSize: 13,
              italic: true,
              color: textSecondary,
            });
          }

          const chartData = block.datasets.map((ds) => ({
            name: ds.label,
            labels: block.labels,
            values: ds.data,
          }));

          slide.addChart(pptx.ChartType.bar, chartData, {
            x: 0.8,
            y: 2.2,
            w: 11.7,
            h: 4.2,
            chartColors: [primaryColor, secondaryColor, accentColor],
            showLegend: block.datasets.length > 1,
            showValAxisTitle: !!block.unit,
            valAxisTitle: block.unit,
          });
          break;
        }

        case "diagram": {
          slide.addText(block.title || "Architecture & Process Flow", {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 0.8,
            fontSize: 26,
            bold: true,
            color: primaryColor,
          });

          slide.addShape(pptx.ShapeType.roundRect, {
            x: 0.8,
            y: 2.0,
            w: 11.7,
            h: 4.5,
            fill: { color: surfaceColor },
            line: { color: primaryColor, width: 1 },
            rectRadius: 0.15,
          });

          slide.addText(block.code, {
            x: 1.2,
            y: 2.3,
            w: 10.9,
            h: 3.5,
            fontSize: 13,
            fontFace: "Courier New",
            color: textPrimary,
            valign: "top",
          });

          if (block.caption) {
            slide.addText(block.caption, {
              x: 1.2,
              y: 5.8,
              w: 10.9,
              h: 0.5,
              fontSize: 12,
              italic: true,
              color: textSecondary,
            });
          }
          break;
        }

        case "magazine_ad": {
          slide.addText(block.headline, {
            x: 0.8,
            y: 1.0,
            w: 11.7,
            h: 1.0,
            fontSize: 28,
            bold: true,
            color: primaryColor,
          });

          if (block.quote) {
            slide.addShape(pptx.ShapeType.roundRect, {
              x: 0.8,
              y: 2.2,
              w: 11.7,
              h: 1.5,
              fill: { color: surfaceColor },
              line: { color: accentColor, width: 2 },
              rectRadius: 0.15,
            });
            slide.addText(`"${block.quote}"` + (block.author ? ` — ${block.author}` : ""), {
              x: 1.1,
              y: 2.4,
              w: 11.1,
              h: 1.1,
              fontSize: 16,
              italic: true,
              color: accentColor,
              valign: "middle",
            });
          }

          slide.addText(block.bodyText, {
            x: 0.8,
            y: block.quote ? 4.0 : 2.2,
            w: 11.7,
            h: 2.5,
            fontSize: 14,
            color: textPrimary,
            valign: "top",
          });
          break;
        }

        default:
          break;
      }

      if (block.citations && block.citations.length > 0) {
        slide.addText("Sources: " + block.citations.map(c => c.entityName).join(", "), {
          x: 0.8,
          y: 6.8,
          w: 11.7,
          h: 0.3,
          fontSize: 9,
          italic: true,
          color: textSecondary,
        });
      }
    }

    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    return buffer;
  }
}

export const presentationAssemblyService = new PresentationAssemblyService();
