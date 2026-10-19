import { z } from "zod";

// ─── Design Tokens & Theme Schemas ──────────────────────────────────────────

export const ColorPaletteSchema = z.object({
  primary: z.string().default("#8b5cf6"),
  secondary: z.string().default("#06b6d4"),
  accent: z.string().default("#f59e0b"),
  background: z.string().default("#090d16"),
  surface: z.string().default("#131b2e"),
  textPrimary: z.string().default("#f8fafc"),
  textSecondary: z.string().default("#94a3b8"),
  border: z.string().default("rgba(255, 255, 255, 0.1)"),
  gradient: z.string().default("linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)"),
});

export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

export const TypographyTokensSchema = z.object({
  fontFamilyHeading: z.string().default("'Outfit', sans-serif"),
  fontFamilyBody: z.string().default("'Inter', sans-serif"),
  headingWeight: z.string().default("800"),
  bodyWeight: z.string().default("400"),
});

export type TypographyTokens = z.infer<typeof TypographyTokensSchema>;

export const PresentationDesignSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isDark: z.boolean().default(true),
  colors: ColorPaletteSchema,
  typography: TypographyTokensSchema,
  glassmorphism: z.boolean().default(true),
  borderRadius: z.string().default("12px"),
});

export type PresentationDesignSystem = z.infer<typeof PresentationDesignSystemSchema>;

// Pre-built Design Themes Catalog
export const PREBUILT_PRESENTATION_THEMES: Record<string, PresentationDesignSystem> = {
  "dark_cyberpunk": {
    id: "dark_cyberpunk",
    name: "Dark Cyberpunk",
    description: "Vibrant neon accents over deep obsidian surfaces with glassmorphism",
    isDark: true,
    glassmorphism: true,
    borderRadius: "16px",
    colors: {
      primary: "#a855f7",
      secondary: "#06b6d4",
      accent: "#ec4899",
      background: "#0b0f19",
      surface: "#182238",
      textPrimary: "#f8fafc",
      textSecondary: "#a1a1aa",
      border: "rgba(168, 85, 247, 0.25)",
      gradient: "linear-gradient(135deg, #a855f7 0%, #06b6d4 50%, #ec4899 100%)",
    },
    typography: {
      fontFamilyHeading: "'Outfit', sans-serif",
      fontFamilyBody: "'Inter', sans-serif",
      headingWeight: "800",
      bodyWeight: "400",
    },
  },
  "glass_corporate": {
    id: "glass_corporate",
    name: "Glass Corporate",
    description: "Sleek enterprise aesthetic with frosted glass, cyan gradients, and crisp metrics",
    isDark: true,
    glassmorphism: true,
    borderRadius: "12px",
    colors: {
      primary: "#3b82f6",
      secondary: "#10b981",
      accent: "#f59e0b",
      background: "#0f172a",
      surface: "#1e293b",
      textPrimary: "#ffffff",
      textSecondary: "#94a3b8",
      border: "rgba(59, 130, 246, 0.2)",
      gradient: "linear-gradient(135deg, #3b82f6 0%, #10b981 100%)",
    },
    typography: {
      fontFamilyHeading: "'Inter', sans-serif",
      fontFamilyBody: "'Inter', sans-serif",
      headingWeight: "700",
      bodyWeight: "400",
    },
  },
  "editorial_magazine": {
    id: "editorial_magazine",
    name: "Editorial Magazine",
    description: "High-fashion light editorial layout with serif headings and asymmetric grids",
    isDark: false,
    glassmorphism: false,
    borderRadius: "4px",
    colors: {
      primary: "#0f172a",
      secondary: "#b45309",
      accent: "#be123c",
      background: "#fafaf9",
      surface: "#ffffff",
      textPrimary: "#1c1917",
      textSecondary: "#57534e",
      border: "rgba(28, 25, 23, 0.15)",
      gradient: "linear-gradient(135deg, #1c1917 0%, #b45309 100%)",
    },
    typography: {
      fontFamilyHeading: "'Playfair Display', Georgia, serif",
      fontFamilyBody: "'Plus Jakarta Sans', sans-serif",
      headingWeight: "800",
      bodyWeight: "400",
    },
  },
  "vibrant_product": {
    id: "vibrant_product",
    name: "Vibrant Product",
    description: "High-energy presentation style with bold emerald & amber contrast",
    isDark: true,
    glassmorphism: true,
    borderRadius: "20px",
    colors: {
      primary: "#10b981",
      secondary: "#f59e0b",
      accent: "#6366f1",
      background: "#064e3b",
      surface: "#047857",
      textPrimary: "#ffffff",
      textSecondary: "#a7f3d0",
      border: "rgba(16, 185, 129, 0.3)",
      gradient: "linear-gradient(135deg, #10b981 0%, #f59e0b 100%)",
    },
    typography: {
      fontFamilyHeading: "'Outfit', sans-serif",
      fontFamilyBody: "'Inter', sans-serif",
      headingWeight: "900",
      bodyWeight: "400",
    },
  },
  "clean_minimalist": {
    id: "clean_minimalist",
    name: "Clean Minimalist",
    description: "Ultra-clean monochrome layout with subtle slate accents and generous whitespace",
    isDark: false,
    glassmorphism: false,
    borderRadius: "8px",
    colors: {
      primary: "#18181b",
      secondary: "#64748b",
      accent: "#2563eb",
      background: "#ffffff",
      surface: "#f8fafc",
      textPrimary: "#0f172a",
      textSecondary: "#475569",
      border: "rgba(15, 23, 42, 0.1)",
      gradient: "linear-gradient(135deg, #0f172a 0%, #2563eb 100%)",
    },
    typography: {
      fontFamilyHeading: "'Inter', sans-serif",
      fontFamilyBody: "'Inter', sans-serif",
      headingWeight: "700",
      bodyWeight: "400",
    },
  },
};

