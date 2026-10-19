/**
 * CycleHistoryView - Event-based audit trail and complete history
 *
 * Shows chronological record of all cycle state changes, decisions, and events.
 * Displays:
 * - Timeline of all events (state changes, approvals, etc.)
 * - Decision rationale and impact
 * - Cost/token attribution per event
 * - User/agent who triggered event
 * - Searchable and filterable
 * - Export capabilities (coming Phase 3)
 *
 * This is the "audit trail view" complementing CycleCompactView and CycleTimelineView.
 */

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { colors, iconRegistry, getStatusIcon, spacing } from "@oddjob/design-system";
import {
  Search,
  Filter,
  Download,
  ChevronDown,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Zap,
  DollarSign,
} from "lucide-react";
import { DrillDownPanel, useDrillDown } from "@/components/DrillDownPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EventType =
  | "cycle.created"
  | "cycle.started"
  | "cycle.completed"
  | "cycle.failed"
  | "mission.created"
  | "mission.started"
  | "mission.completed"
  | "mission.failed"
  | "mission.replanned"
  | "phase.completed"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "budget.alert"
  | "timeline.variance"
  | "dependency.blocked"
  | "dependency.unblocked";

export interface HistoryEvent {
  id: string;
  timestamp: string; // ISO timestamp
  type: EventType;
  title: string; // "Mission completed", "Budget alert", etc.
  description: string; // Detailed explanation
  actor?: string; // User or agent who triggered
  subject?: string; // Mission name, phase name, etc.
  severity: "info" | "success" | "warning" | "error"; // Visual level
  impact?: {
    cost?: number; // Cost of this event
    tokensUsed?: number;
    timeAdded?: number; // Hours
    messagesAdded?: number;
  };
  metadata?: Record<string, any>; // Extra data for detail panel
}

interface CycleHistoryViewProps {
  cycleId?: string | number;
  cycleName: string;
  cycleStatus: string;
  events: HistoryEvent[];
  isLoading?: boolean;
  onExport?: () => void;
  className?: string;
  interactive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function getEventIcon(type: EventType) {
  const iconMap: Record<EventType, any> = {
    "cycle.created": iconRegistry.operations.save,
    "cycle.started": iconRegistry.operations.resume,
    "cycle.completed": CheckCircle2,
    "cycle.failed": iconRegistry.alerts.error,
    "mission.created": iconRegistry.operations.save,
    "mission.started": iconRegistry.operations.resume,
    "mission.completed": CheckCircle2,
    "mission.failed": iconRegistry.alerts.error,
    "mission.replanned": iconRegistry.operations.reset,
    "phase.completed": CheckCircle2,
    "approval.requested": AlertTriangle,
    "approval.granted": CheckCircle2,
    "approval.rejected": iconRegistry.alerts.error,
    "budget.alert": DollarSign,
    "timeline.variance": Clock,
    "dependency.blocked": AlertTriangle,
    "dependency.unblocked": CheckCircle2,
  };
  return iconMap[type] || Clock;
}

function getEventColor(severity: string): string {
  const colorMap: Record<string, string> = {
    info: colors.info[500],
    success: colors.success[500],
    warning: colors.warning[500],
    error: colors.danger[500],
  };
  return colorMap[severity] || colors.neutral[500];
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Card
// ─────────────────────────────────────────────────────────────────────────────

interface EventCardProps {
  event: HistoryEvent;
  onClick?: () => void;
}

function EventCard({ event, onClick }: EventCardProps) {
  const IconComponent = getEventIcon(event.type);
  const eventColor = getEventColor(event.severity);

  return (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        "w-full text-left p-3 sm:p-4 rounded-lg border-l-4 transition-all",
        "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",

        // Severity-based styling
        event.severity === "error"
          ? "bg-danger/5 border-danger/50 hover:border-danger/70"
          : event.severity === "warning"
            ? "bg-warning/5 border-warning/50 hover:border-warning/70"
            : event.severity === "success"
              ? "bg-success/5 border-success/50 hover:border-success/70"
              : "bg-info/5 border-info/50 hover:border-info/70"
      )}
    >
      <div className="space-y-2">
        {/* Header: Title + Time + Severity Badge */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <IconComponent className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: eventColor }} />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm sm:text-base text-foreground">{event.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{formatTimestamp(event.timestamp)}</p>
            </div>
          </div>

