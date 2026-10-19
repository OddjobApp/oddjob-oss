
import { z } from "zod";

export const datasetToolDefinitions = [
    {
        name: "list_datasets",
        description: "List available datasets with metadata and item counts. Datasets are collections of structured JSON data.",
        inputSchema: {
            type: "object" as const,
            properties: {
                search: {
                    type: "string",
                    description: "Search term for dataset name",
                },
                limit: {
                    type: "number",
                    description: "Max results (default: 20)",
                },
            },
        },
    },
    {
        name: "get_dataset_details",
        description: "Get schema details and sample items from a specific dataset.",
        inputSchema: {
            type: "object" as const,
            properties: {
                datasetId: {
                    type: "number",
                    description: "ID of the dataset",
                },
                datasetName: {
                    type: "string",
                    description: "Name of the dataset (if ID not known)",
                },
            },
        },
    },
    {
        name: "create_dataset",
        description: "Create a new empty dataset container. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                name: {
                    type: "string",
                    description: "Name for the new dataset",
                },
                description: {
                    type: "string",
                    description: "Optional description",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional tags for categorization",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "query_dataset",
        description: "Retrieve items from a dataset with optional filtering and pagination.",
        inputSchema: {
            type: "object" as const,
            properties: {
                datasetId: {
                    type: "number",
                    description: "ID of the dataset to query",
                },
                limit: {
                    type: "number",
                    description: "Max results (default: 20)",
                },
                offset: {
                    type: "number",
                    description: "Pagination offset",
                },
            },
            required: ["datasetId"],
        },
    },
    {
        name: "add_dataset_items",
        description: "Add one or more JSON objects to a dataset. Best for structured data ingestion.",
        inputSchema: {
            type: "object" as const,
            properties: {
                datasetId: {
                    type: "number",
                    description: "Target dataset ID",
                },
                items: {
                    type: "array",
                    items: { type: "object" },
                    description: "Array of JSON objects to add",
                },
            },
            required: ["datasetId", "items"],
        },
    },
];

export const ListDatasetsInput = z.object({
    search: z.string().optional().describe("Search term for dataset name"),
    limit: z.number().optional().default(20),
});

export const GetDatasetDetailsInput = z.object({
    datasetId: z.coerce.number().optional(),
    dataset_id: z.coerce.number().optional(),
    datasetName: z.string().optional(),
    dataset_name: z.string().optional(),
}).transform(val => ({
    datasetId: (val as any).datasetId ?? (val as any).dataset_id,
    datasetName: (val as any).datasetName ?? (val as any).dataset_name,
}));

export const CreateDatasetInput = z.object({
    name: z.string().min(1).describe("Name of the dataset"),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    schemaMapping: z.record(z.any()).optional().describe("Initial schema mapping configuration"),
});

export const QueryDatasetInput = z.object({
    datasetId: z.coerce.number().optional(),
    dataset_id: z.coerce.number().optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
    filter: z.record(z.any()).optional().describe("Key-value pairs to filter by (e.g. { 'status': 'active' })"),
}).transform(val => {
    const id = (val as any).datasetId ?? (val as any).dataset_id;
    if (id === undefined) throw new Error("datasetId or dataset_id is required");
    return {
        ...val,
        datasetId: id
    };
});

export const AddDatasetItemsInput = z.object({
    datasetId: z.coerce.number().optional(),
    dataset_id: z.coerce.number().optional(),
    items: z.array(z.record(z.any())).describe("Array of JSON objects to add"),
}).transform(val => {
    const id = (val as any).datasetId ?? (val as any).dataset_id;
    if (id === undefined) throw new Error("datasetId or dataset_id is required");
    return {
        ...val,
        datasetId: id
    };
});

