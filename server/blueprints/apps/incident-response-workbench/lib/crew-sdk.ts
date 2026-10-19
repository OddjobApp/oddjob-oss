/**
 * CREW SDK — helpers for blueprint apps embedded as governed CREW surfaces.
 *
 * This is the canonical, vendorable client for the blueprint ↔ CREW runtime
 * contract (docs/platform/05-component-and-tooling-guides/blueprint-crew-runtime-contract.md).
 * Copy this file into a blueprint's `lib/` — it has no imports and is safe in
 * both browser and SSR contexts.
 *
 * The host mounts the app at `/app/<slug>?embedded=true&embed=1&crewRoom=<key>&orgId=<id>`.
 * The proxy also injects `window.oddjobCrew` (roomKey, setSelectedRecord,
 * notifyView); these helpers prefer that injected bridge when present and fall
 * back to posting the same messages directly, so apps behave identically with
 * or without the injection.
 *
 * Message envelopes (must match CrewCycleAppCanvas.tsx / AgentChatPanel.tsx):
 *   outbound app → host:
 *     { source: 'crew-app-view',        version: 1, roomKey, pathname, selectedRecord? }
 *     { source: 'crew-surface-request', version: 1, roomKey, requestId, kind, title, fields? | approvalId? }
 *     { source: 'crew-surface-cancel',  version: 1, roomKey, requestId }
 *   inbound host → app (validated: same origin, source === window.parent, matching roomKey):
 *     { source: 'crew-surface-response', version: 1, roomKey, requestId, status: 'accepted' | 'submitted' | 'cancelled', data? }
 *     { source: 'crew-host-event',       version: 1, roomKey, type, approvalId?, data? }
 *
 * Inbound `crew-host-event` is also re-dispatched inside the iframe as the
 * `oddjob:crew-host-event` CustomEvent by the injected bridge.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrewSelectedRecord {
    collection: string;
    recordId: string;
}

export interface CrewInputField {
    key: string;
    label: string;
    type?: "text" | "number" | "select" | "checkbox";
    required?: boolean;
    options?: string[];
}

export interface CrewSurfaceResponse {
    status: "submitted" | "cancelled";
    data?: Record<string, unknown>;
}

export interface CrewHostEvent {
    type: string;
    approvalId?: number;
    data?: unknown;
}

interface OddjobCrewBridge {
    roomKey: string;
    setSelectedRecord(record: CrewSelectedRecord | null): void;
    notifyView(): void;
}

// ── Environment ───────────────────────────────────────────────────────────────

/** The room key the host bound this surface to (from ?crewRoom=). */
export function crewRoomKey(): string | null {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("crewRoom");
}

/** True when running inside a CREW app canvas (framed with a room binding). */
export function isCrewEmbedded(): boolean {
    if (typeof window === "undefined") return false;
    return window.parent !== window && crewRoomKey() != null;
}

/** The proxy-injected bridge, when present. */
export function oddjobCrew(): OddjobCrewBridge | null {
    if (typeof window === "undefined") return null;
    const bridge = (window as { oddjobCrew?: OddjobCrewBridge }).oddjobCrew;
    return bridge && typeof bridge.roomKey === "string" ? bridge : null;
}

function postToHost(message: Record<string, unknown>): void {
    if (typeof window === "undefined" || window.parent === window) return;
    try {
        window.parent.postMessage(message, window.location.origin);
    } catch { /* detached or sandboxed frame — swallow */ }
}

// ── View reporting ────────────────────────────────────────────────────────────

/**
 * Report which record is selected. Uses the injected bridge when available;
 * otherwise posts the crew-app-view message directly.
 */
export function setSelectedRecord(record: CrewSelectedRecord | null): void {
    const bridge = oddjobCrew();
    if (bridge) { bridge.setSelectedRecord(record); return; }
    const roomKey = crewRoomKey();
    if (!roomKey) return;
    postToHost({
        source: "crew-app-view",
        version: 1,
        roomKey,
        pathname: window.location.pathname + window.location.search,
        selectedRecord: record,
    });
}

