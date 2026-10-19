import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, GitHubOpConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getGitHubClient } from "@domain/integrations/github-service.js";

export class GitHubOpExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "github_op";
    }

    async execute(
        job: Job,
        resolvedConfig: GitHubOpConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, repoOwner, repoName, action } = resolvedConfig;

        try {
            const client = await getGitHubClient(credentialId, job.organizationId);
            let result: any;

            switch (action) {
                case "create_pr":
                    if (!resolvedConfig.title || !resolvedConfig.head || !resolvedConfig.base) {
                        throw new Error("create_pr requires title, head, and base");
                    }
                    result = await client.createPullRequest(repoOwner, repoName, resolvedConfig.title, resolvedConfig.head, resolvedConfig.base, resolvedConfig.body);
                    break;

                case "merge_pr":
                    if (!resolvedConfig.prNumber) throw new Error("merge_pr requires prNumber");
                    result = await client.mergePullRequest(repoOwner, repoName, resolvedConfig.prNumber, resolvedConfig.mergeMethod || "squash");
                    break;

                case "close_pr":
                    if (!resolvedConfig.prNumber) throw new Error("close_pr requires prNumber");
                    result = await client.closePullRequest(repoOwner, repoName, resolvedConfig.prNumber);
                    break;

                case "create_issue":
                    if (!resolvedConfig.title) throw new Error("create_issue requires title");
                    result = await client.createIssue(repoOwner, repoName, resolvedConfig.title, resolvedConfig.body, resolvedConfig.labels, resolvedConfig.assignees);
                    break;

                case "close_issue":
                    if (!resolvedConfig.issueNumber) throw new Error("close_issue requires issueNumber");
                    result = await client.closeIssue(repoOwner, repoName, resolvedConfig.issueNumber);
                    break;

                case "add_label": {
                    const targetNumber = resolvedConfig.issueNumber ?? resolvedConfig.prNumber;
                    if (!targetNumber) throw new Error("add_label requires issueNumber or prNumber");
                    result = await client.addLabels(repoOwner, repoName, targetNumber, resolvedConfig.labels || []);
                    break;
                }

                case "request_review":
                    if (!resolvedConfig.prNumber) throw new Error("request_review requires prNumber");
                    result = await client.requestReviewers(repoOwner, repoName, resolvedConfig.prNumber, resolvedConfig.reviewers || []);
                    break;

                case "get_pr_reviews":
                    if (!resolvedConfig.prNumber) throw new Error("get_pr_reviews requires prNumber");
                    result = await client.getPullRequestReviews(repoOwner, repoName, resolvedConfig.prNumber);
                    break;

                case "list_prs":
                    result = await client.listPullRequests(repoOwner, repoName, "open", 50);
                    break;

                case "list_issues":
                    result = await client.listIssues(repoOwner, repoName, "open", 50);
                    break;

                default:
                    throw new Error(`Unknown GitHub action: ${action}`);
            }

            return { success: true, status: "success", output: JSON.stringify({ action, result }) };
        } catch (error: any) {
            return { success: false, status: "failed", output: JSON.stringify({ error: error.message, action }) };
        }
    }
}
