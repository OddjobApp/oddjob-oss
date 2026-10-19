import { useLocation } from "wouter";
import { Workflow, ArrowRight } from "lucide-react";
import { useBlockedSessions } from "../hooks/useBlockedSessions.js";
import type { SessionListItem } from "../types/index.js";

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "< 1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}

function unresolvedCount(session: SessionListItem): number | undefined {
  const failures = (session.metadata as { blockingFailures?: unknown[] } | undefined)?.blockingFailures;
  return Array.isArray(failures) ? failures.length : undefined;
}

/**
 * Decision-dashboard sub-widget listing pipeline sessions blocked on a quality
 * gate, distinguished from mission-level items by a pipeline icon.
 * Task 9.1 — Requirements 9.1-9.4
 */
export function BlockedSessionsWidget() {
  const [, setLocation] = useLocation();
  const { data: sessions = [] } = useBlockedSessions();

  if (sessions.length === 0) return null;

  return (
    <div className="border-t border-border/40" data-testid="blocked-sessions-widget">
      <p className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Pipeline Sessions
      </p>
      <ul role="list" className="divide-y divide-border/40">
        {sessions.map((session) => {
          const failures = unresolvedCount(session);
          return (
            <li
              key={session.id}
              role="listitem"
              tabIndex={0}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-inset"
              onClick={() => setLocation(`/pipeline/sessions/${session.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLocation(`/pipeline/sessions/${session.id}`);
                }
              }}
              aria-label={`Pipeline session ${session.templateId} — quality gate blocked`}
            >
              <Workflow className="h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{session.templateId}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{timeSince(session.startedAt)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  Quality Gate Blocked
                  {failures !== undefined && failures > 0 && ` · ${failures} unresolved`}
                </p>
              </div>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
