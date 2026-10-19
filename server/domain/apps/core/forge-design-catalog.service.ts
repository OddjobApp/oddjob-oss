import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("ForgeDesignCatalog");

const CATALOG_API = "https://designdotmd.directory/api/designs";
const CATALOG_CACHE_KEY = "forge:design-catalog";
const CATALOG_CACHE_TTL = 3600; // 1 hour
const STYLE_CACHE_PREFIX = "forge:design-style:";
const STYLE_CACHE_TTL = 86400; // 24 hours — individual styles rarely change

const CURATED_FALLBACK_STYLES: ForgeDesignStyle[] = [
    { id: "heritage", name: "Heritage", author: "Rofi", tags: ["Editorial", "Serif", "Warm"], tagline: "Architectural minimalism meets journalistic gravitas." },
    { id: "glassline", name: "Glassline", author: "Rofi", tags: ["Minimal", "Cobalt"], tagline: "Fog-grey neutrals with a cobalt pinprick." },
    { id: "terracotta", name: "Terracotta", author: "Rofi", tags: ["Warm", "Editorial"], tagline: "Sun-baked clay, ink, and weathered paper." },
    { id: "ocean-depth", name: "Ocean Depth", author: "Rofi", tags: ["Dark", "Teal"], tagline: "Midnight blue foundation with a teal pulse." },
    { id: "swiss-grid", name: "Swiss Grid", author: "Rofi", tags: ["Grid", "Modernist"], tagline: "Helvetica, a 12-column grid, and a single red." },
    { id: "paper-white", name: "Paper White", author: "Rofi", tags: ["Minimal", "Light"], tagline: "The e-reader palette: ink, cream, nothing else." },
    { id: "stripe-gradient", name: "Stripe Gradient", author: "Rofi", tags: ["Gradient", "Product"], tagline: "Deep navy, sky, a whisper of violet." },
    { id: "terminal", name: "Terminal", author: "Rofi", tags: ["Dark", "Mono"], tagline: "Phosphor green on deep black. Fast, loud, honest." },
];

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ForgeDesignStyle {
    id: string;
    name: string;
    author: string;
    tags: string[];
    tagline: string;
}

export interface FontSpec {
    fontFamily: string;
    fontSize?: string;
    fontWeight?: string | number;
    letterSpacing?: string;
    lineHeight?: string | number;
}

export interface ParsedDesignTokens {
    id: string;
    name: string;
    tagline: string;
    colors: {
        primary: string;
        secondary: string;
        tertiary: string;
        neutral: string;
        surface: string;
        "on-primary": string;
    };
    typography: {
        display: FontSpec;
        h1: FontSpec;
        body: FontSpec;
        label: FontSpec;
    };
    rounded: {
        sm: string;
        md: string;
        lg: string;
    };
    spacing: {
        sm: string;
        md: string;
        lg: string;
    };
    components: Record<string, Record<string, string>>;
    overview: string;
    rawMd: string;
}

// ─── YAML Front-Matter Parser ─────────────────────────────────────────────────
// A lightweight, zero-dependency parser for the specific DESIGN.md structure.

