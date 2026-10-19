/**
 * App Studio UI Tightening Unit Tests
 * Validates:
 * - Architecture complexity & build time indicators
 * - Progressive disclosure of advanced runtime/API settings
 * - Cost & token spend transparency pills
 * - Actionable Error Recovery Card with 1-click rescue
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

vi.mock("@domain-ui/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab", () => ({
  AppInteractiveBuilderTab: () => <div data-testid="builder-stub">Builder Stub</div>,
}));

import AppStudioPod from "../../client/src/modules/apps/AppStudioPod";

let queryClient: QueryClient;

function renderForgePod(props: Record<string, unknown> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppStudioPod mode="forge" {...(props as any)} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ ok: true, json: async () => [] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App Studio UI Tightening — Architecture Selection", () => {
  it("renders complexity and estimated build time badges on archetype cards", () => {
    renderForgePod();

    // Archetype cards should show complexity and estimated time
    expect(screen.getByText(/Simple · ~45s/)).toBeInTheDocument();
    expect(screen.getByText(/Medium · ~1.5m/)).toBeInTheDocument();
    expect(screen.getByText(/Simple · ~30s/)).toBeInTheDocument();
    expect(screen.getByText(/Advanced · ~2.5m/)).toBeInTheDocument();
  });
});

describe("App Studio UI Tightening — Progressive Disclosure (Step 2)", () => {
  it("folds advanced API and scaffold settings into a collapsible summary by default", () => {
    renderForgePod();

    // Navigate to step 2 (Specs)
    const continueBtn = screen.getByTestId("forge-continue-to-specs");
    fireEvent.click(continueBtn);

    // Advanced settings container exists
    const advancedDetails = screen.getByTestId("forge-advanced-settings");
    expect(advancedDetails).toBeInTheDocument();

    // Advanced section shows summary badge with pack count
    expect(screen.getByText(/3 packs active/)).toBeInTheDocument();
    expect(screen.getByText("Advanced Architecture & Runtime Settings")).toBeInTheDocument();
  });
});

describe("App Studio UI Tightening — Cost & Token Transparency (Step 3)", () => {
  /*
    This previously asserted a "Cost & Resource Transparency" pill reading
    "Estimated Run Spend: ~$0.18" and "Soft-Cap: $2.50 · SMT Verified", and a
    header chip reading "Spend: ~$0.14 · 1.4k tokens". Every one of those was a
    string literal — no cost, token or verification data reaches this component —
    so the test pinned invented currency in place rather than any behaviour.

    Inverted: pre-flight must not quote a spend it was never given.
  */
  it("quotes no build cost, because none is measured", () => {
    renderForgePod();

    fireEvent.click(screen.getByTestId("forge-continue-to-specs"));
    fireEvent.click(screen.getByText("Continue to Pre-Flight & Ignition"));

    expect(screen.queryByTestId("forge-cost-pill")).toBeNull();
    expect(screen.queryByTestId("forge-live-spend")).toBeNull();
    expect(screen.queryByText(/Estimated Run Spend/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });
});

describe("App Studio UI Tightening — Actionable Error Recovery Card", () => {
  it("renders actionable rescue button when a build failure occurs", () => {
    renderForgePod({
      jobId: "job-failed-123",
      jobStatus: "failed",
    });

    // Error card is rendered with role alert and data-testid
    const errorCard = screen.getByTestId("forge-build-error");
    expect(errorCard).toBeInTheDocument();
    expect(screen.getByText("Build Interrupted")).toBeInTheDocument();

    // Actionable 1-click rescue button is present
    expect(screen.getByText("1-Click Auto-Rescue & Retry")).toBeInTheDocument();
    expect(screen.getByText("Edit Requirements")).toBeInTheDocument();
  });
});
