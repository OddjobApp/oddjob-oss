"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useActivityFeedStore, mapPlatformEvent } from "../stores/activity-feed.store";
import type { ActivityEvent } from "../stores/activity-feed.store";
import { events } from "../../lib/platform-client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActivityFeedProps {
  position?: "sidebar" | "inline";
  maxHeight?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STAGE_OPTIONS = ["requirements", "development", "qa", "deployment"] as const;
const STAGE_LABELS: Record<string, string> = {
  requirements: "Requirements",
  development: "Development",
  qa: "QA",
  deployment: "Deployment",
};

const TYPE_OPTIONS = [
  "agent_thought",
  "tool_call",
  "tool_result",
  "mission_transition",
  "hil_request",
  "handoff",
  "error",
] as const;

const TYPE_LABELS: Record<string, string> = {
  agent_thought: "Thought",
  tool_call: "Tool Call",
  tool_result: "Tool Result",
  mission_transition: "Transition",
  hil_request: "Decision",
  handoff: "Handoff",
  error: "Error",
};

const EVENT_ICONS: Record<ActivityEvent["type"], string> = {
  agent_thought: "💭",
  tool_call: "🔧",
  tool_result: "📋",
  mission_transition: "🔄",
  hil_request: "🔔",
  handoff: "🤝",
  error: "⚠️",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ActivityFeed({ position = "sidebar", maxHeight }: ActivityFeedProps) {
  const {
    events: allEvents,
    filters,
    collapsed,
    loading,
    hasMore,
    addEvent,
    loadMore,
    setFilters,
    toggleCollapsed,
  } = useActivityFeedStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── SSE subscription ────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = events.subscribe((platformEvent) => {
      const mapped = mapPlatformEvent(platformEvent);
      if (mapped) {
        addEvent(mapped);
      }
    });

    return unsubscribe;
  }, [addEvent]);

  // ── Load initial events ─────────────────────────────────────────────────
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Infinite scroll observer ────────────────────────────────────────────
  const setupObserver = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      if (!node || !hasMore) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !loading && hasMore) {
            loadMore();
          }
        },
        { root: scrollRef.current, threshold: 0.1 }
      );

      observerRef.current.observe(node);
    },
    [hasMore, loading, loadMore]
  );

  // ── Filter events ──────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    return allEvents.filter((event) => {
      if (filters.agents.length > 0 && !filters.agents.includes(event.agentName)) {
        return false;
      }
      if (filters.stages.length > 0 && !filters.stages.includes(event.missionStage)) {
        return false;
      }
      if (filters.types.length > 0 && !filters.types.includes(event.type)) {
        return false;
      }
      return true;
    });
  }, [allEvents, filters]);

  // ── Derive unique agent names from events ──────────────────────────────
  const agentNames = useMemo(() => {
    const names = new Set(allEvents.map((e) => e.agentName));
    return Array.from(names).sort();
  }, [allEvents]);

  // ── Sidebar mode: collapsed toggle ─────────────────────────────────────
  if (position === "sidebar" && collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-slate-800 border border-slate-700/50 border-r-0 rounded-l-lg px-2 py-4 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
        aria-label="Open activity feed"
        title="Open Activity Feed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span className="block mt-2 text-[10px] writing-vertical">Feed</span>
      </button>
    );
  }

  const containerClass =
    position === "sidebar"
      ? "w-80 bg-slate-900/70 backdrop-blur-md border-l border-slate-700/50 flex flex-col h-full"
      : "w-full flex flex-col";

  const containerStyle = maxHeight && position === "sidebar" ? { maxHeight } : undefined;

  return (
    <aside className={containerClass} style={containerStyle} aria-label="Activity feed">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-white">Activity Feed</h2>
        {position === "sidebar" && (
          <button
            onClick={toggleCollapsed}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded"
            aria-label="Collapse activity feed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────── */}
      <FilterBar
        agents={agentNames}
        filters={filters}
        setFilters={setFilters}
      />

      {/* ── Event list ──────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
        role="log"
        aria-live="polite"
        aria-label="Activity events"
      >
        {filteredEvents.length === 0 && !loading && (
          <p className="text-center text-sm text-slate-500 py-8">No events yet</p>
        )}

        {filteredEvents.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}

        {/* Sentinel for infinite scroll */}
        <div ref={setupObserver} className="h-1" />

        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-slate-400">Loading…</span>
          </div>
        )}

        {!hasMore && filteredEvents.length > 0 && (
          <p className="text-center text-xs text-slate-600 py-3">All events loaded</p>
        )}
      </div>
    </aside>
  );
}

// ─── Filter Bar ─────────────────────────────────────────────────────────────

