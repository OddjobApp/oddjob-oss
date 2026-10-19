import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { studioDefinitionSchema } from "@shared/form-studio";
import { StudioRenderer } from "./StudioRenderer";

vi.mock("@domain-ui/core/ui/components/shared/LocationPicker", () => ({ LocationPicker: () => <div>map</div> }));

/**
 * The Studio renderer runs the shared engine in the browser: each page is checked
 * before moving on, pages that do not apply are skipped, and a respondent sees
 * only their result blocks.
 */

const definition = studioDefinitionSchema.parse({
  fields: [
    { key: "line", label: "Line of business", type: "select", required: true, pageId: "about", options: ["lending", "insurance"] },
    { key: "apr", label: "APR", type: "number", required: true, pageId: "lending", unit: "%" },
    { key: "calls", label: "Calls reviewed", type: "number", required: true, pageId: "scores" },
    { key: "passed", label: "Calls passed", type: "number", required: true, pageId: "scores" },
    { key: "pass_rate", label: "Pass rate", type: "computed", formula: "passed / calls * 100", format: "percent", pageId: "scores" },
    { key: "clarity", label: "Clarity", type: "rating", scale: "five", pageId: "scores" },
  ],
  studio: {
    version: 2,
    pages: [
      { id: "about", title: "About the call", html: "<p>Intro</p><script>window.hacked = true</script>" },
      { id: "lending", title: "Lending", visibleWhen: "line == 'lending'" },
      { id: "scores", title: "Scores" },
    ],
    scales: [{ id: "five", label: "Five point", min: 1, max: 5, anchors: { "1": "Poor", "5": "Excellent" } }],
    decisionRules: [{ id: "ok", when: "pass_rate >= 90", status: "CERTIFIED" }],
    defaultStatus: "REVIEW",
    results: [
      { id: "rate", title: "Pass rate", type: "score", audience: "respondent", field: "pass_rate", bands: [{ min: 90, max: 100, label: "On target", tone: "good" }] },
      { id: "internal", title: "Reviewer notes", type: "narrative", html: "<p>internal</p>" },
    ],
  },
});

describe("StudioRenderer", () => {
  it("checks each page before moving on, and skips a page that does not apply", async () => {
    const user = userEvent.setup();
    render(<StudioRenderer definition={definition} />);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Line of business/)).toHaveAttribute("aria-invalid", "true");

    await user.selectOptions(screen.getByLabelText(/Line of business/), "insurance");
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("heading", { name: "Scores" })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("shows the lending page once lending is chosen", async () => {
    const user = userEvent.setup();
    render(<StudioRenderer definition={definition} />);
    await user.selectOptions(screen.getByLabelText(/Line of business/), "lending");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Lending" })).toBeInTheDocument();
  });

  it("computes values live, reviews the answers, and shows a respondent only their results in preview", async () => {
    const user = userEvent.setup();
    render(<StudioRenderer definition={definition} initialInputs={{ line: "insurance" }} />);
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.type(screen.getByLabelText(/Calls reviewed/), "20");
    await user.type(screen.getByLabelText(/Calls passed/), "19");
    expect(screen.getByText("95%")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /5\s*Excellent/ }));

    await user.click(screen.getByRole("button", { name: "Review" }));
    const review = screen.getByTestId("studio-renderer-review");
    expect(within(review).getByText("insurance")).toBeInTheDocument();
    expect(within(review).getByText("95%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText("Preview only: nothing was stored.")).toBeInTheDocument();
    expect(screen.getByTestId("result-rate")).toHaveTextContent("On target");
    expect(screen.queryByTestId("result-internal")).not.toBeInTheDocument();
  });

  it("sends the answers to a live submission and shows the results it returns", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ results: [{ id: "rate", title: "Pass rate", audience: "respondent", type: "score", value: 50, band: null }] });
    const single = studioDefinitionSchema.parse({ ...definition, studio: { ...definition.studio, navigation: { mode: "single", reviewBeforeSubmit: false } } });
    render(<StudioRenderer definition={single} onSubmit={onSubmit} initialInputs={{ line: "insurance" }} />);

    await user.type(screen.getByLabelText(/Calls reviewed/), "2");
    await user.type(screen.getByLabelText(/Calls passed/), "1");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith({ line: "insurance", calls: "2", passed: "1" });
    expect(await screen.findByText("Submitted")).toBeInTheDocument();
    expect(screen.getByTestId("result-rate")).toHaveTextContent("50");
  });

  it("shows only the pages of the stage being filled in", () => {
    const staged = studioDefinitionSchema.parse({
      ...definition,
      studio: {
        ...definition.studio,
        stages: [
          { id: "agent", title: "Agent", pageIds: ["about", "lending"], assignee: { type: "respondent" } },
          { id: "qa", title: "QA", pageIds: ["scores"], assignee: { type: "role", role: "qa" } },
        ],
      },
    });
    render(<StudioRenderer definition={staged} stageId="qa" />);
    expect(screen.getByRole("heading", { name: "Scores" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "About the call" })).not.toBeInTheDocument();
  });

  it("removes scripts from authored page HTML", () => {
    const { container } = render(<StudioRenderer definition={definition} />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
