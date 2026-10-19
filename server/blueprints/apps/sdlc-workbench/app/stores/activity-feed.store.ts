/**
 * Activity Feed Store
 *
 * Zustand store managing real-time activity feed state across all SDLC workbenches.
 * Provides a unified, chronological stream of agent events with filtering,
 * pagination, and collapsible sidebar persistence.
 *
 * Requirements: 1.1, 1.2, 1.4, 1.7
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { PlatformEvent } from '../../lib/platform-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'agent_thought' | 'tool_call' | 'tool_result' | 'mission_transition' | 'hil_request' | 'handoff' | 'error';
  agentName: string;
  missionStage: 'requirements' | 'development' | 'qa' | 'deployment' | 'other';
  summary: string;
  detail?: string;
  missionRunId?: number;
  ticketKey?: string;
  actionable?: { type: 'hil'; hilId: string } | { type: 'navigate'; href: string };
}

export interface ActivityFeedFilters {
  agents: string[];
  stages: string[];
  types: string[];
}

export interface ActivityFeedState {
  events: ActivityEvent[];
  filters: ActivityFeedFilters;
  collapsed: boolean;
  loading: boolean;
  hasMore: boolean;

  // Actions
  addEvent: (event: ActivityEvent) => void;
  loadMore: () => Promise<void>;
  setFilters: (filters: Partial<ActivityFeedFilters>) => void;
  toggleCollapsed: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of events to keep in memory */
const MAX_EVENTS = 500;

/** Number of events to fetch per page */
const PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Maps an SSE event type to an ActivityEvent type.
 */