function parseDesignMd(id: string, name: string, tagline: string, rawMd: string): ParsedDesignTokens {
    // Split front-matter from body
    const fmMatch = rawMd.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
        throw new Error(`DESIGN.md for "${id}" has no valid front-matter block.`);
    }

    const yamlBlock = fmMatch[1];
    const body = fmMatch[2] || "";

    // Extract the overview section (## Overview paragraph)
    const overviewMatch = body.match(/## Overview\n\n([\s\S]+?)(?=\n## |$)/);
    const overview = overviewMatch ? overviewMatch[1].trim() : tagline;

    // Parse YAML manually (avoids a js-yaml dependency for this structured format)
    function extractSection(yaml: string, section: string): Record<string, string> {
        const sectionMatch = yaml.match(new RegExp(`${section}:\\n([\\s\\S]+?)(?=\\n\\w|$)`));
        if (!sectionMatch) return {};
        const lines = sectionMatch[1].split('\n').filter(l => l.includes(':'));
        const result: Record<string, string> = {};
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
            if (key && val && !val.includes('\n')) {
                result[key] = val;
            }
        }
        return result;
    }

    function extractTypographyVariant(yaml: string, variant: string): FontSpec {
        const variantMatch = yaml.match(new RegExp(`  ${variant}:\\n([\\s\\S]+?)(?=  \\w|\\nrounded:|$)`));
        if (!variantMatch) return { fontFamily: "Inter" };
        const lines = variantMatch[1].split('\n').filter(l => l.includes(':'));
        const spec: Record<string, string> = {};
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
            if (key && val) spec[key] = val;
        }
        return {
            fontFamily: spec.fontFamily || "Inter",
            fontSize: spec.fontSize,
            fontWeight: spec.fontWeight,
            letterSpacing: spec.letterSpacing,
            lineHeight: spec.lineHeight,
        };
    }

    const colors = extractSection(yamlBlock, 'colors') as ParsedDesignTokens['colors'];
    const rounded = extractSection(yamlBlock, 'rounded') as ParsedDesignTokens['rounded'];
    const spacing = extractSection(yamlBlock, 'spacing') as ParsedDesignTokens['spacing'];

    // Parse nested typography block
    const typography = {
        display: extractTypographyVariant(yamlBlock, 'display'),
        h1: extractTypographyVariant(yamlBlock, 'h1'),
        body: extractTypographyVariant(yamlBlock, 'body'),
        label: extractTypographyVariant(yamlBlock, 'label'),
    };

    // Parse components block (two-level nesting)
    const components: Record<string, Record<string, string>> = {};
    const componentsMatch = yamlBlock.match(/components:\n([\s\S]+?)(?=\n\w|$)/);
    if (componentsMatch) {
        const compLines = componentsMatch[1].split('\n');
        let currentComp = '';
        for (const line of compLines) {
            const compNameMatch = line.match(/^  (\S[\w-]+):$/);
            if (compNameMatch) {
                currentComp = compNameMatch[1];
                components[currentComp] = {};
                continue;
            }
            if (currentComp && line.includes(':')) {
                const colonIdx = line.indexOf(':');
                const key = line.slice(0, colonIdx).trim();
                const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
                if (key && val) components[currentComp][key] = val;
            }
        }
    }

    return {
        id,
        name,
        tagline,
        colors,
        typography,
        rounded,
        spacing,
        components,
        overview,
        rawMd,
    };
}

// ─── Main Service ─────────────────────────────────────────────────────────────

