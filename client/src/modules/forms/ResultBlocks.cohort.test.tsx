import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ResolvedResult } from "@shared/form-studio";
import { ResultBlocks } from "./ResultBlocks";

const cohortBlock = (metric: Partial<Extract<ResolvedResult, { type: "cohort" }>["metric"]>, value: unknown = 88): ResolvedResult => ({
  id: "against", title: "Against the certified bench", audience: "reviewer", type: "cohort", value,
  metric: { id: "certified_lri", label: "Certified LRI", aggregate: "avg", value: 93, rows: 2, asOf: "2026-09-12T12:00:00.000Z", ...metric },
});

describe("cohort result block", () => {
  it("shows this response beside the metric, the difference, and how many responses the metric covers", () => {
    render(<ResultBlocks results={[cohortBlock({})]} />);
    const block = screen.getByTestId("result-against");
    expect(block).toHaveTextContent("This response");
    expect(block).toHaveTextContent("88");
    expect(block).toHaveTextContent("Certified LRI");
    expect(block).toHaveTextContent("93");
    expect(block).toHaveTextContent("−5");
    expect(block).toHaveTextContent(/Average over 2 earlier responses, as of /);
  });

  it("says there is nothing to compare with rather than showing 0", () => {
    render(<ResultBlocks results={[cohortBlock({ value: "", rows: 0 })]} />);
    const block = screen.getByTestId("result-against");
    expect(block).toHaveTextContent("—");
    expect(block).toHaveTextContent("No earlier responses to compare with yet.");
  });

  it("reads a count as a count, and says when a view had no metrics", () => {
    const { unmount } = render(<ResultBlocks results={[cohortBlock({ aggregate: "count", label: "Certified ready now", value: 1, rows: 1 })]} />);
    expect(screen.getByTestId("result-against")).toHaveTextContent(/Counted over this form's completed responses, as of /);
    expect(screen.getByTestId("result-against")).not.toHaveTextContent("−");
    unmount();
    render(<ResultBlocks results={[cohortBlock({ value: "", rows: "", asOf: null })]} />);
    expect(screen.getByTestId("result-against")).toHaveTextContent("The cohort has not been computed for this view.");
  });
});
