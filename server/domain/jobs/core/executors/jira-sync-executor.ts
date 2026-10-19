
import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, JiraSyncConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getJiraClient } from "@domain/integrations/jira-service.js";
import { ingestFileToKnowledgeStore as ingestIntegrationDocument, storeJobOutputAsKnowledge, getJobOutputStorageConfig } from "@domain/knowledge/core/knowledge-store.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { extractAndCreateKnowledgeGraph } from "@domain/knowledge/core/extraction/knowledge-graph-extractor.js";
import { EntityRule, RelationshipRule } from "@shared/schema/index.js";

export class JiraSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "jira_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: JiraSyncConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, projectKeys, projectKey, jql, limit = 100, knowledgeTopicId, additionalFields = [] } = resolvedConfig;

        const logs: string[] = [];
        let processedCount = 0;
        let errorCount = 0;

        // Find the Jira Integration ID for this organization to link documents correctly
        const [connector] = await db
            .select({
                id: saasConnectors.id,
                name: saasConnectors.platform,
                config: saasConnectors.config
            })
            .from(saasConnectors)
            .where(
                and(
                    eq(saasConnectors.orgId, job.organizationId!),
                    eq(saasConnectors.platform, "jira")
                )
            )
            .limit(1);

        if (!connector) {
            logs.push("Warning: No Jira SaaS Connector found for this organization. Ingestion will proceed with default settings.");
        }

        // Define JIRA Knowledge Graph Rules (Comprehensive Spec Implementation)
        const entityRules: EntityRule[] = [
            {
                entityType: "Project",
                label: "Project",
                mappings: {
                    name: "fields.project.name",
                    externalId: "fields.project.id",
                    data: {
                        key: "fields.project.key",
                        projectType: "fields.project.projectTypeKey",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "Issue",
                label: "Issue",
                mappings: {
                    name: "fields.summary",
                    externalId: "key",
                    data: {
                        status: "fields.status.name",
                        priority: "fields.priority.name",
                        issueType: "fields.issuetype.name",
                        updated: "fields.updated",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "Epic",
                label: "Epic",
                condition: "fields.issuetype.name === 'Epic'",
                mappings: {
                    name: "fields.summary",
                    externalId: "key",
                    data: {
                        status: "fields.status.name",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "Story",
                label: "Story",
                condition: "fields.issuetype.name === 'Story'",
                mappings: {
                    name: "fields.summary",
                    externalId: "key",
                    data: {
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "Bug",
                label: "Bug",
                condition: "fields.issuetype.name === 'Bug'",
                mappings: {
                    name: "fields.summary",
                    externalId: "key",
                    data: {
                        priority: "fields.priority.name",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "User",
                label: "User",
                rootPath: "fields.assignee",
                mappings: {
                    name: "displayName",
                    externalId: "accountId",
                    data: {
                        email: "emailAddress",
                        domain: "knowledge"
                    }
                }
            },
            {
                entityType: "Reporter",
                label: "User",
                rootPath: "fields.reporter",
                mappings: {
                    name: "displayName",
                    externalId: "accountId",
                    data: {
                        domain: "knowledge"
                    }
                }
            }
        ];

        const relationshipRules: RelationshipRule[] = [
            {
                relation: "ASSIGNED_TO",
                sourceEntity: "Issue",
                targetEntity: "User",
                sourcePath: "key",
                targetPath: "fields.assignee.accountId"
            },
            {
                relation: "REPORTED_BY",
                sourceEntity: "Issue",
                targetEntity: "Reporter",
                sourcePath: "key",
                targetPath: "fields.reporter.accountId"
            },
            {
                relation: "PART_OF_PROJECT",
                sourceEntity: "Issue",
                targetEntity: "Project",
                sourcePath: "key",
                targetPath: "fields.project.id"
            },
            {
                relation: "BELONGS_TO_EPIC",
                sourceEntity: "Issue",
                targetEntity: "Epic",
                sourcePath: "key",
                targetPath: "fields.customfield_10014" // standard Epic Link field
            }
        ];

        // Initialize Client via Factory (Consolidated Security & Logic)
        const client = await getJiraClient(credentialId, job.organizationId);

        // Determine what to sync
        let targetProjectKeys: string[] = projectKeys || [];
        if (projectKey && !targetProjectKeys.includes(projectKey)) {
            targetProjectKeys.push(projectKey);
        }

        try {
            // If JQL is provided, use that directly
            if (jql) {
                logs.push(`Running JIRA sync with JQL: ${jql}`);
                const result = await client.searchIssues(jql, limit, 0, additionalFields);
                logs.push(`Found ${result.issues.length} issues matching JQL.`);

                const targetStorage = connector?.config?.target_storage || "knowledge_store";
                logs.push(`Storage strategy: ${targetStorage}`);

                for (const issue of result.issues) {
                    try {
                        const content = client.issueToMarkdown(issue);
                        const issueUrl = `${client.getBaseUrl()}/browse/${issue.key}`;
                        let knowledgeDocumentId: number | undefined;

                        // 1. Ingest to Knowledge Store (RAG) - Only if preferred
                        if (targetStorage === "knowledge_store") {
                            knowledgeDocumentId = await ingestIntegrationDocument({
                                content: content,
                                title: `${issue.key}: ${issue.fields.summary}`,
                                platform: connector?.name || "Jira",
                                integrationId: connector?.id || 0,
                                organizationId: job.organizationId!,
                                createdBy: job.createdBy,
                                metadata: {
                                    issueId: issue.id,
                                    projectKey: issue.fields.project.key,
                                    issueType: issue.fields.issuetype.name,
                                    status: issue.fields.status.name,
                                    url: issueUrl,
                                    syncedAt: new Date().toISOString(),
                                    jobId: job.id
                                }
                            });
                        }

                        // 2. Extract to Knowledge Graph (Explorer) - Always do this
                        await extractAndCreateKnowledgeGraph({
                            data: issue,
                            entityRules,
                            relationshipRules,
                            organizationId: job.organizationId!,
                            createdBy: job.createdBy,
                            knowledgeDocumentId,
                            jobId: job.id,
                            extractionSource: "pipeline"
                        });

                        // 3. Store in Dataset (Always if target is dataset, otherwise if extra output configured)
                        const datasetId = targetStorage === "dataset"
                            ? (job.outputDatasetId || 0) // Should ideally be auto-resolved if 0
                            : job.outputDatasetId;

                        if (datasetId) {
                            await storeJobOutputAsKnowledge({
                                output: JSON.stringify(issue),
                                job,
                                stepExecution: { id: 0, status: "success", executedAt: new Date() },
                                topicId: null,
                                datasetId: datasetId,
                                tags: job.outputTags || ["jira"],
                                settings: await getJobOutputStorageConfig(job)
                            });
                        }

                        processedCount++;
                    } catch (err: any) {
                        console.error(`Failed to ingest issue ${issue.key}:`, err);
                        errorCount++;
                        logs.push(`Error processing issue ${issue.key}: ${err.message}`);
                    }
                }
            } else {
                // Sync by project keys
                if (targetProjectKeys.length === 0) {
                    // Fetch all projects if none specified
                    const projects = await client.getProjects(50);
                    targetProjectKeys = projects.map(p => p.key);
                    logs.push(`No project keys specified, syncing ${targetProjectKeys.length} projects`);
                }

                const targetStorage = connector?.config?.target_storage || "knowledge_store";
                logs.push(`Storage strategy: ${targetStorage}`);

                for (const projKey of targetProjectKeys) {
                    logs.push(`Syncing Project: ${projKey}`);
                    try {
                        const searchResult = await client.getIssuesInProject(projKey, limit, 0, additionalFields);

                        for (const issue of searchResult.issues) {
                            try {
                                const content = client.issueToMarkdown(issue);
                                const issueUrl = `${client.getBaseUrl()}/browse/${issue.key}`;
                                let knowledgeDocumentId: number | undefined;

                                // 1. Ingest to Knowledge Store (RAG) - Only if preferred
                                if (targetStorage === "knowledge_store") {
                                    knowledgeDocumentId = await ingestIntegrationDocument({
                                        content: content,
                                        title: `${issue.key}: ${issue.fields.summary}`,
                                        platform: connector?.name || "Jira",
                                        integrationId: connector?.id || 0,
                                        organizationId: job.organizationId!,
                                        createdBy: job.createdBy,
                                        metadata: {
                                            issueId: issue.id,
                                            projectKey: projKey,
                                            issueType: issue.fields.issuetype.name,
                                            status: issue.fields.status.name,
                                            url: issueUrl,
                                            syncedAt: new Date().toISOString(),
                                            jobId: job.id
                                        }
                                    });
                                }

                                // 2. Extract to Knowledge Graph (Explorer) - Always
                                await extractAndCreateKnowledgeGraph({
                                    data: issue,
                                    entityRules,
                                    relationshipRules,
                                    organizationId: job.organizationId!,
                                    createdBy: job.createdBy,
                                    knowledgeDocumentId,
                                    jobId: job.id,
                                    extractionSource: "pipeline"
                                });

                                // 3. Store in Dataset
                                const datasetId = targetStorage === "dataset"
                                    ? (job.outputDatasetId || 0)
                                    : job.outputDatasetId;

                                if (datasetId) {
                                    await storeJobOutputAsKnowledge({
                                        output: JSON.stringify(issue),
                                        job,
                                        stepExecution: { id: 0, status: "success", executedAt: new Date() },
                                        topicId: null,
                                        datasetId: datasetId,
                                        tags: job.outputTags || ["jira"],
                                        settings: await getJobOutputStorageConfig(job)
                                    });
                                }

                                processedCount++;
                            } catch (err: any) {
                                console.error(`Failed to ingest issue ${issue.key}:`, err);
                                errorCount++;
                                logs.push(`Error processing issue ${issue.key}: ${err.message}`);
                            }
                        }
                    } catch (err: any) {
                        console.error(`Failed to fetch issues for ${projKey}:`, err);
                        logs.push(`Failed to sync project ${projKey}: ${err.message}`);
                        errorCount++;
                    }
                }
            }

            return {
                success: errorCount === 0,
                status: errorCount === 0 ? "success" : "failed",
                output: JSON.stringify({
                    message: `Jira Sync Completed. Processed ${processedCount} issues. Errors: ${errorCount}`,
                    processedCount,
                    errorCount,
                    logs: logs
                })
            };
        } catch (error: any) {
            logs.push(`Job Failed: ${error.message}`);
            return {
                success: false,
                status: 'failed',
                output: JSON.stringify({ error: error.message, logs })
            };
        }
    }
}


