/**
 * Multi-Modal Agent - Types and Interfaces
 * 
 * Vision, document processing, and multi-modal capabilities for agents.
 */

/**
 * Vision Model Options
 */
export type VisionModel = 'gpt-4-vision' | 'gemini-pro-vision' | 'claude-3-opus' | 'claude-3-sonnet';

/**
 * Image Input
 */
export interface ImageInput {
  /** Image source: URL, base64, or file path */
  source: string;
  
  /** Source type */
  type: 'url' | 'base64' | 'file_path';
  
  /** MIME type (optional) */
  mimeType?: string;
  
  /** Image description (alt text) */
  description?: string;
}

/**
 * Vision Request
 */
export interface VisionRequest {
  /** Images to analyze */
  images: ImageInput[];
  
  /** Text prompt/instruction */
  prompt: string;
  
  /** Vision model to use */
  model: VisionModel;
  
  /** Maximum tokens in response */
  maxTokens: number;
  
  /** Temperature (0-1) */
  temperature?: number;
  
  /** Expected output format */
  outputFormat?: 'text' | 'json' | 'structured';
  
  /** Extract specific elements */
  extractionConfig?: {
    extractText: boolean;
    extractObjects: boolean;
    extractLayout: boolean;
    extractTables: boolean;
  };
}

/**
 * Vision Response
 */
export interface VisionResponse {
  /** Generated description/analysis */
  description: string;
  
  /** Extracted text (OCR) */
  extractedText?: string;
  
  /** Detected objects */
  detectedObjects?: DetectedObject[];
  
  /** Structured data extraction */
  structuredData?: Record<string, any>;
  
  /** Layout analysis */
  layout?: DocumentLayout;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Model used */
  model: VisionModel;
  
  /** Token usage */
  tokensUsed: {
    input: number;
    output: number;
  };
  
  /** Processing time (ms) */
  processingTimeMs: number;
}

/**
 * Detected Object
 */
export interface DetectedObject {
  /** Object label */
  label: string;
  
  /** Confidence (0-1) */
  confidence: number;
  
  /** Bounding box */
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  /** Object attributes */
  attributes?: Record<string, any>;
}

/**
 * Document Layout
 */
export interface DocumentLayout {
  /** Page dimensions */
  pageDimensions: {
    width: number;
    height: number;
  };
  
  /** Text regions */
  textRegions: TextRegion[];
  
  /** Image regions */
  imageRegions: ImageRegion[];
  
  /** Table regions */
  tableRegions: TableRegion[];
  
  /** Reading order */
  readingOrder: number[];
}

/**
 * Text Region
 */
export interface TextRegion {
  /** Region ID */
  id: number;
  
  /** Bounding box */
  bbox: BoundingBox;
  
  /** Text content */
  text: string;
  
  /** Text type */
  type: 'paragraph' | 'heading' | 'list_item' | 'caption' | 'other';
  
  /** Font/style info */
  style?: {
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
  };
}

/**
 * Image Region
 */
export interface ImageRegion {
  /** Region ID */
  id: number;
  
  /** Bounding box */
  bbox: BoundingBox;
  
  /** Description */
  description?: string;
}

/**
 * Table Region
 */
export interface TableRegion {
  /** Region ID */
  id: number;
  
  /** Bounding box */
  bbox: BoundingBox;
  
  /** Table data */
  table: Table;
}

/**
 * Bounding Box
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Table
 */
export interface Table {
  /** Number of rows */
  rowCount: number;
  
  /** Number of columns */
  columnCount: number;
  
  /** Header row */
  headers: string[];
  
  /** Table cells (row-major order) */
  cells: TableCell[];
}

/**
 * Table Cell
 */
export interface TableCell {
  /** Row index */
  row: number;
  
  /** Column index */
  col: number;
  
  /** Cell text */
  text: string;
  
  /** Is header cell */
  isHeader: boolean;
  
  /** Rowspan */
  rowspan?: number;
  
  /** Colspan */
  colspan?: number;
}

/**
 * Document Processing Request
 */
export interface DocumentProcessingRequest {
  /** Document source */
  source: string;
  
  /** Source type */
  type: 'pdf' | 'docx' | 'doc' | 'tiff' | 'png' | 'jpg';
  
  /** Extract layout structure */
  extractLayout: boolean;
  
  /** Extract tables */
  extractTables: boolean;
  
  /** Extract images */
  extractImages: boolean;
  
