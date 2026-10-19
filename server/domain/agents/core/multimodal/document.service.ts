/**
 * Document Processing Service
 * 
 * Extract text, tables, images from PDF, Word, and image documents.
 */

import {
  DocumentProcessingRequest,
  ProcessedDocument,
  Page,
  Table,
  ExtractedImage,
  DocumentNode,
  DocumentMetrics,
  MultiModalError,
  MultiModalErrorType
} from './types.js';
import { VisionService } from './vision.service.js';
import { createLogger } from '../../../../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';

const logger = createLogger('DocumentService');

/**
 * Document Processing Service
 */
export class DocumentProcessingService {
  private visionService: VisionService;

  constructor(visionService: VisionService) {
    this.visionService = visionService;
    logger.info('Document Processing Service initialized');
  }

  /**
   * Process a document
   */
  async processDocument(request: DocumentProcessingRequest): Promise<ProcessedDocument> {
    const startTime = Date.now();
    logger.info(`Processing document: ${request.type}`);

    try {
      // Validate request
      this.validateRequest(request);

      // Load document content
      const content = await this.loadDocument(request);

      // Process based on type
      let result: ProcessedDocument;

      switch (request.type) {
        case 'pdf':
          result = await this.processPDF(content, request);
          break;
        case 'docx':
        case 'doc':
          result = await this.processWord(content, request);
          break;
        case 'png':
        case 'jpg':
          result = await this.processImage(content, request);
          break;
        default:
          throw new MultiModalError(
            MultiModalErrorType.UNSUPPORTED_FORMAT,
            `Unsupported document format: ${request.type}`
          );
      }

      logger.info(`Document processed: ${result.pages.length} pages, ${result.processingTimeMs}ms`);

      return result;

    } catch (error) {
      logger.error('Document processing failed:', error);
      throw new MultiModalError(
        MultiModalErrorType.DOCUMENT_PROCESSING_FAILED,
        `Document processing failed: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Process PDF document
   */
  private async processPDF(
    content: Buffer,
    request: DocumentProcessingRequest
  ): Promise<ProcessedDocument> {
    // This would integrate with a PDF processing library
    // Placeholder implementation
    logger.info('Processing PDF document');

    // Mock result - would use actual PDF library
    const pages: Page[] = [];
    const tables: Table[] = [];
    const images: ExtractedImage[] = [];

    // For now, convert to image and use vision
    if (request.ocr) {
      const visionResult = await this.visionService.extractText([{
        source: content.toString('base64'),
        type: 'base64',
        mimeType: 'application/pdf'
      }]);

      pages.push({
        pageNumber: 1,
        text: visionResult.fullText,
        dimensions: { width: 612, height: 792 },  // Standard letter size
        textBlocks: [],
        images: []
      });
    }

    const processingTimeMs = Date.now() - Date.now();  // Would track actual time

    return {
      text: pages.map(p => p.text).join('\n'),
      pages,
      tables,
      images,
      metadata: {
        pageCount: pages.length,
        fileSize: content.length,
        mimeType: 'application/pdf'
      },
      structure: this.buildDocumentStructure(pages),
      metrics: {
        processingTimeMs,
        pagesProcessed: pages.length,
        charactersExtracted: pages.reduce((sum, p) => sum + p.text.length, 0),
        imagesExtracted: images.length,
        tablesExtracted: tables.length
      }
    };
  }

  /**
   * Process Word document
   */
  private async processWord(
    content: Buffer,
    request: DocumentProcessingRequest
  ): Promise<ProcessedDocument> {
    logger.info('Processing Word document');

    // This would integrate with mammoth.js or similar
    // Placeholder implementation

    const pages: Page[] = [{
      pageNumber: 1,
      text: 'Word document content placeholder',
      dimensions: { width: 612, height: 792 },
      textBlocks: [],
      images: []
    }];

    return {
      text: pages[0].text,
      pages,
      tables: [],
      images: [],
      metadata: {
        pageCount: 1,
        fileSize: content.length,
        mimeType: request.type === 'docx' 
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/msword'
      },
      structure: this.buildDocumentStructure(pages),
      metrics: {
        processingTimeMs: 0,
        pagesProcessed: 1,
        charactersExtracted: pages[0].text.length,
        imagesExtracted: 0,
        tablesExtracted: 0
      }
    };
  }

  /**
   * Process image document
   */
  private async processImage(
    content: Buffer,
    request: DocumentProcessingRequest
  ): Promise<ProcessedDocument> {
    logger.info('Processing image document');

    const mimeType = `image/${request.type === 'jpg' ? 'jpeg' : request.type}`;

    // Use vision service for OCR and layout
    const [textResult, layoutResult] = await Promise.all([
      request.ocr ? this.visionService.extractText([{
        source: content.toString('base64'),
        type: 'base64',
        mimeType
      }]) : Promise.resolve({ fullText: '', byImage: [''] }),
      
      request.extractLayout ? this.visionService.analyzeLayout({
        source: content.toString('base64'),
        type: 'base64',
        mimeType
      }) : Promise.resolve(undefined)
    ]);

    const page: Page = {
      pageNumber: 1,
      text: textResult.fullText,
      dimensions: layoutResult?.pageDimensions || { width: 0, height: 0 },
      textBlocks: layoutResult?.textRegions.map(r => ({
        id: r.id,
        bbox: r.bbox,
        text: r.text,
        type: r.type
      })) || [],
      images: layoutResult?.imageRegions.map(r => ({
        id: r.id,
        bbox: r.bbox,
        description: r.description
      })) || []
    };

    // Extract tables if present
    const tables: Table[] = [];
    if (request.extractTables && layoutResult?.tableRegions) {
      for (const region of layoutResult.tableRegions) {
        tables.push(region.table);
      }
    }

    return {
      text: page.text,
      pages: [page],
      tables,
      images: [],  // Would extract actual image regions
      metadata: {
        pageCount: 1,
        fileSize: content.length,
        mimeType
      },
      structure: this.buildDocumentStructure([page]),
      metrics: {
        processingTimeMs: 0,
        pagesProcessed: 1,
        charactersExtracted: page.text.length,
        imagesExtracted: 0,
        tablesExtracted: tables.length
      }
    };
  }

  /**
   * Extract tables from document
   */
  async extractTables(documentSource: string): Promise<Table[]> {
    const result = await this.processDocument({
      source: documentSource,
      type: this.detectFormat(documentSource),
      extractLayout: false,
      extractTables: true,
      extractImages: false,
      ocr: true
    });

    return result.tables;
  }

  /**
   * Extract images from document
   */
  async extractImages(documentSource: string): Promise<ExtractedImage[]> {
    const result = await this.processDocument({
      source: documentSource,
      type: this.detectFormat(documentSource),
      extractLayout: false,
      extractTables: false,
      extractImages: true,
      ocr: false
    });

    return result.images;
  }

  /**
   * Convert document to markdown
   */
  async convertToMarkdown(documentSource: string): Promise<string> {
    const result = await this.processDocument({
      source: documentSource,
      type: this.detectFormat(documentSource),
      extractLayout: true,
      extractTables: true,
      extractImages: false,
      ocr: true
    });

    // Build markdown from structure
    const parts: string[] = [];

    if (result.metadata.title) {
      parts.push(`# ${result.metadata.title}\n`);
    }

    for (const node of result.structure) {
      parts.push(this.nodeToMarkdown(node));
    }

    return parts.join('\n');
  }

  /**
   * Load document content
   */
  private async loadDocument(request: DocumentProcessingRequest): Promise<Buffer> {
    if (request.source.startsWith('http')) {
      // Load from URL
      const response = await fetch(request.source);
      return Buffer.from(await response.arrayBuffer());
    } else if (request.source.startsWith('data:')) {
      // Load from data URI
      const base64 = request.source.split(',')[1];
      return Buffer.from(base64, 'base64');
    } else {
      // Load from file path
      return fs.readFile(request.source);
    }
  }

  /**
   * Validate request
   */
  private validateRequest(request: DocumentProcessingRequest): void {
    if (!request.source) {
      throw new MultiModalError(
        MultiModalErrorType.INVALID_DOCUMENT,
        'Document source is required'
      );
    }

    const supportedFormats = ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];
    if (!supportedFormats.includes(request.type)) {
      throw new MultiModalError(
        MultiModalErrorType.UNSUPPORTED_FORMAT,
        `Unsupported format: ${request.type}. Supported: ${supportedFormats.join(', ')}`
      );
    }
  }

