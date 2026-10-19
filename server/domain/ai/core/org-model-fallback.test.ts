/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * An organization's own Gemini key is OPTIONAL. The first version made it
 * mandatory for every AI call — dev included — so an org without one (every
 * org, on day one) lost CREW and copilot outright, and public/webhook AI broke
 * because a request with no org "mismatched" the resource's org.
 */

const h = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./org-model.service.js", () => ({ orgModelService: { resolve: h.resolve } }));
vi.mock("@domain/system/system-config.service.js", () => ({
    systemConfigService: { trackSpend: vi.fn(async () => ({ allowed: true })) },
}));

import { withAiOrganization, resolveAiOrganization } from "./ai-org-context.js";
import { OrganizationAIClient } from "./organization-ai-client.js";

const platform = { execute: vi.fn(async () => ({ success: true, output: "platform" })), executeStream: vi.fn() } as any;

beforeEach(() => {
    vi.clearAllMocks();
    h.resolve.mockResolvedValue(null);
});

describe("resolveAiOrganization", () => {
    it("uses the resource's org when the request has none (public/webhook)", async () => {
        await expect(withAiOrganization(async () => null, () => resolveAiOrganization(7))).resolves.toBe(7);
    });

    it("refuses only when two KNOWN orgs disagree", async () => {
        await expect(withAiOrganization(async () => 5, () => resolveAiOrganization(7))).rejects.toThrow(/does not match/);
        await expect(withAiOrganization(async () => 7, () => resolveAiOrganization(7))).resolves.toBe(7);
    });
});

describe("OrganizationAIClient", () => {
    it("sends an org without its own key to the platform client", async () => {
        const client = new OrganizationAIClient(() => platform);
        const res = await withAiOrganization(async () => 7, () => client.execute({ organizationId: 7 } as any, "hi", "platform-key"));
        expect(h.resolve).toHaveBeenCalledWith(7);
        expect(res).toMatchObject({ output: "platform" });
        expect(platform.execute).toHaveBeenCalled();
    });

    it("sends calls with no org to the platform client", async () => {
        const client = new OrganizationAIClient(() => platform);
        await client.execute({} as any, "hi", "platform-key");
        expect(platform.execute).toHaveBeenCalled();
        expect(h.resolve).not.toHaveBeenCalled();
    });
});
