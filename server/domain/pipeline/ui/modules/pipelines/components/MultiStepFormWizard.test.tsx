import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MultiStepFormWizard from "./MultiStepFormWizard";

afterEach(cleanup);

describe("MultiStepFormWizard", () => {
  const sampleSteps = [
    {
      id: "step_1",
      title: "Step 1: Identity",
      description: "Provide your name",
      fields: [
        { key: "fullName", label: "Full Name", type: "text" as const, required: true },
      ],
    },
    {
      id: "step_2",
      title: "Step 2: Choices",
      description: "Choose your preferences",
      fields: [
        { key: "role", label: "Role", type: "select" as const, options: ["Admin", "User"], defaultValue: "User" },
      ],
    },
  ];

  it("renders multi-step pages and navigates through steps to submission", async () => {
    const onComplete = vi.fn();
    render(
      <MultiStepFormWizard
        steps={sampleSteps}
        onComplete={onComplete}
      />
    );

    // First page should be displayed
    expect(screen.getByText("Step 1: Identity")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument();

    // Fill in required field
    fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: "John Doe" } });

    // Click Next
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Second page should be displayed
    expect(await screen.findByText("Step 2: Choices")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

    // Click Review
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    // Review phase should appear
    expect(await screen.findByText("Review your answers")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Click Submit
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "John Doe",
        role: "User",
      })
    );
  });

  it("supports cancel button if onCancel is provided", () => {
    const onCancel = vi.fn();
    render(
      <MultiStepFormWizard
        steps={sampleSteps}
        onComplete={vi.fn()}
        onCancel={onCancel}
      />
    );

    const cancelButton = screen.getByRole("button", { name: /Cancel form/i });
    expect(cancelButton).toBeInTheDocument();
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