  /** Perform OCR */
  ocr: boolean;
  
  /** OCR language */
  ocrLanguage?: string;
  
  /** Page range (for multi-page docs) */
  pageRange?: {
    start: number;
    end: number;
  };
}

/**
 * Processed Document
 */
export interface ProcessedDocument {
  /** Full text content */
  text: string;
  
  /** Document pages */
  pages: Page[];
  
  /** Extracted tables */
  tables: Table[];
  
  /** Extracted images */
  images: ExtractedImage[];
  
  /** Document metadata */
  metadata: DocumentMetadata;
  
  /** Hierarchical structure */
  structure: DocumentNode[];
  
  /** Processing metrics */
  metrics: DocumentMetrics;
  
  /** Total processing time (ms) */
  processingTimeMs?: number;
}

/**
 * Page
 */
export interface Page {
  /** Page number */
  pageNumber: number;
  
  /** Page text */
  text: string;
  
  /** Page dimensions */
  dimensions: {
    width: number;
    height: number;
  };
  
  /** Text blocks on page */
  textBlocks: TextRegion[];
  
  /** Images on page */
  images: ImageRegion[];
}

/**
 * Extracted Image
 */
export interface ExtractedImage {
  /** Image ID */
  id: string;
  
  /** Source page */
  pageNumber: number;
  
  /** Image data (base64 or URL) */
  data: string;
  
  /** MIME type */
  mimeType: string;
  
  /** Description from vision analysis */
  description?: string;
  
  /** Bounding box on source page */
  bbox: BoundingBox;
}

/**
 * Document Metadata
 */
export interface DocumentMetadata {
  /** Document title */
  title?: string;
  
  /** Author */
  author?: string;
  
  /** Creation date */
  createdAt?: Date;
  
  /** Modification date */
  modifiedAt?: Date;
  
  /** Page count */
  pageCount: number;
  
  /** File size (bytes) */
  fileSize: number;
  
  /** MIME type */
  mimeType: string;
}

/**
 * Document Node (hierarchical structure)
 */
export interface DocumentNode {
  /** Node ID */
  id: string;
  
  /** Node type */
  type: 'document' | 'section' | 'page' | 'paragraph' | 'heading' | 'list' | 'table' | 'image';
  
  /** Node content */
  content?: string;
  
  /** Level in hierarchy */
  level: number;
  
  /** Child nodes */
  children: DocumentNode[];
  
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Document Metrics
 */
export interface DocumentMetrics {
  /** Processing time (ms) */
  processingTimeMs: number;
  
  /** Pages processed */
  pagesProcessed: number;
  
  /** Characters extracted */
  charactersExtracted: number;
  
  /** Images extracted */
  imagesExtracted: number;
  
  /** Tables extracted */
  tablesExtracted: number;
}

/**
 * Multimodal Agent Configuration
 */
export interface MultimodalAgentConfig {
  /** Agent ID */
  agentId: string;
  
  /** Vision capabilities */
  vision: {
    enabled: boolean;
    defaultModel: VisionModel;
    maxImagesPerRequest: number;
  };
  
  /** Document processing */
  documentProcessing: {
    enabled: boolean;
    supportedFormats: string[];
    maxFileSize: number;  // bytes
  };
  
  /** Audio processing */
  audio: {
    enabled: boolean;
    speechToText: boolean;
    textToSpeech: boolean;
  };
  
  /** Integration settings */
  integration: {
    enableSeleniumVision: boolean;
    enableKnowledgeExtraction: boolean;
  };
}

/**
 * Visual Selenium Selector
 */
export interface VisualSelectorRequest {
  /** Selenium session ID */
  sessionId: string;
  
  /** Visual description */
  description: string;
  
  /** Element type hint */
  elementType?: 'button' | 'input' | 'link' | 'image' | 'text' | 'any';
  
  /** Additional hints */
  hints?: {
    color?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    nearText?: string;
  };
}

/**
 * Visual Selector Result
 */
export interface VisualSelectorResult {
  /** Success status */
  success: boolean;
  
  /** Element found */
  found: boolean;
  
  /** CSS/XPath selector */
  selector: string;
  
  /** Selector type */
  selectorType: 'css' | 'xpath' | 'id' | 'class';
  
  /** Confidence (0-1) */
  confidence: number;
  
  /** Element location */
  location?: BoundingBox;
  
  /** Alternative selectors if primary fails */
  alternatives?: string[];
  
