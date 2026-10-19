import { Dataset, DatasetItem } from "@shared/schema/index.js";

export interface CreateDatasetInput {
    name: string;
    description?: string | null;
    tags?: string[] | null;
    schemaMapping?: any;
    knowledgeConfig?: any;
    validationRules?: any;
    // Mission lineage: set when the dataset is produced by a mission
    missionId?: number | null;
    // Project Space that namespaces this dataset's name. Supplied by the caller from
    // request scope (withProjectScope); null leaves the row unnamespaced and org-unique.
    projectId?: number | null;
    // Legacy support or extra configs
    datasetType?: string | null;
    config?: any;
}

export interface UpdateDatasetInput extends Partial<CreateDatasetInput> {
}

export interface DatasetListOptions {
    limit?: number;
    offset?: number;
    datasetIds?: number[];
}

export interface AddItemInput {
    data: Record<string, any>;
    rawData?: Record<string, any>;
    pipelineExecutionId?: number;
    knowledgeNodeId?: number;
}


