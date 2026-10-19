import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { LinkSection } from "./PublishTab";

const view = {
  id: 7,
  securityConfig: {},
  published: { href: "/forms/public/abc", at: "2026-09-01T00:00:00Z", releaseNumber: 1, draftAhead: false },
} as any;

function answer(link: unknown) {
  apiRequest.mockImplementation(async (method: string) => ({ json: async () => (method === "GET" ? link : {}) }));
}

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LinkSection view={view} />
    </QueryClientProvider>,
  );
}

describe("LinkSection: who the link is for", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("makes a private project's link members only, with a code, until the author opens it to anyone", async () => {
    answer({ project: { key: "board", name: "Board", visibility: "private" }, chosen: null, audience: "project_members" });
    renderSection();

    expect(await screen.findByText("Members-only link")).toBeInTheDocument();
    expect(screen.getByLabelText(/Members of Board/)).toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText("A members-only link always asks for an email code")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Anyone with the link"));
    expect(screen.getByText("Board is a private project. Anyone with this link can open the form and answer it.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save link settings" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/form-studio/7/link", { requireOtp: false, tokenExpirationHours: null, audience: "anyone" }));
  });

  it("offers no choice outside a private project, and sends none", async () => {
    answer({ project: null, chosen: null, audience: "anyone" });
    renderSection();

    expect(await screen.findByText("Public link")).toBeInTheDocument();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/form-studio/7/link"));
    expect(screen.queryByText("Who can open this link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save link settings" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/form-studio/7/link", { requireOtp: true, tokenExpirationHours: null }));
  });
});
