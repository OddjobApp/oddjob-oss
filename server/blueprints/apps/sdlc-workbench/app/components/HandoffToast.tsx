"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { events } from "../../lib/platform-client";
import type { PlatformEvent } from "../../lib/platform-client";
import { queueHandoff } from "../../lib/handoff-queue";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HandoffPayload {
  sourceStage: string;
  targetStage: string;
  sourceMission: string;
  targetMission: string;
  ticketKeys: string[];
  triggeredBy: string;
  runId: number;
}

interface HandoffToast {
  id: string;
  payload: HandoffPayload;
  timestamp: string;
  dismissed: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 15_000;
const MAX_VISIBLE_TOASTS = 3;

/** Map stage names to workbench URL paths */
const STAGE_TO_WORKBENCH: Record<string, string> = {
  Requirements: "/pm-workbench",
  Development: "/scrum-master-workbench",
  Planning: "/scrum-master-workbench",
  QA: "/qa-workbench",
  UAT: "/stakeholder-workbench",
  Deployment: "/devops-workbench",
};

/** Stage badge color classes */
const STAGE_COLORS: Record<string, string> = {
  Requirements: "bg-purple-600/20 text-purple-300 border-purple-500/30",
  Development: "bg-blue-600/20 text-blue-300 border-blue-500/30",
  Planning: "bg-cyan-600/20 text-cyan-300 border-cyan-500/30",
  QA: "bg-amber-600/20 text-amber-300 border-amber-500/30",
  UAT: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  Deployment: "bg-rose-600/20 text-rose-300 border-rose-500/30",
};

function getStageBadgeClass(stage: string): string {
  return STAGE_COLORS[stage] ?? "bg-slate-600/20 text-slate-300 border-slate-500/30";
}

function getTargetWorkbenchUrl(targetStage: string): string {
  return STAGE_TO_WORKBENCH[targetStage] ?? "/";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function HandoffToast() {
  const [toasts, setToasts] = useState<HandoffToast[]>([]);

  // ── SSE subscription — filter for stage_handoff events ─────────────────
  useEffect(() => {
    const unsubscribe = events.subscribe((event: PlatformEvent) => {
      if (event.type !== "stage_handoff") return;

      const payload = event.payload as unknown as HandoffPayload;
      if (!payload.sourceStage || !payload.targetStage) return;

      // Persist to localStorage queue for offline badge display
      queueHandoff(payload, event.timestamp);

      const toast: HandoffToast = {
        id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        payload,
        timestamp: event.timestamp,
        dismissed: false,
      };

      setToasts((prev) => {
        const active = prev.filter((t) => !t.dismissed);
        // If at max capacity, dismiss the oldest
        if (active.length >= MAX_VISIBLE_TOASTS) {
          const oldest = active[0];
          return [
            ...prev.map((t) => (t.id === oldest.id ? { ...t, dismissed: true } : t)),
            toast,
          ].filter((t) => !t.dismissed);
        }
        return [...prev, toast];
      });
    });

    return unsubscribe;
  }, []);

  // ── Dismiss handler ────────────────────────────────────────────────────
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Don't render anything if no active toasts
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-3 max-w-sm"
      aria-live="polite"
      aria-label="Handoff notifications"
    >
      {toasts.slice(-MAX_VISIBLE_TOASTS).map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
        />
      ))}
    </div>
  );
}

// ─── Toast Card ─────────────────────────────────────────────────────────────

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: HandoffToast;
  onDismiss: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startTimeRef = useRef(Date.now());

  // ── Auto-dismiss timer, pauses on hover ────────────────────────────────
  useEffect(() => {
    if (hovered) {
      // Pause: clear the timeout and save remaining time
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      return;
    }

    // Start / resume the auto-dismiss timer
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, remainingRef.current);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [hovered, toast.id, onDismiss]);

  const { payload } = toast;
  const viewUrl = getTargetWorkbenchUrl(payload.targetStage);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl shadow-black/30 p-4 w-80 animate-slide-in-right"
      role="alert"
      aria-atomic="true"
    >
      {/* ── Header: close button ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-500"
            aria-hidden="true"
          >
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
          Stage Handoff
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
          aria-label="Dismiss notification"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Source → Target badges ───────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${getStageBadgeClass(
            payload.sourceStage
          )}`}
        >
          {payload.sourceStage}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-slate-500 flex-shrink-0"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
        <span
          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${getStageBadgeClass(
            payload.targetStage
          )}`}
        >
          {payload.targetStage}
        </span>
      </div>

      {/* ── Ticket keys ──────────────────────────────────────────────── */}
      {payload.ticketKeys.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {payload.ticketKeys.map((key) => (
            <span
              key={key}
              className="inline-flex px-1.5 py-0.5 bg-slate-800 border border-slate-700/50 rounded text-[10px] font-mono text-slate-300"
            >
              {key}
            </span>
          ))}
        </div>
      )}

      {/* ── Footer: triggered by + View action ───────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 truncate max-w-[150px]" title={payload.triggeredBy}>
          by {payload.triggeredBy}
        </span>
        <a
          href={viewUrl}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 text-blue-300 rounded text-xs font-semibold hover:bg-blue-600/30 transition-colors"
        >
          View
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="7" y1="17" x2="17" y2="7" />
            <polyline points="7 7 17 7 17 17" />
          </svg>
        </a>
      </div>

      {/* ── Progress bar for auto-dismiss ────────────────────────────── */}
      {!hovered && (
        <div className="mt-3 h-0.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500/40 rounded-full animate-shrink-width"
            style={{ animationDuration: `${remainingRef.current}ms` }}
          />
        </div>
      )}
    </div>
  );
}

export default HandoffToast;
