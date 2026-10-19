/**
 * Vision Service
 * 
 * Multi-modal image analysis with GPT-4V, Gemini, and Claude.
 */

import {
  ImageInput,
  VisionRequest,
  VisionResponse,
  VisionModel,
  DetectedObject,
  DocumentLayout,
  VisionCacheEntry,
  MultiModalServiceConfig,
  DEFAULT_MULTIMODAL_CONFIG,
  MultiModalError,
  MultiModalErrorType
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { createHash } from 'crypto';

const logger = createLogger('VisionService');

/**
 * LLM Client Interface
 */
interface LLMClient {
  chat: {
    completions: {
      create(params: any): Promise<any>;
    };
  };
}

/**
 * Vision Service
 */
export class VisionService {
  private cache: Map<string, VisionCacheEntry> = new Map();
  private config: MultiModalServiceConfig;

  constructor(
    private openaiClient: LLMClient,
    private geminiClient?: any,
    private anthropicClient?: any,
    config?: Partial<MultiModalServiceConfig>
  ) {
    this.config = { ...DEFAULT_MULTIMODAL_CONFIG, ...config };
    logger.info('Vision Service initialized', { defaultModel: this.config.defaultVisionModel });
  }

  /**
   * Analyze images with vision model
   */
  async analyze(request: VisionRequest): Promise<VisionResponse> {
    const startTime = Date.now();
    logger.info(`Vision analysis started: ${request.images.length} images, model: ${request.model}`);

    try {
      // Validate request
      this.validateRequest(request);

      // Check cache
      if (this.config.enableCache) {
        const cached = this.getCachedResult(request);
        if (cached) {
          logger.info('Vision cache hit');
          return {
            ...cached,
            processingTimeMs: Date.now() - startTime
          };
        }
      }

      // Process based on model
      let response: VisionResponse;
      
      switch (request.model) {
        case 'gpt-4-vision':
          response = await this.analyzeWithGPT4V(request);
          break;
        case 'gemini-pro-vision':
          response = await this.analyzeWithGemini(request);
          break;
        case 'claude-3-opus':
        case 'claude-3-sonnet':
          response = await this.analyzeWithClaude(request);
          break;
        default:
          throw new MultiModalError(
            MultiModalErrorType.VISION_FAILED,
            `Unsupported vision model: ${request.model}`
          );
      }

      // Cache result
      if (this.config.enableCache) {
        this.cacheResult(request, response);
      }

      logger.info(`Vision analysis complete: ${response.processingTimeMs}ms, confidence: ${response.confidence.toFixed(2)}`);

      return response;

    } catch (error) {
      logger.error('Vision analysis failed:', error);
      throw new MultiModalError(
        MultiModalErrorType.VISION_FAILED,
        `Vision analysis failed: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Analyze with GPT-4 Vision
   */
  private async analyzeWithGPT4V(request: VisionRequest): Promise<VisionResponse> {
    const startTime = Date.now();

    // Prepare image content
    const imageContents = request.images.map(img => {
      if (img.type === 'url') {
        return {
          type: 'image_url',
          image_url: { url: img.source }
        };
      } else {
        // base64 or file_path - treat as base64
        return {
          type: 'image_url',
          image_url: { 
            url: img.type === 'base64' 
              ? `data:${img.mimeType || 'image/png'};base64,${img.source}`
              : img.source
          }
        };
      }
    });

    // Build extraction instructions if needed
    let enhancedPrompt = request.prompt;
    if (request.extractionConfig) {
      const extractionInstructions = this.buildExtractionInstructions(request.extractionConfig);
      enhancedPrompt = `${request.prompt}\n\n${extractionInstructions}`;
    }

    const response = await this.openaiClient.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: enhancedPrompt },
            ...imageContents
          ]
        }
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.7
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Parse structured output if requested
    let structuredData: Record<string, any> | undefined;
    if (request.outputFormat === 'json' || request.outputFormat === 'structured') {
      structuredData = this.parseStructuredOutput(content);
    }

    return {
      description: content,
      structuredData,
      confidence: 0.9,  // GPT-4V is generally high confidence
      model: 'gpt-4-vision',
      tokensUsed: {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0
      },
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Analyze with Gemini Pro Vision
   */
  private async analyzeWithGemini(request: VisionRequest): Promise<VisionResponse> {
    const startTime = Date.now();

    if (!this.geminiClient) {
      throw new MultiModalError(
        MultiModalErrorType.VISION_FAILED,
        'Gemini client not configured'
      );
    }

    // Gemini implementation would go here
    // Placeholder for actual Gemini API integration
    logger.warn('Gemini analysis not fully implemented');

    return {
      description: 'Gemini analysis placeholder',
      confidence: 0.8,
      model: 'gemini-pro-vision',
      tokensUsed: { input: 0, output: 0 },
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Analyze with Claude 3
   */
  private async analyzeWithClaude(request: VisionRequest): Promise<VisionResponse> {
    const startTime = Date.now();

    if (!this.anthropicClient) {
      throw new MultiModalError(
        MultiModalErrorType.VISION_FAILED,
        'Anthropic client not configured'
      );
    }

    // Claude 3 implementation would go here
    // Placeholder for actual Anthropic API integration
    logger.warn('Claude analysis not fully implemented');

    return {
      description: 'Claude analysis placeholder',
      confidence: 0.85,
      model: request.model,
      tokensUsed: { input: 0, output: 0 },
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Extract text from image (OCR)
   */
  async extractText(images: ImageInput[], language?: string): Promise<{
    fullText: string;
    byImage: string[];
  }> {
    const prompt = `Extract all text from this image${language ? ` in ${language}` : ''}. ` +
      `Return only the text content, preserving layout where possible.`;

    const results: string[] = [];

    for (const image of images) {
      const response = await this.analyze({
        images: [image],
        prompt,
        model: this.config.defaultVisionModel,
        maxTokens: 2000,
        temperature: 0.3
      });

      results.push(response.description);
    }

    return {
      fullText: results.join('\n---\n'),
      byImage: results
    };
  }

  /**
   * Find UI element visually
   */
  async findUIElement(
    screenshot: ImageInput,
    description: string,
    options?: {
      elementType?: string;
      hints?: Record<string, string>;
    }
  ): Promise<{
    found: boolean;
    location?: { x: number; y: number; width: number; height: number };
    confidence: number;
    alternativeSelectors?: string[];
  }> {
    let prompt = `Find the UI element: "${description}"`;
    
    if (options?.elementType) {
      prompt += `\nElement type: ${options.elementType}`;
    }
    
    if (options?.hints) {
      prompt += `\nHints: ${JSON.stringify(options.hints)}`;
    }

    prompt += `\n\nReturn the bounding box coordinates (x, y, width, height) and confidence. ` +
      `If not found, indicate clearly.`;

    const response = await this.analyze({
      images: [screenshot],
      prompt,
      model: this.config.defaultVisionModel,
      maxTokens: 500,
      temperature: 0.2,
      outputFormat: 'structured'
    });

    // Parse structured output for location
    const structured = response.structuredData || {};
    
    return {
      found: structured.found !== false,
      location: structured.location,
      confidence: structured.confidence || response.confidence,
      alternativeSelectors: structured.alternativeSelectors
    };
  }

  /**
   * Analyze document layout
   */
  async analyzeLayout(image: ImageInput): Promise<DocumentLayout> {
    const prompt = `Analyze the layout of this document. ` +
      `Identify text regions, images, tables, and their positions. ` +
      `Return structured data with bounding boxes and reading order.`;

    const response = await this.analyze({
      images: [image],
      prompt,
      model: this.config.defaultVisionModel,
      maxTokens: 1500,
      temperature: 0.2,
      outputFormat: 'structured',
      extractionConfig: {
        extractText: true,
        extractObjects: true,
        extractLayout: true,
        extractTables: true
      }
    });

    // Parse layout from structured data
    const structured = response.structuredData || {};

    return {
      pageDimensions: structured.pageDimensions || { width: 0, height: 0 },
      textRegions: structured.textRegions || [],
      imageRegions: structured.imageRegions || [],
      tableRegions: structured.tableRegions || [],
      readingOrder: structured.readingOrder || []
    };
  }

  /**
   * Batch analyze multiple images
   */
  async batchAnalyze(
    requests: VisionRequest[],
    options?: { parallel: boolean }
  ): Promise<VisionResponse[]> {
    if (options?.parallel !== false) {
      // Process in parallel
      return Promise.all(requests.map(r => this.analyze(r)));
    } else {
      // Process sequentially
      const results: VisionResponse[] = [];
      for (const request of requests) {
        results.push(await this.analyze(request));
      }
      return results;
    }
  }

  /**
   * Clear vision cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Vision cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0  // Would track actual hits in production
    };
  }

  /**
   * Validate request
   */
  private validateRequest(request: VisionRequest): void {
    if (!request.images || request.images.length === 0) {
      throw new MultiModalError(
        MultiModalErrorType.INVALID_IMAGE,
        'At least one image is required'
      );
    }

    if (request.images.length > 10) {
      throw new MultiModalError(
        MultiModalErrorType.INVALID_IMAGE,
        'Maximum 10 images per request'
      );
    }

    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new MultiModalError(
        MultiModalErrorType.INVALID_IMAGE,
        'Prompt is required'
      );
    }

    // Validate image sources
    for (const image of request.images) {
      if (!image.source) {
        throw new MultiModalError(
          MultiModalErrorType.INVALID_IMAGE,
          'Image source is required'
        );
      }
    }
  }

  /**
   * Get cache key for request
   */
  private getCacheKey(request: VisionRequest): string {
    const imageKeys = request.images.map(img => 
      createHash('md5').update(img.source).digest('hex')
    );
    const promptKey = createHash('md5').update(request.prompt).digest('hex');
    return `${request.model}:${imageKeys.join(',')}:${promptKey}`;
  }

  /**
   * Get cached result
   */
  private getCachedResult(request: VisionRequest): VisionResponse | null {
    const key = this.getCacheKey(request);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check expiration
    const now = Date.now();
    const expired = (now - entry.cachedAt.getTime()) > (entry.ttl * 1000);

    if (expired) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  /**
   * Cache result
   */
  private cacheResult(request: VisionRequest, response: VisionResponse): void {
    // Check cache size
    if (this.cache.size >= this.config.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const key = this.getCacheKey(request);
    const entry: VisionCacheEntry = {
      key,
      response,
      cachedAt: new Date(),
      ttl: this.config.cacheTtl
    };

    this.cache.set(key, entry);
  }

  /**
   * Build extraction instructions
   */
  private buildExtractionInstructions(config: {
    extractText: boolean;
    extractObjects: boolean;
    extractLayout: boolean;
    extractTables: boolean;
  }): string {
    const instructions: string[] = ['\n\nExtraction Instructions:'];

    if (config.extractText) {
      instructions.push('- Extract all visible text content');
    }
    if (config.extractObjects) {
      instructions.push('- Identify and locate objects in the image');
    }
    if (config.extractLayout) {
      instructions.push('- Describe the spatial layout and organization');
    }
    if (config.extractTables) {
      instructions.push('- Extract table structures and cell contents');
    }

    instructions.push('\nReturn structured data where possible.');

    return instructions.join('\n');
  }

  /**
   * Parse structured output from text
   */
  private parseStructuredOutput(text: string): Record<string, any> | undefined {
    try {
      // Try to find JSON block in response
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Try to parse entire response as JSON
      return JSON.parse(text);
    } catch {
      // Not valid JSON, return undefined
      return undefined;
    }
  }
}