// ─── Atomic Document Block Schemas ────────────────────────────────────────────

export const CitationSchema = z.object({
  entityId: z.string().optional(),
  entityName: z.string(),
  entityType: z.string().default("knowledge_node"),
  sourceQueryId: z.number().nullable().optional(),
  uri: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const ProvenanceSchema = z.object({
  source: z.string(),
  verified: z.boolean().default(true),
  timestamp: z.string().optional(),
  hash: z.string().optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

export const BaseBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  badgeText: z.string().optional(),
  citations: z.array(CitationSchema).optional(),
  provenance: ProvenanceSchema.optional(),
});

// 1. Hero Header Block
export const HeroHeaderBlockSchema = BaseBlockSchema.extend({
  type: z.literal("hero_header"),
  headline: z.string(),
  subheadline: z.string().optional(),
  ctaText: z.string().optional(),
  imageUrl: z.string().optional(),
  layout: z.enum(["centered", "split_left", "split_right"]).default("split_left"),
});

export type HeroHeaderBlock = z.infer<typeof HeroHeaderBlockSchema>;

// 2. Slide Frame Block (Presentation Deck)
export const SlideFrameBlockSchema = BaseBlockSchema.extend({
  type: z.literal("slide_frame"),
  slideNumber: z.number().int().positive(),
  headline: z.string(),
  bodyMarkdown: z.string(),
  bulletPoints: z.array(z.string()).default([]),
  speakerNotes: z.string().optional(),
  imageUrl: z.string().optional(),
  layout: z.enum(["title_only", "split_text_image", "three_cards", "big_quote"]).default("split_text_image"),
});

export type SlideFrameBlock = z.infer<typeof SlideFrameBlockSchema>;

// 3. Magazine Ad / Editorial Block
export const MagazineAdBlockSchema = BaseBlockSchema.extend({
  type: z.literal("magazine_ad"),
  headline: z.string(),
  quote: z.string().optional(),
  author: z.string().optional(),
  bodyText: z.string(),
  /**
   * Every source bullet except the one promoted to `quote`.
   *
   * Without this the editorial block had nowhere to put them: it kept
   * `bodyText` and the first bullet and dropped the rest on the floor, so
   * asking for the magazine format silently returned less information than
   * every other format built from the same input.
   */
  supportingPoints: z.array(z.string()).default([]),
  heroImageUrl: z.string().optional(),
  accentTag: z.string().optional(),
  layout: z.enum(["editorial_asymmetric", "full_bleed_hero", "two_column_spread"]).default("editorial_asymmetric"),
});

export type MagazineAdBlock = z.infer<typeof MagazineAdBlockSchema>;

// 4. Feature Grid Block
export const FeatureCardSchema = z.object({
  icon: z.string().optional(),
  title: z.string(),
  description: z.string(),
  highlightTag: z.string().optional(),
});

export const FeatureGridBlockSchema = BaseBlockSchema.extend({
  type: z.literal("feature_grid"),
  cards: z.array(FeatureCardSchema).min(1),
  columns: z.number().int().min(2).max(4).default(3),
});

export type FeatureGridBlock = z.infer<typeof FeatureGridBlockSchema>;

// 5. Stat Callout Block
export const StatItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  delta: z.string().optional(),
  isPositive: z.boolean().default(true),
});

