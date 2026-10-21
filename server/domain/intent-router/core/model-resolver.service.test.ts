/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveConnection: vi.fn(), registryRows: [] as unknown[], select: vi.fn() }));
vi.mock("@domain/ai/core/org-model.service.js", () => ({ orgModelService: { resolve: mocks.resolveConnection } }));
vi.mock("@server/database_service.js", () => {
    // Every registry query ends in limit(); it answers with the rows the test set.
    const chain: Record<string, unknown> = {};
    for (const step of ["from", "innerJoin", "where", "orderBy"]) chain[step] = () => chain;
    chain.limit = async () => mocks.registryRows;
    return { db: { select: (...args: unknown[]) => { mocks.select(...args); return chain; } } };
});
import { ModelResolverService } from "./model-resolver.service.js";

const unboundCard = { id: 1, name: "Copilot", modelBindingProviderId: null, modelBindingModelId: null } as any;
const boundCard = { id: 2, name: "Analyst", modelBindingProviderId: 5, modelBindingModelId: 9 } as any;

describe("model resolution for an organization's own AI key", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.registryRows = [];
    });

    it("resolves an unbound card to the connected key instead of failing for want of a registry default", async () => {
        mocks.resolveConnection.mockResolvedValue({ provider: "bedrock", model: "us.anthropic.claude-sonnet-4-6", apiKey: "k", credentialId: 0 });
        const result = await new ModelResolverService().resolve(unboundCard, 1);
        expect(mocks.resolveConnection).toHaveBeenCalledWith(1);
        expect(result).toEqual({
            providerId: null, modelId: null, providerName: "Amazon Bedrock (Claude)",
            providerTechnicalName: "bedrock", modelIdentifier: "us.anthropic.claude-sonnet-4-6", isFallback: false,
        });
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it("reports the connected key even for a bound card, because that key is what answers", async () => {
        mocks.resolveConnection.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "k", credentialId: 0 });
        const result = await new ModelResolverService().resolve(boundCard, 1);
        expect(result).toMatchObject({ providerTechnicalName: "anthropic", modelIdentifier: "claude-sonnet-4-6", providerId: null });
    });

    it("keeps the registry path for an organization with no key, and still says when nothing is configured", async () => {
        mocks.resolveConnection.mockResolvedValue(null);
        await expect(new ModelResolverService().resolve(unboundCard, 1))
            .rejects.toThrow("No available model provider: primary provider unavailable and no org default configured for org 1");
        expect(mocks.select).toHaveBeenCalled();
    });

    it("falls back to the registry when the key lookup itself fails", async () => {
        mocks.resolveConnection.mockRejectedValue(new Error("A valid organization is required"));
        await expect(new ModelResolverService().resolve(unboundCard, 0)).rejects.toThrow("No available model provider");
        expect(mocks.select).toHaveBeenCalled();
    });
});
