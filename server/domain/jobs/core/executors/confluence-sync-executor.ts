
import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, ConfluenceSyncConfig, EntityRule, RelationshipRule } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { getConfluenceClient } from "../../../../domain/integrations/confluence-service.js";
import { ingestFileToKnowledgeStore } from "../../../../knowledge/knowledge-store.js";
import { extractAndCreateKnowledgeGraph } from "@domain/knowledge/core/extraction/knowledge-graph-extractor.js";
import { NotFoundError } from "@server/utils/errors.js";

export class ConfluenceSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "confluence_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: ConfluenceSyncConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, spaceKeys, knowledgeTopicId } = resolvedConfig;

        if (!knowledgeTopicId) {
            throw new Error("Knowledge Topic ID is required for Confluence Sync jobs.");
        }

        // 1. Initialize Client via Factory (Consolidated Security & Logic)
        const client = await getConfluenceClient(credentialId, job.organizationId);

        // 3. Determine Spaces to Sync
        let targetSpaceKeys: string[] = spaceKeys || [];
        if (targetSpaceKeys.length === 0) {
            const spaces = await client.getSpaces(50); // Limit 50 spaces for safety
            targetSpaceKeys = spaces.map((s: any) => s.key);
        }

        let processedCount = 0;
        let errorCount = 0;
        const logs: string[] = [];

        // Definition for Confluence Knowledge Graph Rules
        const entityRules: EntityRule[] = [
            {
                entityType: "ConfluenceSpace",
                label: "Space",
                rootPath: "space", // Page response has an embedded space object
                mappings: {
                    name: "key",
                    externalId: "key",
                    data: {
                        name: "name",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "ConfluencePage",
                label: "Page",
                mappings: {
                    name: "title",
                    externalId: "id",
                    data: {
                        spaceKey: "space.key",
                        url: "_links.webui",
                        domain: "knowledge"
                    }
                }
            }
        ];

        const relationshipRules: RelationshipRule[] = [
            {
                relation: "PAGE_IN_SPACE",
                sourceEntity: "ConfluencePage",
                targetEntity: "ConfluenceSpace",
                sourcePath: "id",
                targetPath: "space.key"
            }
        ];

        // 4. iterate Spaces and Pages
        for (const spaceKey of targetSpaceKeys) {
            logs.push(`Syncing Space: ${spaceKey}`);
            try {
                // Fetch pages with pagination
                let start = 0;
                const limit = 50;
                let hasMore = true;

                while (hasMore) {
                    const pages = await client.getPagesInSpace(spaceKey, limit, start);

                    if (pages.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const page of pages) {
                        try {
                            const content = client.convertToMarkdown(page.body.storage.value);
                            const title = page.title;
                            const pageId = page.id;
                            const baseUrl = client.getBaseUrl()?.replace(/\/wiki$/, '') || '';
                            const webUi = page._links?.webui ? `${baseUrl}${page._links.webui}` : '';

                            if (!webUi.startsWith('http') && baseUrl) {
                                console.warn(`[Confluence Sync] Generated malformed URL for page ${page.id}: ${webUi}`);
                            }

                            // 1. Ingest to Knowledge Store (RAG)
                            let knowledgeDocumentId: number | undefined;
                            const ingested = await ingestFileToKnowledgeStore({
                                content: content,
                                title: title,
                                sourceType: "text",
                                topicId: knowledgeTopicId,
                                organizationId: job.organizationId,
                                createdBy: job.createdBy,
                                metadata: {
                                    source: 'confluence',
                                    pageId: pageId,
                                    spaceKey: spaceKey,
                                    url: webUi,
                                    syncedAt: new Date().toISOString(),
                                    jobId: job.id
                                }
                            });

                            // Get document ID if available
                            if (ingested && typeof ingested === 'number') {
                                knowledgeDocumentId = ingested;
                            } else if (ingested && (ingested as any).id) {
                                knowledgeDocumentId = (ingested as any).id;
                            }

                            // 2. Extract to Knowledge Graph (Explorer)
                            await extractAndCreateKnowledgeGraph({
                                data: page,
                                entityRules,
                                relationshipRules,
                                organizationId: job.organizationId!,
                                createdBy: job.createdBy,
                                knowledgeDocumentId,
                                jobId: job.id,
                                extractionSource: "pipeline"
                            });

                            processedCount++;
                        } catch (err: any) {
                            console.error(`Failed to ingest page ${page.id}:`, err);
                            errorCount++;
                            logs.push(`Error processing page ${page.id}: ${err.message}`);
                        }
                    }

                    start += limit;
                    // Safety break to prevent infinite loops if API misbehaves
                    if (start > 10000) {
                        logs.push(`Pagination safety limit reached (10000 pages) for space ${spaceKey}`);
                        break;
                    }
                }

            } catch (err: any) {
                console.error(`Failed to fetch spaces for ${spaceKey}:`, err);
                logs.push(`Failed to sync space ${spaceKey}: ${err.message}`);
                errorCount++;
            }
        }

        return {
            success: errorCount === 0,
            status: errorCount === 0 ? "success" : "failed",
            output: JSON.stringify({
                message: `Confluence Sync Completed. Processed ${processedCount} pages. Errors: ${errorCount}`,
                logs: logs
            })
        };
    }
}


