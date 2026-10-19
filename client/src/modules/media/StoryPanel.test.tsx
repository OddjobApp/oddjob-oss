import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { StoryPanel } from "./StoryPanel";
import { production, scene } from "./fixtures";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function answer(routes: Record<string, unknown>) {
  apiRequest.mockImplementation(async (_method: string, url: string) => ok(routes[url] ?? []));
}

function renderStory(view = production(), act = vi.fn(async () => view)) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StoryPanel production={view} act={act} />
    </QueryClientProvider>,
  );
  return act;
}

describe("StoryPanel", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("links a manuscript from the room's list", async () => {
    answer({ "/api/media-studio/productions/7/scribe-documents": [{ id: 5, title: "The Archive", updatedAt: "2026-09-13T00:00:00Z" }] });
    const act = renderStory();
    const select = screen.getByLabelText("Scribe manuscript");
    await waitFor(() => expect(within(select).getByRole("option", { name: "The Archive" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "5" } });
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/productions/7/scribe-document", { documentId: 5 }));
  });

  it("says when there is no manuscript to link", async () => {
    answer({});
    renderStory();
    expect(await screen.findByText("No Scribe manuscripts here yet. Write the story in Scribe Studio, then link it.")).toBeInTheDocument();
  });

  it("with a manuscript linked, makes scenes from it, lists its characters, and links a scene to a station", async () => {
    answer({
      "/api/media-studio/productions/7/scribe-documents": [{ id: 5, title: "The Archive", updatedAt: "2026-09-13T00:00:00Z" }],
      "/api/media-studio/productions/7/scribe-stations": [{ id: 91, title: "Ordinary World" }, { id: 92, title: "The Call" }],
    });
    const view = production({
      scribeDocumentId: 5, scribeDocumentTitle: "The Archive",
      characters: [{ id: 1, kind: "character", name: "Elena", description: "a courier", aliases: [] }],
      scenes: [scene({ id: 21, scribeNodeId: 91, station: { title: "Ordinary World", excerpt: "Elena couriers sealed cylinders.", changed: false } })],
    });
    const act = renderStory(view);

    expect(screen.getByTestId("story-characters")).toHaveTextContent("Elena · character · a courier");
    expect(screen.getByTestId("scene-station-21")).toHaveTextContent("Ordinary World. Elena couriers sealed cylinders.");

    fireEvent.click(screen.getByRole("button", { name: "Make scenes from the manuscript's stations" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/productions/7/scenes/from-scribe"));

    const station = screen.getByLabelText("Told in station");
    await waitFor(() => expect(within(station).getByRole("option", { name: "The Call" })).toBeInTheDocument());
    fireEvent.change(station, { target: { value: "92" } });
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/scenes/21/station", { scribeNodeId: 92 }));
  });

  it("shows what is spent, and saves a new budget in cents", async () => {
    answer({});
    const act = renderStory();
    const budget = within(screen.getByTestId("story-budget"));
    expect(budget.getByText(/\$0\.04 of \$25\.00 spent/)).toHaveTextContent("A 5-second take costs about $1.52 at 720p.");
    expect(budget.getByRole("button", { name: "Save budget" })).toBeDisabled();

    fireEvent.change(budget.getByLabelText("Budget in dollars"), { target: { value: "100" } });
    fireEvent.click(budget.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PATCH", "/api/media-studio/productions/7", { budgetLimitCents: 10000 }));
  });

  it("saves a scene's direction, and adds a scene", async () => {
    answer({});
    const view = production({ scenes: [scene({ id: 21, title: "Arrival", location: "", timeOfDay: "", mood: "" })] });
    const act = renderStory(view);
    const card = within(screen.getByTestId("scene-card-21"));
    expect(card.getByRole("button", { name: "Save scene" })).toBeDisabled();

    fireEvent.change(card.getByLabelText("Location"), { target: { value: "Archive rooftop" } });
    fireEvent.change(card.getByLabelText("Time of day"), { target: { value: "night" } });
    fireEvent.change(card.getByLabelText("Mood"), { target: { value: "tense, cold light" } });
    fireEvent.click(card.getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PATCH", "/api/media-studio/scenes/21", {
      title: "Arrival", synopsis: "Elena reaches the roof.", location: "Archive rooftop", timeOfDay: "night", mood: "tense, cold light",
    }));

    fireEvent.change(screen.getByLabelText("New scene"), { target: { value: "The chase" } });
    fireEvent.click(screen.getByRole("button", { name: /Add scene/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/productions/7/scenes", { title: "The chase" }));
  });
});