export const forgeDesignCatalogService = {

    /**
     * Returns the full catalog of ~120+ design styles (name, tags, tagline).
     * Cached in Redis for 1 hour to avoid hammering the upstream API.
     */
    async listStyles(): Promise<ForgeDesignStyle[]> {
        try {
            const cached = await redis.get(CATALOG_CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                // Do not let an old transient failure pin an empty picker for
                // the full cache TTL. Empty is not a useful catalog state.
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { /* Redis miss — fall through to fetch */ }

        try {
            const res = await fetch(CATALOG_API, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error(`Catalog API returned ${res.status}`);
            const styles: ForgeDesignStyle[] = await res.json();

            await redis.setex(CATALOG_CACHE_KEY, CATALOG_CACHE_TTL, JSON.stringify(styles));
            logger.info(`[DesignCatalog] Cached ${styles.length} styles from designdotmd.directory`);
            return styles;
        } catch (err: any) {
            logger.error(`[DesignCatalog] Failed to fetch catalog: ${err.message}`);
            return CURATED_FALLBACK_STYLES;
        }
    },

    /**
     * Fetches a single style with full DESIGN.md content and parsed tokens.
     * Cached in Redis for 24 hours.
     */
    async getStyleById(id: string): Promise<ParsedDesignTokens | null> {
        const cacheKey = `${STYLE_CACHE_PREFIX}${id}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch { }

        try {
            const res = await fetch(`${CATALOG_API}/${id}`, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error(`Design style API returned ${res.status} for id="${id}"`);
            const data: { id: string; name: string; md: string; } & ForgeDesignStyle = await res.json();

            const parsed = parseDesignMd(data.id, data.name, data.tagline, data.md);
            await redis.setex(cacheKey, STYLE_CACHE_TTL, JSON.stringify(parsed));
            logger.info(`[DesignCatalog] Cached design tokens for style: ${id}`);
            return parsed;
        } catch (err: any) {
            logger.error(`[DesignCatalog] Failed to fetch style "${id}": ${err.message}`);
            return null;
        }
    },

    /**
     * Converts parsed design tokens to a Stitch-compatible design system payload.
     * Maps the DESIGN.md color/font/radius values to Stitch's schema.
     */
    toStitchDesignSystem(tokens: ParsedDesignTokens): Record<string, any> {
        return {
            displayName: tokens.name,
            colorPalette: {
                customPrimaryColor: tokens.colors.tertiary, // accent/CTA color
                saturation: "medium",
            },
            typography: {
                fontFamily: tokens.typography.body.fontFamily,
            },
            shape: {
                // Map the md value to Stitch's enum scale
                cornerRoundness: this._roundnessToStitch(tokens.rounded.md),
            },
            appearance: {
                // Infer light/dark from surface color luminance
                lightBackground: this._isLight(tokens.colors.surface) ? tokens.colors.surface : "#FFFFFF",
                darkBackground: !this._isLight(tokens.colors.neutral) ? tokens.colors.neutral : "#0D1117",
            },
            designMd: tokens.rawMd,
        };
    },

    /**
     * Renders a concise design-identity block for AI prompt injection.
     * Covers palette, typography, radius, and the style's own do/don'ts.
     */
    toPromptContext(tokens: ParsedDesignTokens): string {
        return `
## DESIGN IDENTITY: ${tokens.name}
${tokens.overview}

### Color Palette
- Background: ${tokens.colors.neutral}
- Surface/Cards: ${tokens.colors.surface}
- Primary Text: ${tokens.colors.primary}
- Secondary Text: ${tokens.colors.secondary}
- Accent/CTA: ${tokens.colors.tertiary}
- Text on Accent: ${tokens.colors["on-primary"]}

### Typography
- Display: ${tokens.typography.display.fontFamily} ${tokens.typography.display.fontSize} weight:${tokens.typography.display.fontWeight}
- Headings: ${tokens.typography.h1.fontFamily} ${tokens.typography.h1.fontSize} weight:${tokens.typography.h1.fontWeight}
- Body: ${tokens.typography.body.fontFamily} ${tokens.typography.body.fontSize} line-height:${tokens.typography.body.lineHeight}
- Labels: ${tokens.typography.label.fontFamily} ${tokens.typography.label.fontSize} tracking:${tokens.typography.label.letterSpacing}

### Shape
- Border radius SM/MD/LG: ${tokens.rounded.sm} / ${tokens.rounded.md} / ${tokens.rounded.lg}

### Spacing
- SM/MD/LG: ${tokens.spacing.sm} / ${tokens.spacing.md} / ${tokens.spacing.lg}

### Components
- Primary Button: bg ${tokens.components['button-primary']?.backgroundColor ?? tokens.colors.tertiary}, radius ${tokens.components['button-primary']?.rounded ?? tokens.rounded.md}
- Card: bg ${tokens.components['card']?.backgroundColor ?? tokens.colors.surface}, radius ${tokens.components['card']?.rounded ?? tokens.rounded.lg}

RULE: Apply this design identity consistently. Use the font family in next/font/google or next/font/local. Apply colors as CSS custom properties or Tailwind inline styles. Do NOT deviate from the accent color — it is the sole CTA driver.
`.trim();
    },

    /** Maps a CSS border-radius value to Stitch's cornerRoundness enum */
    _roundnessToStitch(radius: string): string {
        const px = parseInt(radius || "8");
        if (px <= 2) return "NONE";
        if (px <= 6) return "SMALL";
        if (px <= 12) return "MEDIUM";
        if (px <= 20) return "LARGE";
        return "FULL";
    },

    /** Naive luminance check: hex colors with high R+G+B are light */
    _isLight(hex: string): boolean {
        if (!hex || !hex.startsWith('#')) return true;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 0.299 + g * 0.587 + b * 0.114) > 128;
    },
};
