import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("@/modules/operations/components/OrgModelSettings", () => ({
    OrgModelSettings: ({ organizationId }: { organizationId: number }) => <div>model settings for {organizationId}</div>,
}));
vi.mock("@/modules/operations/components/OrgFalSettings", () => ({
    OrgFalSettings: ({ organizationId }: { organizationId: number }) => <div>fal settings for {organizationId}</div>,
}));
import AiModelsPage from "./AiModelsPage";

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><AiModelsPage /></QueryClientProvider>);
}

describe("Platform → AI Models", () => {
    it("shows the current organization's AI provider and fal.ai settings", async () => {
        mocks.apiRequest.mockResolvedValue({ json: async () => ({ organizationId: 7 }) });
        renderPage();
        expect(screen.getByRole("heading", { name: "AI Models" })).toBeTruthy();
        expect(await screen.findByText("model settings for 7")).toBeTruthy();
        expect(screen.getByText("fal settings for 7")).toBeTruthy();
        expect(mocks.apiRequest).toHaveBeenCalledWith("GET", "/api/org-settings");
    });

    it("asks for an organization instead of rendering settings without one", async () => {
        mocks.apiRequest.mockResolvedValue({ json: async () => ({}) });
        renderPage();
        expect(await screen.findByText(/Select an organization/)).toBeTruthy();
        expect(screen.queryByText(/model settings/)).toBeNull();
    });
});
