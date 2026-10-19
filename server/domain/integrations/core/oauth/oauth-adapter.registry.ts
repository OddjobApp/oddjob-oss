/**
 * OAuth Adapter Registry
 * 
 * Central registry and dispatcher for all platform OAuth adapters.
 */

import type { OAuthAdapter } from "./oauth-adapter.types.js";
import { jiraOAuthAdapter } from "./jira-oauth.adapter.js";
import { googleOAuthAdapter } from "./google-oauth.adapter.js";
import { slackOAuthAdapter } from "./slack-oauth.adapter.js";
import { microsoftOAuthAdapter } from "./microsoft-oauth.adapter.js";
import { quickBooksOAuthAdapter } from './quickbooks-oauth.adapter.js';
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OAuthAdapterRegistry");

export class OAuthAdapterRegistry {
    private static instance: OAuthAdapterRegistry;
    private adapters: Map<string, OAuthAdapter> = new Map();

    private constructor() {
        this.register(jiraOAuthAdapter);
        this.register(googleOAuthAdapter);
        this.register(slackOAuthAdapter);
        this.register(microsoftOAuthAdapter);
        this.register(quickBooksOAuthAdapter);
    }

    public static getInstance(): OAuthAdapterRegistry {
        if (!OAuthAdapterRegistry.instance) {
            OAuthAdapterRegistry.instance = new OAuthAdapterRegistry();
        }
        return OAuthAdapterRegistry.instance;
    }

    /**
     * Registers an OAuth adapter instance.
     */
    public register(adapter: OAuthAdapter): void {
        this.adapters.set(adapter.platform.toLowerCase(), adapter);
        logger.debug(`Registered OAuth adapter for platform '${adapter.platform}'`);
    }

    /**
     * Retrieves an adapter by platform name.
     */
    public getAdapter(platform: string): OAuthAdapter | undefined {
        return this.adapters.get(platform.toLowerCase());
    }

    /**
     * Retrieves an adapter or throws an error if unsupported.
     */
    public requireAdapter(platform: string): OAuthAdapter {
        const adapter = this.getAdapter(platform);
        if (!adapter) {
            throw new Error(`Unsupported OAuth platform: '${platform}'. Available platforms: ${Array.from(this.adapters.keys()).join(", ")}`);
        }
        return adapter;
    }

    /**
     * Lists all registered platform identifiers.
     */
    public getRegisteredPlatforms(): string[] {
        return Array.from(this.adapters.keys());
    }
}

export const oauthAdapterRegistry = OAuthAdapterRegistry.getInstance();
