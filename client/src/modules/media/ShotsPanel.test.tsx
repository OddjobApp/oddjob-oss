import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ShotsPanel } from "./ShotsPanel";
import { keyframe, plotPoint, production, scene, shot, take } from "./fixtures";

const elena = { id: 1, kind: "character" as const, name: "Elena", description: "a courier in a rain-soaked trench coat", aliases: [] };

const film = production({
  characters: [elena],
  scenes: [scene({
    id: 21, location: "Archive rooftop", timeOfDay: "night", mood: "tense",
    plotPoints: [plotPoint({ keyframes: [keyframe({ id: 41, status: "approved" })] })],
    shots: [
      shot({ id: 31, referenceKeyframeId: 41, prompt: "Elena crouches behind the parapet", action: "", dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }] }),
      shot({ id: 32, prompt: "Wide on the stairwell", framing: null, lens: null, cameraMotion: null, takes: [take()] }),
    ],
  })],
});

/**
 * The panel is a shot list beside one open editor: every other editor is
 * rendered `hidden`, so it is correctly absent from the accessibility tree
 * until its shot is chosen. Tests reaching a shot's controls have to open it
 * first, exactly as a reader would.
 */
const openShot = (n: number) =>
  fireEvent.click(within(screen.getByRole("navigation", { name: "Shot list" })).getAllByRole("button")[n - 1]);

