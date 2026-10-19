import { describe, it, expect } from "vitest";
import { WCAGTokenSynthesizer } from "../wcag-token-synthesizer.js";

describe("WCAGTokenSynthesizer (Relative Luminance & Contrast Synthesis)", () => {
  it("should calculate exact WCAG 2.2 contrast ratios for known standards", () => {
    // Pure Black on Pure White = 21.0:1
    const blackWhite = WCAGTokenSynthesizer.calculateContrast("#000000", "#FFFFFF");
    expect(blackWhite.contrastRatio).toBe(21);
    expect(blackWhite.meetsAA).toBe(true);
    expect(blackWhite.meetsAAA).toBe(true);

    // Light gray on white (#CCCCCC on #FFFFFF) fails AA
    const lowContrast = WCAGTokenSynthesizer.calculateContrast("#CCCCCC", "#FFFFFF");
    expect(lowContrast.meetsAA).toBe(false);
  });

  it("should synthesize compliant light and dark themes from any brand seed hex", () => {
    // Brand blue seed (#3B82F6)
    const palette = WCAGTokenSynthesizer.synthesizeAccessiblePalette("#3B82F6");

    expect(palette.lightTheme.meetsAA).toBe(true);
    expect(palette.lightTheme.contrastWithBg).toBeGreaterThanOrEqual(4.5);

    expect(palette.darkTheme.meetsAA).toBe(true);
    expect(palette.darkTheme.contrastWithBg).toBeGreaterThanOrEqual(4.5);

    expect(palette.cssTokens).toContain("--color-brand-light-fg:");
    expect(palette.cssTokens).toContain("--color-brand-dark-fg:");
  });

  it("should synthesize compliant palette even from challenging yellow brand seeds", () => {
    // Bright yellow (#FACC15) has terrible contrast against white
    const yellowPalette = WCAGTokenSynthesizer.synthesizeAccessiblePalette("#FACC15");

    expect(yellowPalette.lightTheme.meetsAA).toBe(true);
    expect(yellowPalette.lightTheme.contrastWithBg).toBeGreaterThanOrEqual(4.5);
  });
});
