import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ComputerUseStudio from "./ComputerUseStudio";
import type { StudioStep, StudioTask } from "./types";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/modules/agents/components/ComputerUseLiveViewer", () => ({
  ComputerUseLiveViewer: ({ sessionId }: { sessionId: string }) => <div>Screenshots of {sessionId}</div>,
  ConfirmationPanel: ({ task }: { task: { task: StudioTask } }) => <div>Confirm {task.task.id}</div>,
}));
vi.mock("@/modules/agents/components/ComputerUseReplay", () => ({ ComputerUseReplay: () => <div>Task replay</div> }));

const request = vi.mocked(apiRequest);
const session = { id: "session-1", os: "linux", status: "running", provider: "org_desktop", actionCount: 12 };
let task: StudioTask;
let steps: StudioStep[];
let skills: Record<string, unknown>;

const step = (n: number, over: Partial<StudioStep>): StudioStep => ({
  id: `s${n}`, stepNumber: n, phase: "action", status: "succeeded", createdAt: "2026-09-19T10:00:00Z", ...over,
});

function show(props: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComputerUseStudio sessionId={session.id} organizationId={7} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  task = { id: "t1", sessionId: session.id, task: "Find Honolulu's population", status: "succeeded" };
  steps = [];
  skills = {};
  request.mockReset();
  request.mockImplementation(async (method, url) => {
    const body = (v: unknown) => new Response(JSON.stringify(v));
    if (url.endsWith("/sessions")) return body({ sessions: [session] });
    if (url.includes("/computer-use/tasks?")) return body({ tasks: [task] });
    if (url.endsWith(`/computer-use/tasks/${task.id}`)) return body({ task, steps });
    if (url.includes("/skills")) {
      const key = Object.keys(skills).find((k) => url.includes(k));
      return key ? body(skills[key]) : body({ skills: [] });
    }
    return body({});
  });
});

describe("Computer Use Studio on live data", () => {
  it("shows the real session's recorded facts and no invented metrics", async () => {
    show();
    const facts = await screen.findByTestId("session-facts");
    expect(within(facts).getByText("org_desktop")).toBeInTheDocument();
    expect(within(facts).getByText("12")).toBeInTheDocument();
    expect(screen.queryByText(/fps|latency|confidence/i)).not.toBeInTheDocument();
  });

  it("starts watching; taking control needs the live desktop first", async () => {
    show();
    await screen.findByText("Screenshots of session-1");
    expect(screen.getByTestId("mode-watch-btn")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-control-btn")).toBeDisabled();
  });

  it("labels a learned-skill replay and a recorded takeover in the step timeline", async () => {
    steps = [
      step(1, { phase: "skill_replay", action: "fill", plan: { skillId: "k1", skill: "Wikipedia lookup", step: 1 } }),
      step(2, { phase: "skill_replay", status: "stopped", action: "Wikipedia lookup", result: { skillId: "k1", completed: false, stepsRun: 1, totalSteps: 3, stoppedAt: { step: 1, reason: "the Search field was not found" } } }),
      step(3, { phase: "awaiting_confirmation", status: "needs_confirmation", decision: "yield", plan: { explanation: "Please log in" } }),
      step(4, { phase: "takeover_recorded", result: { recordingId: "r1", steps: 4 } }),
    ];
    show();
    expect(await screen.findByText(/Replayed "Wikipedia lookup", step 1/)).toBeInTheDocument();
    expect(screen.getByText(/stopped after 1 of 3 steps/)).toBeInTheDocument();
    expect(screen.getByText("Handed to you")).toBeInTheDocument();
    expect(screen.getByText(/Your takeover was recorded \(4 steps\)/)).toBeInTheDocument();
  });

  it("shows the skill a task used, with its real run counts, and the draft made from the takeover", async () => {
    steps = [
      step(1, { phase: "skill_replay", action: "click", plan: { skillId: "k1", skill: "Wikipedia lookup", step: 1 } }),
      step(2, { phase: "takeover_recorded", result: { recordingId: "r1", steps: 2 } }),
    ];
    skills = {
      "/skills/k1": { skill: { id: "k1", name: "Wikipedia lookup", status: "active", site: "en.wikipedia.org", successCount: 3, failureCount: 1 } },
      "/skills": { skills: [{ id: "k2", name: "Log in to the portal", status: "draft", successCount: 0, failureCount: 0, sourceRecordingId: "r1" }] },
    };
    show();
    fireEvent.click(await screen.findByTestId("dock-tab-skill"));
    expect(await screen.findByText(/en\.wikipedia\.org · 3 of 4 runs finished the task/)).toBeInTheDocument();
    expect(await screen.findByText("Log in to the portal")).toBeInTheDocument();
    expect(screen.getByText(/never replayed until an organization admin approves/)).toBeInTheDocument();
  });

  it("puts a pending approval at the top of the dock and offers to stop the task", async () => {
    task = { ...task, status: "needs_confirmation", result: { pending: { kind: "yield", explanation: "Solve the CAPTCHA" } } };
    show();
    expect(await screen.findByText("Confirm t1")).toBeInTheDocument();
    expect(screen.getByText(/The agent handed you the desktop/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stop-task-btn"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("/computer-use/tasks/t1/cancel"), {}));
  });

  it("opens the task a notification pointed at", async () => {
    const other = { ...task, id: "t2", task: "Other task" };
    request.mockImplementation(async (_m, url) => {
      const body = (v: unknown) => new Response(JSON.stringify(v));
      if (url.endsWith("/sessions")) return body({ sessions: [session] });
      if (url.includes("/computer-use/tasks?")) return body({ tasks: [task, other] });
      if (url.endsWith("/computer-use/tasks/t2")) return body({ task: other, steps: [] });
      return body({ task, steps: [] });
    });
    show({ taskId: "t2" });
    expect(await screen.findByText("Other task", { selector: "p" })).toBeInTheDocument();
  });

  it("closes from the header", async () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.click(await screen.findByTestId("studio-exit-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
