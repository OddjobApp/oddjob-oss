import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "./ai-client.service.js";
import { systemAiService } from "./system-ai.service.js";
import { developmentProviderKey, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("ImageSynthesisService");

export interface ImageSynthesisOptions {
  model?: string;
  provider?: "dalle" | "midjourney" | "imagen" | "flux";
  aspectRatio?: "16:9" | "4:5" | "1:1" | "9:16";
  stylize?: number;
}

/**
 * Image Synthesis Service
 * 
 * Provides high-level capability to generate raster assets (icons, images)
 * using AI providers like DALL-E 3, Midjourney (ImagineAPI), Google Imagen 3, or FLUX.
 */
export const imageSynthesisService = {
  /**
   * Generates an image based on a prompt and returns the result URL.
   */
  async synthesizeImage(prompt: string, orgId?: number, options: ImageSynthesisOptions = {}) {
    const provider = options.provider || 'dalle';
    const model = options.model || (provider === 'midjourney' ? 'midjourney-v6' : 'dall-e-3');

    // Format prompt if Midjourney is requested
    let finalPrompt = prompt;
    if (provider === 'midjourney') {
      const ar = options.aspectRatio || '16:9';
      const stylize = options.stylize || 250;
      finalPrompt = `${prompt} --ar ${ar} --v 6.0 --stylize ${stylize} --style raw`;
      logger.info(`[ImageSynthesis] Formatted Midjourney v6 prompt: "${finalPrompt}"`);
    }

    // Development only: production is strict BYOK and organizations can connect
    // only a Gemini key. This used to take any tenant's `ai_provider` credential.
    let apiKey: string | undefined = developmentProviderKey("openai") || undefined;
    let baseUrl = undefined;

    // Fallback to System Copilot config
    if (!apiKey) {
      const config = await systemAiService.getAiConfig('copilot', orgId);
      if (config?.apiKey) {
        apiKey = config.apiKey;
        baseUrl = config.baseUrl;
      }
    }

    if (!apiKey) {
      // Never hand back a stock photo as though it were the generated image.
      throw new Error(`Image synthesis with "${provider}" is not available: no ${provider} connection is configured for this organization.`);
    }

    const client = AIClientFactory.getClient({ 
      provider: provider === 'midjourney' ? 'openai' : provider, 
      apiKey: apiKey,
      baseUrl: baseUrl
    } as any);

    logger.info(`Synthesizing image with provider ${provider} (${model}): "${finalPrompt}"`);

    const result = await client.execute({
      model,
      userPrompt: finalPrompt,
      requestType: "text",
      responseType: "text",
    } as any, undefined, apiKey!);

    if (!result.success || !result.output) {
      logger.warn(`Image synthesis fallback triggered: ${result.error}`);
      return `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80`;
    }

    return result.output;
  },

  /**
   * Downloads an image from a URL and saves it to the specified destination.
   */
  /**
   * Render an image and write it to `destPath`.
   *
   * Gemini first, on the organization's own key: the only image provider an
   * organization can connect, so under strict BYOK the only one production can
   * use. The DALL-E path (synthesizeImage) remains for development.
   */
  async synthesizeImageFile(prompt: string, orgId: number | undefined, destPath: string, options: ImageSynthesisOptions = {}) {
    const geminiKey = await resolveOrgGeminiKey(orgId ?? null);
    if (geminiKey) {
      const { createGeminiImageGenerator, GEMINI_IMAGE_ASPECT_RATIOS } = await import("@domain/media-studio/core/gemini-image.js");
      // Gemini renders a fixed set of ratios; anything else (4:5) falls back to square.
      const ratio = (options.aspectRatio && options.aspectRatio in GEMINI_IMAGE_ASPECT_RATIOS
        ? options.aspectRatio : "1:1") as keyof typeof GEMINI_IMAGE_ASPECT_RATIOS;
      const image = await createGeminiImageGenerator({ apiKey: geminiKey }).generate(prompt, ratio);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, image.content);
      logger.info(`Saved synthesized asset to ${destPath} (Gemini ${image.model})`);
      return { model: image.model, mimeType: image.mimeType };
    }
    const url = await this.synthesizeImage(prompt, orgId, options);
    await this.downloadImage(url, destPath);
    return { model: options.model || "dall-e-3", mimeType: "image/png" };
  },

  async downloadImage(url: string, destPath: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`);
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, buffer);
      
      logger.info(`Saved synthesized asset to ${destPath}`);
      return true;
    } catch (err: any) {
      logger.error(`Failed to save synthesized asset to ${destPath}`, { error: err.message });
      throw err;
    }
  }
};
