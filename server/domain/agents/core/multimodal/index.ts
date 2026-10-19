/**
 * Multi-Modal Agent Module
 * 
 * Vision, document processing, and multi-modal capabilities.
 */

// Types
export {
  ImageInput,
  VisionRequest,
  VisionResponse,
  VisionModel,
  DetectedObject,
  DocumentLayout,
  TextRegion,
  Table,
  TableCell,
  DocumentProcessingRequest,
  ProcessedDocument,
  Page,
  ExtractedImage,
  DocumentMetadata,
  DocumentNode,
  DocumentMetrics,
  VisualSelectorRequest,
  VisualSelectorResult,
  VisualKnowledgeExtractionRequest,
  ExtractedVisualKnowledge,
  VisualEntity,
  VisualRelationship,
  MultimodalAgentConfig,
  MultimodalAgentJobConfig,
  MultiModalServiceConfig,
  DEFAULT_MULTIMODAL_CONFIG,
  MultiModalError,
  MultiModalErrorType
} from './types.js';

// Services
export { VisionService } from './vision.service.js';
export { DocumentProcessingService } from './document.service.js';
