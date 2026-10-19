import {
  DocumentBlockAST,
  DocumentBlock,
  PresentationDesignSystem,
  PREBUILT_PRESENTATION_THEMES,
} from "@shared/schema/document-block.schema.js";

export class PresentationMediaService {
  /**
   * Synthesizes an art direction prompt based on block content, active theme rules, and model provider.
   */
  generateArtDirectionPrompt(
    block: DocumentBlock,
    designSystem: PresentationDesignSystem,
    provider: "midjourney" | "imagen" | "dalle" = "midjourney"
  ): string {
    const topic = (block as any).headline || (block as any).title || "Strategic Enterprise Solution";
    const themeId = designSystem.id;

    let basePrompt = "";
    switch (themeId) {
      case "dark_cyberpunk":
        basePrompt = `High-end 3D glassmorphism render of ${topic}, neon purple and cyan volumetric glow, obsidian metallic surfaces, cinematic lighting, photorealistic octane render`;
        break;

      case "glass_corporate":
        basePrompt = `Sleek corporate isometric vector graph of ${topic}, frosted glass transparency, sapphire blue and emerald green gradients, ultra-clean minimalism, high-tech dashboard style`;
        break;

      case "editorial_magazine":
        basePrompt = `Editorial fashion photography of ${topic}, minimalist magazine composition, warm stone neutral tones, soft studio lighting, architectural elegance, high-contrast monochrome`;
        break;

      case "vibrant_product":
        basePrompt = `Bold futuristic product design render of ${topic}, vibrant emerald and amber lighting, dynamic motion curves, high energy studio background, modern product showcase`;
        break;

      case "clean_minimalist":
      default:
        basePrompt = `Ultra-clean minimalist geometric abstract vector illustration of ${topic}, monochrome slate background, crisp lines, subtle drop shadows, contemporary Swiss design`;
        break;
    }

    if (provider === "midjourney") {
      const ar = block.type === "magazine_ad" ? "4:5" : "16:9";
      return `${basePrompt} --ar ${ar} --v 6.0 --stylize 250 --style raw`;
    }

    return basePrompt;
  }

