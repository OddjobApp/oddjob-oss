
import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { getJiraClient } from "../../../../domain/integrations/jira-service.js";
import { db } from "../../../../database_service.js";
import { missionBlackboardHistory } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

export interface JiraMigrationConfig {
    sourceCredentialId: number;
    targetCredentialId: number;
    sourceProjectKey: string;
    targetProjectKey: string;
    triggerStatus?: string;
    mappingConfig?: Record<string, string>;
    samplingMode?: boolean;
    deduplicationField?: string;
}

export class JiraMigrationExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "jira_migration";
    }

    async execute(
        job: Job,
        resolvedConfig: JiraMigrationConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; missionId?: number }
    ): Promise<StepExecutionResult> {
        const {
            sourceCredentialId,
            targetCredentialId,
            sourceProjectKey,
            targetProjectKey,
            triggerStatus,
            mappingConfig,
            samplingMode = false,
            deduplicationField = "source_issue_key"
        } = resolvedConfig;

        const logs: string[] = [];
        const sourceClient = await getJiraClient(sourceCredentialId, job.organizationId);
        const targetClient = await getJiraClient(targetCredentialId, job.organizationId);

        // 1. Sampling Mode
        if (samplingMode) {
            logs.push(`Running in Sampling Mode for Project: ${sourceProjectKey} -> ${targetProjectKey}`);
            const sourceIssues = await sourceClient.getIssuesInProject(sourceProjectKey, 5);
            const targetIssues = await targetClient.getIssuesInProject(targetProjectKey, 5);
            const sourceFields = await sourceClient.getFields();
            const targetFields = await targetClient.getFields();

            return {
                success: true,
                status: "success",
                output: JSON.stringify({
                    sourceSample: sourceIssues.issues.slice(0, 3),
                    targetSample: targetIssues.issues.slice(0, 3),
                    sourceFields: sourceFields.filter(f => !f.custom),
                    targetFields: targetFields.filter(f => !f.custom),
                    message: "Sampling completed successfully."
                })
            };
        }

        // 2. Migration Mode
        logs.push(`Starting Migration Poll: ${sourceProjectKey} -> ${targetProjectKey}`);
        const jql = `project = "${sourceProjectKey}" ${triggerStatus ? `AND status = "${triggerStatus}"` : ''} ORDER BY created DESC`;
        const searchResult = await sourceClient.searchIssues(jql, 50);

        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const issue of searchResult.issues) {
            try {
                // Deduplication Check (Check Blackboard)
                if (context.missionId) {
                    const [existing] = await db.select()
                        .from(missionBlackboardHistory)
                        .where(
                            and(
                                eq(missionBlackboardHistory.missionId, context.missionId),
                                eq(missionBlackboardHistory.changeReason, `migrated:${issue.key}`)
                            )
                        )
                        .limit(1);

                    if (existing) {
                        skippedCount++;
                        continue;
                    }
                }

                // Field Mapping (Basic Implementation - specialized AI step expected in full workflow)
                const targetFields: any = {
                    project: { key: targetProjectKey },
                    summary: issue.fields.summary,
                    description: issue.fields.description,
                    issuetype: { name: issue.fields.issuetype.name }
                };

                // Apply mapping config if provided
                if (mappingConfig) {
                    for (const [sourceField, targetField] of Object.entries(mappingConfig)) {
                        const value = (issue.fields as any)[sourceField];
                        if (value !== undefined) {
                            targetFields[targetField] = value;
                        }
                    }
                }

                // Create Issue in Target
                const result = await targetClient.createIssue(targetFields);
                migratedCount++;
                logs.push(`Successfully migrated ${issue.key} -> ${result.key}`);

                // Update Blackboard (Audit Trail/Dedupe)
                if (context.missionId) {
                    await db.insert(missionBlackboardHistory).values({
                        missionId: context.missionId,
                        changedBy: `job:${job.id}`,
                        changeReason: `migrated:${issue.key}`,
                        blackboard: { sourceKey: issue.key, targetKey: result.key },
                        createdAt: new Date()
                    });
                }
            } catch (err: any) {
                errorCount++;
                logs.push(`Error migrating ${issue.key}: ${err.message}`);
            }
        }

        return {
            success: errorCount === 0,
            status: errorCount === 0 ? "success" : "failed",
            output: JSON.stringify({
                migratedCount,
                skippedCount,
                errorCount,
                logs
            })
        };
    }
}