function mapEventType(sseType: string): ActivityEvent['type'] | null {
  switch (sseType) {
    case 'agent_thought':
      return 'agent_thought';
    case 'tool_start':
      return 'tool_call';
    case 'tool_end':
      return 'tool_result';
    case 'stage_transition':
      return 'mission_transition';
    case 'stage_handoff':
      return 'handoff';
    case 'hil_created':
      return 'hil_request';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * Infers the mission stage from the event payload or mission name.
 */
function inferMissionStage(payload: Record<string, unknown>): ActivityEvent['missionStage'] {
  // Direct stage from payload (e.g., stage_transition events)
  const stage = (payload.stage ?? payload.to ?? payload.missionStage ?? '') as string;
  const normalized = stage.toLowerCase();

  if (normalized.includes('requirement') || normalized.includes('prd') || normalized.includes('pm')) {
    return 'requirements';
  }
  if (normalized.includes('develop') || normalized.includes('coding') || normalized.includes('implementation')) {
    return 'development';
  }
  if (normalized.includes('qa') || normalized.includes('test') || normalized.includes('quality')) {
    return 'qa';
  }
  if (normalized.includes('deploy') || normalized.includes('release') || normalized.includes('uat')) {
    return 'deployment';
  }

  // Try to infer from mission name
  const missionName = ((payload.missionName ?? payload.mission ?? '') as string).toLowerCase();
  if (missionName.includes('requirement') || missionName.includes('prd')) return 'requirements';
  if (missionName.includes('develop') || missionName.includes('implement')) return 'development';
  if (missionName.includes('qa') || missionName.includes('test')) return 'qa';
  if (missionName.includes('deploy') || missionName.includes('release')) return 'deployment';

  return 'other';
}

/**
 * Builds a human-readable summary from the event payload.
 */
function buildSummary(type: ActivityEvent['type'], payload: Record<string, unknown>): string {
  const agent = (payload.agentName ?? payload.agent ?? 'Agent') as string;

  switch (type) {
    case 'agent_thought':
      return (payload.summary ?? payload.thought ?? `${agent} is thinking...`) as string;
    case 'tool_call':
      return `${agent} called ${(payload.toolName ?? payload.tool ?? 'a tool') as string}`;
    case 'tool_result':
      return `${agent} received result from ${(payload.toolName ?? payload.tool ?? 'tool') as string}`;
    case 'mission_transition':
      return `Mission transitioned to ${(payload.to ?? payload.stage ?? 'next stage') as string}`;
    case 'hil_request':
      return `${agent} needs input: ${(payload.formName ?? payload.prompt ?? 'decision required') as string}`;
    case 'handoff':
      return `Handoff: ${(payload.sourceStage ?? '') as string} → ${(payload.targetStage ?? '') as string}`;
    case 'error':
      return (payload.message ?? payload.error ?? 'An error occurred') as string;
    default:
      return (payload.summary ?? 'Event occurred') as string;
  }
}

/**
 * Extracts actionable metadata from the event payload if present.
 */
function extractActionable(type: ActivityEvent['type'], payload: Record<string, unknown>): ActivityEvent['actionable'] {
  if (type === 'hil_request' && payload.hilId) {
    return { type: 'hil', hilId: payload.hilId as string };
  }
  if (payload.href) {
    return { type: 'navigate', href: payload.href as string };
  }
  return undefined;
}

/**
 * Maps an incoming SSE PlatformEvent to the ActivityEvent format.
 * Returns null if the event type is not recognized.
 */
export function mapPlatformEvent(event: PlatformEvent): ActivityEvent | null {
  const mappedType = mapEventType(event.type);
  if (!mappedType) return null;

  const { payload } = event;

  return {
    id: (payload.id as string) ?? `${event.type}-${event.timestamp}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: event.timestamp,
    type: mappedType,
    agentName: (payload.agentName ?? payload.agent ?? 'Unknown') as string,
    missionStage: inferMissionStage(payload),
    summary: buildSummary(mappedType, payload),
    detail: (payload.detail ?? payload.details) as string | undefined,
    missionRunId: payload.runId as number | undefined,
    ticketKey: (payload.ticketKey ?? payload.issueKey) as string | undefined,
    actionable: extractActionable(mappedType, payload),
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useActivityFeedStore = create<ActivityFeedState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        events: [],
        filters: { agents: [], stages: [], types: [] },
        collapsed: false,
        loading: false,
        hasMore: true,

        // ── Actions ─────────────────────────────────────────────────────────

        addEvent: (event: ActivityEvent) => {
          const state = get();

          // Guard against duplicate events
          if (state.events.some((e) => e.id === event.id)) {
            return;
          }

          // Prepend new event (newest first), cap at MAX_EVENTS
          const updatedEvents = [event, ...state.events].slice(0, MAX_EVENTS);

          set({ events: updatedEvents });
        },

        loadMore: async () => {
          const state = get();
          if (state.loading || !state.hasMore) return;

          set({ loading: true });

          try {
            // Build query params for cursor-based pagination
            const params = new URLSearchParams();
            params.set('limit', String(PAGE_SIZE));

            // Use the last event's id as cursor for pagination
            if (state.events.length > 0) {
              const lastEvent = state.events[state.events.length - 1];
              params.set('cursor', lastEvent.id);
            }

            // Apply current filters
            const { filters } = state;
            if (filters.agents.length > 0) {
              params.set('agent', filters.agents.join(','));
            }
            if (filters.stages.length > 0) {
              params.set('stage', filters.stages.join(','));
            }
            if (filters.types.length > 0) {
              params.set('type', filters.types.join(','));
            }

            const response = await fetch(`/api/oddjob/events/history?${params.toString()}`, {
              credentials: 'include',
            });

            if (!response.ok) {
              throw new Error(`Failed to load events: HTTP ${response.status}`);
            }

            const data = await response.json();
            const newEvents: ActivityEvent[] = data.events ?? [];

            // Deduplicate against existing events
            const existingIds = new Set(state.events.map((e) => e.id));
            const uniqueNewEvents = newEvents.filter((e) => !existingIds.has(e.id));

            set({
              events: [...get().events, ...uniqueNewEvents].slice(0, MAX_EVENTS),
              hasMore: newEvents.length >= PAGE_SIZE,
              loading: false,
            });
          } catch (error) {
            console.error('[ActivityFeedStore] Failed to load more events:', error);
            set({ loading: false });
          }
        },

        setFilters: (newFilters: Partial<ActivityFeedFilters>) => {
          const state = get();
          set({
            filters: { ...state.filters, ...newFilters },
          });
        },

        toggleCollapsed: () => {
          set({ collapsed: !get().collapsed });
        },
      }),
      {
        name: 'activity-feed-storage',
        // Only persist collapsed state to localStorage (Requirement 1.7)
        partialize: (state) => ({
          collapsed: state.collapsed,
        }),
      }
    ),
    { name: 'ActivityFeedStore' }
  )
);
