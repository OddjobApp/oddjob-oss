import {
    CreateKnowledgeNodeInput,
    UpdateKnowledgeNodeInput,
    CreateKnowledgeEdgeInput,
    UpdateKnowledgeEdgeInput,
    verificationStatusEnum
} from "@shared/schema/index.js";

export type VerificationStatus = (typeof verificationStatusEnum)[number];

/** Source of extraction for a knowledge node */
export interface ExtractionSource {
    sourceType: string;
    sourceRef?: string | null;
    confidenceScore?: number;
    extractionMethod?: string;
}

/** Flexible key-value data for knowledge nodes */
export interface NodeData {
    [key: string]: string | number | boolean | null | NodeData | NodeData[] | string[] | number[] | undefined;
}

/** RAG content metadata structure */
export interface ContentMetadata {
    extractedAt?: string;
    extractedBy?: string;
    sourceVersion?: string;
    chunkIndex?: number;
    totalChunks?: number;
    [key: string]: string | number | boolean | null | undefined;
}

export interface CreateNodeInput extends Omit<CreateKnowledgeNodeInput, "data" | "verificationStatus" | "extractionSources" | "sourceType"> {
    data?: NodeData;
    properties?: NodeData;
    metadata?: NodeData;
    sourceType?: string;
    sourceRef?: string | null;
    description?: string | null;
    verificationStatus?: VerificationStatus;
    extractionSources?: ExtractionSource[];
    missionId?: number;
    sourceCreatedAt?: Date | null;
    sourceUpdatedAt?: Date | null;
}

export interface UpdateNodeInput extends Partial<CreateNodeInput> { }

export interface CreateEdgeInput {
    sourceNodeId: number;
    targetNodeId: number;
    relation: string;
    properties?: NodeData;
    weight?: number;
    lastUpdatedByRunId?: number | null;
    missionId?: number | null;
}

export interface NodeSearchOptions {
    query?: string;
    label?: string;
    knowledgeTopicId?: number;
    knowledgeTopicIds?: number[];
    datasetIds?: number[];
    pipelineExecutionId?: number;
    pipelineId?: number;
    limit?: number;
    offset?: number;
    verificationStatus?: VerificationStatus;
    knowledgeDocumentId?: number;
    missionId?: number;
    excludeLabels?: string[];
    domain?: 'knowledge' | 'system' | 'all';
    /**
     * Match `data.fingerprintPrefix` exactly. Lets workspace/repo-scoped
     * callers filter in SQL instead of loading the table and filtering in JS.
     */
    fingerprintPrefix?: string;
    /** Match `data.filePath` exactly. Indexed; pairs with fingerprintPrefix. */
    filePath?: string;
    temporal?: {
        before?: string | Date;
        after?: string | Date;
        between?: { start: string | Date; end: string | Date };
        atTime?: string | Date;
        field?: 'created' | 'updated'; // Which field to filter on. Default is 'created' (sourceCreatedAt)
    };
}

export interface GraphTraversalOptions {
    depth?: number;
    relations?: string[];
    direction?: "outgoing" | "incoming" | "both";
}

export interface RagContentSource {
    id: number;
    name: string;
    assetType: string;
    sourceType: string;
    textContent?: string | null;
    datasetId?: number;
    qdrantPointId?: string | null;
    nodeId?: number;
    metadata?: ContentMetadata;
}
