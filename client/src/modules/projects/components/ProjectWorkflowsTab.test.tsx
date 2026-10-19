import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useProjectWorkflows = vi.fn();
const useWorkflowDetail = vi.fn();
const useWorkflowRuns = vi.fn();
const useWorkflowSignalSubscriptions = vi.fn();
const useWorkflowSignalDeliveries = vi.fn();
vi.mock("../hooks/use-projects", () => ({
    useProjectWorkflows: (...args: any[]) => useProjectWorkflows(...args),
    useWorkflowDetail: (...args: any[]) => useWorkflowDetail(...args),
    useWorkflowRuns: (...args: any[]) => useWorkflowRuns(...args),
    useWorkflowSignalSubscriptions: (...args: any[]) => useWorkflowSignalSubscriptions(...args),
    useWorkflowSignalDeliveries: (...args: any[]) => useWorkflowSignalDeliveries(...args),
    roleAtLeast: (role: string | null | undefined, required: string) => {
        const rank = ["viewer", "operator", "editor", "owner"];
        return !!role && rank.indexOf(role) >= rank.indexOf(required);
    },
}));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ProjectWorkflowsTab } from "./ProjectWorkflowsTab";

const workflow = (over: Record<string, unknown> = {}) => ({
    id: 9,
    title: "Dispatch intake",
    description: "Intake to dispatch",
    draftPipelineId: 41,
    status: "draft",
    ...over,
});

const release = (over: Record<string, unknown> = {}) => ({
    id: 30,
    workflowId: 9,
    releaseNumber: 2,
    digest: "abcdef1234567890",
    description: null,
    createdAt: new Date().toISOString(),
    ...over,
});

const deployment = (over: Record<string, unknown> = {}) => ({
    id: 50,
    workflowId: 9,
    releaseId: 30,
    environment: "production",
    status: "active",
    ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
    workflow: workflow(),
    releases: [release()],
    deployments: [deployment()],
    projectId: 7,
    ...over,
});

function renderTab(role: string | null) {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <ProjectWorkflowsTab projectKey="rescue" projectId={7} role={role} />
        </QueryClientProvider>,
    );
}

describe("ProjectWorkflowsTab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useWorkflowRuns.mockReturnValue({ data: [], isLoading: false });
        useWorkflowSignalSubscriptions.mockReturnValue({ data: [], isLoading: false });
        useWorkflowSignalDeliveries.mockReturnValue({ data: [], isLoading: false });
        apiRequest.mockImplementation(async (method: string, url: string) => {
            if (method === "GET" && url === "/api/pipelines") {
                return { json: async () => [{ id: 41, name: "Intake flow" }, { id: 90, name: "Escalation flow" }] };
            }
            if (method === "POST") return { json: async () => ({ release: release(), unchanged: false, executionId: 777 }) };
            throw new Error(`unexpected ${method} ${url}`);
        });
    });

    it("renders workflows with release and deployment badges and a draft link", () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail(), isLoading: false });
        renderTab("viewer");

        const card = screen.getByTestId("project-workflow-9");
        expect(card).toHaveTextContent("Dispatch intake");
        expect(card).toHaveTextContent("v2");
        expect(card).toHaveTextContent("active · v2");
        expect(screen.getByTestId("workflow-draft-link-9")).toHaveAttribute("href", "/operations/workstreams/41");
    });

    it("gives a viewer no publish or operate controls", () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail(), isLoading: false });
        renderTab("viewer");

        expect(screen.queryByRole("button", { name: /publish release/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /activate latest/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /run now/i })).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Workstream to register as a workflow")).not.toBeInTheDocument();
    });

    it("lets an editor publish a release and toasts the version", async () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail({ deployments: [] }), isLoading: false });
        renderTab("editor");

        fireEvent.click(screen.getByRole("button", { name: /publish release/i }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/workflows/9/releases", {}));
        await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Release v2 published" }));
    });

    it("disables Run now when there is no active deployment", () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail({ deployments: [deployment({ status: "paused" })] }), isLoading: false });
        renderTab("operator");

        expect(screen.getByRole("button", { name: /run now/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /^resume$/i })).toBeInTheDocument();
    });

    it("shows the signal triggers section when a workflow is expanded", () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail(), isLoading: false });
        useWorkflowSignalSubscriptions.mockReturnValue({
            data: [{ id: 3, name: "High-severity policy", enabled: true, filters: { eventTypes: ["policy_change"], minimumSeverity: "High" } }],
            isLoading: false,
        });
        useWorkflowSignalDeliveries.mockReturnValue({
            data: [{ id: "d1", disposition: "started", pipelineExecutionId: 777, deliveredAt: new Date().toISOString(), payload: { eventType: "policy_change" } }],
            isLoading: false,
        });
        renderTab("viewer");

        fireEvent.click(screen.getByRole("button", { name: /releases and runs for dispatch intake/i }));
        expect(screen.getByTestId("signal-triggers-9")).toBeInTheDocument();
        expect(screen.getByText("High-severity policy")).toBeInTheDocument();
        expect(screen.getByText("started")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "run #777" })).toHaveAttribute("href", "/operations/workstream-executions/777");
        // Viewer cannot toggle or delete a trigger.
        expect(screen.queryByRole("button", { name: /^disable$/i })).not.toBeInTheDocument();
    });

    it("lets an editor post a new signal subscription", async () => {
        useProjectWorkflows.mockReturnValue({ data: [workflow()], isLoading: false });
        useWorkflowDetail.mockReturnValue({ data: detail(), isLoading: false });
        renderTab("editor");

        fireEvent.click(screen.getByRole("button", { name: /releases and runs for dispatch intake/i }));
        const form = screen.getByTestId("signal-subscription-form-9");
        fireEvent.change(form.querySelector("input[placeholder='Name']")!, { target: { value: "Critical policy" } });
        fireEvent.change(form.querySelector("input[placeholder='event.type, other.type']")!, { target: { value: "policy_change, sanctions" } });
        fireEvent.change(form.querySelector("select")!, { target: { value: "Critical" } });
        fireEvent.click(screen.getByRole("button", { name: /add trigger/i }));

        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
            "POST",
            "/api/workflows/9/signal-subscriptions",
            {
                name: "Critical policy",
                filters: { eventTypes: ["policy_change", "sanctions"], minimumSeverity: "Critical" },
                cooldownMinutes: 0,
            },
        ));
    });

    it("says when no workflows belong to the project", () => {
        useProjectWorkflows.mockReturnValue({ data: [], isLoading: false });
        renderTab("owner");
        expect(screen.getByText("No workflows belong to this project yet.")).toBeInTheDocument();
    });
});
