import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { studioDefinitionSchema } from "@shared/form-studio";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@domain-ui/core/ui/components/shared/LocationPicker", () => ({ LocationPicker: () => <div>map</div> }));

import FormStudioPod from "./FormStudioPod";

/**
 * The Studio pod loads a form, saves the author's edits shortly after they stop,
 * says what blocks publishing, and acts on a held Org Forge template update.
 */

const baseView = (overrides: Record<string, unknown> = {}) => ({
  id: 7, name: "Dispatch review", description: null, revision: 3, checks: [], legacy: false, published: null,
  templateUpdate: null, updatedAt: "2026-09-12T09:00:00Z", createdBy: null,
  schema: studioDefinitionSchema.parse({
    fields: [
      { key: "reason", label: "Reason", type: "text", required: true },
      { key: "risk", label: "Risk", type: "computed", formula: "severity * 2" },
    ],
    studio: { version: 2, pages: [{ id: "page_1", title: "Form" }] },
  }),
  ...overrides,
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderPod(view: ReturnType<typeof baseView>, onClose?: () => void) {
  apiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
    if (method === "GET" && url === "/api/form-studio/7") return ok(view);
    if (method === "PUT" && url === "/api/form-studio/7") return ok({ ...view, revision: view.revision + 1, schema: body.schema, name: body.name ?? view.name });
    if (method === "POST" && url === "/api/form-studio/7/template-update/apply") return ok({ ...view, revision: view.revision + 1, templateUpdate: null });
    throw new Error(`unexpected ${method} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><FormStudioPod formId={7} onClose={onClose} /></QueryClientProvider>);
}

// A block body: vitest runs a function returned from beforeEach as cleanup, and
// mockReset() returns the mock, which then ran as apiRequest() with no arguments.
beforeEach(() => {
  apiRequest.mockReset();
});

describe("FormStudioPod", () => {
  it('saves pending edits before closing the studio', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    renderPod(baseView(), close);
    await screen.findByTestId('save-state');
    await user.clear(screen.getByLabelText('Form name'));
    await user.type(screen.getByLabelText('Form name'), 'Revised intake');
    await user.click(screen.getByRole('button', { name: 'Close Form Studio' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(apiRequest).toHaveBeenCalledWith('PUT', '/api/form-studio/7', expect.objectContaining({ name: 'Revised intake' }));
  });

  it("saves an edited question shortly after the author stops typing", async () => {
    const user = userEvent.setup();
    renderPod(baseView());
    expect(await screen.findByTestId("save-state")).toHaveTextContent("Saved · rev 3");

    await user.click(screen.getByRole("button", { name: /Reason/, expanded: false }));
    const label = screen.getByLabelText("Question");
    await user.clear(label);
    await user.type(label, "Why override?");
    expect(screen.getByTestId("save-state")).toHaveTextContent("Unsaved changes");

    await waitFor(() => expect(screen.getByTestId("save-state")).toHaveTextContent("Saved · rev 4"), { timeout: 4000 });
    const put = apiRequest.mock.calls.find(([method]) => method === "PUT");
    expect(put?.[2]).toMatchObject({ revision: 3, autosave: true });
    expect(put?.[2].schema.fields[0].label).toBe("Why override?");
  });

  it("counts the problems that block publishing", async () => {
    renderPod(baseView());
    expect(await screen.findByRole("button", { name: "1 problem blocks publishing" })).toBeInTheDocument();
  });

  it("applies an Org Forge template update held on the form", async () => {
    const user = userEvent.setup();
    renderPod(baseView({ templateUpdate: { at: "2026-09-12T09:00:00Z", templateKey: "dispatch_override", description: null, fields: [], added: ["severity"], changed: [], notInTemplate: ["risk"] } }));
    const banner = await screen.findByTestId("template-update");
    expect(banner).toHaveTextContent("Adds severity. Keeps your risk.");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/form-studio/7/template-update/apply", { revision: 3 }));
    await waitFor(() => expect(screen.queryByTestId("template-update")).not.toBeInTheDocument());
  });
});
