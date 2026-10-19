import { BaseGateway, type GatewayResponse } from "./base.gateway.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PythonGateway");

export class PythonGateway extends BaseGateway {
    protected readonly platform = 'python';
    private readonly baseUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_SIDECAR_URL || 'http://localhost:8001';

    /**
     * Check if the Python sidecar is healthy
     */
    async isHealthy(): Promise<boolean> {
        try {
            const res = await this.request({
                action: 'health_check',
                url: `${this.baseUrl}/health`,
                method: 'GET'
            });
            return res.status === 200;
        } catch (err) {
            return false;
        }
    }

    /**
     * Execute a Python script
     */
    async executeScript(script: string, inputData: any): Promise<any> {
        const res = await this.request({
            action: 'execute_script',
            url: `${this.baseUrl}/execute`,
            method: 'POST',
            body: { script, input_data: inputData }
        });
        return res.body;
    }

    /**
     * Parse a PDF file
     */
    async parsePdf(buffer: Buffer): Promise<any> {
        // In a real implementation, this might be a multipart upload
        // But for now, we'll assume the sidecar accepts base64 or similar if needed
        // Or we use a specific endpoint. 
        const res = await this.request({
            action: 'parse_pdf',
            url: `${this.baseUrl}/parse-pdf`,
            method: 'POST',
            body: { file_data: buffer.toString('base64') }
        });
        return res.body;
    }

    /**
     * Scrape a URL
     */
    async scrape(url: string, options: any = {}): Promise<any> {
        const res = await this.request({
            action: 'scrape',
            url: `${this.baseUrl}/scrape`,
            method: 'POST',
            body: { url, ...options }
        });
        return res.body;
    }

    /**
     * Generate embeddings for text via Python sidecar (SentenceTransformers/local models)
     */
    async generateEmbedding(text: string, model?: string): Promise<number[] | null> {
        try {
            const res = await this.request({
                action: 'generate_embedding',
                url: `${this.baseUrl}/api/v1/embed`,
                method: 'POST',
                body: { text, model }
            });
            
            // The Python service returns { embedding: number[], model: string, ... }
            return (res.body as any)?.embedding || null;
        } catch (err) {
            logger.error('Python embedding generation failed', { err });
            return null;
        }
    }

    /**
     * Rank nodes using Python graph algorithms (PageRank)
     */
    async rankNodes(nodes: any[], edges: any[]): Promise<Record<string, number> | null> {
        try {
            const res = await this.request({
                action: 'rank_nodes',
                url: `${this.baseUrl}/api/v1/graph/rank`,
                method: 'POST',
                body: { nodes, edges }
            });
            return (res.body as any)?.scores || null;
        } catch (err) {
            logger.error('Python graph ranking failed', { err });
            return null;
        }
    }

    /**
     * Perform full graph traversal and ranking in Python (optimized)
     */
    async traverseGraph(seedNodeIds: number[], options: { maxHops?: number, limit?: number } = {}): Promise<any | null> {
        try {
            const res = await this.request({
                action: 'traverse_graph',
                url: `${this.baseUrl}/api/v1/graph/traverse`,
                method: 'POST',
                body: { 
                    seed_node_ids: seedNodeIds,
                    max_hops: options.maxHops || 2,
                    limit: options.limit || 100
                }
            });
            return res.body || null;
        } catch (err) {
            logger.error('Python graph traversal failed', { err });
            return null;
        }
    }

    /**
     * Specialized execution for internal Python sidecar
     */
    async execute(
        action: string,
        url: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
        body?: any,
        orgId: number | null = null
    ): Promise<GatewayResponse> {
        return this.request({
            action,
            url,
            method,
            body,
            organizationId: orgId
        });
    }
}

export const pythonGateway = new PythonGateway();
export const pythonBridge = pythonGateway;


