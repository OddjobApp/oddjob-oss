/**
 * Resolve the AI provider that drives computer-use tasks.
 *
 * Computer use follows the primary orchestration model (the `copilot` system
 * service config). If that model is Gemini, we use the Gemini Interactions loop;
 * if it is Anthropic, we use the Anthropic Messages API with the computer-use
 * tool. Other providers fail fast with a clear message.
 */

import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { createLogger } from "../../../utils/logger.js";
import type { ComputerUseLoopDriver, ComputerUseProviderConfig } from "./computer-use-loop.js";
import { createGeminiComputerUseLoop, systemInstruction as geminiSystemInstruction } from "./gemini-computer-use.js";
import { createAnthropicComputerUseLoop } from "./anthropic-computer-use.js";

const logger = createLogger("ComputerUseProvider");

const SUPPORTED_PROVIDERS = new Set<string>(["google", "anthropic"]);

export async function resolveComputerUseProviderConfig(
    organizationId: number,
): Promise<ComputerUseProviderConfig> {
    const config = await systemAiService.getAiConfig("copilot", organizationId);
    if (!config) {
        throw new Error("No primary AI model configured for this organization. Connect an AI provider in Organization Settings.");
    }
    if (!config.apiKey) {
        throw new Error(`Primary AI model ${config.provider}/${config.model} has no resolved API key.`);
    }
    if (!SUPPORTED_PROVIDERS.has(config.provider)) {
        throw new Error(
            `Computer use does not support provider "${config.provider}". ` +
            `Configure the primary model to Google Gemini or Anthropic Claude.`,
        );
    }
    logger.info("Resolved computer-use provider", {
        organizationId,
        provider: config.provider,
        model: config.model,
    });
    return {
        provider: config.provider as "google" | "anthropic",
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
    };
}

export function createComputerUseLoop(config: ComputerUseProviderConfig): ComputerUseLoopDriver {
    if (config.provider === "google") {
        return createGeminiComputerUseLoop({
            apiKey: config.apiKey,
            model: config.model,
            systemInstruction: geminiSystemInstruction(),
        });
    }
    return createAnthropicComputerUseLoop({
        apiKey: config.apiKey,
        model: config.model,
    });
}

export async function resolveAndCreateComputerUseLoop(
    organizationId: number,
): Promise<{ config: ComputerUseProviderConfig; driver: ComputerUseLoopDriver }> {
    const config = await resolveComputerUseProviderConfig(organizationId);
    return { config, driver: createComputerUseLoop(config) };
}
