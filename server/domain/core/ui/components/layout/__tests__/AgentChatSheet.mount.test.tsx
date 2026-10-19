import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AgentChatSheet } from "../AgentChatSheet";

import type { AssistantInboxItem } from "../../../hooks/use-intervention-engine";

let mockInboxItems: AssistantInboxItem[] = [];
const mockAcceptInboxItem = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOrgContextOptional = vi.fn();
const mockUseActiveProject = vi.fn();

vi.mock("@domain-ui/auth/ui/modules/auth/hooks/use-auth", () => ({
    useAuth: () => mockUseAuth(),
}));

vi.mock("@domain-ui/core/ui/hooks/use-org-context", () => ({
    useOrgContextOptional: () => mockUseOrgContextOptional(),
}));

vi.mock("@/modules/projects/hooks/use-projects", () => ({
    useActiveProject: (orgId?: number | null) => mockUseActiveProject(orgId),
}));

vi.mock("@domain-ui/core/ui/hooks/use-intervention-engine", () => ({
    useInterventionEngine: () => ({
        active: null,
        queueLength: 0,
        assistantInbox: mockInboxItems,
        acceptInboxItem: mockAcceptInboxItem,
        clearAssistantInbox: vi.fn(),
        accept: vi.fn(),
    }),
}));

vi.mock("wouter", () => ({
    useLocation: () => ["/dashboard", vi.fn()],
}));

vi.mock("@/lib/queryClient", () => ({
    apiRequest: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
    }),
}));

const missionQuery = vi.fn();
afterEach(() => { cleanup(); mockInboxItems = []; });

function renderWithClient(ui: React.ReactElement, runs: unknown[] = []) {
    const client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
                queryFn: async ({ queryKey }) => {
                    missionQuery(queryKey[0]);
                    if (String(queryKey[0]).startsWith("/api/mission-runs/in-flight")) return runs;
                    if (queryKey[0] === "/api/missions") return [{ id: 999, name: "Saved definition", status: "active" }];
                    return [];
                },
            },
        },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("AgentChatSheet mount and display behavior", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it("displays the right assistant panel when open=true even if active project is pending", () => {
        mockUseAuth.mockReturnValue({ user: { id: "1", username: "tester" } });
        mockUseOrgContextOptional.mockReturnValue({ selectedOrgId: 10 });
        mockUseActiveProject.mockReturnValue({ data: null, isPending: true });

        renderWithClient(
            <AgentChatSheet open={true} onOpenChange={vi.fn()} />
        );

        // Verify the copilot sheet mounts and displays title
        expect(screen.getByTestId("copilot-chat-sheet")).toBeInTheDocument();
        expect(screen.getByText("Oddjob Copilot")).toBeInTheDocument();
    });

    it("displays the right assistant panel when open=true even if user is not yet loaded", () => {
        mockUseAuth.mockReturnValue({ user: null });
        mockUseOrgContextOptional.mockReturnValue(null);
        mockUseActiveProject.mockReturnValue({ data: null, isPending: false });

        renderWithClient(
            <AgentChatSheet open={true} onOpenChange={vi.fn()} />
        );

        expect(screen.getByTestId("copilot-chat-sheet")).toBeInTheDocument();
        expect(screen.getByText("Oddjob Copilot")).toBeInTheDocument();
    });

    it("displays the active project space badge when active project is loaded", () => {
        mockUseAuth.mockReturnValue({ user: { id: "1", username: "tester" } });
        mockUseOrgContextOptional.mockReturnValue({ selectedOrgId: 10 });
        mockUseActiveProject.mockReturnValue({
            data: { project: { key: "alpha", name: "Alpha Project" } },
            isPending: false,
        });

        renderWithClient(
            <AgentChatSheet open={true} onOpenChange={vi.fn()} />
        );

        expect(screen.getByTestId("copilot-chat-sheet")).toBeInTheDocument();
        expect(screen.getByTestId("copilot-project-scope")).toHaveTextContent("Alpha Project");
    });

    it("keeps assistant panel open without triggering onOpenChange(false) when interacting outside", () => {
        mockUseAuth.mockReturnValue({ user: { id: "1", username: "tester" } });
        mockUseOrgContextOptional.mockReturnValue({ selectedOrgId: 10 });
        mockUseActiveProject.mockReturnValue({ data: null, isPending: false });
        const onOpenChange = vi.fn();

        renderWithClient(
            <div>
                <button data-testid="outside-button">Outside Page Action</button>
                <AgentChatSheet open={true} onOpenChange={onOpenChange} />
            </div>
        );

        expect(screen.getByTestId("copilot-chat-sheet")).toBeInTheDocument();

        // Simulate pointerdown and click on outside element
        const outsideButton = screen.getByTestId("outside-button");
        fireEvent.pointerDown(outsideButton);
        fireEvent.click(outsideButton);

        // Assistant sheet should not have been dismissed
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
});

const run = { runId: 73, missionId: 12, name: "Executing research", status: "active", costUsd: 0, budgetLimitUsd: null, lastEvent: null, lastActivityAt: "2026-10-07T10:00:00.000Z", stale: false };

describe("flight deck execution evidence", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: { id: "1", username: "tester" } });
        mockUseOrgContextOptional.mockReturnValue({ selectedOrgId: 342 });
        mockUseActiveProject.mockReturnValue({ data: null, isPending: false });
    });

    it("requires an organization instead of reporting an unscoped all-clear", () => {
        mockUseOrgContextOptional.mockReturnValue(null);
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: /Missions/ }));
        expect(screen.getByText("Select an organization to view mission runs.")).toBeInTheDocument();
        expect(screen.queryByText("All Flight Paths Clear")).not.toBeInTheDocument();
    });

    it("queries org-scoped runs and never lists saved definitions as in flight", async () => {
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: /Missions/ }));
        expect(await screen.findByText("All Flight Paths Clear")).toBeInTheDocument();
        expect(missionQuery).toHaveBeenCalledWith("/api/mission-runs/in-flight?orgId=342");
        expect(missionQuery).not.toHaveBeenCalledWith("/api/missions");
        expect(screen.queryByText("Saved definition")).not.toBeInTheDocument();
    });

    it("preserves recorded zero spend and pauses the run rather than its definition", async () => {
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} />, [run]);
        fireEvent.click(screen.getByRole("button", { name: /Missions/ }));
        expect(await screen.findByText("Executing research")).toBeInTheDocument();
        expect(screen.getByText(/\$0.00 \/ No budget set/)).toBeInTheDocument();
        expect(screen.getByText("No execution event recorded")).toBeInTheDocument();
        expect(screen.queryByText(/Synthesizing next agent step/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Pause" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/mission-runs/73/pause?orgId=342"));
    });

    it("marks stale runs and stops their actual run id without counting them active", async () => {
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} />, [{ ...run, stale: true }]);
        fireEvent.click(screen.getByRole("button", { name: /Missions/ }));
        expect(await screen.findByText("Stale")).toBeInTheDocument();
        expect(screen.queryByText("In Flight")).not.toBeInTheDocument();
        expect(screen.queryByText("1 Active")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Stop stale run" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/mission-runs/73/terminate?orgId=342"));
    });

    it("shows approval waits without offering a resume that bypasses approval", async () => {
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} />, [{ ...run, status: "waiting_on_human" }]);
        fireEvent.click(screen.getByRole("button", { name: /Missions/ }));
        expect(await screen.findByText("Awaiting approval")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
        expect(screen.queryByText("1 Active")).not.toBeInTheDocument();
    });
});

