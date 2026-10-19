import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { MediaConfigurationRail, shotStatus } from "./MediaConfigurationRail";
import { assembly, keyframe, plotPoint, production, scene, shot, take } from "./fixtures";

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const navigated = vi.fn();
const onNavigate = (event: Event) => navigated((event as CustomEvent).detail);

function renderRail(routes: Record<string, unknown>) {
  apiRequest.mockImplementation(async (_method: string, url: string) => ok(routes[url] ?? []));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MediaConfigurationRail crewSessionId={3} />
    </QueryClientProvider>,
  );
}

describe("MediaConfigurationRail", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    navigated.mockReset();
    window.addEventListener("media-studio:navigate", onNavigate);
  });
  afterEach(() => window.removeEventListener("media-studio:navigate", onNavigate));

  const view = production({
    budgetLimitCents: 1000, spendCents: 850,
    scenes: [scene({
      id: 21,
      plotPoints: [plotPoint({ keyframes: [keyframe({ status: "approved" })] }), plotPoint({ id: 12, keyframes: [keyframe({ id: 42, status: "ready" })] })],
      shots: [
        shot({ id: 31, takes: [take({ id: 51, status: "approved" })] }),
        shot({ id: 32, framing: null, dialogue: [{ speaker: "Elena", line: "Not tonight." }], takes: [take({ id: 61, status: "ready_for_review" }), take({ id: 62, status: "pending_approval" })] }),
      ],
      assembly: assembly(),
    })],
  });

  it("shows budget, progress and what needs a decision, each opening its place in the studio", async () => {
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [{ id: 7, title: "Rooftop chase" }], "/api/media-studio/productions/7": view });

    expect(await screen.findByTestId("media-configuration-budget")).toHaveTextContent("$8.50 of $10.00 spent · Seedance at 720p, about $0.31 a second");
    expect(screen.getByRole("button", { name: "Storyboard: 1 of 2 plot points have an approved keyframe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shots: 1 of 2 shots have an approved take" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reels: 1 of 1 scenes have a reel" })).toBeInTheDocument();

    // Takes are listed in the Queue tab, so the count opens it rather than sending the
    // studio somewhere and repeating the list in two places.
    fireEvent.click(screen.getByRole("button", { name: "1 take to review" }));
    expect(screen.getByTestId("render-queue")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("media-rail-tab-production"));
    fireEvent.click(screen.getByRole("button", { name: "1 keyframe to approve" }));
    expect(navigated).toHaveBeenLastCalledWith({ productionId: 7, tab: "storyboard" });

    const second = screen.getByTestId("media-configuration-shot-32");
    expect(second).toHaveTextContent("Shot 2");
    expect(second).toHaveTextContent("framing not set · 1 line");
    expect(second).toHaveTextContent("Ready for review");
    fireEvent.click(second);
    expect(navigated).toHaveBeenLastCalledWith({ productionId: 7, tab: "film", sceneId: 21, shotId: 32 });
  });

  it("shows spend by scene and on each shot, with each status drawn as a shape too", async () => {
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [{ id: 7, title: "Rooftop chase" }], "/api/media-studio/productions/7": view });

    const spend = await screen.findByTestId("media-configuration-spend");
    const arrival = within(spend).getByRole("button", { name: "SCENE-01 Arrival: $3.08 spent, $1.50 waiting for approval" });
    expect(arrival).toHaveTextContent("$0.08 of it on keyframes · $1.50 more waiting for approval");
    fireEvent.click(arrival);
    expect(navigated).toHaveBeenLastCalledWith({ productionId: 7, tab: "shots", sceneId: 21 });

    const second = screen.getByTestId("media-configuration-shot-32");
    expect(second).toHaveTextContent("1 line · $1.50");
    expect(second.querySelector('[data-status-icon="ready_for_review"]')).not.toBeNull();
  });

  it("offers to start a production when the room has none", async () => {
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [] });
    expect(await screen.findByTestId("media-configuration-empty")).toHaveTextContent("No production in this room yet");
    fireEvent.click(screen.getByRole("button", { name: "Start a production" }));
    expect(navigated).toHaveBeenCalledWith({ tab: "story" });
  });

  it("explains a load failure and retries", async () => {
    apiRequest.mockRejectedValue(new Error("HTTP 500: Internal Server Error"));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MediaConfigurationRail crewSessionId={3} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The server hit an error.");
    const calls = apiRequest.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(apiRequest.mock.calls.length).toBeGreaterThan(calls);
  });

  it("lets a shot's best take speak for it", () => {
    expect(shotStatus(shot({ takes: [take({ status: "failed" }), take({ id: 2, status: "ready_for_review" })] }))).toBe("ready_for_review");
    expect(shotStatus(shot({ takes: [] }))).toBe("none");
  });
  it("inspects the clip the studio has on screen, and prices the take it can ask for", async () => {
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [view], "/api/media-studio/productions/7": view });
    expect(await screen.findByTestId("media-configuration-rail")).toBeInTheDocument();

    // Nothing selected: the production overview is more use than an empty inspector.
    expect(screen.queryByTestId("clip-inspector")).not.toBeInTheDocument();

    // The studio says what is on screen; the rail is not in its tree, so it listens.
    fireEvent(window, new CustomEvent("media-studio:selection", {
      detail: { productionId: 7, sceneId: 21, sceneKey: "SCENE-01", shotId: 32, shotNumber: 2 },
    }));

    const clip = await screen.findByTestId("clip-inspector");
    expect(within(clip).getByText("Shot 2")).toBeInTheDocument();
    // The billable action carries its price, so a click is never a surprise bill.
    expect(within(clip).getByTestId("clip-inspector-take-btn")).toHaveTextContent("Ask for another take");

    // And the production tools are still one click away.
    fireEvent.click(screen.getByTestId("media-rail-tab-production"));
    expect(screen.queryByTestId("clip-inspector")).not.toBeInTheDocument();
  });

  it("answers a rail that mounts mid-edit by asking the studio what is selected", () => {
    const asked = vi.fn();
    window.addEventListener("media-studio:selection-request", asked);
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [view] });
    expect(asked).toHaveBeenCalled();
    window.removeEventListener("media-studio:selection-request", asked);
  });
  it("shows what the production is waiting on, with progress only where a render reported it", async () => {
    const queueView = production({
      scenes: [scene({
        id: 21,
        shots: [
          shot({ id: 31, takes: [take({ id: 51, status: "rendering", streaming: { totalSteps: 30, currentStep: 18, etaSeconds: 120, activeNodeTitle: "KSampler" } })] }),
          shot({ id: 32, takes: [take({ id: 61, status: "ready_for_review" })] }),
          shot({ id: 33, takes: [take({ id: 71, status: "queued" })] }),
          shot({ id: 34, takes: [take({ id: 81, status: "failed", error: "ffmpeg failed (exit 1)" })] }),
        ],
      })],
    });
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [queueView], "/api/media-studio/productions/7": queueView });
    fireEvent.click(await screen.findByTestId("media-rail-tab-queue"));
    const queue = await screen.findByTestId("render-queue");

    // Both in-flight takes, but only the one that reported steps shows how far along.
    const inFlight = within(queue).getByTestId("render-queue-rendering");
    expect(within(inFlight).getAllByRole("listitem")).toHaveLength(2);
    expect(inFlight).toHaveTextContent("60% · KSampler · 2 min left");
    expect(inFlight).toHaveTextContent("Queued");

    expect(within(queue).getByTestId("render-queue-review")).toHaveTextContent("shot 2 · take 1");
    expect(within(queue).getByTestId("render-queue-failed")).toHaveTextContent("ffmpeg failed (exit 1)");
  });

  it("approves a take from the queue without leaving the edit", async () => {
    const queueView = production({
      scenes: [scene({ id: 21, shots: [shot({ id: 32, takes: [take({ id: 61, status: "ready_for_review" })] })] })],
    });
    renderRail({ "/api/media-studio/productions?crewSessionId=3": [queueView], "/api/media-studio/productions/7": queueView });
    fireEvent.click(await screen.findByTestId("media-rail-tab-queue"));

    fireEvent.click(await screen.findByTestId("render-queue-approve-61"));
    await waitFor(() => expect(apiRequest.mock.calls.some((call: any[]) =>
      call[0] === "POST" && call[1] === "/api/media-studio/takes/61/approve")).toBe(true));
  });
});
