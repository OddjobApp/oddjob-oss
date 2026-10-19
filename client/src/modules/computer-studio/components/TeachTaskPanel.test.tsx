import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SkillEditor, type LearnedSkill } from "./TeachTaskPanel";
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const skill: LearnedSkill = { id: "skill-1", name: "Find account", description: "", status: "draft", procedure: "Search for an account",
  inputs: [], steps: [{ kind: "fill", url: "https://example.com", at: 0, target: { tag: "input", css: "#search" }, value: "Acme" }] };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SkillEditor skill={skill} sessionId="desktop" busy={false} onSaved={vi.fn()} onTest={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => { request.mockReset(); request.mockResolvedValue(new Response(JSON.stringify({ skill }))); });
describe("teaching review", () => {
  it("saves an explicit variable before allowing a test or approval", async () => {
    show();
    const variable = screen.getByPlaceholderText("company_name (press Enter)");
    fireEvent.change(variable, { target: { value: "company_name" } });
    fireEvent.keyDown(variable, { key: "Enter" });
    expect(screen.getByLabelText("Value or template")).toHaveValue("{{company_name}}");
    expect(screen.getByRole("button", { name: "Test on desktop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve skill" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("/skills/skill-1"), expect.objectContaining({
      inputs: [expect.objectContaining({ name: "company_name", example: "Acme" })],
      steps: [expect.objectContaining({ value: "{{company_name}}" })],
    })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Test on desktop" })).toBeEnabled());
  });
  it("will not persist an output without a valid name", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add output" }));
    fireEvent.change(screen.getByLabelText("Output name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Extraction needs an output name");
    expect(request).not.toHaveBeenCalled();
  });
});
