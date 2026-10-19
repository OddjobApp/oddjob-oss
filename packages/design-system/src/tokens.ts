/**
 * Design Tokens - Single source of truth for Oddjob UI
 *
 * All colors, spacing, typography, and semantic values defined here.
 * Components should import from this file instead of hardcoding values.
 */

// ─────────────────────────────────────────────────────────────────────────────
// COLOR PALETTE
// ─────────────────────────────────────────────────────────────────────────────

export const colors = {
  // Core brand colors
  primary: {
    50: "#f0f9ff",
    100: "#e0f2fe",
    200: "#bae6fd",
    300: "#7dd3fc",
    400: "#38bdf8",
    500: "#0ea5e9",
    600: "#0284c7",
    700: "#0369a1",
    800: "#075985",
    900: "#0c3d66",
  },

  // Secondary - accent orange/gold
  secondary: {
    50: "#fef2f2",
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    400: "#f87171",
    500: "#ef4444", // Primary red for "today"
    600: "#dc2626",
    700: "#b91c1c",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Accent - amber/gold for milestones & warnings
  accent: {
    50: "#fffbeb",
    100: "#fef3c7",
    200: "#fde68a",
    300: "#fcd34d",
    400: "#fbbf24",
    500: "#f59e0b", // Milestone & critical path
    600: "#d97706",
    700: "#b45309",
    800: "#92400e",
    900: "#78350f",
  },

  // Success - emerald
  success: {
    50: "#f0fdf4",
    100: "#dcfce7",
    200: "#bbf7d0",
    300: "#86efac",
    400: "#4ade80",
    500: "#22c55e", // Completed, passed
    600: "#16a34a",
    700: "#15803d",
    800: "#166534",
    900: "#145231",
  },

  // Warning - amber
  warning: {
    50: "#fffbeb",
    100: "#fef3c7",
    200: "#fde68a",
    300: "#fcd34d",
    400: "#fbbf24",
    500: "#f59e0b", // Retry, warning
    600: "#d97706",
    700: "#b45309",
    800: "#92400e",
    900: "#78350f",
  },

  // Danger - red
  danger: {
    50: "#fef2f2",
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    400: "#f87171",
    500: "#ef4444", // Failed, error
    600: "#dc2626",
    700: "#b91c1c",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Info - cyan/sky (for manual gates, pending)
  info: {
    50: "#ecf0ff",
    100: "#e0e7ff",
    200: "#c7d2fe",
    300: "#a5b4fc",
    400: "#818cf8",
    500: "#6366f1", // Normal task, pending
    600: "#4f46e5",
    700: "#4338ca",
    800: "#3730a3",
    900: "#312e81",
  },

  // Manual/Paused - cyan
  manual: {
    50: "#ecfdf5",
    100: "#d1fae5",
    200: "#a7f3d0",
    300: "#6ee7b7",
    400: "#2dd4bf",
    500: "#22d3ee", // Manual gate, paused (cyan)
    600: "#0891b2",
    700: "#0e7490",
    800: "#155e75",
    900: "#164e63",
  },

  // Purple - for retrying, recovery
  recovery: {
    50: "#faf5ff",
    100: "#f3e8ff",
    200: "#e9d5ff",
    300: "#d8b4fe",
    400: "#c084fc",
    500: "#a855f7", // Retrying, recovering
    600: "#9333ea",
    700: "#7e22ce",
    800: "#6b21a8",
    900: "#581c87",
  },

  // Neutral grays
  neutral: {
    0: "#ffffff",
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
    950: "#030712",
  },

  // Semantic colors for execution modes
  execution: {
    critical: "#f59e0b", // Critical path
    normal: "#6366f1", // Normal tasks
    actual: "rgba(52,211,153,0.30)", // Actual time spent
    float: "rgba(255,255,255,0.05)", // Slack/float time
    connector: "rgba(148,163,184,0.50)", // Dependency lines
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export const statusBadges = {
  completed: {
    bg: colors.success[50],
    text: colors.success[700],
    border: colors.success[200],
    icon: "CheckCircle2",
    label: "Completed",
  },
  running: {
    bg: colors.accent[50],
    text: colors.accent[700],
    border: colors.accent[200],
    icon: "Activity",
    label: "Running",
  },
  paused: {
    bg: colors.manual[50],
    text: colors.manual[700],
    border: colors.manual[200],
    icon: "Pause",
    label: "Paused",
  },
  warning: {
    bg: colors.warning[50],
    text: colors.warning[700],
    border: colors.warning[200],
    icon: "AlertTriangle",
    label: "Warning",
  },
  failed: {
    bg: colors.danger[50],
    text: colors.danger[700],
    border: colors.danger[200],
    icon: "X",
    label: "Failed",
  },
  pending: {
    bg: colors.info[50],
    text: colors.info[700],
    border: colors.info[200],
    icon: "Clock",
    label: "Pending",
  },
  replanning: {
    bg: colors.recovery[50],
    text: colors.recovery[700],
    border: colors.recovery[200],
    icon: "RefreshCw",
    label: "Replanning",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SPACING SCALE (Tailwind-based)
// ─────────────────────────────────────────────────────────────────────────────

export const spacing = {
  0: "0px",
  1: "0.25rem", // 4px
  2: "0.5rem", // 8px
  3: "0.75rem", // 12px
  4: "1rem", // 16px
  5: "1.25rem", // 20px
  6: "1.5rem", // 24px
  7: "1.75rem", // 28px
  8: "2rem", // 32px
  9: "2.25rem", // 36px
  10: "2.5rem", // 40px
  12: "3rem", // 48px
  16: "4rem", // 64px
  20: "5rem", // 80px
  24: "6rem", // 96px
  32: "8rem", // 128px
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY SCALE
// ─────────────────────────────────────────────────────────────────────────────

export const typography = {
  // Font families
  fontFamily: {
    sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
    serif: 'ui-serif, Georgia, serif',
  },

  // Font sizes
  fontSize: {
    xs: { size: "0.75rem", lineHeight: "1rem", letterSpacing: "0.02em" }, // 12px
    sm: { size: "0.875rem", lineHeight: "1.25rem", letterSpacing: "0.01em" }, // 14px
    base: { size: "1rem", lineHeight: "1.5rem", letterSpacing: "0" }, // 16px
    lg: { size: "1.125rem", lineHeight: "1.75rem", letterSpacing: "0" }, // 18px
    xl: { size: "1.25rem", lineHeight: "1.75rem", letterSpacing: "-0.01em" }, // 20px
    "2xl": { size: "1.5rem", lineHeight: "2rem", letterSpacing: "-0.01em" }, // 24px
    "3xl": { size: "1.875rem", lineHeight: "2.25rem", letterSpacing: "-0.02em" }, // 30px
    "4xl": { size: "2.25rem", lineHeight: "2.5rem", letterSpacing: "-0.02em" }, // 36px
    "5xl": { size: "3rem", lineHeight: "1", letterSpacing: "-0.02em" }, // 48px
    "6xl": { size: "3.75rem", lineHeight: "1", letterSpacing: "-0.03em" }, // 60px
  },

  // Font weights
  fontWeight: {
    thin: 100,
    extralight: 200,
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  },

  // Line heights
  lineHeight: {
    none: "1",
    tight: "1.25",
    snug: "1.375",
    normal: "1.5",
    relaxed: "1.625",
    loose: "2",
  },

  // Letter spacing
  letterSpacing: {
    tighter: "-0.05em",
    tight: "-0.025em",
    normal: "0em",
    wide: "0.025em",
    wider: "0.05em",
    widest: "0.1em",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SHADOWS & ELEVATION
// ─────────────────────────────────────────────────────────────────────────────

export const shadows = {
  none: "none",
  xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  base: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  "2xl": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  inner: "inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BORDER RADIUS
// ─────────────────────────────────────────────────────────────────────────────

export const borderRadius = {
  none: "0px",
  sm: "0.125rem", // 2px
  base: "0.25rem", // 4px
  md: "0.375rem", // 6px
  lg: "0.5rem", // 8px
  xl: "0.75rem", // 12px
  "2xl": "1rem", // 16px
  "3xl": "1.5rem", // 24px
  full: "9999px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BREAKPOINTS (Mobile-first)
// ─────────────────────────────────────────────────────────────────────────────

export const breakpoints = {
  xs: "320px",
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITIONS & ANIMATIONS
// ─────────────────────────────────────────────────────────────────────────────

export const transitions = {
  duration: {
    instant: "0ms",
    fast: "100ms",
    normal: "150ms",
    slow: "200ms",
    slower: "300ms",
    slowest: "500ms",
  },
  timing: {
    linear: "linear",
    easeIn: "cubic-bezier(0.4, 0, 1, 1)",
    easeOut: "cubic-bezier(0, 0, 0.2, 1)",
    easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Z-INDEX SCALE
// ─────────────────────────────────────────────────────────────────────────────

export const zIndex = {
  hide: -1,
  auto: "auto",
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  backdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
  notification: 1080,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSIBLE COLOR CONTRAST PAIRS
// ─────────────────────────────────────────────────────────────────────────────

export const a11y = {
  contrastPairs: [
    // (background, foreground) - both WCAG AA compliant (4.5:1 or higher)
    { bg: colors.neutral[0], fg: colors.neutral[900] }, // White on dark
    { bg: colors.neutral[900], fg: colors.neutral[0] }, // Dark on white
    { bg: colors.primary[500], fg: colors.neutral[0] }, // Primary on white
    { bg: colors.success[500], fg: colors.neutral[0] }, // Success on white
    { bg: colors.danger[500], fg: colors.neutral[0] }, // Danger on white
    { bg: colors.accent[500], fg: colors.neutral[0] }, // Accent on white
  ],
} as const;

/**
 * WCAG 2.2 Relative Luminance and Contrast Calculator
 */
export function calculateContrast(hex1: string, hex2: string): number {
  const getLum = (hex: string) => {
    let clean = hex.replace("#", "").trim();
    if (clean.length === 3) clean = clean.split("").map(c => c + c).join("");
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;

    const toLin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  };

  const l1 = getLum(hex1);
  const l2 = getLum(hex2);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((brighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * Dynamically synthesizes WCAG 2.2 AA compliant Light & Dark mode tokens from a seed brand hex.
 */
export function createAccessibleTheme(brandSeedHex: string) {
  const lightBg = "#FFFFFF";
  const darkBg = "#0F172A";

  let lightFg = brandSeedHex;
  let lightCR = calculateContrast(lightFg, lightBg);
  if (lightCR < 4.5) {
    lightFg = "#1E293B"; // Fallback to high-contrast slate-800
    lightCR = calculateContrast(lightFg, lightBg);
  }

  let darkFg = brandSeedHex;
  let darkCR = calculateContrast(darkFg, darkBg);
  if (darkCR < 4.5) {
    darkFg = "#F8FAFC"; // Fallback to high-contrast slate-50
    darkCR = calculateContrast(darkFg, darkBg);
  }

  return {
    seed: brandSeedHex,
    light: {
      bg: lightBg,
      fg: lightFg,
      contrastRatio: lightCR,
      meetsAA: lightCR >= 4.5
    },
    dark: {
      bg: darkBg,
      fg: darkFg,
      contrastRatio: darkCR,
      meetsAA: darkCR >= 4.5
    },
    cssVariables: `:root {\n  --color-brand-seed: ${brandSeedHex};\n  --color-brand-light-fg: ${lightFg};\n  --color-brand-dark-fg: ${darkFg};\n}`
  };
}

/**
 * Generate CSS variable definitions (:root) from design system color tokens.
 */
export function toCssVariables(): string {
  const vars: string[] = [];
  for (const [paletteName, palette] of Object.entries(colors)) {
    if (typeof palette === "object" && palette !== null) {
      for (const [shade, hexValue] of Object.entries(palette)) {
        vars.push(`--color-${paletteName}-${shade}: ${hexValue};`);
      }
    }
  }
  return `:root {\n  ${vars.join("\n  ")}\n}`;
}

export default {
  colors,
  statusBadges,
  spacing,
  typography,
  shadows,
  borderRadius,
  breakpoints,
  transitions,
  zIndex,
  a11y,
  calculateContrast,
  createAccessibleTheme,
  toCssVariables,
};


