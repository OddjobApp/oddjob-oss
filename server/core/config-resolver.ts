/**
 * Configuration Resolver Bridge
 * 
 * Provides a centralized way to resolve system and provider configurations.
 * Delegates to domain-specific resolvers while maintaining a clean core API.
 */

import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";

export const configResolver = {
  /**
   * Resolve an AI provider by name.
   */
  async resolveAIProvider(provider: string) {
    const config = await aiConfigResolver.resolveProviderCredential(provider);
    if (!config) {
      throw new Error(`AI Provider "${provider}" not found or not configured.`);
    }
    return config;
  },

  /**
   * Resolve specific system configuration keys.
   */
  async resolveSystemConfig(serviceKey: 'concierge' | 'copilot' | 'faultAnalysis') {
    return await aiConfigResolver.resolveSystemConfig(serviceKey);
  }
};
