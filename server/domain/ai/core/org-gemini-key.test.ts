import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveConnection = vi.fn();
vi.mock("./org-model.service.js", () => ({ orgModelService: { resolve: (...args: unknown[]) => resolveConnection(...args) } }));

const { resolveOrgGeminiKey, resolveOrgTextAiKey } = await import("./org-gemini-key.js");

const env = { ...process.env };

describe("resolveOrgGeminiKey", () => {
    beforeEach(() => {
        resolveConnection.mockReset();
        process.env.GEMINI_API_KEY = "platform-key";
        delete process.env.GOOGLE_API_KEY;
    });
    afterEach(() => {
        process.env = { ...env };
    });

    it("bills the organization's own key when it has one", async () => {
        resolveConnection.mockResolvedValue({ apiKey: "org-key", model: "gemini-2.5-flash" });
        expect(await resolveOrgGeminiKey(7)).toBe("org-key");
        expect(resolveConnection).toHaveBeenCalledWith(7, "google");
    });

    it("never falls back to the platform key in production", async () => {
        process.env.NODE_ENV = "production";
        resolveConnection.mockResolvedValue(null);
        expect(await resolveOrgGeminiKey(7)).toBeNull();
        expect(await resolveOrgGeminiKey(null)).toBeNull();
    });

    it("lets the platform key stand in outside production", async () => {
        process.env.NODE_ENV = "development";
        resolveConnection.mockResolvedValue(null);
        expect(await resolveOrgGeminiKey(7)).toBe("platform-key");
    });
});

describe("resolveOrgTextAiKey", () => {
    beforeEach(() => {
        resolveConnection.mockReset();
        process.env.GEMINI_API_KEY = "platform-key";
    });
    afterEach(() => {
        process.env = { ...env };
    });

    it("accepts any connected provider, not only Gemini", async () => {
        // An org on Amazon Bedrock alone was told to connect a Gemini key.
        resolveConnection.mockResolvedValue({ provider: "bedrock", apiKey: "bedrock-key", model: "us.anthropic.claude-sonnet-4-6" });
        expect(await resolveOrgTextAiKey(7)).toBe("bedrock-key");
        expect(resolveConnection).toHaveBeenCalledWith(7);
    });

    it("is null in production when the organization connected no provider", async () => {
        process.env.NODE_ENV = "production";
        resolveConnection.mockResolvedValue(null);
        expect(await resolveOrgTextAiKey(7)).toBeNull();
    });

    it("uses the platform key for the requested provider outside production", async () => {
        process.env.NODE_ENV = "development";
        process.env.OPENAI_API_KEY = "platform-openai";
        resolveConnection.mockResolvedValue(null);
        expect(await resolveOrgTextAiKey(7)).toBe("platform-key");
        expect(await resolveOrgTextAiKey(7, "openai")).toBe("platform-openai");
    });
});