describe("Open in chat from Updates", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: { id: "1", username: "tester" } });
        mockUseOrgContextOptional.mockReturnValue({ selectedOrgId: 342 });
        mockUseActiveProject.mockReturnValue({ data: null, isPending: false });
        mockInboxItems = [{ id: "review-1", vector: "S", title: "Review execution", description: "Needs attention", priority: "critical", source: "intervention.triggered", receivedAt: Date.now(), updatedAt: Date.now(), outcome: "accepted", aiPrompt: "Review this execution" }];
    });

    it("switches an already-open Updates panel to chat on every click", () => {
        renderWithClient(<AgentChatSheet open={true} onOpenChange={vi.fn()} initialContext={{ assistantView: "chat" }} />);
        for (let i = 0; i < 2; i++) {
            fireEvent.click(screen.getByRole("button", { name: /Updates/ }));
            expect(screen.getByText("Assistant Updates")).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: "Open in chat" }));
            expect(screen.queryByText("Assistant Updates")).not.toBeInTheDocument();
        }
        expect(mockAcceptInboxItem).toHaveBeenCalledTimes(2);
        expect(mockAcceptInboxItem).toHaveBeenCalledWith(mockInboxItems[0]);
    });

    it("closes the overlay when handing a deliberation card to its room", () => {
        mockInboxItems[0].context = { deliberationRoom: "/workspace/chat/deliberation-77" };
        const onOpenChange = vi.fn();
        renderWithClient(<AgentChatSheet open={true} onOpenChange={onOpenChange} />);
        fireEvent.click(screen.getByRole("button", { name: /Updates/ }));
        fireEvent.click(screen.getByRole("button", { name: "Open in chat" }));
        expect(mockAcceptInboxItem).toHaveBeenCalledWith(mockInboxItems[0]);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
