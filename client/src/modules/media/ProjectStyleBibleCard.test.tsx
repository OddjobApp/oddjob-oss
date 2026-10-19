import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectStyleBibleCard } from "./ProjectStyleBibleCard";
import { production } from "./fixtures";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockImplementation(async (_method: string, url: string) => ({
    ok: true,
    json: async () => {
      if (url.includes("/style-bible")) {
        return {
          look: "1920s Weimar noir, chiaroscuro",
          period: "1920s",
          costumeGuidelines: "Heavy wool trench coats",
          negativePrompt: "wristwatches, modern cars",
          canonicalCharacters: [{ name: "Elena", kind: "character", description: "Sharp jawline" }],
        };
      }
      return {};
    },
  })),
}));

function renderCard(prod = production({ projectId: 12 })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectStyleBibleCard production={prod} />
    </QueryClientProvider>,
  );
}

describe("ProjectStyleBibleCard", () => {
  it("renders room-local warning when production has no projectId", () => {
    renderCard(production({ projectId: null }));
    expect(screen.getByTestId("project-style-bible-local")).toHaveTextContent("Room-Local Production");
  });

  it("renders Project Space Style Bible card when linked to a project", async () => {
    renderCard(production({ projectId: 12, style: "1920s Weimar noir, chiaroscuro" }));
    expect(await screen.findByTestId("project-style-bible-card")).toBeInTheDocument();
    expect(await screen.findByText("1920s")).toBeInTheDocument();
    expect(screen.getByText(/Heavy wool trench coats/)).toBeInTheDocument();
    expect(screen.getByText("Elena")).toBeInTheDocument();
    expect(screen.getByText("Inherited")).toBeInTheDocument();
  });
});
