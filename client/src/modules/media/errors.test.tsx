import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describeStudioError } from "./errors";
import { StudioErrorAlert } from "./StudioErrorAlert";

describe("studio error guidance", () => {
  it("adds what to do, and where, to what the server said", () => {
    expect(describeStudioError(new Error("This take would take Rooftop chase past its budget: $3.12 of $3.30 is spent or waiting for approval."))).toEqual({
      message: "This take would take Rooftop chase past its budget: $3.12 of $3.30 is spent or waiting for approval.",
      fix: "Raise the budget in Story, shorten the shot, or withdraw takes still waiting for approval.",
      action: { label: "Open the budget", location: { tab: "story" } },
    });
    expect(describeStudioError(new Error("Seedance renders 4 to 15 seconds; this shot is 20. Change its length first."))).toMatchObject({ action: { label: "Open Shots", location: { tab: "shots" } } });
    expect(describeStudioError(new Error("Take 3 was already approved and sent to fal.ai, so it can't be withdrawn and its cost stands.")).fix)
      .toBe("That render is already paid for. Review it when it is ready, and reject it if it isn't right.");
  });

  it("turns session, network and server failures into something to do", () => {
    expect(describeStudioError(new Error("Unauthorized"))).toMatchObject({ message: "You are signed out.", action: { label: "Sign in", href: "/auth/login" } });
    expect(describeStudioError(new TypeError("Failed to fetch")).message).toBe("The server did not answer.");
    expect(describeStudioError(new Error("HTTP 500: Internal Server Error")).fix).toBe("The server hit an error. Retry, and if it keeps failing, check the server log for this request.");
    expect(describeStudioError(new Error("HTTP 404: "))).toMatchObject({ message: "That did not work.", fix: "It may have been deleted, or it belongs to a production you can't open. Refresh the studio." });
    expect(describeStudioError("something odd")).toEqual({ message: "something odd", fix: "Try again. If it keeps happening, refresh the studio." });
  });

  it("turns fal.ai exhausted balance and provider lockouts into clear guidance with direct billing link", () => {
    const raw = "The keyframe could not be uploaded to fal.ai: fal.ai returned 403: User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing";
    const guidance = describeStudioError(new Error(raw));
    expect(guidance.message).toBe("fal.ai credit balance is exhausted.");
    expect(guidance.fix).toContain("Your fal.ai account balance has run out.");
    expect(guidance.actions).toEqual([
      { label: "Top up fal.ai balance", href: "https://fal.ai/dashboard/billing" },
      { label: "Switch engine in Story", location: { tab: "story" } },
    ]);

    render(<StudioErrorAlert error={new Error(raw)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("fal.ai credit balance is exhausted.");
    const link = screen.getByRole("link", { name: /Top up fal.ai balance/ });
    expect(link).toHaveAttribute("href", "https://fal.ai/dashboard/billing");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByRole("button", { name: "Switch engine in Story" })).toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getByText(raw)).toBeInTheDocument();
  });

  it("shows the guidance with its quick action, retry and dismiss", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const navigated = vi.fn();
    window.addEventListener("media-studio:navigate", (event) => navigated((event as CustomEvent).detail));
    render(<StudioErrorAlert error={new Error("Describe what the shot shows before asking for a take.")} onRetry={onRetry} onDismiss={onDismiss} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Describe what the shot shows before asking for a take.Write what the shot shows");
    fireEvent.click(screen.getByRole("button", { name: "Open Shots" }));
    expect(navigated).toHaveBeenCalledWith({ tab: "shots" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
