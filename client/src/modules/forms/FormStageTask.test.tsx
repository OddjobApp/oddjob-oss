import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { emptyLedger, lockStage, stageView, type StageLedger } from "@shared/form-studio-stages";
import { successionAnswers, successionForm } from "@shared/form-studio-stages.fixture";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { FormStageRequestPanel, FormStageTask, type StageTask } from "./FormStageTask";

const def = successionForm();
const at = new Date("2026-09-12T10:00:00Z");

function lock(ledger: StageLedger, stageId: string, inputs: Record<string, unknown>, provenance?: Record<string, { source: string }>) {
  const outcome = lockStage(def, ledger, stageId, inputs, { type: "user", userId: "u1" }, at, provenance);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome.ledger;
}

function task(ledger: StageLedger, stageId: string): StageTask {
  return { responseId: 7, formId: 3, formName: "Succession review", releaseNumber: 1, complete: false, ...stageView(def, ledger, stageId) };
}

const afterHr = lock(lock(emptyLedger(), "candidate", successionAnswers.candidate), "hr", successionAnswers.hr, {
  leadership_360_score: { source: "Q3 360 survey export, row 14" },
});

describe("FormStageTask", () => {
  // A block body: a returned function would run as cleanup, calling the mock after each test.
  beforeEach(() => { apiRequest.mockReset(); });

  it("shows the committee where the response is and the earlier answers, with where an agent's answer came from", () => {
    render(<FormStageTask task={task(afterHr, "committee")} onSubmit={vi.fn()} />);

    // The stage's heading; its page carries the same title further down.
    expect(screen.getAllByRole("heading", { name: "Committee review" })[0].tagName).toBe("H3");
    const stages = screen.getByRole("list", { name: "Stages" });
    expect(stages).toHaveTextContent("Candidate self-assessment (submitted)");
    expect(stages).toHaveTextContent("Committee review (waiting)");
    const earlier = screen.getByRole("region", { name: "Earlier answers" });
    expect(earlier).toHaveTextContent("360 leadership score");
    expect(earlier).toHaveTextContent("Source: Q3 360 survey export, row 14");
    expect(screen.getByLabelText(/Committee notes/)).toBeInTheDocument();
  });

  it("shows a submitted stage read-only with its results", () => {
    render(<FormStageTask task={task(afterHr, "hr")} onSubmit={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("This stage has been submitted.");
    // No questions to answer again; HR, a reviewer, sees its results, flight risk included.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Flight risk" })).toBeInTheDocument();
  });

  it("loads a Decision Inbox stage request, read-only once the request is resolved", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ request: { id: 41, status: "approved" }, view: task(lock(emptyLedger(), "candidate", successionAnswers.candidate), "hr") }) });
    render(<FormStageRequestPanel approvalId={41} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "HR data" })).toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/form-studio/stage-requests/41");
    expect(screen.getByRole("status")).toHaveTextContent("This request is no longer waiting for answers.");
  });

  it("says why a stage request could not be loaded", async () => {
    apiRequest.mockRejectedValue(new Error("You are not asked to fill in this stage."));
    render(<FormStageRequestPanel approvalId={41} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You are not asked to fill in this stage."));
  });
});
