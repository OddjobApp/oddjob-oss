import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FilmBriefPod from "@domain-ui/core/ui/components/packaged/FilmBriefPod";

describe("FilmBriefPod", () => {
  it("sends the production's title and aspect ratio, and nothing without a title", () => {
    const onComplete = vi.fn();
    render(<FilmBriefPod onComplete={onComplete} />);
    const start = screen.getByRole("button", { name: "Start the film" });
    expect(start).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Rooftop chase " } });
    fireEvent.change(screen.getByLabelText("Aspect ratio"), { target: { value: "2.39:1" } });
    fireEvent.click(start);
    expect(onComplete).toHaveBeenCalledWith({ productionTitle: "Rooftop chase", aspectRatio: "2.39:1" });
  });
});
