import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppArchitecturePlanPod from "./AppArchitecturePlanPod.js";
import * as packaged from "./index.js";

const catalog = {
  analytics_dashboard: { layout: "dashboard", surfaces: ["kpis", "charts"], builder: "mount_builder_pod" },
  spatial_workspace: { layout: "spatial_canvas", surfaces: ["map", "layers"], builder: "mount_builder_pod" },
};

describe("AppArchitecturePlanPod", () => {
  it("is exported through the packaged component registry", () => {
    expect(packaged.AppArchitecturePlanPod).toBe(AppArchitecturePlanPod);
  });

  it("renders the persisted recommendation and previews another archetype", () => {
    render(<AppArchitecturePlanPod plan={{
      appName: "Fleet Intelligence",
      archetype: "spatial_workspace",
      layout: "spatial_canvas",
      surfaces: ["map", "layers"],
      capabilities: ["map", "layers"],
      integrations: [],
      recommendedTool: "mount_builder_pod",
      requiresForgeGeneration: false,
    }} catalog={catalog} />);

    expect(screen.getByText("Fleet Intelligence")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Spatial Workspace/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Analytics Dashboard/i }));
    expect(screen.getByText(/Preview selection only/i)).toBeTruthy();
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });
});
