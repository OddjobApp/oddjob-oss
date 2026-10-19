
import { BaseGateway, type GatewayResponse } from "./base-gateway.js";

export interface JiraIssue {
    id: string;
    key: string;
    self: string;
    fields: {
        summary: string;
        description: string | null;
        status: {
            name: string;
        };
        issuetype: {
            name: string;
        };
        project: {
            key: string;
            name: string;
        };
        created: string;
        updated: string;
        reporter?: {
            displayName: string;
            emailAddress?: string;
        };
        assignee?: {
            displayName: string;
            emailAddress?: string;
        } | null;
        priority?: {
            name: string;
        };
        labels?: string[];
        components?: { name: string }[];
    };
}

export interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
}

export interface JiraSearchResult {
    issues: JiraIssue[];
    // Legacy /search fields — NOT returned by the newer /rest/api/3/search/jql
    // endpoint (token-paginated), so treat them as optional. Do not rely on
    // `total` as a success signal; check `issues` instead.
    startAt?: number;
    maxResults?: number;
    total?: number;
    // /search/jql pagination fields
    isLast?: boolean;
    nextPageToken?: string;
}

export class JiraGateway extends BaseGateway {
    protected readonly platform = 'jira';
    private baseUrl: string;
    private username: string;
    private apiToken: string;
    private orgId: number | null;

    constructor(baseUrl: string, username: string, apiToken: string, orgId: number | null = null) {
        super();
        this.baseUrl = baseUrl.replace(/\/+$/, ''); // Ensure no trailing slash
        this.username = username;
        this.apiToken = apiToken;
        this.orgId = orgId;
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }

    private getAuthHeader() {
        const credentials = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');
        return {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    }

    /**
     * List all projects
     */
    async getProjects(limit = 50, start = 0): Promise<JiraProject[]> {
        let allProjects: JiraProject[] = [];
        let currentStart = start;
        let hasMore = true;
        const batchSize = 50;

        while (hasMore && allProjects.length < limit) {
            const requestedBatch = Math.min(batchSize, limit - allProjects.length);
            const url = new URL(`${this.baseUrl}/rest/api/3/project/search`);
            url.searchParams.append('maxResults', requestedBatch.toString());
            url.searchParams.append('startAt', currentStart.toString());

            const response = await this.request({
                action: 'get_projects',
                method: 'GET',
                url: url.toString(),
                headers: this.getAuthHeader(),
                organizationId: this.orgId
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Failed to fetch Jira projects at start ${currentStart}: ${response.status} ${JSON.stringify(response.body)}`);
            }

            const batch = response.body.values || [];
            allProjects = allProjects.concat(batch);
            
            hasMore = !response.body.isLast && batch.length === requestedBatch;
            currentStart += batch.length;

            if (batch.length === 0) break;
        }

        return allProjects;
    }

    /**
     * Search issues using JQL
     */
    async searchIssues(jql: string, limit = 50, start = 0, additionalFields: string[] = []): Promise<JiraSearchResult> {
        const url = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
        url.searchParams.append('jql', jql);
        url.searchParams.append('startAt', start.toString());
        url.searchParams.append('maxResults', limit.toString());

        const baseFields = [
            'summary',
            'description',
            'status',
            'issuetype',
            'project',
            'created',
            'updated',
            'reporter',
            'assignee',
            'priority',
            'labels',
            'components'
        ];
        // Merge base fields with additional custom fields, removing duplicates
        const fields = Array.from(new Set([...baseFields, ...additionalFields]));
        url.searchParams.append('fields', fields.join(','));

        const response = await this.request({
            action: 'search_issues',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to search Jira issues: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body as JiraSearchResult;
    }

    /**
     * Get issues from a project
     */
    async getIssuesInProject(projectKey: string, limit = 50, start = 0, additionalFields: string[] = []): Promise<JiraSearchResult> {
        const jql = `project = "${projectKey}" ORDER BY updated DESC`;
        return this.searchIssues(jql, limit, start, additionalFields);
    }

    /**
     * Get a single issue by key
     */
    async getIssue(issueKey: string, additionalFields: string[] = []): Promise<JiraIssue> {
        const url = new URL(`${this.baseUrl}/rest/api/3/issue/${issueKey}`);
        
        const baseFields = [
            'summary',
            'description',
            'status',
            'issuetype',
            'project',
            'created',
            'updated',
            'reporter',
            'assignee',
            'priority',
            'labels',
            'components'
        ];
        const fields = Array.from(new Set([...baseFields, ...additionalFields]));
        url.searchParams.append('fields', fields.join(','));

        const response = await this.request({
            action: 'get_issue',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to fetch issue ${issueKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body as JiraIssue;
    }

    /**
     * Get all available fields in the Jira instance
     */
    async getFields(): Promise<any[]> {
        const url = new URL(`${this.baseUrl}/rest/api/3/field`);

        const response = await this.request({
            action: 'get_fields',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to fetch Jira fields: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body as any[];
    }

    /**
     * Create a new issue in Jira
     */
    async createIssue(fields: any): Promise<any> {
        const url = new URL(`${this.baseUrl}/rest/api/3/issue`);

        const response = await this.request({
            action: 'create_issue',
            method: 'POST',
            url: url.toString(),
            headers: this.getAuthHeader(),
            body: { fields },
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to create Jira issue: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body;
    }

    /**
     * Add a comment to an existing Jira issue
     */
    async addComment(issueKey: string, body: string): Promise<any> {
        const url = new URL(`${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`);

        const response = await this.request({
            action: 'add_comment',
            method: 'POST',
            url: url.toString(),
            headers: this.getAuthHeader(),
            body: {
                body: typeof body === 'string' ? {
                    type: 'doc',
                    version: 1,
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }]
                } : body
            },
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to add comment to issue ${issueKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body;
    }

    /**
     * Get available transitions for an issue
     */
    async getTransitions(issueKey: string): Promise<Array<{ id: string; name: string }>> {
        const url = new URL(`${this.baseUrl}/rest/api/3/issue/${issueKey}/transitions`);

        const response = await this.request({
            action: 'get_transitions',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to get transitions for ${issueKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        const transitions = (response.body as any)?.transitions ?? [];
        return transitions.map((t: any) => ({ id: t.id, name: t.name }));
    }

    /**
     * Transition an issue to a new status
     */
    async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
        const url = new URL(`${this.baseUrl}/rest/api/3/issue/${issueKey}/transitions`);

        const response = await this.request({
            action: 'transition_issue',
            method: 'POST',
            url: url.toString(),
            headers: this.getAuthHeader(),
            body: { transition: { id: transitionId } },
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to transition ${issueKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }
    }
}

