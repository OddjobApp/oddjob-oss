/**
 * WCAG 2.2 Relative Luminance & Accessible Design Token Synthesizer
 * Formally verifies and synthesizes accessible color palettes and tokens via contrast arithmetic.
 */

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface ContrastResult {
  contrastRatio: number;
  meetsAA: boolean;       // >= 4.5:1
  meetsAAA: boolean;      // >= 7.0:1
  meetsLargeTextAA: boolean; // >= 3.0:1
  luminance1: number;
  luminance2: number;
}

export interface SynthesizedPalette {
  seedHex: string;
  lightTheme: {
    background: string;
    surface: string;
    foreground: string;
    contrastWithBg: number;
    meetsAA: boolean;
  };
  darkTheme: {
    background: string;
    surface: string;
    foreground: string;
    contrastWithBg: number;
    meetsAA: boolean;
  };
  cssTokens: string;
}

export type AccessibleThemeTokens = SynthesizedPalette;

export class WCAGTokenSynthesizer {
  /**
   * Parse hex string (#RGB, #RRGGBB) to RGB
   */
  public static hexToRgb(hex: string): RGB {
    let clean = hex.replace("#", "").trim();
    if (clean.length === 3) {
      clean = clean.split("").map(c => c + c).join("");
    }
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  /**
   * Convert RGB to hex string
   */
  public static rgbToHex(rgb: RGB): string {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(rgb.r).toString(16).padStart(2, "0");
    const g = clamp(rgb.g).toString(16).padStart(2, "0");
    const b = clamp(rgb.b).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`.toUpperCase();
  }

  /**
   * Calculate WCAG 2.2 Relative Luminance over sRGB space
   */
  public static calculateLuminance(rgb: RGB): number {
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };

    const rLin = toLinear(rgb.r);
    const gLin = toLinear(rgb.g);
    const bLin = toLinear(rgb.b);

    return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
  }

  /**
   * Calculate contrast ratio between two colors
   */
  public static calculateContrast(color1: string | RGB, color2: string | RGB): ContrastResult {
    const rgb1 = typeof color1 === "string" ? this.hexToRgb(color1) : color1;
    const rgb2 = typeof color2 === "string" ? this.hexToRgb(color2) : color2;

    const l1 = this.calculateLuminance(rgb1);
    const l2 = this.calculateLuminance(rgb2);

    const brighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    const ratio = Math.round(((brighter + 0.05) / (darker + 0.05)) * 100) / 100;

    return {
      contrastRatio: ratio,
      meetsAA: ratio >= 4.5,
      meetsAAA: ratio >= 7.0,
      meetsLargeTextAA: ratio >= 3.0,
      luminance1: l1,
      luminance2: l2
    };
  }

  /**
   * Synthesizes mathematically guaranteed contrast-compliant light and dark tokens from a seed brand color
   */
  public static synthesizeAccessiblePalette(seedHex: string): SynthesizedPalette {
    const seedRgb = this.hexToRgb(seedHex);
    const seedLum = this.calculateLuminance(seedRgb);

    // Light theme background (#FFFFFF, L = 1.0)
    const lightBg = "#FFFFFF";
    let lightFg = seedHex;
    let lightContrast = this.calculateContrast(lightFg, lightBg);

    // If seed color does not have sufficient contrast against white (CR < 4.5), darken it
    if (!lightContrast.meetsAA) {
      let darkened = { ...seedRgb };
      for (let factor = 0.95; factor >= 0.05; factor -= 0.05) {
        darkened = {
          r: seedRgb.r * factor,
          g: seedRgb.g * factor,
          b: seedRgb.b * factor
        };
        const testHex = this.rgbToHex(darkened);
        const testContrast = this.calculateContrast(testHex, lightBg);
        if (testContrast.meetsAA) {
          lightFg = testHex;
          lightContrast = testContrast;
          break;
        }
      }
      if (!lightContrast.meetsAA) {
        lightFg = "#1E293B"; // Fallback to slate-800
        lightContrast = this.calculateContrast(lightFg, lightBg);
      }
    }

    // Dark theme background (#0F172A, slate-900)
    const darkBg = "#0F172A";
    let darkFg = seedHex;
    let darkContrast = this.calculateContrast(darkFg, darkBg);

    // If seed color does not have sufficient contrast against dark background (CR < 4.5), lighten it
    if (!darkContrast.meetsAA) {
      let lightened = { ...seedRgb };
      for (let factor = 1.1; factor <= 3.0; factor += 0.1) {
        lightened = {
          r: Math.min(255, seedRgb.r * factor + (255 - seedRgb.r) * 0.2),
          g: Math.min(255, seedRgb.g * factor + (255 - seedRgb.g) * 0.2),
          b: Math.min(255, seedRgb.b * factor + (255 - seedRgb.b) * 0.2)
        };
        const testHex = this.rgbToHex(lightened);
        const testContrast = this.calculateContrast(testHex, darkBg);
        if (testContrast.meetsAA) {
          darkFg = testHex;
          darkContrast = testContrast;
          break;
        }
      }
      if (!darkContrast.meetsAA) {
        darkFg = "#F8FAFC"; // Fallback to slate-50
        darkContrast = this.calculateContrast(darkFg, darkBg);
      }
    }

    const cssTokens = `
:root {
  --color-brand-seed: ${seedHex};
  --color-brand-light-fg: ${lightFg};
  --color-brand-light-bg: ${lightBg};
  --contrast-light-ratio: ${lightContrast.contrastRatio};
  --color-brand-dark-fg: ${darkFg};
  --color-brand-dark-bg: ${darkBg};
  --contrast-dark-ratio: ${darkContrast.contrastRatio};
}
`.trim();

    return {
      seedHex,
      lightTheme: {
        background: lightBg,
        surface: "#F8FAFC",
        foreground: lightFg,
        contrastWithBg: lightContrast.contrastRatio,
        meetsAA: lightContrast.meetsAA
      },
      darkTheme: {
        background: darkBg,
        surface: "#1E293B",
        foreground: darkFg,
        contrastWithBg: darkContrast.contrastRatio,
        meetsAA: darkContrast.meetsAA
      },
      cssTokens
    };
  }
}
