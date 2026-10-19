import TurndownService from 'turndown';
import { credentialsService } from "../auth/core/credentials-service.js";
import { JiraGateway, type JiraIssue, type JiraProject, type JiraSearchResult } from "../../integrations/jira-gateway.js";

import { CircuitBreaker } from "../jobs/core/utils/circuit-breaker.js";
import { withRetry } from "../jobs/core/utils/retry.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export { JiraIssue, JiraProject, JiraSearchResult };

export class JiraClient {
    private gateway: JiraGateway;
    private circuitBreaker: CircuitBreaker;

    constructor(baseUrl: string, username: string, apiToken: string, orgId: number | null = null) {
        this.gateway = new JiraGateway(baseUrl, username, apiToken, orgId);
        // Threshold: 5 failures, Timeout: 60 seconds
        this.circuitBreaker = new CircuitBreaker(5, 60000);
    }

    private async executeWithResilience<T>(operation: () => Promise<T>): Promise<T> {
        return this.circuitBreaker.execute(() => withRetry(operation, 3, 1000));
    }

    public getBaseUrl(): string {
        return this.gateway.getBaseUrl();
    }

    /**
     * List all projects
     */
    async getProjects(limit = 50, start = 0): Promise<JiraProject[]> {
        return this.executeWithResilience(() => this.gateway.getProjects(limit, start));
    }

    /**
     * Fetch ALL projects via offset pagination (helper)
     */
    async getAllProjects(maxProjects = 500): Promise<JiraProject[]> {
        return this.executeWithResilience(() => this.gateway.getProjects(maxProjects, 0));
    }

    /**
     * Search issues using JQL
     */
    async searchIssues(jql: string, limit = 50, start = 0, additionalFields: string[] = []): Promise<JiraSearchResult> {
        return this.executeWithResilience(() => this.gateway.searchIssues(jql, limit, start, additionalFields));
    }

    /**
     * Get issues from a project
     */
    async getIssuesInProject(projectKey: string, limit = 50, start = 0, additionalFields: string[] = []): Promise<JiraSearchResult> {
        return this.executeWithResilience(() => this.gateway.getIssuesInProject(projectKey, limit, start, additionalFields));
    }

    /**
     * Get a single issue by key
     */
    async getIssue(issueKey: string, additionalFields: string[] = []): Promise<JiraIssue> {
        return this.executeWithResilience(() => this.gateway.getIssue(issueKey, additionalFields));
    }

    /**
     * Get all available fields in the Jira instance
     */
    async getFields(): Promise<any[]> {
        return this.executeWithResilience(() => this.gateway.getFields());
    }

    /**
     * Create a new issue in Jira
     */
    async createIssue(fields: any): Promise<any> {
        return this.executeWithResilience(() => this.gateway.createIssue(fields));
    }

    /**
     * Add a comment to an existing Jira issue
     */
    async addComment(issueKey: string, body: string): Promise<any> {
        return this.executeWithResilience(() => this.gateway.addComment(issueKey, body));
    }

    /**
     * Get available transitions for an issue
     */
    async getTransitions(issueKey: string): Promise<Array<{ id: string; name: string }>> {
        return this.executeWithResilience(() => this.gateway.getTransitions(issueKey));
    }

