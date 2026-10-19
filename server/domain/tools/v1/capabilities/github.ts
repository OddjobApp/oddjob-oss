import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function resolveGitHubCredential(orgId?: number | null): Promise<number | undefined> {
    if (!orgId) return undefined;
    try {
        const { db } = await import("@server/database_service.js");
        const { saasConnectors } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [connector] = await db
            .select({ id: saasConnectors.id })
            .from(saasConnectors)
            .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "github")))
            .limit(1);
        return connector?.id;
    } catch {
        return undefined;
    }
}

export const GITHUB_TOOLS: Record<string, ToolDefinition> = {
    github_list_prs: {
        name: "github_list_prs",

        idempotency: "read-safe",
        label: "List Pull Requests",
        group: "GitHub",
        description: "List pull requests in a GitHub repository.",
        parameters: z.object({
            owner: z.string().describe("Repository owner (user or org)"),
            repo: z.string().describe("Repository name"),
            state: z.enum(["open", "closed", "all"]).default("open").describe("PR state filter"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured. Add a GitHub connector in Settings." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const prs = await client.listPullRequests(params.owner, params.repo, params.state || "open", 50);
            return JSON.stringify(prs.map((pr: any) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                author: pr.user?.login,
                url: pr.html_url,
                head: pr.head?.ref,
                base: pr.base?.ref,
                draft: pr.draft,
                created: pr.created_at,
            })));
        },
    },

    github_list_issues: {
        name: "github_list_issues",

        idempotency: "read-safe",
        label: "List GitHub Issues",
        group: "GitHub",
        description: "List issues in a GitHub repository.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            state: z.enum(["open", "closed", "all"]).default("open").describe("Issue state filter"),
            labels: z.string().optional().describe("Comma-separated label names to filter by"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const issues = await client.listIssues(params.owner, params.repo, params.state || "open", 50, params.labels);
            const realIssues = issues.filter((i: any) => !i.pull_request);
            return JSON.stringify(realIssues.map((i: any) => ({
                number: i.number,
                title: i.title,
                state: i.state,
                author: i.user?.login,
                labels: i.labels?.map((l: any) => l.name),
                assignees: i.assignees?.map((a: any) => a.login),
                url: i.html_url,
                created: i.created_at,
            })));
        },
    },

    github_create_pr: {
        name: "github_create_pr",

        idempotency: "none",
        riskLevel: "high",
        label: "Create Pull Request",
        group: "GitHub",
        description: "Create a new pull request in a GitHub repository.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            title: z.string().describe("PR title"),
            head: z.string().describe("Branch to merge from"),
            base: z.string().describe("Branch to merge into (e.g. main)"),
            body: z.string().optional().describe("PR description in markdown"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const pr = await client.createPullRequest(params.owner, params.repo, params.title, params.head, params.base, params.body);
            return JSON.stringify({ number: pr.number, url: pr.html_url, state: pr.state, title: pr.title });
        },
    },

    github_create_issue: {
        name: "github_create_issue",

        idempotency: "none",
        label: "Create GitHub Issue",
        group: "GitHub",
        description: "Create a new issue in a GitHub repository.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            title: z.string().describe("Issue title"),
            body: z.string().optional().describe("Issue description"),
            labels: z.array(z.string()).optional().describe("Labels to apply"),
            assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const issue = await client.createIssue(params.owner, params.repo, params.title, params.body, params.labels, params.assignees);
            return JSON.stringify({ number: issue.number, url: issue.html_url, title: issue.title });
        },
    },

    github_merge_pr: {
        name: "github_merge_pr",

        idempotency: "none",
        riskLevel: "high",
        label: "Merge Pull Request",
        group: "GitHub",
        description: "Merge a pull request in a GitHub repository.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            prNumber: z.number().describe("Pull request number"),
            mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash").describe("Merge strategy"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const result = await client.mergePullRequest(params.owner, params.repo, params.prNumber, params.mergeMethod || "squash");
            return JSON.stringify(result);
        },
    },

    github_get_pr_reviews: {
        name: "github_get_pr_reviews",

        idempotency: "read-safe",
        label: "Get PR Reviews",
        group: "GitHub",
        description: "Get review status and comments for a pull request.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            prNumber: z.number().describe("Pull request number"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const reviews = await client.getPullRequestReviews(params.owner, params.repo, params.prNumber);
            return JSON.stringify(reviews.map((r: any) => ({
                reviewer: r.user?.login,
                state: r.state,
                body: r.body,
                submittedAt: r.submitted_at,
            })));
        },
    },

    github_request_review: {
        name: "github_request_review",

        idempotency: "none",
        label: "Request PR Review",
        group: "GitHub",
        description: "Request reviewers for a pull request.",
        parameters: z.object({
            owner: z.string().describe("Repository owner"),
            repo: z.string().describe("Repository name"),
            prNumber: z.number().describe("Pull request number"),
            reviewers: z.array(z.string()).describe("GitHub usernames to request reviews from"),
        }),
        execute: async (params, context) => {
            const { getGitHubClient } = await import("../../../integrations/github-service.js");
            const credentialId = await resolveGitHubCredential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No GitHub credential configured." });
            const client = await getGitHubClient(credentialId, context?.organizationId || null);
            const result = await client.requestReviewers(params.owner, params.repo, params.prNumber, params.reviewers);
            return JSON.stringify({ status: "requested", reviewers: params.reviewers });
        },
    },
};
