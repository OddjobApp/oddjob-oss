import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "../auth/core/credentials-service.js";

const logger = createLogger("GitHubService");

export class GitHubClient {
    private token: string;
    private baseUrl: string;

    constructor(token: string, baseUrl = "https://api.github.com") {
        this.token = token;
        this.baseUrl = baseUrl;
    }

    private async request(path: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`GitHub API error ${res.status}: ${body}`);
        }
        return res.json();
    }

    async listRepos(owner: string, limit = 100): Promise<any[]> {
        return this.request(`/users/${owner}/repos?per_page=${limit}&sort=updated`);
    }

    async listIssues(owner: string, repo: string, state = "open", limit = 100, labels?: string, since?: string): Promise<any[]> {
        let qs = `?state=${state}&per_page=${limit}&sort=updated&filter=all`;
        if (labels) qs += `&labels=${encodeURIComponent(labels)}`;
        if (since) qs += `&since=${since}`;
        return this.request(`/repos/${owner}/${repo}/issues${qs}`);
    }

    async listPullRequests(owner: string, repo: string, state = "open", limit = 100): Promise<any[]> {
        return this.request(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}&sort=updated`);
    }

    async listCommits(owner: string, repo: string, limit = 100, since?: string): Promise<any[]> {
        let qs = `?per_page=${limit}`;
        if (since) qs += `&since=${since}`;
        return this.request(`/repos/${owner}/${repo}/commits${qs}`);
    }

    async listReleases(owner: string, repo: string, limit = 30): Promise<any[]> {
        return this.request(`/repos/${owner}/${repo}/releases?per_page=${limit}`);
    }

    async createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/pulls`, {
            method: "POST",
            body: JSON.stringify({ title, head, base, body: body || "" }),
        });
    }

    async mergePullRequest(owner: string, repo: string, prNumber: number, mergeMethod: string): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
            method: "PUT",
            body: JSON.stringify({ merge_method: mergeMethod }),
        });
    }

    async closePullRequest(owner: string, repo: string, prNumber: number): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
            method: "PATCH",
            body: JSON.stringify({ state: "closed" }),
        });
    }

    async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/issues`, {
            method: "POST",
            body: JSON.stringify({ title, body: body || "", labels: labels || [], assignees: assignees || [] }),
        });
    }

    async closeIssue(owner: string, repo: string, issueNumber: number): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
            method: "PATCH",
            body: JSON.stringify({ state: "closed" }),
        });
    }

    async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels }),
        });
    }

    async requestReviewers(owner: string, repo: string, prNumber: number, reviewers: string[]): Promise<any> {
        return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`, {
            method: "POST",
            body: JSON.stringify({ reviewers }),
        });
    }

    async getPullRequestReviews(owner: string, repo: string, prNumber: number): Promise<any[]> {
        return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
    }

    issueToMarkdown(issue: any, repoFullName: string): string {
        let md = `# ${issue.number}: ${issue.title}\n\n`;
        md += `**Repo:** ${repoFullName}\n`;
        md += `**State:** ${issue.state}\n`;
        if (issue.user) md += `**Author:** ${issue.user.login}\n`;
        if (issue.labels?.length) md += `**Labels:** ${issue.labels.map((l: any) => l.name).join(", ")}\n`;
        if (issue.assignees?.length) md += `**Assignees:** ${issue.assignees.map((a: any) => a.login).join(", ")}\n`;
        md += `**Created:** ${issue.created_at}\n`;
        md += `**Updated:** ${issue.updated_at}\n`;
        if (issue.html_url) md += `**URL:** ${issue.html_url}\n`;
        if (issue.body) md += `\n## Description\n\n${issue.body}\n`;
        return md;
    }

    prToMarkdown(pr: any, repoFullName: string): string {
        let md = `# PR #${pr.number}: ${pr.title}\n\n`;
        md += `**Repo:** ${repoFullName}\n`;
        md += `**State:** ${pr.state}\n`;
        md += `**Head:** ${pr.head?.ref} → **Base:** ${pr.base?.ref}\n`;
        if (pr.user) md += `**Author:** ${pr.user.login}\n`;
        if (pr.merged) md += `**Merged:** Yes\n`;
        if (pr.html_url) md += `**URL:** ${pr.html_url}\n`;
        if (pr.body) md += `\n## Description\n\n${pr.body}\n`;
        return md;
    }
}

export async function getGitHubClient(credentialId: number | undefined, orgId: number | null): Promise<GitHubClient> {
    if (!credentialId) throw new Error("GitHub credential ID is required");
    const cred = await credentialsService.getById(credentialId, orgId);
    const token = (cred as any).token || (cred as any).apiKey || (cred as any).accessToken;
    if (!token) throw new Error("GitHub credential must have a token, apiKey, or accessToken field");
    const baseUrl = (cred as any).baseUrl || "https://api.github.com";
    return new GitHubClient(token, baseUrl);
}
