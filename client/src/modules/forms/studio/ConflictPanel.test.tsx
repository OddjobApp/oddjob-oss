import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictPanel } from "./ConflictPanel";

/**
 * The live two-session check showed each version of a conflicting page as raw
 * JSON. The panel now shows only what differs, by property name.
 */

const pageConflict = {
  id: "pages:page_1", scope: "collection" as const, collection: "pages" as const, key: "page_1", label: 'Page "Title from this tab"',
  base: { id: "page_1", title: "Page one", html: "" },
  mine: { id: "page_1", title: "Title from this tab", html: "" },
  theirs: { id: "page_1", title: "Title from the other session", html: "" },
};

describe("ConflictPanel", () => {
  it("shows the differing property in words, not the two objects", () => {
    render(<ConflictPanel conflicts={[pageConflict]} onResolve={vi.fn()} />);
    const row = screen.getByRole("row", { name: /Title/ });
    expect(row).toHaveTextContent("Title from this tab");
    expect(row).toHaveTextContent("Title from the other session");
    expect(screen.queryByText(/"id"/)).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Text/ })).not.toBeInTheDocument();
  });

  it("says which side removed a unit the other changed", () => {
    render(<ConflictPanel conflicts={[{ ...pageConflict, mine: undefined }]} onResolve={vi.fn()} />);
    expect(screen.getByText("You removed it; the saved version changed it.")).toBeInTheDocument();
    expect(screen.getByLabelText("Keep it removed")).toBeInTheDocument();
  });

  it("resolves with the author's choice", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(<ConflictPanel conflicts={[pageConflict]} onResolve={onResolve} />);
    await user.click(screen.getByLabelText("Keep yours"));
    await user.click(screen.getByRole("button", { name: "Apply and save" }));
    expect(onResolve).toHaveBeenCalledWith({ "pages:page_1": "mine" });
  });
});