    /**
     * Transition an issue to a new status
     */
    async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
        return this.executeWithResilience(() => this.gateway.transitionIssue(issueKey, transitionId));
    }

    /**
     * Convert Jira issue to markdown content for knowledge ingestion
     */
    issueToMarkdown(issue: JiraIssue): string {
        const { fields, key } = issue;

        let content = `# ${key}: ${fields.summary}\n\n`;
        content += `**Status:** ${fields.status.name}\n`;
        content += `**Type:** ${fields.issuetype.name}\n`;
        content += `**Project:** ${fields.project.name} (${fields.project.key})\n`;

        if (fields.priority) {
            content += `**Priority:** ${fields.priority.name}\n`;
        }

        if (fields.reporter) {
            content += `**Reporter:** ${fields.reporter.displayName}\n`;
        }

        if (fields.assignee) {
            content += `**Assignee:** ${fields.assignee.displayName}\n`;
        }

        if (fields.labels && fields.labels.length > 0) {
            content += `**Labels:** ${fields.labels.join(', ')}\n`;
        }

        if (fields.components && fields.components.length > 0) {
            content += `**Components:** ${fields.components.map(c => c.name).join(', ')}\n`;
        }

        content += `**Created:** ${fields.created}\n`;
        content += `**Updated:** ${fields.updated}\n`;

        // Add additional custom fields
        const baseFieldKeys = [
            'summary', 'description', 'status', 'issuetype', 'project',
            'created', 'updated', 'reporter', 'assignee', 'priority',
            'labels', 'components', 'comment', 'attachment', 'worklog'
        ];

        const customFields = Object.keys(fields).filter(key => !baseFieldKeys.includes(key));
        if (customFields.length > 0) {
            content += `\n### Additional Fields\n`;
            customFields.forEach(key => {
                const value = (fields as any)[key];
                if (value !== null && value !== undefined) {
                    const label = key.startsWith('customfield_') ? key : key.charAt(0).toUpperCase() + key.slice(1);
                    // Handle objects (like user objects or status objects) recursively or simply
                    const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
                    content += `**${label}:** ${displayValue}\n`;
                }
            });
        }

        content += `\n---\n\n## Description\n\n`;

        if (fields.description) {
            // Jira description can be ADF (Atlassian Document Format) or plain text
            if (typeof fields.description === 'string') {
                content += fields.description;
            } else {
                // Convert ADF to plain text (simplified)
                content += this.adfToPlainText(fields.description);
            }
        } else {
            content += '*No description provided.*';
        }

        return content;
    }

    /**
     * Simple ADF to plain text converter
     */
    private adfToPlainText(adf: any): string {
        if (!adf || typeof adf !== 'object') return String(adf || '');

        if (adf.type === 'text') {
            return adf.text || '';
        }

        if (adf.content && Array.isArray(adf.content)) {
            return adf.content.map((node: any) => this.adfToPlainText(node)).join('');
        }

        // Handle paragraph and other block elements
        if (adf.type === 'paragraph' || adf.type === 'heading') {
            const text = adf.content ? adf.content.map((node: any) => this.adfToPlainText(node)).join('') : '';
            return text + '\n\n';
        }

        if (adf.type === 'bulletList' || adf.type === 'orderedList') {
            return adf.content ? adf.content.map((item: any) => '- ' + this.adfToPlainText(item)).join('\n') + '\n' : '';
        }

        if (adf.type === 'listItem') {
            return adf.content ? adf.content.map((node: any) => this.adfToPlainText(node)).join('') : '';
        }

        if (adf.type === 'codeBlock') {
            const code = adf.content ? adf.content.map((node: any) => this.adfToPlainText(node)).join('') : '';
            return '```\n' + code + '\n```\n';
        }

        return '';
    }
}

/**
 * Factory to create an authenticated Jira Client from a Credential ID.
 * Enforces strict Organization checks to prevent unauthorized access.
 */
export async function getJiraClient(credentialId: number, orgId: number | null): Promise<JiraClient> {
    // Fetch Credential (securely scoped to Org)
    const credential = await credentialsService.getById(credentialId, orgId, false);

    if (credential.type !== 'jira') {
        throw new Error(`Invalid credential type. Expected 'jira', got '${credential.type}'`);
    }

    const metadata = credential.metadata as any;
    const baseUrl = metadata.endpoint;
    const username = metadata.account;

    // Resolve API Token
    let apiToken = metadata.apiKey;
    if (!apiToken && credential.envVarName) {
        apiToken = (await resolveCredentialSecret(credential));
    }

    if (!baseUrl || !username || !apiToken) {
        throw new Error("Incomplete Jira credentials. Ensure Endpoint, Account, and API Key are configured.");
    }

    return new JiraClient(baseUrl, username, apiToken, orgId);
}


