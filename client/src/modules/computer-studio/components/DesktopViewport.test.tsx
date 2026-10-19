import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { apiRequest } from "@/lib/queryClient";
import { DesktopViewport } from "./DesktopViewport";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/modules/agents/components/ComputerUseLiveViewer", () => ({ ComputerUseLiveViewer: () => <div>Screen preview</div> }));
const request = vi.mocked(apiRequest);
const props = { sessionId: "session", organizationId: 7, mode: "watch" as const, liveConnected: false, onLiveConnected: vi.fn(), onTakeControl: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); });

describe("desktop connection lifecycle", () => {
  it("ignores a delayed connection after the selected desktop unmounts", async () => {
    let resolve!: (response: Response) => void;
    request.mockImplementation(() => new Promise<Response>(r => { resolve = r; }));
    const view = render(<DesktopViewport {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect live desktop" }));
    const signal = request.mock.calls[0][4];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(new Response(JSON.stringify({ url: "/api/integrations/trycua/desktop/viewer/o/7/vnc.html" }))); });
    expect(props.onLiveConnected).not.toHaveBeenCalled();
  });

  it("rejects an invalid connection URL and keeps the screen preview", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ url: "https://invalid.example/" })));
    render(<DesktopViewport {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect live desktop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid viewer URL");
    expect(screen.getByText("Screen preview")).toBeInTheDocument();
  });

  it("makes the iframe inert immediately when switching from control to watch", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ url: "/api/integrations/trycua/desktop/viewer/o/7/vnc.html" })));
    const view = render(<DesktopViewport {...props} mode="control" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect live desktop" }));
    await waitFor(() => expect(props.onLiveConnected).toHaveBeenCalledWith(true));
    view.rerender(<DesktopViewport {...props} liveConnected mode="control" />);
    expect(screen.getByTestId("novnc-iframe").parentElement).not.toHaveAttribute("inert");
    request.mockImplementation(() => new Promise<Response>(() => {}));
    view.rerender(<DesktopViewport {...props} liveConnected mode="watch" />);
    expect(screen.getByTestId("novnc-iframe").parentElement).toHaveAttribute("inert");
  });

});
