import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor , within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { MediaStudio } from "./MediaStudio";
import { plotPoint, production, scene, shot, take } from "./fixtures";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderStudio(props: Partial<React.ComponentProps<typeof MediaStudio>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MediaStudio crewSessionId={3} sceneId="SCENE-01" sceneTitle="Rooftop chase" aspectRatio="2.39:1" {...props} />
    </QueryClientProvider>,
  );
}

describe("MediaStudio", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    localStorage.clear();
  });

  it("offers to start the room's first production, and opens it once started", async () => {
    const started = production({ scenes: [scene({ plotPoints: [plotPoint()] })] });
    let listed: unknown[] = [];
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/media-studio/productions?crewSessionId=3") return ok(listed);
      if (method === "POST" && url === "/api/media-studio/productions") {
        listed = [{ id: 7, title: "Rooftop chase" }];
        return ok(started);
      }
      if (method === "GET" && url === "/api/media-studio/productions/7") return ok(started);
      return ok([]);
    });

    renderStudio();
    expect(await screen.findByTestId("media-studio-start")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Rooftop chase");
    expect(screen.getByLabelText("Aspect ratio")).toHaveValue("2.39:1");

    fireEvent.click(screen.getByRole("button", { name: "Start production" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/media-studio/productions", { title: "Rooftop chase", aspectRatio: "2.39:1", crewSessionId: 3 }));
    expect(await screen.findByTestId("create-video-panel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Create" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the room's production and moves between its tabs", async () => {
    const view = production({ scenes: [scene({ plotPoints: [plotPoint()] })] });
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === "/api/media-studio/productions?crewSessionId=3") return ok([{ id: 7, title: "Rooftop chase" }]);
      if (url === "/api/media-studio/productions/7") return ok(view);
      return ok([]);
    });

    renderStudio();
    expect(await screen.findByTestId("storyboard-sequencer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByTestId("story-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Shots" }));
    expect(screen.getByTestId("shots-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Film" }));
    expect(screen.getByTestId("media-studio-pod")).toBeInTheDocument();
  });

  it("shows what is spent against the budget, and says when takes are simulations", async () => {
    const view = production({ spendCents: 4, budgetLimitCents: 2500, video: { ...production().video, configured: false } });
    apiRequest.mockImplementation(async (_method: string, url: string) => ok(url.endsWith("?crewSessionId=3") ? [{ id: 7, title: "Rooftop chase" }] : url.endsWith("/productions/7") ? view : []));
    renderStudio();
    expect(await screen.findByTestId("media-studio-spend")).toHaveTextContent("$0.04 of $25.00 spent");
    expect(screen.getByTestId("media-studio-simulation")).toHaveTextContent("Takes simulate");
  });

  it("opens work needing attention and supports keyboard tab navigation", async () => {
    const view = production({ scenes: [scene({ shots: [shot({ takes: [take({ status: "failed" })] })] })] });
    apiRequest.mockImplementation(async (_method: string, url: string) => ok(url.endsWith("?crewSessionId=3") ? [{ id: 7, title: "Rooftop chase" }] : view));
    renderStudio();
    fireEvent.click(await screen.findByRole("button", { name: "1 takes failed" }));
    const shotsTab = screen.getByRole("tab", { name: "Shots" });
    expect(shotsTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(shotsTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Film" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Film" })).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Film" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Create" })).toHaveFocus();
  });

  it("retries a failed load without leaving the studio", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(ok([]));
    renderStudio();
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
    expect(await screen.findByTestId("media-studio-start")).toBeInTheDocument();
  });

  it("sends a plot point, a shot or a take to the chat, and says which production is open", async () => {
    const view = production({
      scenes: [scene({
        id: 21,
        plotPoints: [plotPoint()],
        shots: [shot({ id: 31, takes: [take({ id: 51, takeNumber: 2 })] }), shot({ id: 32 })],
      })],
    });
    apiRequest.mockImplementation(async (_method: string, url: string) => ok(url.endsWith("?crewSessionId=3") ? [{ id: 7, title: "Rooftop chase" }] : url.endsWith("/productions/7") ? view : []));
    const onFocusInChat = vi.fn();
    const onProductionChange = vi.fn();
    renderStudio({ onFocusInChat, onProductionChange });

    fireEvent.click(await screen.findByRole("button", { name: "Discuss SCENE-01 plot point 1: She sees the drone in chat" }));
    expect(onFocusInChat).toHaveBeenLastCalledWith({ productionId: 7, sceneId: 21, sceneKey: "SCENE-01", kind: "plot_point", id: 11, label: "SCENE-01 plot point 1: She sees the drone" });
    await waitFor(() => expect(onProductionChange).toHaveBeenLastCalledWith(7));

    fireEvent.click(screen.getByRole("tab", { name: "Shots" }));
    // Shots is a list beside one open editor; every other editor is rendered
    // hidden, so shot 2 has to be opened before its controls are reachable.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Shot list" })).getAllByRole("button")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Discuss SCENE-01 shot 2 in chat" }));
    expect(onFocusInChat).toHaveBeenLastCalledWith({ productionId: 7, sceneId: 21, sceneKey: "SCENE-01", kind: "shot", id: 32, label: "SCENE-01 shot 2" });

    fireEvent.click(screen.getByRole("tab", { name: "Film" }));
    fireEvent.click(screen.getByRole("button", { name: "Discuss take 2 in chat" }));
    expect(onFocusInChat).toHaveBeenLastCalledWith({ productionId: 7, sceneId: 21, sceneKey: "SCENE-01", kind: "take", id: 51, label: "SCENE-01 shot 1, take 2" });
  });

  it("changes a transition from the Film timeline", async () => {
    const view = production({ scenes: [scene({ id: 21, shots: [shot({ id: 31 }), shot({ id: 32 })] })] });
    apiRequest.mockImplementation(async (_method: string, url: string) => ok(url.endsWith("?crewSessionId=3") ? [{ id: 7, title: "Rooftop chase" }] : view));
    renderStudio();
    fireEvent.click(await screen.findByRole("tab", { name: "Film" }));
    fireEvent.click(screen.getByTestId("transition-node-1"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/media-studio/shots/31", { transition: "crossfade" }));
  });

  it("opens the production a mount names, and reads it again when the room changes it", async () => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.endsWith("?crewSessionId=3")) return ok([{ id: 7, title: "Rooftop chase" }, { id: 8, title: "Night market" }]);
      if (url.endsWith("/productions/8")) return ok(production({ id: 8, title: "Night market" }));
      return ok(production());
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const studio = (refreshKey: number) => (
      <QueryClientProvider client={client}>
        <MediaStudio crewSessionId={3} productionId={8} refreshKey={refreshKey} />
      </QueryClientProvider>
    );
    const readsOf8 = () => apiRequest.mock.calls.filter(([method, url]) => method === "GET" && url === "/api/media-studio/productions/8").length;

    const { rerender } = render(studio(1));
    await waitFor(() => expect(readsOf8()).toBe(1));
    expect(apiRequest).not.toHaveBeenCalledWith("GET", "/api/media-studio/productions/7", undefined);

    rerender(studio(1));
    rerender(studio(2));
    await waitFor(() => expect(readsOf8()).toBe(2));
  });

  it("says why it could not load, and hides the chat and closes through its handlers", async () => {
    apiRequest.mockRejectedValue(new Error("403: Organization context required"));
    const onClose = vi.fn();
    const onToggleFocusMode = vi.fn();
    renderStudio({ onClose, onToggleFocusMode });

    expect(await screen.findByRole("alert")).toHaveTextContent("403: Organization context required");
    fireEvent.click(screen.getByRole("button", { name: "Hide the chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Media Studio" }));
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows renaming the production inline from the header card", async () => {
    const view = production({ id: 7, title: "New Schene" });
    const renamed = { ...view, title: "Night Market Chase" };
    apiRequest.mockImplementation(async (method: string, url: string, body: any) => {
      if (url === "/api/media-studio/productions?crewSessionId=3") return ok([{ id: 7, title: "New Schene" }]);
      if (method === "GET" && url === "/api/media-studio/productions/7") return ok(view);
      if (method === "PATCH" && url === "/api/media-studio/productions/7") {
        expect(body).toEqual({ title: "Night Market Chase" });
        return ok(renamed);
      }
      return ok([]);
    });

    renderStudio();
    expect(await screen.findByText("New Schene")).toBeInTheDocument();

    const editBtn = screen.getByTestId("edit-production-title-btn");
    fireEvent.click(editBtn);

    const input = screen.getByTestId("edit-production-title-input");
    expect(input).toHaveValue("New Schene");

    fireEvent.change(input, { target: { value: "Night Market Chase" } });
    fireEvent.click(screen.getByTestId("save-production-title-btn"));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/media-studio/productions/7", { title: "Night Market Chase" });
    });
  });
});