describe("ShotsPanel", () => {
  it("opens the requested shot when navigation mounts the panel", () => {
    render(<ShotsPanel production={film} act={vi.fn()} focus={{ sceneId: 21, shotId: 32, at: 1 }} />);
    expect(screen.getByTestId("shot-editor-32")).toBeVisible();
    expect(screen.getByTestId("shot-editor-31")).not.toBeVisible();
  });

  it("shows exactly what the video model will be sent, from the scene's direction and the shot's dialogue", () => {
    render(<ShotsPanel production={film} act={vi.fn()} />);
    const preview = screen.getByTestId("compiled-prompt-31");
    expect(preview).toHaveTextContent("Setting: Archive rooftop, night.");
    expect(preview).toHaveTextContent("Shot: medium close-up, 35mm lens, camera slow push-in.");
    expect(preview).toHaveTextContent("Characters: Elena, a courier in a rain-soaked trench coat.");
    expect(preview).toHaveTextContent('Elena (whispering): "Not tonight."');
    expect(screen.getByRole("img", { name: "Reference keyframe for shot 1" })).toBeInTheDocument();
    expect(screen.queryByTestId("shot-warnings-31")).not.toBeInTheDocument();
  });

  it("updates the preview as the author writes, and warns about a speaker the manuscript does not have", () => {
    render(<ShotsPanel production={film} act={vi.fn()} />);
    const editor = within(screen.getByTestId("shot-editor-31"));
    fireEvent.click(editor.getByRole("button", { name: /Add line/ }));
    fireEvent.change(editor.getAllByLabelText("Speaker")[1], { target: { value: "Marcus" } });
    fireEvent.change(editor.getAllByLabelText("Line")[1], { target: { value: "Wait!" } });

    expect(screen.getByTestId("compiled-prompt-31")).toHaveTextContent('Marcus: "Wait!"');
    expect(screen.getByTestId("shot-warnings-31")).toHaveTextContent('"Marcus" is not a character in the manuscript.');
  });

  it("saves the shot's direction and dialogue, leaving out empty lines", async () => {
    const act = vi.fn(async () => film);
    render(<ShotsPanel production={film} act={act} />);
    const editor = within(screen.getByTestId("shot-editor-31"));
    expect(editor.getByRole("button", { name: "Save shot" })).toBeDisabled();

    fireEvent.change(editor.getByLabelText("Action"), { target: { value: "She presses the cylinder to her chest" } });
    fireEvent.click(editor.getByRole("button", { name: /Add line/ }));
    fireEvent.change(editor.getByLabelText("Framing"), { target: { value: " " } });
    fireEvent.click(editor.getByRole("button", { name: "Save shot" }));

    await waitFor(() => expect(act).toHaveBeenCalledWith("PATCH", "/api/media-studio/shots/31", {
      prompt: "Elena crouches behind the parapet", negativePrompt: null, framing: null, lens: "35mm", cameraMotion: "slow push-in",
      action: "She presses the cylinder to her chest", durationSeconds: 5, transition: "cut", referenceKeyframeId: 41,
      dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }],
    }));
  });

  it("asks for a take with its cost, and ends it on the next plot point's approved keyframe when asked", async () => {
    const act = vi.fn(async () => film);
    const framed = production({
      scenes: [scene({
        id: 21,
        plotPoints: [
          plotPoint({ id: 11, keyframes: [keyframe({ id: 41, status: "approved" })] }),
          plotPoint({ id: 12, position: 1, title: "She runs", keyframes: [keyframe({ id: 42, status: "approved" })] }),
        ],
        shots: [shot({ id: 31, plotPointId: 11, referenceKeyframeId: 41 })],
      })],
    });
    render(<ShotsPanel production={framed} act={act} />);

    expect(screen.getByTestId("take-estimate-31")).toHaveTextContent("About $1.52 at 720p, starting from the shot's keyframe. Nothing renders until the take is approved.");
    fireEvent.click(screen.getByLabelText("End on the next plot point's keyframe"));
    fireEvent.click(screen.getByRole("button", { name: /^Ask for a take/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/shots/31/takes", { endOnNextKeyframe: true }));
  });

  it("lists a shot's takes, and offers no end frame for a shot that starts from text", () => {
    render(<ShotsPanel production={film} act={vi.fn()} />);
    expect(screen.getByTestId("take-estimate-32")).toHaveTextContent("About $1.52 at 720p, from text alone.");
    expect(within(screen.getByTestId("take-controls-32")).getByLabelText("End on the next plot point's keyframe")).toBeDisabled();
    expect(screen.getByTestId("take-list-32")).toHaveTextContent("Take 1Ready for review$1.50");
  });

  it("will not ask for a take of an unsaved shot or one Seedance cannot render, and says when takes are simulations", () => {
    const simulated = production({ ...film, video: { ...film.video, configured: false } });
    const { rerender } = render(<ShotsPanel production={simulated} act={vi.fn()} />);
    const controls = within(screen.getByTestId("take-controls-31"));
    expect(screen.getByTestId("take-estimate-31")).toHaveTextContent("fal.ai is not set up here, so a take is recorded as a simulation: no video and no charge.");

    fireEvent.change(within(screen.getByTestId("shot-editor-31")).getByLabelText("Action"), { target: { value: "She runs" } });
    expect(controls.getByRole("button", { name: /^Ask for a take/ })).toBeDisabled();
    expect(controls.getByText("Save the shot before asking for a take.")).toBeInTheDocument();

    const long = production({ ...film, scenes: [scene({ ...film.scenes[0], shots: [shot({ id: 31, durationSeconds: 20 })] })] });
    rerender(<ShotsPanel production={long} act={vi.fn()} />);
    expect(within(screen.getByTestId("take-controls-31")).getByText("Seedance renders 4 to 15 seconds; this shot is 20.")).toBeInTheDocument();
  });

  it("orders, adds and removes shots, confirming before removing one with takes", async () => {
    const act = vi.fn(async () => film);
    render(<ShotsPanel production={film} act={act} />);
    openShot(2);
    // Shot 2 has takes, so the delete is held behind a confirmation the reader has to
    // answer. Nothing is sent until they do.
    fireEvent.click(screen.getByRole("button", { name: "Remove shot 2" }));
    expect(act).not.toHaveBeenCalledWith("DELETE", "/api/media-studio/shots/32");
    fireEvent.click(await screen.findByRole("button", { name: "Delete shot and takes" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("DELETE", "/api/media-studio/shots/32"));
    openShot(1);

    fireEvent.click(screen.getByRole("button", { name: "Move shot 1 down" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/scenes/21/shots/order", { ids: [32, 31] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove shot 1" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("DELETE", "/api/media-studio/shots/31"));
    fireEvent.click(screen.getByRole("button", { name: /Add shot/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/shots", {}));
  });

  it("renders clear guidance and actions when a take fails due to exhausted provider balance", () => {
    const errorMsg = "The keyframe could not be uploaded to fal.ai: fal.ai returned 403: User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing";
    const failedFilm = production({
      scenes: [scene({
        id: 21,
        shots: [shot({
          id: 33,
          takes: [take({ id: 99, takeNumber: 1, status: "failed", error: errorMsg })],
        })],
      })],
    });

    render(<ShotsPanel production={failedFilm} act={vi.fn()} />);
    const errorCard = screen.getByTestId("take-error-99");
    expect(errorCard).toBeInTheDocument();
    expect(errorCard).toHaveTextContent("fal.ai credit balance is exhausted.");
    const topUpLink = within(errorCard).getByRole("link", { name: /Top up fal.ai balance/ });
    expect(topUpLink).toHaveAttribute("href", "https://fal.ai/dashboard/billing");
    expect(topUpLink).toHaveAttribute("target", "_blank");
  });

  it("adds a dialogue coverage package with one click", async () => {
    const act = vi.fn(async () => film);
    render(<ShotsPanel production={film} act={act} />);

    const dialogueBtn = screen.getByTestId("coverage-dialogue-21");
    expect(dialogueBtn).toBeInTheDocument();
    fireEvent.click(dialogueBtn);

    await waitFor(() => expect(act).toHaveBeenCalledWith(
      "POST",
      "/api/media-studio/scenes/21/coverage",
      { template: "dialogue" }
    ));
  });

  it("queues takes for all unapproved shots in the scene in one click", async () => {
    const act = vi.fn(async () => film);
    render(<ShotsPanel production={film} act={act} />);

    const queueBtn = screen.getByTestId("batch-takes-btn-21");
    expect(queueBtn).toBeInTheDocument();
    expect(queueBtn).toHaveTextContent("Queue Scene Takes (1)");
    fireEvent.click(queueBtn);

    await waitFor(() => expect(act).toHaveBeenCalledWith(
      "POST",
      "/api/media-studio/scenes/21/batch-takes",
      {}
    ));
  });

  it("auto-orchestrates a shot prompt from scene location, lighting, and characters", async () => {
    const act = vi.fn(async () => film);
    render(<ShotsPanel production={film} act={act} />);
    openShot(1);

    const orchestrateBtn = screen.getByTestId("auto-orchestrate-31");
    expect(orchestrateBtn).toBeInTheDocument();
    fireEvent.click(orchestrateBtn);

    await waitFor(() => expect(act).toHaveBeenCalledWith(
      "POST",
      "/api/media-studio/shots/31/orchestrate",
      expect.objectContaining({ action: "Elena crouches behind the parapet" })
    ));
  });

  it("appends style modifier chips to the shot prompt without typing", () => {
    render(<ShotsPanel production={film} act={vi.fn()} />);
    openShot(1);

    const chipBar = screen.getByTestId("prompt-chips-31");
    expect(chipBar).toBeInTheDocument();
    const goldenHourChip = within(chipBar).getByText("+ Golden hour rim light");
    fireEvent.click(goldenHourChip);

    const promptTextarea = within(screen.getByTestId("shot-editor-31")).getByLabelText("What the shot shows");
    expect(promptTextarea).toHaveValue("Elena crouches behind the parapet, Golden hour rim light");
  });
});
