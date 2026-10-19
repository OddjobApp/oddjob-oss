import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScaffoldPackPalette } from "../ScaffoldPackPalette.js";

describe("ScaffoldPackPalette UI Component", () => {
  it("should render feature pack items and selected count badge", () => {
    render(
      <ScaffoldPackPalette
        selectedPacks={["core-node-express"]}
        onSelectPack={() => {}}
        onRemovePack={() => {}}
      />
    );

    expect(screen.getByText("Scaffold Feature Packs")).toBeDefined();
    expect(screen.getByText("1 selected")).toBeDefined();
    expect(screen.getByText("Node Express Core")).toBeDefined();
  });

  it("should trigger onSelectPack when clicking Add on a pack", () => {
    let selected = "";
    render(
      <ScaffoldPackPalette
        selectedPacks={[]}
        onSelectPack={(id) => { selected = id; }}
        onRemovePack={() => {}}
      />
    );

    const jwtAddBtn = screen.getAllByRole("button", { name: /Add/i })[0];
    fireEvent.click(jwtAddBtn);

    expect(selected).not.toBe("");
  });
});
