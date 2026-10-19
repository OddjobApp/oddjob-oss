/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAiConfig = vi.hoisted(() => vi.fn());
vi.mock("@domain/ai/core/system-ai.service.js", () => ({ systemAiService: { getAiConfig: getAiConfig } }));

import {
    createComputerUseLoop,
    resolveComputerUseProviderConfig,
    resolveAndCreateComputerUseLoop,
} from "./computer-use-provider.service.js";

beforeEach(() => {
    getAiConfig.mockReset();
});

describe("resolveComputerUseProviderConfig", () => {
    it("reads the copilot system config and returns the resolved provider", async () => {
        getAiConfig.mockResolvedValue({ provider: "google", model: "gemini-3.8-flash", apiKey: "key-1" });
        const config = await resolveComputerUseProviderConfig(7);
        expect(config).toEqual({ provider: "google", model: "gemini-3.8-flash", apiKey: "key-1", baseUrl: undefined });
        expect(getAiConfig).toHaveBeenCalledWith("copilot", 7);
    });

    it("supports anthropic when copilot is configured for Claude", async () => {
        getAiConfig.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4", apiKey: "key-2" });
        const config = await resolveComputerUseProviderConfig(8);
        expect(config).toEqual({ provider: "anthropic", model: "claude-sonnet-4", apiKey: "key-2", baseUrl: undefined });
    });

    it("fails when no primary model is configured", async () => {
        getAiConfig.mockResolvedValue(null);
        await expect(resolveComputerUseProviderConfig(7)).rejects.toThrow(/No primary AI model configured/);
    });

    it("fails when the resolved key is missing", async () => {
        getAiConfig.mockResolvedValue({ provider: "google", model: "gemini-3.8-flash", apiKey: undefined });
        await expect(resolveComputerUseProviderConfig(7)).rejects.toThrow(/no resolved API key/);
    });

    it("fails for unsupported providers", async () => {
        getAiConfig.mockResolvedValue({ provider: "openai", model: "gpt-4o", apiKey: "key-3" });
        await expect(resolveComputerUseProviderConfig(7)).rejects.toThrow(/does not support provider/);
    });
});

describe("createComputerUseLoop", () => {
    it("returns a Gemini driver for google", () => {
        const driver = createComputerUseLoop({ provider: "google", model: "gemini-3.8-flash", apiKey: "k" });
        expect(driver.runLoop).toBeTypeOf("function");
    });

    it("returns an Anthropic driver for anthropic", () => {
        const driver = createComputerUseLoop({ provider: "anthropic", model: "claude-sonnet-4", apiKey: "k" });
        expect(driver.runLoop).toBeTypeOf("function");
    });
});

describe("resolveAndCreateComputerUseLoop", () => {
    it("returns a driver for the resolved config", async () => {
        getAiConfig.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4", apiKey: "key-2" });
        const { config, driver } = await resolveAndCreateComputerUseLoop(8);
        expect(config.provider).toBe("anthropic");
        expect(driver.runLoop).toBeTypeOf("function");
    });
});
