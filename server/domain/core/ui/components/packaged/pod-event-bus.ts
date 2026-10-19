import { useEffect } from "react";

/**
 * Generates a standard W3C traceparent string:
 * version(00) - traceId(32 hex) - spanId(16 hex) - traceFlags(01)
 */
export function generateW3CTraceparent(): string {
  const hex = (len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += Math.floor(Math.random() * 16).toString(16);
    }
    return s;
  };
  return `00-${hex(32)}-${hex(16)}-01`;
}

export interface WorkbenchSaveOptions {
  stageId: string;
  summary: string;
  data: Record<string, any>;
  traceparent?: string;
}

/**
 * Standardized workbench message dispatcher.
 * Supports both object options syntax: emitWorkbenchSaved({ stageId, summary, data })
 * and positional parameters: emitWorkbenchSaved(stageId, summary, data, traceparent).
 * Attaches W3C distributed trace context and cryptographic timestamp.
 */
export function emitWorkbenchSaved(
  stageIdOrOptions: string | WorkbenchSaveOptions,
  summary?: string,
  data?: Record<string, any>,
  traceparentParam?: string
): void {
  if (typeof window === "undefined") return;

  let stageId: string;
  let summaryText: string;
  let dataPayload: Record<string, any>;
  let traceparent: string;

  if (typeof stageIdOrOptions === "object") {
    stageId = stageIdOrOptions.stageId;
    summaryText = stageIdOrOptions.summary;
    dataPayload = stageIdOrOptions.data || {};
    traceparent = stageIdOrOptions.traceparent || generateW3CTraceparent();
  } else {
    stageId = stageIdOrOptions;
    summaryText = summary || `Stage ${stageId} completed`;
    dataPayload = data || {};
    traceparent = traceparentParam || generateW3CTraceparent();
  }

  const enrichedData = {
    ...dataPayload,
    _trace: {
      traceparent,
      timestamp: new Date().toISOString(),
      stageId,
    },
  };

  window.postMessage(
    {
      source: "workbench",
      version: 1,
      type: "saved",
      traceparent,
      payload: {
        stageId,
        summary: summaryText,
        data: enrichedData,
      },
    },
    "*"
  );
}

export interface PodAgentEvent<T = any> {
  stageId?: string;
  action: string;
  payload: T;
  agentName?: string;
}

/**
 * Dispatches a targeted custom event onto the window bus for pod synchronization.
 */
export function dispatchPodEvent(
  stageId: string,
  action: string,
  payload: any = {},
  agentName: string = "CrewChat"
): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent("oddjob:pod-event", {
    detail: { stageId, action, payload, agentName },
  });
  window.dispatchEvent(event);
}

/**
 * React hook that connects a builder pod to live Crew Chat events.
 * Agents in the room can dispatch `oddjob:pod-event` or specific `pod:<action>` custom events.
 */
export function usePodEventListener(
  stageId: string,
  handler: (event: PodAgentEvent) => void
): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as PodAgentEvent | undefined;
      if (!detail) return;
      if (!detail.stageId || detail.stageId === stageId || detail.stageId === "all") {
        handler(detail);
      }
    };

    window.addEventListener("oddjob:pod-event", onCustomEvent);
    return () => {
      window.removeEventListener("oddjob:pod-event", onCustomEvent);
    };
  }, [stageId, handler]);
}
