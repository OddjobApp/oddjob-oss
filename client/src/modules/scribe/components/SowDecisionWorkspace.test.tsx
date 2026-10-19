import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SowDecisionWorkspace } from "./SowDecisionWorkspace";

const node = {
  id: 7, title: "2. Scope of Services", stationKey: "scope", content: "Original author text.",
  sortOrder: 1, wordCount: 3, status: "draft",
} as any;

describe("canvas-first SOW workspace", () => {
  it("keeps assistant guidance outside the manuscript and saves only explicit author edits", () => {
    const onSaveContent = vi.fn();
    render(<SowDecisionWorkspace title="Manuscript / Agreement" nodes={[node]} activeNode={node} annotations={[]} onSelectNode={vi.fn()} onSaveContent={onSaveContent} />);

    const manuscript = screen.getByLabelText("Edit manuscript");
    expect(manuscript).toHaveValue("Original author text.");
    fireEvent.click(screen.getByRole("button", { name: "Answer in a note" }));
    fireEvent.change(screen.getByLabelText("Assistant note"), { target: { value: "Exclude warehousing." } });
    expect(manuscript).toHaveValue("Original author text.");
    expect(onSaveContent).not.toHaveBeenCalled();

    fireEvent.change(manuscript, { target: { value: "Edited by the author." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSaveContent).toHaveBeenCalledWith(7, "Edited by the author.");
  });

  it("exposes questions, structure, continuity, and branch modes", () => {
    render(<SowDecisionWorkspace title="SOW" nodes={[node]} activeNode={node} annotations={[]} onSelectNode={vi.fn()} onSaveContent={vi.fn()} />);
    for (const mode of ["Questions", "Structure", "Continuity", "Branches"]) expect(screen.getByRole("button", { name: mode })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(screen.getByText("Explore without replacing")).toBeVisible();
  });
});
