
import { JobExecutor } from "./index.js";
import { Job } from "@shared/schema/index.js";
import { qdrantPublisher } from "@domain/knowledge/core/indexing/qdrant-publisher.js";
import { db } from "../../../../database_service.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";

export class UnifiedSyncExecutor implements JobExecutor {
    name = "unified_sync_executor";

    canExecute(jobType: string): boolean {
        return jobType === "unified_knowledge_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: any,
        context: any
    ): Promise<any> {
        console.log(`[UnifiedSyncExecutor] Starting sync for knowledge base...`);

        // This is a "SWEEP" style sync - it finds items not yet indexed or updated
        // For MVP, we'll just grab everything that isn't indexed (naively)
        // Or better, we just sync the last N items to confirm it works

        const limit = 50;

        // 1. Sync Recent Dataset Items
        // Ideally we'd track "last_synced_at" on the items, but for now we rely on re-indexing
        const items = await datasetService.getAllItems(getSystemOrgContext(job.organizationId!), limit);

        console.log(`[UnifiedSyncExecutor] Found ${items.length} dataset items to sync.`);
        for (const item of items) {
            await qdrantPublisher.publishDatasetItem(item.id);
        }

        // 2. Sync Knowledge Graph Nodes
        const nodesResult = await graphService.searchNodes(getSystemOrgContext(job.organizationId!), { limit });
        const nodes = nodesResult.nodes;

        console.log(`[UnifiedSyncExecutor] Found ${nodes.length} graph nodes to sync.`);
        for (const node of nodes) {
            await qdrantPublisher.publishGraphNode(node.id);
        }

        console.log(`[UnifiedSyncExecutor] Sync complete.`);

        return {
            success: true,
            status: "success",
            output: `Synced ${items.length} dataset items and ${nodes.length} knowledge nodes.`
        };
    }
}


