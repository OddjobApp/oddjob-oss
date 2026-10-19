import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateVideoPanel } from "./CreateVideoPanel";
import { keyframe, plotPoint, production, scene, shot, take } from "./fixtures";

vi.mock("@/lib/queryClient", () => ({ resolveActiveOrgId: () => 9 }));

describe("CreateVideoPanel", () => {
  it("persists a scene and shot before requesting a take with the chosen audio setting", async () => {
    const withScene = production({ scenes: [scene()] });
    const withShot = production({ scenes: [scene({ shots: [shot()] })] });
    const act = vi.fn().mockResolvedValueOnce(withScene).mockResolvedValueOnce(withShot).mockResolvedValueOnce(production({ scenes: [scene({ shots: [shot({ takes: [take({ status: "pending_approval" })] })] })] }));
    render(<CreateVideoPanel production={production()} act={act} />);
    fireEvent.change(screen.getByLabelText("Describe your video"), { target: { value: "A bird over the ocean" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "8" } });
    fireEvent.click(screen.getByLabelText("Generate audio with the video"));
    fireEvent.click(screen.getByRole("button", { name: "Generate video" }));
    await waitFor(() => expect(act).toHaveBeenCalledTimes(3));
    expect(act.mock.calls).toEqual([
      ["POST", "/api/media-studio/productions/7/scenes", { title: "My video" }],
      ["POST", "/api/media-studio/scenes/21/shots", { prompt: "A bird over the ocean", durationSeconds: 8, referenceKeyframeId: null }],
      ["POST", "/api/media-studio/shots/31/takes", { generateAudio: false }],
    ]);
    expect(await screen.findByText(/Generation requested/)).toBeInTheDocument();
  });

  it("keeps a saved shot discoverable when the generation request fails", async () => {
    const act = vi.fn().mockResolvedValueOnce(production({ scenes: [scene({ shots: [shot()] })] })).mockRejectedValueOnce(new Error("Budget exceeded"));
    render(<CreateVideoPanel production={production({ scenes: [scene()] })} act={act} />);
    fireEvent.click(screen.getByRole("button", { name: "Nature study" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate video" }));
    expect(await screen.findByText(/Budget exceeded/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Clip saved");
    expect(screen.getByRole("button", { name: "Open Shots" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Generate video" })).toBeDisabled();
    expect(act).toHaveBeenCalledTimes(2);
  });

  it("offers approved reference frames only and sends the selected image", async () => {
    const s = scene({ plotPoints: [plotPoint({ keyframes: [keyframe({ status: "approved" }), keyframe({ id: 42, status: "ready" })] })] });
    const act = vi.fn().mockResolvedValue(production({ scenes: [{ ...s, shots: [shot()] }] }));
    render(<CreateVideoPanel production={production({ scenes: [s] })} act={act} />);
    expect(screen.queryByRole("option", { name: /Frame 42/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Starting frame"), { target: { value: "41" } });
    fireEvent.click(screen.getByRole("button", { name: "Product film" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate video" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/shots", expect.objectContaining({ referenceKeyframeId: 41 })));
  });

  it("labels simulations truthfully and renders playable clips and review actions", async () => {
    const view = production({ video: { ...production().video, configured: false }, scenes: [scene({ shots: [shot({ takes: [take({ videoUrl: "/api/media-studio/assets/8" })] })] })] });
    const act = vi.fn().mockResolvedValue(view);
    const { container } = render(<CreateVideoPanel production={view} act={act} />);
    expect(screen.getByRole("button", { name: "Simulate clip" })).toBeInTheDocument();
    expect(screen.getByText(/simulation only, no video or charge/)).toBeInTheDocument();
    expect(container.querySelector("video")).toHaveAttribute("src", "/api/media-studio/assets/8?orgId=9");
    fireEvent.click(screen.getByRole("button", { name: "Use in reel" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/takes/51/approve"));
    expect(screen.getByRole("link", { name: "Download clip" })).toHaveAttribute("href", "/api/media-studio/assets/8?orgId=9");
  });
});
