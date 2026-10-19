import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useProjectForms = vi.fn();
vi.mock("../hooks/use-projects", () => ({ useProjectForms: (...args: any[]) => useProjectForms(...args) }));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ProjectFormsTab } from "./ProjectFormsTab";

const form = (over: Record<string, unknown> = {}) => ({
  id: 12, name: "Succession review", state: "published", releaseNumber: 2, responses: 3, waitingRequests: 1, ...over,
});
const overview = {
  forms: [form()],
  waitingStages: [{ approvalId: 40, formId: 12, formName: "Succession review", stageTitle: "HR data", responseId: 7, approverEmail: "hr@example.com", waitingSince: new Date().toISOString() }],
  recentResults: [{ responseId: 7, formId: 12, formName: "Succession review", releaseNumber: 2, status: "PRIMARY_SUCCESSOR_CERTIFIED", submittedAt: new Date().toISOString() }],
  responseDatasets: [{ id: 5, name: "Succession responses", description: null, forms: ["Succession review"] }],
};

function renderTab(role: string | null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectFormsTab projectKey="succession" role={role} />
    </QueryClientProvider>,
  );
}

describe("ProjectFormsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/form-studio") return { json: async () => [form(), form({ id: 30, name: "Pulse survey" })] };
      if (method === "POST") return { json: async () => ({}) };
      throw new Error(`unexpected ${method} ${url}`);
    });
  });

  it("links each form to Form Studio, and shows waiting stages, recent results and datasets", () => {
    useProjectForms.mockReturnValue({ data: overview, isLoading: false });
    renderTab("viewer");

    const link = screen.getByTestId("project-form-link-12");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/armory/forms/builder/12");
    expect(link).toHaveTextContent("3 responses · 1 request waiting");
    expect(link).toHaveTextContent("v2");
    expect(screen.getByRole("region", { name: "Stages waiting" })).toHaveTextContent("HR data · Succession review");
    expect(screen.getByRole("region", { name: "Recent results" })).toHaveTextContent("PRIMARY_SUCCESSOR_CERTIFIED");
    expect(screen.getByRole("region", { name: "Response datasets" })).toHaveTextContent("From Succession review");
  });

  it("gives a viewer no controls to change the project's forms", () => {
    useProjectForms.mockReturnValue({ data: overview, isLoading: false });
    renderTab("viewer");
    expect(screen.queryByRole("button", { name: /new form/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Form to add to this project")).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("lets an editor add one of the organization's other forms", async () => {
    useProjectForms.mockReturnValue({ data: overview, isLoading: false });
    renderTab("editor");

    const picker = screen.getByLabelText("Form to add to this project");
    await waitFor(() => expect(screen.getByRole("option", { name: "Pulse survey" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Succession review" })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/projects/succession/resources", { resourceType: "form", resourceId: 30 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Form added to the project" }));
  });

  it("says when no forms belong to the project", () => {
    useProjectForms.mockReturnValue({ data: { forms: [], waitingStages: [], recentResults: [], responseDatasets: [] }, isLoading: false });
    renderTab("owner");
    expect(screen.getByText("No forms belong to this project yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New form" })).toBeInTheDocument();
  });
});
