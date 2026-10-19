import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
const setLocation = vi.fn();
vi.mock("wouter", async (importOriginal) => ({ ...(await importOriginal<typeof import("wouter")>()), useLocation: () => ["/armory/forms", setLocation] }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import FormsLibraryPage, { type LibraryRow } from "./FormsLibraryPage";

/**
 * The Forms library lists authored forms from the Studio's library endpoint:
 * their release state, what blocks publishing, and what depends on them.
 */

const row = (overrides: Partial<LibraryRow>): LibraryRow => ({
  id: 1, name: "Form", description: null, isArchived: false, legacy: false, revision: 1, state: "draft", releaseNumber: null,
  updatedAt: "2026-09-12T09:00:00Z", lastEditedBy: null, sources: [], responses: 0, waitingRequests: 0, issueCount: 0,
  testCount: 0, failingTests: 0, usedBy: [], templateUpdate: false, ...overrides,
});
const ROWS = [
  row({ id: 1, name: "Beta launch review", state: "draft_ahead", releaseNumber: 2, responses: 14, usedBy: [
    { type: "pipeline_step", via: "id", jobId: 5, name: "Approve launch" },
    { type: "mission_template", via: "name", templateId: 3, name: "Beta cycle", stepOrder: 2 },
  ] }),
  row({ id: 2, name: "Dispatch Override", legacy: true, templateUpdate: true }),
  row({ id: 3, name: "Succession draft", issueCount: 2, failingTests: 1 }),
];
const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><FormsLibraryPage /></QueryClientProvider>);
}

beforeEach(() => {
  apiRequest.mockReset();
  setLocation.mockReset();
  apiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url.startsWith("/api/form-studio")) return ok(url.includes("state=draft") ? [ROWS[2]] : ROWS);
    if (method === "POST" && url === "/api/form-studio") return ok({ id: 9 });
    throw new Error(`unexpected ${method} ${url}`);
  });
});

describe("FormsLibraryPage", () => {
  it("shows each form's release state, problems and what uses it", async () => {
    renderPage();
    const beta = await screen.findByTestId("form-row-1");
    expect(within(beta).getByText("Release 2 (draft ahead)")).toBeInTheDocument();
    expect(within(beta).getByText("2 places")).toBeInTheDocument();
    expect(within(beta).getByText("Pipeline step “Approve launch”")).toBeInTheDocument();

    const legacy = screen.getByTestId("form-row-2");
    expect(within(legacy).getByText("Legacy")).toBeInTheDocument();
    expect(within(legacy).getByText("Template changes to review")).toBeInTheDocument();

    expect(within(screen.getByTestId("form-row-3")).getByText("2 issues · 1 failing test")).toBeInTheDocument();
  });

  it("asks the library for the chosen state", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("form-row-1");
    await user.selectOptions(screen.getByLabelText("State"), "draft");
    await waitFor(() => expect(screen.queryByTestId("form-row-1")).not.toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/form-studio?state=draft");
  });

  it("creates a blank form and opens it in the Studio", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "New form" }));
    await user.type(screen.getByLabelText("Name"), "Pulse check");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith("/armory/forms/builder/9"));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/form-studio", { name: "Pulse check" });
  });
});