          {/* Severity Badge */}
          <div
            className="flex-shrink-0 px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap capitalize"
            style={{ backgroundColor: `${eventColor}20`, color: eventColor }}
          >
            {event.severity}
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2">{event.description}</p>

        {/* Metadata Row */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
          {event.actor && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {event.actor}
            </span>
          )}

          {event.subject && (
            <span className="flex items-center gap-1">
              <span className="font-medium">{event.subject}</span>
            </span>
          )}

          {event.impact?.cost && (
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              ${event.impact.cost.toLocaleString()}
            </span>
          )}

          {event.impact?.tokensUsed && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {event.impact.tokensUsed.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Details Panel
// ─────────────────────────────────────────────────────────────────────────────

interface EventDetailsProps {
  event: HistoryEvent;
}

function EventDetails({ event }: EventDetailsProps) {
  return (
    <div className="space-y-6">
      {/* Event Summary */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">Event Details</h3>
        <div className="grid grid-cols-2 gap-3 p-4 rounded-lg border border-border/50 bg-background/40">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Type</p>
            <p className="font-mono text-sm mt-1">{event.type}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Severity</p>
            <p className="text-sm mt-1 capitalize font-medium" style={{ color: getEventColor(event.severity) }}>
              {event.severity}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Timestamp</p>
            <p className="font-mono text-sm mt-1">{formatTimestamp(event.timestamp)}</p>
          </div>

          {event.actor && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Actor</p>
              <p className="text-sm mt-1">{event.actor}</p>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">Description</h3>
        <p className="text-sm leading-6 text-muted-foreground">{event.description}</p>
      </div>

      {/* Impact */}
      {event.impact && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Impact</h3>
          <div className="grid grid-cols-2 gap-3">
            {event.impact.cost !== undefined && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase">Cost</p>
                <p className="text-lg font-bold text-foreground mt-1">
                  ${event.impact.cost.toLocaleString()}
                </p>
              </div>
            )}

            {event.impact.tokensUsed !== undefined && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase">Tokens</p>
                <p className="text-lg font-bold text-foreground mt-1">
                  {event.impact.tokensUsed.toLocaleString()}
                </p>
              </div>
            )}

            {event.impact.timeAdded !== undefined && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase">Time Added</p>
                <p className="text-lg font-bold text-foreground mt-1">+{event.impact.timeAdded}h</p>
              </div>
            )}

            {event.impact.messagesAdded !== undefined && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase">Messages</p>
                <p className="text-lg font-bold text-foreground mt-1">+{event.impact.messagesAdded}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subject */}
      {event.subject && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Subject</h3>
          <div className="p-3 rounded-lg bg-background/40 border border-border/30">
            <p className="text-sm font-mono">{event.subject}</p>
          </div>
        </div>
      )}

      {/* Metadata */}
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Additional Data</h3>
          <div className="p-3 rounded-lg bg-background/40 border border-border/30 font-mono text-xs space-y-2 max-h-64 overflow-y-auto">
            {Object.entries(event.metadata).map(([key, value]) => (
              <div key={key} className="flex gap-2 items-start">
                <span className="text-muted-foreground">{key}:</span>
                <span className="text-foreground break-all">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const CycleHistoryView = React.forwardRef<HTMLDivElement, CycleHistoryViewProps>(
  (
    {
      cycleId,
      cycleName,
      cycleStatus,
      events,
      isLoading = false,
      onExport,
      className,
      interactive = true,
    },
    ref
  ) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [severityFilter, setSeverityFilter] = useState<string[]>([]);
    const [typeFilter, setTypeFilter] = useState<string[]>([]);

    // Filter events
    const filteredEvents = useMemo(() => {
      return events.filter((event) => {
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matches =
            event.title.toLowerCase().includes(query) ||
            event.description.toLowerCase().includes(query) ||
            event.type.toLowerCase().includes(query) ||
            event.subject?.toLowerCase().includes(query);
          if (!matches) return false;
        }

        // Severity filter
        if (severityFilter.length > 0 && !severityFilter.includes(event.severity)) {
          return false;
        }

        // Type filter
        if (typeFilter.length > 0 && !typeFilter.includes(event.type)) {
          return false;
        }

        return true;
      });
    }, [events, searchQuery, severityFilter, typeFilter]);

    // Group events by date
    const groupedEvents = useMemo(() => {
      const groups = new Map<string, HistoryEvent[]>();

      filteredEvents.forEach((event) => {
        const date = formatDate(event.timestamp);
        if (!groups.has(date)) {
          groups.set(date, []);
        }
        groups.get(date)!.push(event);
      });

      return Array.from(groups.entries()).sort((a, b) => {
        return new Date(b[1][0].timestamp).getTime() - new Date(a[1][0].timestamp).getTime();
      });
    }, [filteredEvents]);

    // Drill-down state
    const { isOpen, item: selectedEvent, open, close } = useDrillDown<HistoryEvent>();

    // Calculate statistics
    const stats = useMemo(() => {
      const errors = events.filter((e) => e.severity === "error").length;
      const warnings = events.filter((e) => e.severity === "warning").length;
      const totalCost = events.reduce((sum, e) => sum + (e.impact?.cost || 0), 0);
      const totalTokens = events.reduce((sum, e) => sum + (e.impact?.tokensUsed || 0), 0);

      return { errors, warnings, totalCost, totalTokens };
    }, [events]);

    return (
      <>
        <div ref={ref} className={cn("space-y-6", className)}>
          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-foreground">{cycleName}</h2>
                <p className="text-xs sm:text-sm text-muted-foreground capitalize">
                  History View — Complete Audit Trail
                </p>
              </div>

              {/* Export Button */}
              {onExport && (
                <button
                  onClick={onExport}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              )}
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-background/40">
                <p className="text-xs font-medium text-muted-foreground uppercase">Total Events</p>
                <p className="text-2xl font-black text-foreground mt-1">{events.length}</p>
              </div>

              {stats.errors > 0 && (
                <div className="p-3 rounded-lg bg-danger/5 border border-danger/20">
                  <p className="text-xs font-medium text-danger uppercase">Errors</p>
                  <p className="text-2xl font-black text-danger mt-1">{stats.errors}</p>
                </div>
              )}

              {stats.warnings > 0 && (
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <p className="text-xs font-medium text-warning uppercase">Warnings</p>
                  <p className="text-2xl font-black text-warning mt-1">{stats.warnings}</p>
                </div>
              )}

              {stats.totalCost > 0 && (
                <div className="p-3 rounded-lg bg-background/40">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Total Cost</p>
                  <p className="text-2xl font-black text-foreground mt-1">
                    ${stats.totalCost.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/50 bg-background/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-2">
              {/* Severity Filter */}
              {["error", "warning", "success", "info"].map((sev) => (
                <button
                  key={sev}
                  onClick={() => {
                    setSeverityFilter((prev) =>
                      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
                    );
                  }}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
                    severityFilter.includes(sev)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 text-secondary-foreground hover:bg-secondary"
                  )}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Results Count */}
            <p className="text-xs text-muted-foreground">
              Showing {filteredEvents.length} of {events.length} events
              {searchQuery && ` (filtered)`}
            </p>
          </div>

          {/* Events Timeline */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">Loading history...</div>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">No events found</div>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedEvents.map(([date, dayEvents]) => (
                <div key={date} className="space-y-2">
                  {/* Date Header */}
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide sticky top-0 bg-background/80 backdrop-blur-sm py-2">
                    {date}
                  </h3>

                  {/* Events for this day */}
                  <div className="space-y-2 pl-0 sm:pl-4 border-l-2 border-neutral/20 ml-2 sm:ml-0">
                    {dayEvents.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        onClick={() => {
                          if (interactive) {
                            open(event);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event Details Drill-Down */}
        <DrillDownPanel
          isOpen={isOpen}
          title={selectedEvent?.title || "Event"}
          subtitle={selectedEvent ? formatTimestamp(selectedEvent.timestamp) : undefined}
          onClose={close}
          size="lg"
        >
          {selectedEvent && <EventDetails event={selectedEvent} />}
        </DrillDownPanel>
      </>
    );
  }
);

CycleHistoryView.displayName = "CycleHistoryView";

export default CycleHistoryView;
