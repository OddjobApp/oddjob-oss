import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { MediaStudio } from "./MediaStudio";
import { production, scene, shot, take } from "./fixtures";
import type { ProductionView } from "@shared/media-studio";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderStudio(view: ProductionView) {
  apiRequest.mockImplementation(async (_method: string, url: string) => ok(url.endsWith("?crewSessionId=3") ? [{ id: 7, title: "Rooftop chase" }] : view));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MediaStudio crewSessionId={3} />
    </QueryClientProvider>,
  );
}

const twoScenes = () => production({
  scenes: [
    scene({
      id: 21,
      shots: [
        shot({ id: 31, takes: [take({ id: 51, status: "approved" })] }),
        shot({ id: 32, takes: [take({ id: 52, status: "ready_for_review" })] }),
        shot({ id: 33, takes: [take({ id: 53, status: "failed" })] }),
        shot({ id: 34, takes: [take({ id: 54, status: "ready_for_review" })] }),
      ],
    }),
    scene({ id: 22, sceneKey: "SCENE-02", title: "The chase", shots: [shot({ id: 35, takes: [] })] }),
  ],
});

describe("MediaStudio's Film tab", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toast.mockReset();
    localStorage.clear();
    window.history.replaceState(null, "", "/crew/room-1");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("shows where the production and the scene stand, and steps through the shots that need a look", async () => {
    renderStudio(twoScenes());
    fireEvent.click(await screen.findByRole("tab", { name: "Film" }));
    expect(screen.getByRole("progressbar", { name: "Shots with an approved take" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("media-studio-progress")).toHaveTextContent("1 of 5 shots approved");

    const crumbs = screen.getByTestId("film-breadcrumb");
    expect(crumbs).toHaveTextContent("Rooftop chase");
    expect(within(crumbs).getByText("Shot 1 of 4")).toHaveAttribute("aria-current", "page");

    const summary = screen.getByTestId("film-status-summary");
    expect(summary).toHaveTextContent("1 of 4 approved");
    expect(within(summary).getByRole("button", { name: "3 without an approved take" })).toBeInTheDocument();
    const review = within(summary).getByRole("button", { name: "2 ready for review" });
    fireEvent.click(review);
    expect(within(crumbs).getByText("Shot 2 of 4")).toBeInTheDocument();
    fireEvent.click(review);
    expect(within(crumbs).getByText("Shot 4 of 4")).toBeInTheDocument();
    fireEvent.click(review);
    expect(within(crumbs).getByText("Shot 2 of 4")).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole("button", { name: "1 failed" }));
    expect(within(crumbs).getByText("Shot 3 of 4")).toBeInTheDocument();
    expect(screen.getByTestId("stage-take-status").querySelector('[data-status-icon="failed"]')).not.toBeNull();
  });

  it("confirms an approval, says how to undo it, and confirms the undo", async () => {
    renderStudio(twoScenes());
    fireEvent.click(await screen.findByRole("tab", { name: "Film" }));
    fireEvent.click(within(screen.getByTestId("film-status-summary")).getByRole("button", { name: "2 ready for review" }));
    fireEvent.click(screen.getByTestId("dailies-approve-take-btn"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Approved take 1 of SCENE-01 shot 2", description: "Undo with Ctrl+Z." }));

    await waitFor(() => expect(screen.getByTestId("media-studio-undo")).toBeEnabled());
    fireEvent.click(screen.getByTestId("media-studio-undo"));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Undone: Approved take 1 of SCENE-01 shot 2" }));
  });

  it("remembers the tab, scene and view for the production, and copies a link that opens the shot", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    const first = renderStudio(twoScenes());
    fireEvent.click(await screen.findByRole("tab", { name: "Film" }));
    fireEvent.change(screen.getByLabelText("Scene"), { target: { value: "22" } });
    fireEvent.click(screen.getByTestId("view-mode-graph-btn"));
    first.unmount();

    renderStudio(twoScenes());
    expect(await screen.findByRole("tab", { name: "Film" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("film-breadcrumb")).toHaveTextContent("Shot 1 of 1");
    expect(screen.getByLabelText("Scene")).toHaveValue("22");
    expect(screen.getByTestId("media-graph-viewer")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("film-copy-link-btn"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const link = new URL(writeText.mock.calls[0][0]);
    expect(link.pathname).toBe("/crew/room-1");
    expect(link.search).toBe("?studio=media&tab=film&production=7&scene=22&shot=35");
    expect(toast).toHaveBeenCalledWith({ title: "Link copied", description: "It opens SCENE-02 shot 1 in Media Studio for anyone who can see this production." });
  });

  it("follows a shared link to its tab, scene and shot", async () => {
    window.history.replaceState(null, "", "/crew/room-1?studio=media&tab=film&production=7&scene=21&shot=34");
    renderStudio(twoScenes());
    expect(await screen.findByTestId("film-breadcrumb")).toHaveTextContent("Shot 4 of 4");
    expect(screen.getByRole("tab", { name: "Film" })).toHaveAttribute("aria-selected", "true");
  });
});
