import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CharacterStudio } from "./CharacterStudio";
import { production } from "./fixtures";
import { BARNABY_VANCE } from "@shared/character";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockImplementation(async (_method: string, url: string) => ({
    ok: true,
    json: async () => {
      if (url.includes("/cinematic-catalog")) {
        return {
          characters: [BARNABY_VANCE],
        };
      }
      if (url.includes("/style-bible")) {
        return {
          look: "1920s Weimar noir",
          canonicalCharacters: [],
        };
      }
      if (url.includes("/verify-drift")) {
        return {
          passed: true,
          meanSimilarityScore: 0.86,
          threshold: 0.72,
          action: "ACCEPT",
        };
      }
      return {};
    },
  })),
}));

function renderStudio(prod = production({ projectId: 12 })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CharacterStudio production={prod} />
    </QueryClientProvider>
  );
}

describe("CharacterStudio", () => {
  it("renders character studio with master character Barnaby Vance and portrait", async () => {
    renderStudio();
    expect(screen.getByTestId("character-studio")).toBeInTheDocument();
    expect(screen.getAllByText("Barnaby Vance").length).toBeGreaterThan(0);
    expect(screen.getByText(/lean, broad-shouldered artisan build/)).toBeInTheDocument();
    expect(screen.getByTestId("character-header-portrait")).toHaveAttribute(
      "src",
      "/assets/characters/barnaby_portrait.jpg"
    );
  });

  it("displays invariant phenotype descriptors, portrait, and compiled prompt preview", () => {
    renderStudio();
    expect(screen.getAllByText(/gentle friendly jawline/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/warm expressive hazel eyes/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("character-canonical-portrait")).toHaveAttribute(
      "src",
      "/assets/characters/barnaby_portrait.jpg"
    );
    expect(screen.getByText(/Cinematic medium close-up shot of Barnaby Vance/)).toBeInTheDocument();
  });

  it("switches to wardrobe tab and shows outfit details and prohibited elements", () => {
    renderStudio();
    fireEvent.click(screen.getByTestId("tab-wardrobe"));
    expect(screen.getByText("Active Layer Configuration:")).toBeInTheDocument();
    expect(screen.getByText(/hand-stitched heavy tan canvas apron/)).toBeInTheDocument();
    expect(screen.getByText(/modern graphics/)).toBeInTheDocument();
  });

  it("switches to turnaround tab and renders master turnaround sheet artwork with calibrated crops", () => {
    renderStudio();
    fireEvent.click(screen.getByTestId("tab-turnaround"));
    expect(screen.getByText("Angle & Crop Selector")).toBeInTheDocument();
    expect(screen.getByText(/Turnaround Sheet Visual Calibrator/)).toBeInTheDocument();
    expect(screen.getByTestId("turnaround-sheet-image")).toHaveAttribute(
      "src",
      "/assets/characters/barnaby_turnaround.jpg"
    );

    const headshotBtn = screen.getByTestId("crop-select-headshot_neutral");
    fireEvent.click(headshotBtn);
    expect(screen.getAllByText("headshot_neutral").length).toBeGreaterThan(0);
  });

  it("switches character using cast quick switcher pill", () => {
    renderStudio();
    const pipPill = screen.getByTestId("cast-pill-char_pip_pup_01");
    fireEvent.click(pipPill);
    expect(screen.getAllByText("Pip the Pup").length).toBeGreaterThan(0);
    expect(screen.getByText(/Golden Retriever canine companion/)).toBeInTheDocument();
    expect(screen.getByTestId("character-header-portrait")).toHaveAttribute(
      "src",
      "/assets/characters/pip_portrait.jpg"
    );
  });

  it("switches to Face QA drift tab and handles drift simulations", async () => {
    renderStudio();
    fireEvent.click(screen.getByTestId("tab-qa"));
    expect(screen.getByText(/InsightFace \/ ArcFace Cosine Similarity QA/)).toBeInTheDocument();

    const banner = screen.getByTestId("drift-status-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/Identity Consistent/)).toBeInTheDocument();

    // Trigger drifting preset
    const driftBtn = screen.getByText("Preset: Drifting Take (0.62)");
    fireEvent.click(driftBtn);

    await waitFor(() => {
      expect(screen.getByTestId("drift-status-banner")).toBeInTheDocument();
    });
  });

  it("handles saving to Project Space Style Bible", async () => {
    renderStudio();
    const saveBtn = screen.getByTestId("save-character-bible-btn");
    expect(saveBtn).toBeInTheDocument();
    fireEvent.click(saveBtn);
  });
});
