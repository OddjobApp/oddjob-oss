import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormalVisualCanvas } from "../FormalVisualCanvas.js";

describe("FormalVisualCanvas (Live SMT Visual Assembly)", () => {
  it("should render visual canvas with live proof certified badge", () => {
    render(<FormalVisualCanvas appName="Test Incident Dashboard" />);

    expect(screen.getByText("Test Incident Dashboard")).toBeDefined();
    expect(screen.getByText(/Proof Certified/i)).toBeDefined();
  });

  it("should detect collision when viewport is resized below minimum required width", () => {
    render(
      <FormalVisualCanvas 
        initialBlocks={[
          { id: "b1", name: "Fixed A", type: "sidebar", sizingMode: "fixed", width: 300 },
          { id: "b2", name: "Fixed B", type: "sidebar", sizingMode: "fixed", width: 300 }
        ]} 
      />
    );

    // Initial slider at 1024px passes (300 + 300 + 16 + 32 = 648px <= 1024px)
    expect(screen.getByText(/Proof Certified/i)).toBeDefined();

    // Click mobile preset (375px) -> triggers collision warning (648px > 375px)
    const mobileButton = screen.getByText(/Mobile \(375px\)/i);
    fireEvent.click(mobileButton);

    expect(screen.getByText(/Collision @ W=375px/i)).toBeDefined();
  });

  it("should execute MaxSMT synthesis and generate clamp expressions", async () => {
    render(<FormalVisualCanvas appName="Synthesized App" />);

    const synthesizeButton = screen.getByText(/Magic Responsive Fix \(MaxSMT\)/i);
    fireEvent.click(synthesizeButton);

    // Switch to Generated Code tab
    const codeTab = screen.getByText(/Generated Code/i);
    fireEvent.click(codeTab);

    expect(screen.getByText(/Copy Source Code/i)).toBeDefined();
    expect(screen.getByText(/FormalFlex/i)).toBeDefined();
  });
});
