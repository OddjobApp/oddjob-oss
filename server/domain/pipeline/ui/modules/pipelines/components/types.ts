export interface Job {
    id: number;
    name: string;
    type: string;
    description?: string;
    config?: any;
    outputSchema?: any;
}

export interface PipelineStep {
    id: number;
    pipelineId: number;
    jobId: number;
    order: number;
    outputName: string | null;
}

export interface Pipeline {
    id: number;
    name: string;
    description: string | null;
    triggerType: string;
    isActive: boolean;
    createdBy: string;
    createdAt: string;
    organizationId: number | null;
    steps: PipelineStep[];
    tracks?: PipelineTrack[];
    knowledgeGraphConfig?: any;
    enableKnowledgeGraph?: boolean;
}

export interface PipelineTrack {
    id: string; // "track-1", "track-2"
    name: string;
    order: number;
    description?: string;
    color?: string; // Hex color for track header/border
}

export interface FormStep {
    tempId: string; // Temporary ID for new steps not yet saved
    id?: number;
    jobId: number | null;
    order: number;
    outputName: string;
    name?: string;
    label?: string;
    moduleType?: string | null; // "logic_gatekeeper" for Decision Nodes
    destinationStepId?: number | null; // Explicit routing target
    destinationTempId?: string; // Explicit routing target (temporary UI ID)
    trackId?: string; // The ID of the track this step belongs to
    decisionNodeConfig?: any; // Decision Node configuration
    transformerConfig?: any; // Transformer job configuration (stored temporarily, will update job on save)
    iteratorConfig?: any;
    decisionConfig?: any;
    retryConfig?: any;
    knowledgeGraphConfig?: any;
    runOnCondition?: string;
    onFailureAction?: string;
    fallbackJobId?: number | null; // Job to run when onFailureAction === "Execute Fallback Job"
    inputMapping?: Record<string, string>; // explicit input mapping
}

