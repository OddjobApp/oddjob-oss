import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { OrgModelSettings } from "./OrgModelSettings";

function respond(body: unknown) {
    return { json: async () => body } as Response;
}

function renderSettings() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><OrgModelSettings organizationId={7} /></QueryClientProvider>);
}

describe("OrgModelSettings", () => {
    beforeEach(() => apiRequest.mockReset());

    it("lists every provider, marks the default, and says which features need Gemini", async () => {
        apiRequest.mockResolvedValue(respond({ configured: true, canManage: true, connections: [
            { provider: "anthropic", model: "claude-sonnet-5-5", region: null, keyHint: "…1234", isDefault: true },
        ] }));
        renderSettings();
        expect(await screen.findByText("Default: Anthropic Claude · claude-sonnet-5-5")).toBeInTheDocument();
        for (const label of ["Google Gemini", "Anthropic Claude", "OpenAI", "xAI Grok", "Alibaba Qwen", "Meta Muse"]) {
            expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
        }
        expect(screen.getByText(/They stay off until you connect a Gemini key/)).toBeInTheDocument();
        expect(screen.getByText("Connected · claude-sonnet-5-5 · key …1234")).toBeInTheDocument();
    });

    it("connects a provider with its default model, and never shows the key again", async () => {
        apiRequest.mockResolvedValue(respond({ configured: false, canManage: true, connections: [] }));
        renderSettings();
        const grok = await screen.findByRole("region", { name: "xAI Grok" });
        await userEvent.click(grok.querySelector("button")!);
        await userEvent.type(screen.getByLabelText("xAI Grok API key"), "xai-secret-key-1234567890");
        await userEvent.click(screen.getByRole("button", { name: "Validate and save" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/org-model?organizationId=7",
            { provider: "xai", apiKey: "xai-secret-key-1234567890", model: "grok-4" }));
        await waitFor(() => expect(screen.queryByLabelText("xAI Grok API key")).not.toBeInTheDocument());
    });

    it("hides management from members", async () => {
        apiRequest.mockResolvedValue(respond({ configured: true, canManage: false, connections: [
            { provider: "google", model: "gemini-2.5-flash", region: null, keyHint: "…9999", isDefault: true },
        ] }));
        renderSettings();
        expect(await screen.findByText("An organization administrator can manage these connections.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
        expect(screen.queryByText(/They stay off/)).not.toBeInTheDocument();
    });
});
