import { ConfluenceGateway, type ConfluencePage, type ConfluenceSpace } from "../../integrations/confluence-gateway.js";
import { CircuitBreaker } from "../jobs/core/utils/circuit-breaker.js";
import { withRetry } from "../jobs/core/utils/retry.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export { ConfluencePage, ConfluenceSpace };

export class ConfluenceClient {
    private gateway: ConfluenceGateway;
    private circuitBreaker: CircuitBreaker;

    constructor(baseUrl: string, username: string, apiToken: string, orgId: number | null = null) {
        this.gateway = new ConfluenceGateway(baseUrl, username, apiToken, orgId);
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
     * List all spaces
     */
    async getSpaces(limit = 25, start = 0): Promise<ConfluenceSpace[]> {
        return this.executeWithResilience(() => this.gateway.getSpaces(limit, start));
    }

    /**
     * Get all pages from a specific space
     */
    async getPagesInSpace(spaceKey: string, limit = 25, start = 0): Promise<ConfluencePage[]> {
        return this.executeWithResilience(() => this.gateway.getPagesInSpace(spaceKey, limit, start));
    }

    /**
     * Fetch ALL pages in a space via offset pagination.
     * Stops when a batch is smaller than pageSize or the total reaches maxPages.
     */
    async getAllPagesInSpace(spaceKey: string, pageSize = 50, maxPages = 1000): Promise<ConfluencePage[]> {
        const all: ConfluencePage[] = [];
        let start = 0;

        while (all.length < maxPages) {
            const batch = await this.getPagesInSpace(spaceKey, pageSize, start);
            all.push(...batch);
            if (batch.length < pageSize) break;
            start += pageSize;
        }

        return all;
    }

    /**
     * Fetch ALL spaces via offset pagination.
     */
    async getAllSpaces(pageSize = 50, maxSpaces = 500): Promise<ConfluenceSpace[]> {
        const all: ConfluenceSpace[] = [];
        let start = 0;

        while (all.length < maxSpaces) {
            const batch = await this.getSpaces(pageSize, start);
            all.push(...batch);
            if (batch.length < pageSize) break;
            start += pageSize;
        }

        return all;
    }

    /**
     * Get a single page by ID
     */
    async getPage(pageId: string): Promise<ConfluencePage> {
        return this.executeWithResilience(() => this.gateway.getPage(pageId));
    }

    /**
     * Resolve a Space Key to a Space ID
     */
    async getSpaceIdByKey(spaceKey: string): Promise<string> {
        return this.executeWithResilience(() => this.gateway.getSpaceIdByKey(spaceKey));
    }

    /**
     * Search pages using API V2
     */
    async searchPagesV2(query: string, spaceId?: string, limit = 25): Promise<any[]> {
        return this.executeWithResilience(() => this.gateway.searchPagesV2(query, spaceId, limit));
    }

    /**
     * Get a single page by ID using API V2
     */
    async getPageV2(pageId: string): Promise<any> {
        return this.executeWithResilience(() => this.gateway.getPageV2(pageId));
    }

    /**
     * Convert HTML content (from Confluence) to Markdown
     */
    convertToMarkdown(html: string): string {
        return this.gateway.convertToMarkdown(html);
    }

    /**
     * Create a page in Confluence
     */
    async createPage(spaceKey: string, title: string, content: string, parentPageId?: string): Promise<any> {
        return this.executeWithResilience(() => this.gateway.createPage(spaceKey, title, content, parentPageId));
    }

    /**
     * Update a page in Confluence
     */
    async updatePage(pageId: string, title: string, content: string, version: number): Promise<any> {
        return this.executeWithResilience(() => this.gateway.updatePage(pageId, title, content, version));
    }
}

/**
 * Factory to create an authenticated Confluence Client from a Credential ID.
 */
export async function getConfluenceClient(credentialId: number, orgId: number | null) {
    const { credentialsService } = await import("../auth/core/credentials-service.js");
    const credential = await credentialsService.getById(credentialId, orgId, false);

    if (credential.type !== 'confluence') {
        throw new Error(`Invalid credential type. Expected 'confluence', got '${credential.type}'`);
    }

    const metadata = credential.metadata as any;
    const baseUrl = metadata.endpoint;
    const username = metadata.account;

    let apiToken = metadata.apiKey;
    if (!apiToken && credential.envVarName) {
        apiToken = (await resolveCredentialSecret(credential));
    }

    if (!baseUrl || !username || !apiToken) {
        throw new Error("Incomplete Confluence credentials. Ensure Endpoint, Account, and API Key are configured.");
    }

    return new ConfluenceClient(baseUrl, username, apiToken, orgId);
}