/** Emit a crew-app-view heartbeat for the current route. No-op standalone. */
export function notifyView(): void {
    const bridge = oddjobCrew();
    if (bridge) { bridge.notifyView(); return; }
    setSelectedRecord(null);
}

// ── Input & approval requests ─────────────────────────────────────────────────

/**
 * Raise a question, form, or bound approval into the CREW room transcript.
 * The promise resolves when the host replies 'submitted' or 'cancelled', or
 * rejects if the host never acknowledges (5s) or the surface isn't embedded.
 * An 'accepted' reply means the card rendered and the human has 15 more
 * minutes to answer.
 *
 * This requests human input only — it never executes anything. Persisted
 * side-effects still require a server-verified, org-scoped write path.
 */
export function requestCrewInput(options: {
    kind: "question" | "form" | "approval";
    title: string;
    fields?: CrewInputField[];
    approvalId?: number;
    signal?: AbortSignal;
}): Promise<CrewSurfaceResponse> {
    if (typeof window === "undefined" || window.parent === window) {
        return Promise.reject(new Error("Open this surface in CREW to request input."));
    }
    const roomKey = crewRoomKey();
    if (!roomKey) return Promise.reject(new Error("No CREW room binding."));
    const requestId = `input-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => {
            clearTimeout(timer);
            window.removeEventListener("message", receive);
            options.signal?.removeEventListener("abort", cancel);
        };
        const cancel = () => {
            postToHost({ source: "crew-surface-cancel", version: 1, roomKey, requestId });
            cleanup();
            resolve({ status: "cancelled" });
        };
        const receive = (event: MessageEvent) => {
            const reply = event.data;
            if (event.origin !== window.location.origin || event.source !== window.parent) return;
            if (reply?.source !== "crew-surface-response" || reply.version !== 1) return;
            if (reply.roomKey !== roomKey || reply.requestId !== requestId) return;
            if (reply.status === "accepted") {
                clearTimeout(timer);
                timer = setTimeout(cancel, 15 * 60_000);
                return;
            }
            if (!["submitted", "cancelled"].includes(reply.status)) return;
            cleanup();
            resolve({ status: reply.status, data: reply.data });
        };
        window.addEventListener("message", receive);
        options.signal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => { cleanup(); reject(new Error("CREW did not acknowledge the input request.")); }, 5000);
        if (options.signal?.aborted) { cancel(); return; }
        postToHost({
            source: "crew-surface-request",
            version: 1,
            roomKey,
            requestId,
            kind: options.kind,
            title: options.title,
            ...(options.fields ? { fields: options.fields } : {}),
            ...(options.approvalId ? { approvalId: options.approvalId } : {}),
        });
    });
}

/**
 * Convenience wrapper: raise an existing `app_record_action` approval (created
 * via propose_app_action / approvalService) into the room as a bound approval
 * card. The host will only honour approvalId values created by this app.
 */
export function requestSurfaceApproval(approvalId: number, title: string, signal?: AbortSignal): Promise<CrewSurfaceResponse> {
    return requestCrewInput({ kind: "approval", title, approvalId, signal });
}

// ── Host events ───────────────────────────────────────────────────────────────

/**
 * Subscribe to host → app events (`crew-host-event`, e.g. type
 * 'approval-resolved'). Validates origin, source window, and roomKey. Also
 * honors the `oddjob:crew-host-event` CustomEvent re-dispatched by the
 * injected bridge. Returns an unsubscribe function.
 */
export function onCrewHostEvent(handler: (event: CrewHostEvent) => void): () => void {
    if (typeof window === "undefined") return () => {};
    const roomKey = crewRoomKey();

    const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (event.origin !== window.location.origin || event.source !== window.parent) return;
        if (data?.source !== "crew-host-event" || data.version !== 1) return;
        if (roomKey && data.roomKey !== roomKey) return;
        handler({ type: data.type, approvalId: data.approvalId, data: data.data });
    };
    const onCustom = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail && typeof detail === "object") handler(detail as CrewHostEvent);
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("oddjob:crew-host-event", onCustom as EventListener);
    return () => {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("oddjob:crew-host-event", onCustom as EventListener);
    };
}
