
import { SeleniumConfig } from "@shared/schema/index.js";

export interface UnblockingConfig {
    provider: "none" | "scrapingbee" | "brightdata" | "zenrows";
    apiKey?: string;
    proxyUrl?: string;
}

export class UnblockingService {
    /**
     * Resolves proxy and unblocking headers/options based on config
     */
    resolveConfig(config: SeleniumConfig): any {
        const proxy = config.proxy;
        if (!proxy || proxy.provider === "none") {
            return null;
        }

        switch (proxy.provider) {
            case "scrapingbee":
                return this.resolveScrapingBee(proxy);
            case "brightdata":
                return this.resolveBrightData(proxy);
            case "zenrows":
                return this.resolveZenRows(proxy);
            default:
                return null;
        }
    }

    private resolveScrapingBee(proxy: any) {
        // ScrapingBee typically uses a simple proxy port or API endpoint
        // For Playwright, we can return the proxy server URL
        const apiKey = proxy.password || process.env.SCRAPINGBEE_API_KEY;
        return {
            server: `http://proxy.scrapingbee.com:8888`,
            username: apiKey,
            password: ""
        };
    }

    private resolveBrightData(proxy: any) {
        // Bright Data (formerly Luminati)
        const host = "brd.superproxy.io:22225";
        return {
            server: `http://${host}`,
            username: proxy.username,
            password: proxy.password
        };
    }

    private resolveZenRows(proxy: any) {
        // ZenRows proxy endpoint
        const apiKey = proxy.password || process.env.ZENROWS_API_KEY;
        return {
            server: `http://proxy.zenrows.com:8001`,
            username: apiKey,
            password: ""
        };
    }
}

export const unblockingService = new UnblockingService();




