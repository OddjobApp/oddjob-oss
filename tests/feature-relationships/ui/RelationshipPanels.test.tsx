import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SimilarMissionsPanel } from "../../../server/domain/mission/ui/modules/missions/components/SimilarMissionsPanel";
import { ResourceImpactPanel } from "../../../client/src/components/resource-catalog/ResourceImpactPanel";

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), orgId: 7 }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@domain-ui/core/ui/hooks/use-org-context", () => ({ useOrgContext: () => ({ selectedOrgId: mocks.orgId }) }));
vi.mock("@domain-ui/auth/ui/modules/auth", () => ({ useAuth: () => ({ user: { defaultOrgId: 7 } }) }));

function mount(element: React.ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); mocks.orgId = 7; });

describe("Similar mission reuse", () => {
    it("uses the selected organization and applies only a supported strategy", async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ missions: [
            { id: 1, missionId: 12, objective: "Review renewal accounts", outcome: "success", strategy: "rolling_wave" },
            { id: 2, missionId: 13, objective: "Old mission", outcome: "failure", strategy: "retired_strategy" },
        ] }) });
        const select = vi.fn();
        mount(<SimilarMissionsPanel objective="Review renewal accounts" organizationId={7} onStrategySelect={select} />);
        const apply = await screen.findByRole("button", { name: "Use this strategy" });
        expect(mocks.request.mock.calls[0][1]).toContain("orgId=7");
        expect(screen.getByText("Strategy unavailable")).toBeInTheDocument();
        fireEvent.click(apply);
        expect(select).toHaveBeenCalledExactlyOnceWith("rolling_wave");
        expect(screen.getAllByRole("link", { name: "View mission" })[0]).toHaveAttribute("href", "/operations/missions/12");
    });

    it("does not substitute organization 1 when organization context is missing", async () => {
        mount(<SimilarMissionsPanel objective="Review renewal accounts" />);
        expect(screen.getByText(/Select an organization/)).toBeInTheDocument();
        await new Promise(resolve => setTimeout(resolve, 450));
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("distinguishes a failed lookup from no matches and supports retry", async () => {
        mocks.request.mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ json: async () => ({ missions: [] }) });
        mount(<SimilarMissionsPanel objective="Review renewal accounts" organizationId={7} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByText(/No matching mission outcomes/)).toBeInTheDocument();
    });

    it("hides results for the old objective while a new search is pending", async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ missions: [
            { id: 1, missionId: 12, objective: "Old result", outcome: "success", strategy: "rolling_wave" },
        ] }) });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const view = (objective: string) => <QueryClientProvider client={client}><SimilarMissionsPanel objective={objective} organizationId={7} /></QueryClientProvider>;
        const { rerender } = render(view("Review renewal accounts"));
        await screen.findByText("Old result");
        rerender(view("Inspect production incidents"));
        expect(screen.queryByText("Old result")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Finding");
    });
});

describe("Dependency impact", () => {
    it("separates direct and indirect usage and discloses truncated analysis", async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ truncated: true, nodes: [
            { depth: 1, resource: { key: "mission:12", id: "12", type: "mission", name: "Renewal review", lifecycle: "active" } },
            { depth: 2, resource: { key: "cycle:9", id: "9", type: "cycle", name: "Monthly close", lifecycle: "paused" } },
        ] }) });
        mount(<ResourceImpactPanel resourceKey="credential:5" editing />);
        expect(await screen.findByText(/Partial results/)).toBeInTheDocument();
        expect(within(screen.getByRole("region", { name: "Used by" })).getByText("Renewal review")).toBeInTheDocument();
        expect(within(screen.getByRole("region", { name: "Indirectly affected" })).getByText("Monthly close")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Renewal review" })).toHaveAttribute("href", "/operations/missions/12");
        expect(mocks.request.mock.calls[0][1]).toContain("credential%3A5?orgId=7&maxDepth=3");
    });

    it("never describes a failed impact lookup as no dependencies", async () => {
        mocks.request.mockRejectedValue(new Error("offline"));
        mount(<ResourceImpactPanel resourceKey="credential:5" />);
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("impact is unknown"));
        expect(screen.queryByText(/No incoming relationships/)).not.toBeInTheDocument();
    });
});