  /**
   * Generates a responsive theme-styled SVG vector media data URL for zero-latency visual rendering.
   */
  generateSvgPlaceholder(topic: string, designSystem: PresentationDesignSystem): string {
    const primary = designSystem?.colors?.primary || "#06b6d4";
    const secondary = designSystem?.colors?.secondary || "#3b82f6";
    const bg = designSystem?.colors?.surface || "#090d16";
    const text = designSystem?.colors?.textPrimary || "#f8fafc";
    const accent = designSystem?.colors?.accent || "#f59e0b";

    const escapeXml = (str: string): string =>
      (str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const rawTopic = topic || "Executive Presentation Deliverable";
    const safeTopic = escapeXml(rawTopic.length > 55 ? `${rawTopic.slice(0, 52)}...` : rawTopic);
    const safeFontHeading = (designSystem?.typography?.fontFamilyHeading || "sans-serif").replace(/"/g, "'");
    const safeFontBody = (designSystem?.typography?.fontFamilyBody || "sans-serif").replace(/"/g, "'");

    // Dynamic topic iconography and category badge selection
    let iconSvg = "";
    let badgeText = "EXECUTIVE BRIEFING";

    if (/film|video|cinema|creative|camera|scene|script|scribe|media|dailies|storyboard|shot/i.test(rawTopic)) {
      badgeText = "CREATIVE & CINEMATICS";
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <circle cx="400" cy="148" r="10" fill="none" stroke="${primary}" stroke-width="2" />
        <circle cx="400" cy="126" r="4.5" fill="${primary}" />
        <circle cx="400" cy="170" r="4.5" fill="${primary}" />
        <circle cx="378" cy="148" r="4.5" fill="${primary}" />
        <circle cx="422" cy="148" r="4.5" fill="${primary}" />
        <path d="M 424 165 L 436 177" stroke="${secondary}" stroke-width="2" stroke-linecap="round" />
      `;
    } else if (/decision|policy|governance|matrix|verdict|gate|charter|consensus/i.test(rawTopic)) {
      badgeText = "GOVERNANCE & DECISION";
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <line x1="400" y1="130" x2="400" y2="166" stroke="${primary}" stroke-width="2.5" stroke-linecap="round" />
        <line x1="382" y1="136" x2="418" y2="136" stroke="${primary}" stroke-width="2" stroke-linecap="round" />
        <path d="M 382 136 L 374 152 L 390 152 Z" fill="${secondary}" fill-opacity="0.6" stroke="${secondary}" stroke-width="1.5" />
        <path d="M 418 136 L 410 152 L 426 152 Z" fill="${secondary}" fill-opacity="0.6" stroke="${secondary}" stroke-width="1.5" />
        <line x1="390" y1="166" x2="410" y2="166" stroke="${primary}" stroke-width="2.5" stroke-linecap="round" />
      `;
    } else if (/action|todo|commit|task|step|plan|roadmap|milestone|deliverable/i.test(rawTopic)) {
      badgeText = "ACTION & COMMITMENTS";
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <rect x="386" y="132" width="28" height="34" rx="4" fill="none" stroke="${primary}" stroke-width="2" />
        <rect x="395" y="129" width="10" height="4" rx="2" fill="${primary}" />
        <path d="M 391 143 L 394 146 L 401 139" fill="none" stroke="${secondary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="404" y1="143" x2="410" y2="143" stroke="${text}" stroke-opacity="0.7" stroke-width="1.5" stroke-linecap="round" />
        <path d="M 391 153 L 394 156 L 401 149" fill="none" stroke="${secondary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="404" y1="153" x2="410" y2="153" stroke="${text}" stroke-opacity="0.7" stroke-width="1.5" stroke-linecap="round" />
      `;
    } else if (/security|compliance|audit|privacy|safety|guardrail|firewall|protect/i.test(rawTopic)) {
      badgeText = "SECURITY & COMPLIANCE";
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <path d="M 400 132 L 416 138 C 416 154 400 164 400 166 C 400 164 384 154 384 138 Z" fill="${secondary}" fill-opacity="0.3" stroke="${primary}" stroke-width="2" stroke-linejoin="round" />
        <path d="M 395 148 L 399 152 L 407 144" fill="none" stroke="${primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      `;
    } else if (/technical|pipeline|render|queue|conform|architecture|system|code|infra|engine/i.test(rawTopic)) {
      badgeText = "ENGINEERING & PIPELINE";
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <circle cx="385" cy="148" r="6" fill="${primary}" />
        <circle cx="400" cy="138" r="6" fill="${secondary}" />
        <circle cx="415" cy="148" r="6" fill="${primary}" />
        <line x1="390" y1="145" x2="395" y2="141" stroke="${text}" stroke-opacity="0.8" stroke-width="1.5" />
        <line x1="405" y1="141" x2="410" y2="145" stroke="${text}" stroke-opacity="0.8" stroke-width="1.5" />
      `;
    } else {
      iconSvg = `
        <circle cx="400" cy="148" r="32" fill="${primary}" fill-opacity="0.15" stroke="${primary}" stroke-width="2" />
        <path d="M 400 134 Q 400 148 414 148 Q 400 148 400 162 Q 400 148 386 148 Q 400 148 400 134 Z" fill="${primary}" />
        <circle cx="414" cy="138" r="2.5" fill="${secondary}" />
        <circle cx="386" cy="158" r="2" fill="${secondary}" />
      `;
    }

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primary}" stop-opacity="0.85" />
          <stop offset="100%" stop-color="${secondary}" stop-opacity="0.85" />
        </linearGradient>
        <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.09)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
        </linearGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        </pattern>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="25" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="${bg}" />
      <rect width="100%" height="100%" fill="url(#grid)" />
      <circle cx="400" cy="225" r="160" fill="url(#grad)" filter="url(#glow)" opacity="0.4" />
      <rect x="70" y="65" width="660" height="320" rx="20" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />
      ${iconSvg}
      <text x="400" y="225" font-family="${safeFontHeading}" font-size="20" font-weight="bold" fill="${text}" text-anchor="middle">${safeTopic}</text>
      <rect x="270" y="260" width="260" height="28" rx="14" fill="${secondary}" fill-opacity="0.15" stroke="${secondary}" stroke-opacity="0.4" stroke-width="1" />
      <text x="400" y="278" font-family="${safeFontBody}" font-size="11" font-weight="bold" fill="${secondary}" text-anchor="middle" letter-spacing="2">${badgeText}</text>
    </svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  }

  /**
   * Enriches a DocumentBlockAST by attaching synthesized hero image URLs to relevant blocks.
   */
  async synthesizeMediaForBlockAST(ast: DocumentBlockAST, provider: "midjourney" | "imagen" | "dalle" = "midjourney"): Promise<DocumentBlockAST> {
    const designSystem = ast.designSystem;

    const enrichedBlocks = ast.blocks.map((block) => {
      const topic = (block as any).headline || (block as any).title || ast.title;
      const mediaUrl = this.generateSvgPlaceholder(topic, designSystem);
      const artPrompt = this.generateArtDirectionPrompt(block, designSystem, provider);

      switch (block.type) {
        case "hero_header":
          return {
            ...block,
            imageUrl: block.imageUrl || mediaUrl,
            subtitle: block.subtitle || `Midjourney Art Direction: ${artPrompt.slice(0, 70)}...`,
          };

        case "slide_frame":
          return {
            ...block,
            imageUrl: block.imageUrl || mediaUrl,
          };

        case "magazine_ad":
          return {
            ...block,
            heroImageUrl: block.heroImageUrl || mediaUrl,
          };

        default:
          return block;
      }
    });

    return {
      ...ast,
      blocks: enrichedBlocks,
      updatedAt: new Date().toISOString(),
    };
  }
}

export const presentationMediaService = new PresentationMediaService();
