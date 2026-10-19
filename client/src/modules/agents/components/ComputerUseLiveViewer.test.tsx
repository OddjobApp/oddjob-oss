import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ConfirmationPanel, ComputerUseLiveViewer } from "./ComputerUseLiveViewer";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const task = { task: { id: "task-1", task: "Read a report", status: "needs_confirmation", stepCount: 3, result: { pending: { kind: "yield", explanation: "Please sign in to continue" } } }, steps: [] };
function show(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
}
beforeEach(() => { request.mockReset(); });

describe("computer-use live controls", () => {
  it("explains a takeover and sends the user's reply on resume", async () => {
    request.mockResolvedValue(new Response(JSON.stringify(task)));
    show(<ConfirmationPanel task={task} onConfirm={vi.fn()} />);
    expect(screen.getByText("Please sign in to continue")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "Signed in" } });
    fireEvent.click(screen.getByRole("button", { name: "Done — resume agent" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("/task-1/confirm"), { allow: true, text: "Signed in", includeVerificationObservation: true }));
  });

  it("keeps a failed approval visible and allows retry", async () => {
    request.mockRejectedValue(new Error("Approval failed"));
    show(<ConfirmationPanel task={task} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Done — resume agent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Approval failed");
    expect(screen.getByRole("button", { name: "Done — resume agent" })).toBeEnabled();
  });

  it("cancels through the API, and offers no ungoverned way to drive the desktop", async () => {
    request.mockImplementation(async (method, url) => {
      if (url.endsWith("/replay")) return new Response(JSON.stringify({ ...task, task: { ...task.task, status: "running" } }));
      if (url.endsWith("/cancel")) return new Response(JSON.stringify({ ...task, task: { ...task.task, status: "cancelled" } }));
      if (url.endsWith("/screenshot")) return new Response(JSON.stringify({ screenshot: "data:image/png;base64,abc" }));
      if (url.includes("/observe")) return new Response(JSON.stringify({ observation: {} }));
      return new Response(JSON.stringify({ session: { status: "running", os: "linux", expiresAt: "2026-09-20T00:00:00Z" } }));
    });
    show(<ComputerUseLiveViewer sessionId="session" activeTaskId="task-1" organizationId={7} />);
    const cancel = await screen.findByRole("button", { name: "Cancel task" });
    // The "Manual Override" box used to sit here: a second instruction field beside
    // the chat that ran actions through guided-actions, skipping the approval a task
    // run goes through. Instruct the agent, or take control of the desktop yourself.
    expect(screen.queryByText("Manual Override")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tell the agent what to do next/)).not.toBeInTheDocument();
    fireEvent.click(cancel);
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("/task-1/cancel"), {}));
    expect(await screen.findByText(/cancelled · 3 recorded steps/)).toBeInTheDocument();
  });
});
