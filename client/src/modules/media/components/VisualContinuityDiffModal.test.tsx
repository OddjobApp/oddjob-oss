import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisualContinuityDiffModal } from "./VisualContinuityDiffModal";
import { keyframe, plotPoint, production } from "../fixtures";

describe("VisualContinuityDiffModal", () => {
  const currentKeyframe = keyframe({
    id: 101,
    imageUrl: "/api/media-studio/assets/101.png",
    status: "ready",
  });

  const previousKeyframe = keyframe({
    id: 100,
    imageUrl: "/api/media-studio/assets/100.png",
    status: "approved",
  });

  const currentPlotPoint = plotPoint({
    id: 2,
    title: "Measuring the Coffee",
    beat: "Martin measures coffee grounds.",
  });

  const prod = production({
    references: [
      {
        id: 28,
        name: "Martin",
        kind: "character",
        imageUrl: "/api/media-studio/assets/28.png",
        status: "approved",
        prompt: "Middle-aged man in flannel pajamas",
        costCents: 0,
        error: null,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  it("renders when open and displays candidate keyframe and previous keyframe target", () => {
    render(
      <VisualContinuityDiffModal
        open={true}
        onOpenChange={vi.fn()}
        currentKeyframe={currentKeyframe}
        plotPoint={currentPlotPoint}
        previousKeyframe={previousKeyframe}
        previousPlotPointTitle="Standing in Kitchen"
        production={prod}
      />,
    );

    expect(screen.getByTestId("visual-continuity-diff-modal")).toBeInTheDocument();
    expect(screen.getByText(/Visual Continuity Diff · Measuring the Coffee/)).toBeInTheDocument();
    expect(screen.getByTestId("diff-target-prev-keyframe")).toBeInTheDocument();
    expect(screen.getByTestId("diff-target-ref-28")).toBeInTheDocument();
  });

  it("switches modes between split, difference, onion skin, and flicker", () => {
    render(
      <VisualContinuityDiffModal
        open={true}
        onOpenChange={vi.fn()}
        currentKeyframe={currentKeyframe}
        plotPoint={currentPlotPoint}
        previousKeyframe={previousKeyframe}
        production={prod}
      />,
    );

    // Initial split mode
    expect(screen.getByTestId("mode-split-btn")).toBeInTheDocument();
    expect(screen.getByTestId("split-slider-handle")).toBeInTheDocument();

    // Switch to difference heatmap
    fireEvent.click(screen.getByTestId("mode-difference-btn"));
    expect(screen.getByTestId("difference-view")).toBeInTheDocument();
    expect(screen.getByText(/Black = Identical pixels/)).toBeInTheDocument();

    // Switch to onion skinning
    fireEvent.click(screen.getByTestId("mode-onion-btn"));
    expect(screen.getByTestId("onion-view")).toBeInTheDocument();

    // Switch to A/B flicker
    fireEvent.click(screen.getByTestId("mode-flicker-btn"));
    expect(screen.getByTestId("flicker-view")).toBeInTheDocument();
  });

  it("calls onApprove and onReject when buttons are clicked", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    render(
      <VisualContinuityDiffModal
        open={true}
        onOpenChange={vi.fn()}
        currentKeyframe={currentKeyframe}
        plotPoint={currentPlotPoint}
        previousKeyframe={previousKeyframe}
        production={prod}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByTestId("modal-approve-btn"));
    expect(onApprove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("modal-reject-btn"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
