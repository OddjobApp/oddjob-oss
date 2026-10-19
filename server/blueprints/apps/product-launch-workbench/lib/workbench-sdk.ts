/**
 * Workbench SDK — embedded-mode helpers for SDLC apps.
 *
 * Workbench blueprints (PM, Scrum Master, QA, etc.) import these helpers to
 * communicate with the Cycle Manager parent frame when running in Modal mode
 * (URL has ?embed=1). When running standalone (Page mode) these helpers are
 * no-ops so the same code works in both surfaces.
 *
 * Origin contract: both parent (Oddjob app) and child (workbench app) are
 * served from the same proxy origin, so window.parent.postMessage targets
 * are always trusted. We still verify event.origin === window.location.origin
 * on the listener side.
 *
 * Message envelope (must match preview-proxy.ts and Cycle Manager client):
 *   interface WorkbenchMessage   { source: 'workbench';    version: 1; type: ...; payload?: any; requestId?: string }
 *   interface CycleManagerMessage{ source: 'cycle-manager'; version: 1; type: ...; payload?: any; requestId?: string }
 *
 * Import into a blueprint's pages/index.tsx like:
 *   import { useWorkbenchContext, notifySaved, notifyUnsavedChange } from '@oddjob/workbench-sdk';
 *
 * If the parent never responds with a 'context' message within 1s the hook
 * returns null — workbenches should fall back to standalone defaults.
 */

import { useEffect, useState } from "react";

export interface WorkbenchContext {
    missionId: number;
    bindingId: number;
    cycleId?: number;
    mission?: { id: number; name: string; objective: string | null };
    user?: { id: string; email?: string };
    /** Org the user is currently scoped to */
    organizationId?: number;
}

export type WorkbenchOutboundType = "ready" | "saved" | "unsaved-change" | "request-close" | "navigate-out" | "trigger-cycle";
export type CycleManagerInboundType = "context" | "force-close" | "ack";

export interface WorkbenchMessage<T = any> {
    source: "workbench";
    version: 1;
    type: WorkbenchOutboundType;
    payload?: T;
    requestId?: string;
}

export interface CycleManagerMessage<T = any> {
    source: "cycle-manager";
    version: 1;
    type: CycleManagerInboundType;
    payload?: T;
    requestId?: string;
}

/** True when the app is rendered inside a Cycle Manager modal (URL has ?embed=1). */
export function isEmbedded(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("embed") === "1";
}

/**
 * React hook: announces readiness to the parent and returns the WorkbenchContext
 * when the parent responds. Returns null when running standalone (Page mode) or
 * while waiting for the parent's response.
 */
export function useWorkbenchContext(): WorkbenchContext | null {
    const [ctx, setCtx] = useState<WorkbenchContext | null>(null);
    useEffect(() => {
        if (!isEmbedded() || typeof window === "undefined") return;
        const handler = (e: MessageEvent) => {
            if (e.origin !== window.location.origin) return;
            const msg = e.data as CycleManagerMessage | undefined;
            if (msg?.source !== "cycle-manager" || msg.version !== 1) return;
            if (msg.type === "context") setCtx(msg.payload as WorkbenchContext);
        };
        window.addEventListener("message", handler);
        // Announce ready — parent will reply with 'context'
        postToParent({ type: "ready" });
        return () => window.removeEventListener("message", handler);
    }, []);
    return ctx;
}

/** Tell Cycle Manager the user saved something and which mission fields are stale. */
export function notifySaved(summary: string, affectedMissionFields?: string[]): void {
    postToParent({ type: "saved", payload: { summary, affectedMissionFields } });
}

/** Tell Cycle Manager there are unsaved changes — close prompts will warn. */
export function notifyUnsavedChange(dirty: boolean = true): void {
    postToParent({ type: "unsaved-change", payload: { dirty } });
}

/** Ask Cycle Manager to close the modal (e.g. user clicks a Close button inside the app). */
export function requestClose(): void {
    postToParent({ type: "request-close" });
}

/** Ask Cycle Manager to navigate the parent away from Modal mode (e.g. "Open in full page"). */
export function navigateOut(targetUrl: string): void {
    postToParent({ type: "navigate-out", payload: { targetUrl } });
}

/** Ask Cycle Manager to trigger the owning cycle from inside an embedded app. */
export function triggerCycle(reason?: string, payload?: Record<string, any>): string | null {
    if (!isEmbedded()) return null;
    const requestId = `trigger-cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    postToParent({ type: "trigger-cycle", requestId, payload: { reason, payload } });
    return requestId;
}

function postToParent(partial: { type: WorkbenchOutboundType; payload?: any; requestId?: string }): void {
    if (typeof window === "undefined" || window.parent === window) return;
    const msg: WorkbenchMessage = { source: "workbench", version: 1, ...partial };
    console.log("postToParent sending:", msg);
    // Targeting same origin specifically would be ideal but the parent might be
    // accessed via different localhost names during dev. Restrict on listener.
    try {
        window.parent.postMessage(msg, "*");
        console.log("postToParent sent successfully");
    } catch (e) {
        console.log("postToParent failed", e);
    }
}
