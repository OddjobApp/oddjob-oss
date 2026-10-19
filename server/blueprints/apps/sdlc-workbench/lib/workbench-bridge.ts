"use client";

export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  return ["1", "cycle"].includes(new URLSearchParams(window.location.search).get("embed") ?? "");
}

export function triggerCycle(reason: string, payload?: Record<string, unknown>): string | null {
  if (!isEmbedded() || typeof window === "undefined" || window.parent === window) return null;
  const requestId = `trigger-cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const roomKey = new URLSearchParams(window.location.search).get("crewRoom");
  if (!roomKey) return null;
  const finish = (status: string) => window.dispatchEvent(new CustomEvent("workbench-request-status", { detail: status }));
  const timer = window.setTimeout(() => { window.removeEventListener("message", receive); finish("CREW did not acknowledge this request. No launch is confirmed."); }, 5000);
  const receive = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.source !== "crew-workbench-host" || event.data?.requestId !== requestId || event.data?.roomKey !== roomKey) return;
    clearTimeout(timer); window.removeEventListener("message", receive);
    finish(event.data.status === "prepared" ? "Request prepared in CREW chat. Review and send it; no mission has launched." : "CREW could not prepare this request.");
  };
  window.addEventListener("message", receive);
  window.parent.postMessage(
    {
      source: "workbench",
      version: 1,
      type: "trigger-cycle",
      requestId,
      roomKey,
      payload: { reason, payload },
    },
    window.location.origin,
  );
  return requestId;
}

export interface CrewInputField {
  key: string; label: string; type?: 'text' | 'number' | 'select' | 'checkbox'; required?: boolean; options?: string[];
}
export interface CrewSurfaceResponse { status: 'submitted' | 'cancelled'; data?: Record<string, unknown> }
/** Requests human input only; consumers must separately verify/authorize any execution. */
export function requestCrewInput(options: { kind: 'question' | 'form' | 'approval'; title: string; fields?: CrewInputField[]; approvalId?: number; signal?: AbortSignal }): Promise<CrewSurfaceResponse> {
  if (typeof window === 'undefined' || window.parent === window) return Promise.reject(new Error('Open this surface in CREW to request input.'));
  const roomKey = new URLSearchParams(window.location.search).get('crewRoom');
  if (!roomKey) return Promise.reject(new Error('No CREW room binding.'));
  const requestId = `input-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); options.signal?.removeEventListener('abort', cancel); };
    const cancel = () => { window.parent.postMessage({ source: 'crew-surface-cancel', version: 1, roomKey, requestId }, window.location.origin); cleanup(); resolve({ status: 'cancelled' }); };
    const expire = () => { cancel(); };
    const receive = (event: MessageEvent) => {
      const reply = event.data;
      if (event.origin !== window.location.origin || event.source !== window.parent || reply?.source !== 'crew-surface-response' || reply.version !== 1 || reply.roomKey !== roomKey || reply.requestId !== requestId) return;
      if (reply.status === 'accepted') { clearTimeout(timer); timer = setTimeout(expire, 15 * 60_000); return; }
      if (!['submitted', 'cancelled'].includes(reply.status)) return;
      cleanup(); resolve({ status: reply.status, data: reply.data });
    };
    window.addEventListener('message', receive);
    options.signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('CREW did not acknowledge the input request.')); }, 5000);
    if (options.signal?.aborted) { cancel(); return; }
    window.parent.postMessage({ source: 'crew-surface-request', version: 1, roomKey, requestId,
      kind: options.kind, title: options.title, ...(options.fields ? { fields: options.fields } : {}), ...(options.approvalId ? { approvalId: options.approvalId } : {}) }, window.location.origin);
  });
}
