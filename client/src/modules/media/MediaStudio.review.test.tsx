import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { MediaStudio } from "./MediaStudio";
import { openInMediaStudio } from "./navigation";
import { production, scene, shot, take } from "./fixtures";
import type { ProductionView } from "@shared/media-studio";

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const readsList = (url: string) => url.endsWith("?crewSessionId=3");

function renderStudio(view: ProductionView) {
  apiRequest.mockImplementation(async (_method: string, url: string) => ok(readsList(url) ? [{ id: 7, title: "Rooftop chase" }] : view));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MediaStudio crewSessionId={3} />
    </QueryClientProvider>,
  );
}

const postsTo = (url: string) => apiRequest.mock.calls.filter(([method, called]) => method === "POST" && called === url).length;

describe("MediaStudio review decisions", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    localStorage.clear();
  });

  it("undoes and redoes an approval from the header and with Ctrl+Z", async () => {
    renderStudio(production({ scenes: [scene({ id: 21, shots: [shot({ id: 31, takes: [take({ id: 51, takeNumber: 1, status: "ready_for_review" })] })] })] }));
    fireEvent.click(await screen.findByRole("tab", { name: "Film" }));
    expect(screen.getByTestId("media-studio-undo")).toBeDisabled();

    fireEvent.click(screen.getByTestId("dailies-approve-take-btn"));
    await waitFor(() => expect(screen.getByTestId("media-studio-undo")).toBeEnabled());
    expect(postsTo("/api/media-studio/takes/51/approve")).toBe(1);
    expect(screen.getByTestId("media-studio-undo")).toHaveAttribute("aria-label", "Undo: Approved take 1 of SCENE-01 shot 1");

    fireEvent.click(screen.getByTestId("media-studio-undo"));
    await waitFor(() => expect(screen.getByTestId("media-studio-redo")).toBeEnabled());
    expect(postsTo("/api/media-studio/takes/51/unapprove")).toBe(1);

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(postsTo("/api/media-studio/takes/51/approve")).toBe(2));
    await waitFor(() => expect(screen.getByTestId("media-studio-undo")).toBeEnabled());
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(postsTo("/api/media-studio/takes/51/unapprove")).toBe(2));
  });

  it("goes where the configuration rail asks, and explains a refusal with a way to fix it", async () => {
    const view = production({
      scenes: [scene({ id: 21, shots: [shot({ id: 31, takes: [take({ id: 51, status: "ready_for_review" })] }), shot({ id: 32, takes: [] })] })],
    });
    renderStudio(view);
    await screen.findByRole("tab", { name: "Film" });

    act(() => openInMediaStudio({ tab: "shots" }));
    expect(screen.getByRole("tab", { name: "Shots" })).toHaveAttribute("aria-selected", "true");

    act(() => openInMediaStudio({ tab: "film", productionId: 7, sceneId: 21, shotId: 32 }));
    expect(within(screen.getByTestId("media-dailies-inspector")).getByText("Shot 2")).toBeInTheDocument();

    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "POST") throw new Error("This take would take Rooftop chase past its budget: $99.00 of $100.00 is spent or waiting for approval, and a 5-second take costs about $1.52 at 720p.");
      return ok(readsList(url) ? [{ id: 7, title: "Rooftop chase" }] : view);
    });
    fireEvent.click(screen.getByTestId("dailies-request-take-btn"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Raise the budget in Story, shorten the shot, or withdraw takes still waiting for approval.");
    fireEvent.click(within(alert).getByRole("button", { name: "Open the budget" }));
    expect(screen.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
  });
});
