
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScraperApiService");

export interface ScraperApiResponse {
    success: boolean;
    content: string;
    metadata?: any;
    error?: string;
}

export class ScraperApiService {
    /**
     * Executes a scrape using Firecrawl API
     */
    async firecrawl(url: string, apiKey?: string): Promise<ScraperApiResponse> {
        const key = apiKey || process.env.FIRECRAWL_API_KEY;
        if (!key) throw new Error("FIRECRAWL_API_KEY not configured");

        logger.info(`Executing Firecrawl scrape for: ${url}`);
        try {
            const response = await fetch("https://api.firecrawl.dev/v0/scrape", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                body: JSON.stringify({ url, wait_for: 3000, skip_robots: true, page_options: { only_main_content: true } })
            });

            if (!response.ok) {
                const err = await response.text();
                return { success: false, content: "", error: `Firecrawl error (${response.status}): ${err}` };
            }

            const data = await response.json();
            return { 
                success: true, 
                content: data.data?.content || data.data?.markdown || JSON.stringify(data.data),
                metadata: data.metadata 
            };
        } catch (e) {
            return { success: false, content: "", error: String(e) };
        }
    }

    /**
     * Executes an extraction using ScrapeGraph API
     */
    async scrapegraph(url: string, prompt: string, apiKey?: string): Promise<ScraperApiResponse> {
        const key = apiKey || process.env.SCRAPEGRAPH_API_KEY;
        if (!key) throw new Error("SCRAPEGRAPH_API_KEY not configured");

        logger.info(`Executing ScrapeGraph extraction for: ${url}`);
        try {
            const response = await fetch("https://api.scrapegraph.ai/v1/smart_extract", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                body: JSON.stringify({ 
                    url, 
                    user_prompt: prompt || "Extract all relevant information from this page in structured format.",
                    output_format: "json"
                })
            });

            if (!response.ok) {
                const err = await response.text();
                return { success: false, content: "", error: `ScrapeGraph error (${response.status}): ${err}` };
            }

            const data = await response.json();
            return { 
                success: true, 
                content: typeof data.result === 'string' ? data.result : JSON.stringify(data.result),
                metadata: data.usage 
            };
        } catch (e) {
            return { success: false, content: "", error: String(e) };
        }
    }
}

export const scraperApiService = new ScraperApiService();