  /**
   * Detect format from source
   */
  private detectFormat(source: string): any {
    const ext = path.extname(source).toLowerCase().replace('.', '');
    
    const formatMap: Record<string, any> = {
      'pdf': 'pdf',
      'docx': 'docx',
      'doc': 'doc',
      'png': 'png',
      'jpg': 'jpg',
      'jpeg': 'jpg',
      'tiff': 'tiff',
      'tif': 'tiff'
    };

    return formatMap[ext] || 'pdf';
  }

  /**
   * Build document structure
   */
  private buildDocumentStructure(pages: Page[]): DocumentNode[] {
    const root: DocumentNode = {
      id: 'doc',
      type: 'document',
      level: 0,
      children: []
    };

    for (const page of pages) {
      const pageNode: DocumentNode = {
        id: `page-${page.pageNumber}`,
        type: 'page',
        level: 1,
        children: []
      };

      // Add text blocks as children
      for (const block of page.textBlocks) {
        const blockNode: DocumentNode = {
          id: `block-${block.id}`,
          type: block.type === 'heading' ? 'heading' : 'paragraph',
          content: block.text,
          level: 2,
          children: [],
          metadata: { bbox: block.bbox }
        };
        pageNode.children.push(blockNode);
      }

      root.children.push(pageNode);
    }

    return [root];
  }

  /**
   * Convert document node to markdown
   */
  private nodeToMarkdown(node: DocumentNode): string {
    switch (node.type) {
      case 'heading':
        return `## ${node.content || ''}`;
      case 'paragraph':
        return node.content || '';
      case 'page':
        return node.children.map(c => this.nodeToMarkdown(c)).join('\n\n');
      case 'document':
        return node.children.map(c => this.nodeToMarkdown(c)).join('\n\n');
      default:
        return node.content || '';
    }
  }
}