function FilterBar({
  agents,
  filters,
  setFilters,
}: {
  agents: string[];
  filters: { agents: string[]; stages: string[]; types: string[] };
  setFilters: (f: Partial<typeof filters>) => void;
}) {
  const toggleAgent = (name: string) => {
    const current = filters.agents;
    const updated = current.includes(name)
      ? current.filter((a) => a !== name)
      : [...current, name];
    setFilters({ agents: updated });
  };

  const toggleStage = (stage: string) => {
    const current = filters.stages;
    const updated = current.includes(stage)
      ? current.filter((s) => s !== stage)
      : [...current, stage];
    setFilters({ stages: updated });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) {
      setFilters({ types: [] });
    } else {
      const current = filters.types;
      const updated = current.includes(value)
        ? current.filter((t) => t !== value)
        : [...current, value];
      setFilters({ types: updated });
    }
  };

  return (
    <div className="px-3 py-2 border-b border-slate-700/30 space-y-2">
      {/* Agent chips */}
      {agents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agents.map((name) => (
            <button
              key={name}
              onClick={() => toggleAgent(name)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                filters.agents.includes(name)
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700/60 text-slate-300 hover:bg-slate-600"
              }`}
              aria-pressed={filters.agents.includes(name)}
              aria-label={`Filter by agent ${name}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Stage pills */}
      <div className="flex flex-wrap gap-1">
        {STAGE_OPTIONS.map((stage) => (
          <button
            key={stage}
            onClick={() => toggleStage(stage)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              filters.stages.includes(stage)
                ? "bg-emerald-600 text-white"
                : "bg-slate-700/60 text-slate-300 hover:bg-slate-600"
            }`}
            aria-pressed={filters.stages.includes(stage)}
            aria-label={`Filter by stage ${STAGE_LABELS[stage]}`}
          >
            {STAGE_LABELS[stage]}
          </button>
        ))}
      </div>

      {/* Type dropdown */}
      <select
        value=""
        onChange={handleTypeChange}
        className="w-full bg-slate-800 border border-slate-700/50 rounded text-xs text-slate-300 px-2 py-1"
        aria-label="Filter by event type"
      >
        <option value="">
          {filters.types.length === 0
            ? "All types"
            : `${filters.types.length} type${filters.types.length > 1 ? "s" : ""} selected`}
        </option>
        {TYPE_OPTIONS.map((type) => (
          <option key={type} value={type}>
            {filters.types.includes(type) ? "✓ " : ""}
            {TYPE_LABELS[type]}
          </option>
        ))}
      </select>

      {/* Active filter indicators */}
      {(filters.agents.length > 0 || filters.stages.length > 0 || filters.types.length > 0) && (
        <button
          onClick={() => setFilters({ agents: [], stages: [], types: [] })}
          className="text-[10px] text-slate-400 hover:text-white transition-colors"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

// ─── Event Card ─────────────────────────────────────────────────────────────

function EventCard({ event }: { event: ActivityEvent }) {
  const timeAgo = useRelativeTime(event.timestamp);

  return (
    <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 hover:border-slate-600/50 transition-colors">
      <div className="flex items-start gap-2">
        {/* Agent icon / type icon */}
        <span className="text-sm mt-0.5 flex-shrink-0" aria-hidden="true">
          {EVENT_ICONS[event.type]}
        </span>

        <div className="flex-1 min-w-0">
          {/* Header: agent name + timestamp */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-200 truncate">
              {event.agentName}
            </span>
            <time
              dateTime={event.timestamp}
              className="text-[10px] text-slate-500 flex-shrink-0"
              title={new Date(event.timestamp).toLocaleString()}
            >
              {timeAgo}
            </time>
          </div>

          {/* Summary */}
          <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{event.summary}</p>

          {/* Stage badge */}
          {event.missionStage !== "other" && (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-700/60 text-slate-400">
              {STAGE_LABELS[event.missionStage] ?? event.missionStage}
            </span>
          )}

          {/* Action button for HIL events */}
          {event.actionable?.type === "hil" && (
            <a
              href={`/hil/${event.actionable.hilId}`}
              className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 bg-amber-600/20 border border-amber-500/30 text-amber-300 rounded text-[10px] font-semibold hover:bg-amber-600/30 transition-colors"
            >
              Review
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </a>
          )}

          {/* Navigate action */}
          {event.actionable?.type === "navigate" && (
            <a
              href={event.actionable.href}
              className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 bg-blue-600/20 border border-blue-500/30 text-blue-300 rounded text-[10px] font-semibold hover:bg-blue-600/30 transition-colors"
            >
              View
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}
