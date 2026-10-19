import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, GitHubSyncConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getGitHubClient } from "@domain/integrations/github-service.js";
import { ingestFileToKnowledgeStore as ingestIntegrationDocument } from "@domain/knowledge/core/knowledge-store.js";

export class GitHubSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "github_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: GitHubSyncConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, owner, repos, syncType, state, limit, knowledgeTopicId, labels, since } = resolvedConfig;
        const logs: string[] = [];
        let processedCount = 0;
        let errorCount = 0;

        const client = await getGitHubClient(credentialId, job.organizationId);

        let targetRepos = [...(repos || [])];
        if (targetRepos.length === 0 && owner) {
            logs.push(`No repos specified — fetching repos for owner: ${owner}`);
            const allRepos = await client.listRepos(owner, 50);
            targetRepos = allRepos.map((r: any) => r.name);
            logs.push(`Found ${targetRepos.length} repos`);
        }

        if (targetRepos.length === 0) {
            return {
                success: false,
                status: "failed",
                output: JSON.stringify({ error: "No repos to sync. Provide repos[] or an owner." })
            };
        }

        try {
            for (const repoName of targetRepos) {
                const repoFullName = owner ? `${owner}/${repoName}` : repoName;
                const parts = repoFullName.split("/");
                const repoOwner = parts[0];
                const repoSlug = parts[1] || repoName;

                // Sync Issues
                if (syncType === "issues" || syncType === "all") {
                    try {
                        const issues = await client.listIssues(repoOwner, repoSlug, state, limit, labels?.join(","), since);
                        const realIssues = issues.filter((i: any) => !i.pull_request);
                        logs.push(`${repoFullName}: Found ${realIssues.length} issues`);
                        for (const issue of realIssues) {
                            try {
                                await ingestIntegrationDocument({
                                    content: client.issueToMarkdown(issue, repoFullName),
                                    title: `${repoFullName}#${issue.number}: ${issue.title}`,
                                    platform: "GitHub",
                                    integrationId: 0,
                                    organizationId: job.organizationId!,
                                    createdBy: job.createdBy,
                                    metadata: {
                                        issueNumber: issue.number,
                                        repo: repoFullName,
                                        state: issue.state,
                                        type: "issue",
                                        url: issue.html_url,
                                        jobId: job.id,
                                    },
                                });
                                processedCount++;
                            } catch (e: any) {
                                errorCount++;
                                logs.push(`Error ingesting issue ${issue.number}: ${e.message}`);
                            }
                        }
                    } catch (e: any) {
                        logs.push(`Failed fetching issues for ${repoFullName}: ${e.message}`);
                        errorCount++;
                    }
                }

                // Sync Pull Requests
                if (syncType === "pull_requests" || syncType === "all") {
                    try {
                        const prs = await client.listPullRequests(repoOwner, repoSlug, state, limit);
                        logs.push(`${repoFullName}: Found ${prs.length} PRs`);
                        for (const pr of prs) {
                            try {
                                await ingestIntegrationDocument({
                                    content: client.prToMarkdown(pr, repoFullName),
                                    title: `${repoFullName} PR #${pr.number}: ${pr.title}`,
                                    platform: "GitHub",
                                    integrationId: 0,
                                    organizationId: job.organizationId!,
                                    createdBy: job.createdBy,
                                    metadata: {
                                        prNumber: pr.number,
                                        repo: repoFullName,
                                        state: pr.state,
                                        type: "pull_request",
                                        url: pr.html_url,
                                        jobId: job.id,
                                    },
                                });
                                processedCount++;
                            } catch (e: any) {
                                errorCount++;
                                logs.push(`Error ingesting PR ${pr.number}: ${e.message}`);
                            }
                        }
                    } catch (e: any) {
                        logs.push(`Failed fetching PRs for ${repoFullName}: ${e.message}`);
                        errorCount++;
                    }
                }

                // Sync Releases
                if (syncType === "releases" || syncType === "all") {
                    try {
                        const releases = await client.listReleases(repoOwner, repoSlug);
                        for (const release of releases) {
                            try {
                                const content = `# Release: ${release.tag_name}\n\n**Name:** ${release.name || release.tag_name}\n**Published:** ${release.published_at}\n\n${release.body || ""}`;
                                await ingestIntegrationDocument({
                                    content,
                                    title: `${repoFullName} Release: ${release.tag_name}`,
                                    platform: "GitHub",
                                    integrationId: 0,
                                    organizationId: job.organizationId!,
                                    createdBy: job.createdBy,
                                    metadata: {
                                        tag: release.tag_name,
                                        repo: repoFullName,
                                        type: "release",
                                        url: release.html_url,
                                        jobId: job.id,
                                    },
                                });
                                processedCount++;
                            } catch (e: any) {
                                errorCount++;
                            }
                        }
                    } catch (e: any) {
                        logs.push(`Failed fetching releases for ${repoFullName}: ${e.message}`);
                        errorCount++;
                    }
                }
            }

            return {
                success: errorCount === 0,
                status: errorCount === 0 ? "success" : "failed",
                output: JSON.stringify({
                    message: `GitHub Sync completed. Processed ${processedCount} items. Errors: ${errorCount}`,
                    processedCount,
                    errorCount,
                    logs,
                }),
            };
        } catch (error: any) {
            logs.push(`Job failed: ${error.message}`);
            return { success: false, status: "failed", output: JSON.stringify({ error: error.message, logs }) };
        }
    }
}
