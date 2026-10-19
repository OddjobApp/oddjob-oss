import React, { useEffect, useRef, useState } from "react";
import { Hand, Loader2, Monitor, PlugZap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ComputerUseLiveViewer } from "@/modules/agents/components/ComputerUseLiveViewer";
import type { ControlMode, StudioTask } from "../types";

interface DesktopViewportProps {
  sessionId: string;
  organizationId?: number;
  task?: StudioTask;
  mode: ControlMode;
  liveConnected: boolean;
  onLiveConnected: (connected: boolean) => void;
  onTakeControl: () => void;
}

/**
 * Asks for the noVNC page URL for this org's desktop, with a fresh single-use ticket.
 *
 * Not the /desktop/viewer redirect: a frame cannot follow it here (it loads as an
 * error page, while the same URL opens fine in a tab), so the server hands over the
 * destination and the frame goes straight there.
 */
export function viewerUrlEndpoint(organizationId: number | undefined, mode: ControlMode): string {
  const params = new URLSearchParams();
  if (organizationId) params.set("orgId", String(organizationId));
  if (mode === "watch") params.set("viewOnly", "1");
  return `/api/integrations/trycua/desktop/viewer-url?${params.toString()}`;
}

/**
 * Centre track. The live desktop (noVNC) when it can be reached, view-only unless the
 * person has taken control; otherwise the periodic screenshot viewer with manual actions.
 */
export function DesktopViewport({ sessionId, organizationId, task, mode, liveConnected, onLiveConnected, onTakeControl }: DesktopViewportProps) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const handedToYou = task?.status === "needs_confirmation" && task.result?.pending?.kind === "yield";

  /** A ticket is single-use, so switching between watching and control fetches a new one. */
  const openViewer = async (next: ControlMode) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setConnecting(true);
    setConnectError(null);
    try {
      // Starting a stopped desktop can take up to ~90s. The error body says why when
      // the desktop cannot be reached at all (computer use off, none for this org).
      const res = await apiRequest("GET", viewerUrlEndpoint(organizationId, next), undefined, undefined, controller.signal);
      const { url } = await res.json();
      if (controller.signal.aborted) return;
      if (typeof url !== "string" || !url.startsWith("/api/integrations/trycua/desktop/viewer/o/")) {
        throw new Error("The desktop connection returned an invalid viewer URL.");
      }
      setFrameUrl(url);
      onLiveConnected(true);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setConnectError(err?.message ?? String(err));
      setFrameUrl(null);
      onLiveConnected(false);
    } finally {
      if (!controller.signal.aborted) setConnecting(false);
    }
  };

  // Switching control modes needs a fresh page, and a fresh ticket with it.
  useEffect(() => {
    if (liveConnected) void openViewer(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="desktop-viewport">
      {handedToYou && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span>
            <strong>The agent handed you the desktop.</strong>{" "}
            {task?.result?.pending?.explanation ?? "Finish the step, then resume the agent from the panel on the right."}
          </span>
          {liveConnected && mode === "watch" && (
            <Button size="sm" onClick={onTakeControl}><Hand className="mr-1.5 h-3.5 w-3.5" />Take control</Button>
          )}
        </div>
      )}

      {liveConnected && frameUrl ? (
        <div ref={element => { element?.toggleAttribute("inert", mode === "watch" || connecting); }} className="relative min-h-[420px] flex-1 overflow-hidden rounded-md border border-border bg-muted">
          <iframe
            key={frameUrl}
            src={frameUrl}
            title={mode === "control" ? "Live desktop: you have control" : "Live desktop: watching"}
            className="absolute inset-0 h-full w-full"
            data-testid="novnc-iframe"
          />
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/80 px-2 py-0.5 text-[11px] font-medium">
            {mode === "control" ? "You have control" : "Watching (view only)"}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><Monitor className="h-4 w-4" aria-hidden="true" />Showing periodic screenshots. Connect the live desktop to watch in real time or take control.</span>
            <Button size="sm" variant="outline" onClick={() => openViewer(mode)} disabled={connecting} data-testid="connect-live-desktop-btn">
              {connecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
              {connecting ? "Connecting…" : "Connect live desktop"}
            </Button>
          </div>
          {connectError && <p role="alert" className="text-xs text-destructive">{connectError}</p>}
          <ComputerUseLiveViewer key={sessionId} sessionId={sessionId} organizationId={organizationId} activeTaskId={task?.id} embedded />
        </>
      )}
    </div>
  );
}
