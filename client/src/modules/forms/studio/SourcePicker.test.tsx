import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { SourcePicker } from "./SourcePicker";

const documents = [
  { id: 1, title: "Succession policy", summary: null, updatedAt: "2026-09-01T00:00:00Z", inProject: true },
  { id: 2, title: "Company handbook", summary: null, updatedAt: "2026-09-10T00:00:00Z", inProject: false },
];

function renderPicker(props: { formId?: number; projectKey?: string }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SourcePicker idPrefix="test" selected={[]} onChange={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe("SourcePicker", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ json: async () => documents });
  });

  it("asks for the form's project documents first, and marks them", async () => {
    renderPicker({ formId: 12 });
    await waitFor(() => expect(screen.getByText("Succession policy")).toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/form-studio/sources?q=&formId=12");
    expect(screen.getAllByText("In this project")).toHaveLength(1);
  });

  it("names the project a new form is started in", async () => {
    renderPicker({ projectKey: "succession" });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/form-studio/sources?q=&projectKey=succession"));
  });
});
