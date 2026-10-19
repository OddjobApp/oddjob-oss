import {
    ListDatasetsInput,
    GetDatasetDetailsInput,
    CreateDatasetInput,
    QueryDatasetInput,
    AddDatasetItemsInput
} from "../tools/datasets.js";
import { datasetService } from "../../domain/knowledge/core/dataset-service.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";
import { hasResourcePermission } from "@shared/schema/index.js";

export async function handleListDatasets(args: unknown, context?: ToolContext) {
    try {
        const input = ListDatasetsInput.parse(args);
        const orgContext = getOrgContext(context);

        const results = await datasetService.list(orgContext, {
            limit: input.limit,
            datasetIds: context?.allowedDatasetIds || undefined
        });

        // Filter by resource scoping (New)
        let scopedResults = results;
        if (context?.resourceScoping) {
            scopedResults = results.filter((d: any) =>
                hasResourcePermission(context.permissions || [], "dataset:read", d.id.toString(), context.resourceScoping)
            );
        }

        // Enrich with item counts
        const enriched = await Promise.all(scopedResults.map(async (d: any) => {
            const stats = await datasetService.getStats(d.id, orgContext);
            return {
                id: d.id,
                name: d.name,
                description: d.description,
                tags: d.tags,
                itemCount: stats.rowCount,
                updatedAt: d.updatedAt,
            };
        }));

        // Filter by search if provided
        let filtered = enriched;
        if (input.search) {
            const searchLower = input.search.toLowerCase();
            filtered = enriched.filter((d: any) => d.name.toLowerCase().includes(searchLower));
        }

        return successResponse(
            filtered,
            `Found ${filtered.length} datasets`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetDatasetDetails(args: unknown, context?: ToolContext) {
    try {
        const input = GetDatasetDetailsInput.parse(args);
        const orgContext = getOrgContext(context);

        let dataset: any = null;
        if (input.datasetId) {
            if (context?.resourceScoping && !hasResourcePermission(context.permissions || [], "dataset:read", input.datasetId.toString(), context.resourceScoping)) {
                return errorResponse("Access to this dataset is restricted (resource scoping)");
            }
            dataset = await datasetService.getById(input.datasetId, orgContext);
        } else if (input.datasetName) {
            const all = await datasetService.list(orgContext);
            dataset = all.find((d: any) => d.name.toLowerCase().includes(input.datasetName!.toLowerCase()));
            if (dataset) {
                if (context?.resourceScoping && !hasResourcePermission(context.permissions || [], "dataset:read", dataset.id.toString(), context.resourceScoping)) {
                    return errorResponse("Access to this dataset is restricted (resource scoping)");
                }
                dataset = await datasetService.getById(dataset.id, orgContext);
            }
        }

        if (!dataset) {
            return errorResponse("Dataset not found");
        }

        // Get sample items
        const { items: samples } = await datasetService.getItems(dataset.id, orgContext, { limit: 5 });

        return successResponse({
            ...dataset,
            sampleItems: samples.map((s: any) => s.data),
        }, `Dataset: ${dataset.name}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleCreateDataset(args: unknown, context?: ToolContext) {
    try {
        const input = CreateDatasetInput.parse(args);
        const orgContext = getOrgContext(context);

        const newDataset = await datasetService.create({
            name: input.name,
            description: input.description,
            tags: input.tags,
            schemaMapping: input.schemaMapping,
        }, orgContext);

        return successResponse(
            { id: newDataset.id, name: newDataset.name },
            `Created dataset "${newDataset.name}" (ID: ${newDataset.id})`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleQueryDataset(args: unknown, context?: ToolContext) {
    try {
        const input = QueryDatasetInput.parse(args);
        const orgContext = getOrgContext(context);

        if (context?.resourceScoping && !hasResourcePermission(context.permissions || [], "dataset:read", input.datasetId.toString(), context.resourceScoping)) {
            return errorResponse("Access to this dataset is restricted (resource scoping)");
        }

        if (context?.allowedDatasetIds && context.allowedDatasetIds.length > 0 && !context.allowedDatasetIds.includes(input.datasetId)) {
            return errorResponse("Access to this dataset is restricted");
        }

        const { items, total } = await datasetService.getItems(input.datasetId, orgContext, {
            limit: input.limit,
            offset: input.offset,
        });

        return successResponse(
            {
                items: items.map((r: any) => r.data),
                total
            },
            `Found ${items.length} items in dataset ID ${input.datasetId}`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleAddDatasetItems(args: unknown, context?: ToolContext) {
    try {
        const input = AddDatasetItemsInput.parse(args);
        const orgContext = getOrgContext(context);

        if (input.items.length === 0) {
            return successResponse({}, "No items to add");
        }

        const { inserted, items } = await datasetService.addItems(
            input.datasetId,
            input.items.map(item => ({ data: item, rawData: item })),
            orgContext
        );

        return successResponse(
            { count: inserted, itemIds: items?.map((i: any) => i.id) },
            `Added ${inserted} items to dataset ID ${input.datasetId}`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