  /** Vision model used */
  model: VisionModel;
  
  /** Screenshot reference */
  screenshotId?: string;
}

/**
 * Visual Knowledge Extraction
 */
export interface VisualKnowledgeExtractionRequest {
  /** Image source */
  image: ImageInput;
  
  /** Extraction context */
  context: {
    missionId?: string;
    organizationId: number;
    expectedEntityTypes?: string[];
  };
  
  /** Extraction instructions */
  instructions?: string;
}

/**
 * Extracted Knowledge from Visual
 */
export interface ExtractedVisualKnowledge {
  /** Extracted entities */
  entities: VisualEntity[];
  
  /** Extracted relationships */
  relationships: VisualRelationship[];
  
  /** Document/form extraction */
  document?: {
    type: string;
    fields: Record<string, string>;
  };
  
  /** Scene description */
  sceneDescription: string;
}

/**
 * Visual Entity
 */
export interface VisualEntity {
  /** Entity ID */
  id: string;
  
  /** Entity type */
  type: 'person' | 'organization' | 'location' | 'event' | 'object' | 'text' | 'document';
  
  /** Entity name/label */
  name: string;
  
  /** Confidence (0-1) */
  confidence: number;
  
  /** Bounding box in image */
  bbox?: BoundingBox;
  
  /** Attributes */
  attributes: Record<string, any>;
}

/**
 * Visual Relationship
 */
export interface VisualRelationship {
  /** Source entity ID */
  sourceId: string;
  
  /** Target entity ID */
  targetId: string;
  
  /** Relationship type */
  relation: string;
  
  /** Confidence (0-1) */
  confidence: number;
}

/**
 * Multimodal Agent Job Configuration
 */
export interface MultimodalAgentJobConfig {
  /** Job type */
  type: 'vision_analysis' | 'document_processing' | 'visual_selenium' | 'knowledge_extraction';
  
  /** System prompt */
  systemPrompt: string;
  
  /** Goal/prompt */
  goal: string;
  
  /** Input sources */
  inputs: {
    text?: string;
    images?: ImageInput[];
    documents?: DocumentProcessingRequest[];
    screenshots?: boolean;
  };
  
  /** Output configuration */
  output: {
    format: 'text' | 'structured' | 'document' | 'entities';
    includeSources: boolean;
    maxLength?: number;
  };
  
  /** Vision settings */
  vision?: {
    model: VisionModel;
    maxTokens: number;
  };
}

/**
 * Cache Entry for Vision Results
 */
export interface VisionCacheEntry {
  /** Cache key (hash of image + prompt) */
  key: string;
  
  /** Cached response */
  response: VisionResponse;
  
  /** Cached at timestamp */
  cachedAt: Date;
  
  /** Time-to-live (seconds) */
  ttl: number;
}

/**
 * Multi-Modal Service Configuration
 */
export interface MultiModalServiceConfig {
  /** Enable caching */
  enableCache: boolean;
  
  /** Cache TTL (seconds) */
  cacheTtl: number;
  
  /** Max cache size */
  maxCacheSize: number;
  
  /** Default vision model */
  defaultVisionModel: VisionModel;
  
  /** Max file size for documents (bytes) */
  maxDocumentSize: number;
  
  /** Supported document formats */
  supportedFormats: string[];
}

/**
 * Default configuration
 */
export const DEFAULT_MULTIMODAL_CONFIG: MultiModalServiceConfig = {
  enableCache: true,
  cacheTtl: 3600,
  maxCacheSize: 1000,
  defaultVisionModel: 'gpt-4-vision',
  maxDocumentSize: 50 * 1024 * 1024,  // 50MB
  supportedFormats: ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'tiff', 'tif']
};

/**
 * Multi-Modal Error Types
 */
export enum MultiModalErrorType {
  INVALID_IMAGE = 'invalid_image',
  INVALID_DOCUMENT = 'invalid_document',
  VISION_FAILED = 'vision_failed',
  DOCUMENT_PROCESSING_FAILED = 'document_processing_failed',
  UNSUPPORTED_FORMAT = 'unsupported_format',
  FILE_TOO_LARGE = 'file_too_large',
  SELENIUM_ERROR = 'selenium_error',
  CACHE_ERROR = 'cache_error',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Multi-Modal Error
 */
export class MultiModalError extends Error {
  constructor(
    public type: MultiModalErrorType,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'MultiModalError';
  }
}
