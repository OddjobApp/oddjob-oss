import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ReferenceBoard, referenceSubjects } from "./ReferenceBoard";
import { production, reference, scene } from "./fixtures";

const view = production({
  characters: [
    { id: 1, kind: "character", name: "Elena", description: "a courier", aliases: ["El"] },
    { id: 2, kind: "location", name: "The Archive Roof", description: "a flat concrete roof", aliases: ["Archive rooftop"] },
  ],
  scenes: [scene({ id: 21, location: "Archive rooftop" }), scene({ id: 22, sceneKey: "SCENE-02", location: "Stairwell" })],
  references: [
    reference({ id: 71, name: "Elena", status: "approved", imageUrl: "/api/media-studio/assets/3" }),
    reference({ id: 72, name: "Elena", status: "ready", imageUrl: "/api/media-studio/assets/4" }),
  ],
});

describe("ReferenceBoard", () => {
  beforeEach(() => {
    toast.mockReset();
  });

  it("lists the manuscript's characters and places, and the scenes' own places, once each", () => {
    expect(referenceSubjects(view).map((subject) => [subject.kind, subject.name])).toEqual([
      ["character", "Elena"], ["location", "The Archive Roof"], ["location", "Stairwell"],
    ]);
  });

  it("saves the look", async () => {
    const act = vi.fn(async () => view);
    render(<ReferenceBoard production={view} act={act} />);
    expect(screen.getByRole("button", { name: "Save look" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Look"), { target: { value: "35mm film grain" } });
    fireEvent.click(screen.getByRole("button", { name: "Save look" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PATCH", "/api/media-studio/productions/7", { style: "35mm film grain" }));
  });

  it("shows the reference in use beside a newer one to approve, and renders references for whoever has none", async () => {
    const act = vi.fn(async () => view);
    render(<ReferenceBoard production={view} act={act} />);

    const elena = within(screen.getByTestId("reference-character-elena"));
    expect(elena.getByRole("img", { name: "Reference in use for Elena" })).toHaveAttribute("src", "/api/media-studio/assets/3");
    expect(elena.getByRole("img", { name: "New reference for Elena" })).toHaveAttribute("src", "/api/media-studio/assets/4");
    fireEvent.click(elena.getByRole("button", { name: "Approve the new reference of Elena" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/references/72/approve"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Approved the new reference of Elena", description: "Keyframes that show Elena are rendered with it." }));

    const stairwell = within(screen.getByTestId("reference-location-stairwell"));
    expect(stairwell.getByText("No reference yet")).toBeInTheDocument();
    fireEvent.click(stairwell.getByRole("button", { name: "Render a reference of Stairwell" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/productions/7/references", { kind: "location", name: "Stairwell" }));

    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "character" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Marcus" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), { target: { value: "a guard in a grey uniform" } });
    fireEvent.click(screen.getByRole("button", { name: "Render reference" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/productions/7/references", {
      kind: "character", name: "Marcus", description: "a guard in a grey uniform",
    }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  });
});
