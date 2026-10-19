
import { BaseGateway } from "./base-gateway.js";
import TurndownService from 'turndown';

export interface ConfluencePage {
    id: string;
    title: string;
    body: {
        storage: {
            value: string;
        };
        view?: {
            value: string;
        }
    };
    version: {
        number: number;
    };
    space: {
        key: string;
        name: string;
    };
    _links: {
        webui: string;
        tinyui: string;
    };
}

export interface ConfluenceSpace {
    id: number;
    key: string;
    name: string;
    type: string;
    _links: {
        webui: string;
    };
}

export class ConfluenceGateway extends BaseGateway {
    protected readonly platform = 'confluence';
    private baseUrl: string;
    private username: string;
    private apiToken: string;
    private orgId: number | null;

    constructor(baseUrl: string, username: string, apiToken: string, orgId: number | null = null) {
        super();
        this.baseUrl = baseUrl.replace(/\/+$/, ''); // Ensure no trailing slash

        // Auto-fix for Confluence Cloud: Append /wiki if missing
        if (this.baseUrl.includes('.atlassian.net') && !this.baseUrl.endsWith('/wiki')) {
            this.baseUrl += '/wiki';
        }

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
     * List all spaces
     */
    async getSpaces(limit = 25, start = 0): Promise<ConfluenceSpace[]> {
        let allSpaces: ConfluenceSpace[] = [];
        let currentStart = start;
        let hasMore = true;
        const batchSize = 25;

        while (hasMore && allSpaces.length < limit) {
            const requestedBatch = Math.min(batchSize, limit - allSpaces.length);
            const url = new URL(`${this.baseUrl}/rest/api/space`);
            url.searchParams.append('limit', requestedBatch.toString());
            url.searchParams.append('start', currentStart.toString());
            url.searchParams.append('type', 'global');

            const response = await this.request({
                action: 'get_spaces',
                method: 'GET',
                url: url.toString(),
                headers: this.getAuthHeader(),
                organizationId: this.orgId
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Failed to fetch Confluence spaces at start ${currentStart}: ${response.status} ${JSON.stringify(response.body)}`);
            }

            const batch = response.body.results || [];
            allSpaces = allSpaces.concat(batch);
            
            // In Confluence REST API V1, _links.next exists if there are more
            hasMore = !!response.body._links?.next && batch.length === requestedBatch;
            currentStart += batch.length;

            if (batch.length === 0) break;
        }

        return allSpaces;
    }

    /**
     * Get all pages from a specific space
     */
    async getPagesInSpace(spaceKey: string, limit = 25, start = 0): Promise<ConfluencePage[]> {
        const url = new URL(`${this.baseUrl}/rest/api/content`);
        url.searchParams.append('spaceKey', spaceKey);
        url.searchParams.append('type', 'page');
        url.searchParams.append('expand', 'body.storage,version,space,history,children.comment,metadata.labels,children.attachment');
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('start', start.toString());
        url.searchParams.append('status', 'current');

        const response = await this.request({
            action: 'get_pages_in_space',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to fetch pages for space ${spaceKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body.results;
    }

    /**
     * Resolve a Space Key to a Space ID (required for many V2 endpoints)
     */
    async getSpaceIdByKey(spaceKey: string): Promise<string> {
        const url = new URL(`${this.baseUrl}/api/v2/spaces`);
        url.searchParams.append('keys', spaceKey);

        const response = await this.request({
            action: 'get_space_id_by_key',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to resolve space key ${spaceKey}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        if (!response.body.results || response.body.results.length === 0) {
            throw new Error(`Space with key ${spaceKey} not found`);
        }

        return response.body.results[0].id;
    }

    /**
     * Search pages using API V2
     */
    async searchPagesV2(query: string, spaceId?: string, limit = 25): Promise<any[]> {
        const url = new URL(`${this.baseUrl}/api/v2/pages`);
        url.searchParams.append('title', query); // Simple title match for now
        if (spaceId) {
            url.searchParams.append('space-id', spaceId);
        }
        url.searchParams.append('limit', limit.toString());

        const response = await this.request({
            action: 'search_pages_v2',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to search Confluence pages (V2): ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body.results;
    }

    /**
     * Get a single page by ID using API V2 (with storage format)
     */
    async getPageV2(pageId: string): Promise<any> {
        const url = new URL(`${this.baseUrl}/api/v2/pages/${pageId}`);
        url.searchParams.append('body-format', 'storage');

        const response = await this.request({
            action: 'get_page_v2',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to fetch page ${pageId} (V2): ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body;
    }

    /**
     * Get a single page by ID
     */
    async getPage(pageId: string): Promise<ConfluencePage> {
        const url = new URL(`${this.baseUrl}/rest/api/content/${pageId}`);
        url.searchParams.append('expand', 'body.storage,version,space,history,children.comment,metadata.labels,children.attachment');

        const response = await this.request({
            action: 'get_page',
            method: 'GET',
            url: url.toString(),
            headers: this.getAuthHeader(),
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to fetch page ${pageId}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body as ConfluencePage;
    }

    /**
     * Convert HTML content (from Confluence) to Markdown
     */
    convertToMarkdown(html: string): string {
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*'
        });

        return turndownService.turndown(html);
    }

    /**
     * Create a new Confluence page using V2 API
     */
    async createPage(spaceKey: string, title: string, content: string, parentPageId?: string): Promise<any> {
        const spaceId = await this.getSpaceIdByKey(spaceKey);
        const url = `${this.baseUrl}/api/v2/pages`;
        const body: any = {
            spaceId,
            status: "current",
            title,
            body: {
                representation: "storage",
                value: content
            }
        };
        if (parentPageId) {
            body.parentId = parentPageId;
        }

        const response = await this.request({
            action: 'create_page',
            method: 'POST',
            url,
            headers: this.getAuthHeader(),
            body,
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to create Confluence page: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body;
    }

    /**
     * Update an existing Confluence page using V2 API
     */
    async updatePage(pageId: string, title: string, content: string, version: number): Promise<any> {
        const url = `${this.baseUrl}/api/v2/pages/${pageId}`;
        const body = {
            id: pageId,
            status: "current",
            title,
            body: {
                representation: "storage",
                value: content
            },
            version: {
                number: version,
                message: "Updated via Oddjob Agent"
            }
        };

        const response = await this.request({
            action: 'update_page',
            method: 'PUT',
            url,
            headers: this.getAuthHeader(),
            body,
            organizationId: this.orgId
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Failed to update Confluence page ${pageId}: ${response.status} ${JSON.stringify(response.body)}`);
        }

        return response.body;
    }
}