export const StatCalloutBlockSchema = BaseBlockSchema.extend({
  type: z.literal("stat_callout"),
  stats: z.array(StatItemSchema).min(1),
});

export type StatCalloutBlock = z.infer<typeof StatCalloutBlockSchema>;

// 6. Comparison Matrix Block
export const ComparisonRowSchema = z.object({
  feature: z.string(),
  competitorValue: z.string(),
  ourValue: z.string(),
  isOurAdvantage: z.boolean().default(true),
});

export const ComparisonMatrixBlockSchema = BaseBlockSchema.extend({
  type: z.literal("comparison_matrix"),
  competitorName: z.string().default("Industry Alternative"),
  ourName: z.string().default("Oddjob Engine"),
  rows: z.array(ComparisonRowSchema).min(1),
});

export type ComparisonMatrixBlock = z.infer<typeof ComparisonMatrixBlockSchema>;

// 7. Timeline Block
export const TimelineEventSchema = z.object({
  dateOrPhase: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["completed", "active", "upcoming"]).default("upcoming"),
});

export const TimelineBlockSchema = BaseBlockSchema.extend({
  type: z.literal("timeline"),
  events: z.array(TimelineEventSchema).min(1),
});

export type TimelineBlock = z.infer<typeof TimelineBlockSchema>;

// 8. Interactive Chart Block
export const ChartDatasetSchema = z.object({
  label: z.string(),
  data: z.array(z.number()),
  color: z.string().optional(),
});

export const ChartBlockSchema = BaseBlockSchema.extend({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie", "doughnut", "radar"]).default("bar"),
  labels: z.array(z.string()).min(1),
  datasets: z.array(ChartDatasetSchema).min(1),
  unit: z.string().optional(),
  description: z.string().optional(),
});

export type ChartBlock = z.infer<typeof ChartBlockSchema>;

// 9. Diagram Block (Mermaid & Architecture Flows)
export const DiagramBlockSchema = BaseBlockSchema.extend({
  type: z.literal("diagram"),
  diagramType: z.enum(["mermaid", "flowchart", "sequence", "architecture"]).default("mermaid"),
  code: z.string(),
  caption: z.string().optional(),
});

export type DiagramBlock = z.infer<typeof DiagramBlockSchema>;

// ─── Union of All Document Blocks ────────────────────────────────────────────

export const DocumentBlockSchema = z.discriminatedUnion("type", [
  HeroHeaderBlockSchema,
  SlideFrameBlockSchema,
  MagazineAdBlockSchema,
  FeatureGridBlockSchema,
  StatCalloutBlockSchema,
  ComparisonMatrixBlockSchema,
  TimelineBlockSchema,
  ChartBlockSchema,
  DiagramBlockSchema,
]);

export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;

// ─── Top-Level Document AST ──────────────────────────────────────────────────

export const DocumentBlockASTSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  formatCategory: z.enum(["presentation_deck", "magazine_ad", "whitepaper", "executive_brief"]).default("presentation_deck"),
  designSystem: PresentationDesignSystemSchema,
  blocks: z.array(DocumentBlockSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type DocumentBlockAST = z.infer<typeof DocumentBlockASTSchema>;
