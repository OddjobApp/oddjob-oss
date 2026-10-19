import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectMediaTab } from "./ProjectMediaTab";

function renderTab(body: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => body } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectMediaTab projectKey="films" />
    </QueryClientProvider>,
  );
}

describe("ProjectMediaTab", () => {
  it("lists the project's productions with what they hold, what they spent, and their room", async () => {
    renderTab({
      productions: [
        {
          id: 7, title: "Rooftop chase", aspectRatio: "2.39:1", updatedAt: "2026-09-13T00:00:00.000Z",
          scenes: 3, shots: 1, approvedTakes: 1, reels: 0, spendCents: 460, budgetLimitCents: 10000,
          room: { sessionKey: "room-7", title: "Night shoot" },
        },
        {
          id: 8, title: "Night market", aspectRatio: "16:9", updatedAt: "2026-09-12T00:00:00.000Z",
          scenes: 1, shots: 2, approvedTakes: 0, reels: 1, spendCents: 0, budgetLimitCents: 10000, room: null,
        },
      ],
    });

    const first = await screen.findByTestId("project-production-7");
    expect(first).toHaveTextContent("Rooftop chase");
    expect(first).toHaveTextContent("3 scenes · 1 shot · 1 approved take · 0 reels");
    expect(first).toHaveTextContent("$4.60 of $100.00 spent");
    expect(screen.getByTestId("project-production-room-7")).toHaveAttribute("href", "/workspace/chat/room-7");
    expect(screen.getByTestId("project-production-room-7")).toHaveTextContent("Open in Night shoot");
    expect(screen.getByTestId("project-production-8")).toHaveTextContent("Not made in a room");
  });

  it("says how to start a film when the project has none", async () => {
    renderTab({ productions: [] });
    expect(await screen.findByText(/No films belong to this project yet/)).toBeInTheDocument();
  });
});
