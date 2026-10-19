"use client";

export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

export function triggerCycle(reason: string, payload?: Record<string, unknown>): string | null {
  if (!isEmbedded() || typeof window === "undefined" || window.parent === window) return null;
  const requestId = `trigger-cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.parent.postMessage(
    {
      source: "workbench",
      version: 1,
      type: "trigger-cycle",
      requestId,
      payload: { reason, payload },
    },
    "*",
  );
  return requestId;
}
