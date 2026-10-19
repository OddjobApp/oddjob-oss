import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ComputerUseStudio from "./ComputerUseStudio";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/modules/agents/components/ComputerUseLiveViewer", () => ({ ComputerUseLiveViewer: ({ sessionId }: { sessionId: string }) => <div>Live desktop {sessionId}</div>, ConfirmationPanel: () => <div>Confirmation</div> }));
vi.mock("@/modules/agents/components/ComputerUseReplay", () => ({ ComputerUseReplay: () => <div>Task replay</div> }));

const request = vi.mocked(apiRequest);
const session = { id: "session-1", os: "linux", status: "running" };
let tasks: Array<{ id: string; sessionId: string; task: string; status: string }>;
function show(sessionId?: string, taskId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ComputerUseStudio sessionId={sessionId} taskId={taskId} organizationId={7} /></QueryClientProvider>);
}
beforeEach(() => {
  tasks = [];
  request.mockReset();
  request.mockImplementation(async (method, url) => {
    if (method === "GET" && url.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: [session] }));
    if (method === "GET" && url.includes("/desktop/viewer-url")) return new Response(JSON.stringify({ url: "/api/integrations/trycua/desktop/viewer/o/7/vnc.html" }));
    if (method === "GET") return new Response(JSON.stringify({ tasks }));
    if (url.endsWith("/tasks")) return new Response(JSON.stringify({ task: { id: "new-task", sessionId: session.id, task: "Find a report", status: "queued" } }));
    return new Response(JSON.stringify({}));
  });
});

describe("connected Computer Studio", () => {
  it.each(["running", "queued"])("disables human control while a %s task owns the desktop", async status => {
    tasks = [{ id: "active", sessionId: session.id, task: "Existing work", status }];
    show(session.id);
    await screen.findByText(/A task is active/);
    fireEvent.click(screen.getByRole("button", { name: "Connect live desktop" }));
    await screen.findByTestId("novnc-iframe");
    expect(screen.getByRole("button", { name: "Take control" })).toBeDisabled();
  });

  it("allows human control while the task is waiting for confirmation", async () => {
    tasks = [{ id: "paused", sessionId: session.id, task: "Waiting for you", status: "needs_confirmation" }];
    show(session.id);
    await screen.findByText(/A task is active/);
    fireEvent.click(screen.getByRole("button", { name: "Connect live desktop" }));
    await screen.findByTestId("novnc-iframe");
    expect(screen.getByRole("button", { name: "Take control" })).toBeEnabled();
  });

  it("switches from stale history to a task started from chat", async () => {
    tasks = [
      { id: "chat-task", sessionId: session.id, task: "Navigate to the Wired article", status: "running" },
      { id: "old-task", sessionId: session.id, task: "Old task", status: "succeeded" },
    ];
    show(session.id, "old-task");
    expect(await screen.findByText("Navigate to the Wired article")).toBeInTheDocument();
  });
  it("defaults to a real session picker without simulated progress", async () => {
    show();
    expect(screen.getByText("Connect a desktop to begin")).toBeInTheDocument();
    expect(screen.queryByText("Approval Required for Action #6")).not.toBeInTheDocument();
    await screen.findByText(/linux · running/);
    fireEvent.change(screen.getByLabelText("Desktop session"), { target: { value: session.id } });
    expect(await screen.findByText("Live desktop session-1")).toBeInTheDocument();
  });

  it("starts tasks without per-action approval by default", async () => {
    show(session.id);
    await screen.findByText(/linux · running/);
    fireEvent.change(screen.getByLabelText("What should the computer do?"), { target: { value: "Find a report" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start task" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("/tasks/new-task/run"), {}));
    expect(request).toHaveBeenCalledWith("POST", expect.stringMatching(/\/tasks$/), expect.objectContaining({ sessionId: session.id, task: "Find a report", executeImmediately: false, requireConfirmation: false }));
  });

  it("prevents concurrent task starts on an active desktop", async () => {
    tasks = [{ id: "active", sessionId: session.id, task: "Existing work", status: "needs_confirmation" }];
    show(session.id);
    await screen.findByText(/A task is active/);
    fireEvent.change(screen.getByLabelText("What should the computer do?"), { target: { value: "New work" } });
    expect(screen.getByRole("button", { name: "Start task" })).toBeDisabled();
  });

  it("shows API failures instead of manufacturing a live desktop", async () => {
    request.mockRejectedValue(new Error("Session access denied"));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Session access denied");
    expect(screen.queryByText("Live desktop session-1")).not.toBeInTheDocument();
  });
});
