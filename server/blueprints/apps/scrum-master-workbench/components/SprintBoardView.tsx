/**
 * SprintBoardView — Kanban board with 5 status columns, 60s auto-refresh,
 * drag-and-drop via @dnd-kit + Jira transition API, optimistic updates,
 * keyboard accessibility, ARIA live announcements, and live burndown indicator.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { AlertCircle, Loader2 } from "lucide-react";
import { jira, telemetry } from "../lib/platform-client";
import type { JiraIssue } from "../lib/platform-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  sprintNumber: number;
  committedKeys: string[];
  totalCommittedPoints: number;
}

const COLUMNS = ["To Do", "In Progress", "In Review", "QA", "Done"] as const;
type ColumnName = (typeof COLUMNS)[number];

interface DragEndResult {
  ticketKey: string;
  sourceColumn: ColumnName;
  targetColumn: ColumnName;
}

// ── Custom Keyboard Coordinate Getter ─────────────────────────────────────────
// Moves focus between columns (left/right arrows) for keyboard DnD.
// Up/Down arrows cycle within the current column's droppable targets.

function columnKeyboardCoordinates(
  event: KeyboardEvent,
  { context: { active, droppableRects, droppableContainers, over } }: any
) {
  if (!active || !droppableRects) return undefined;

  const { code } = event;

  if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(code)) {
    event.preventDefault();

    const columnIds = COLUMNS as unknown as string[];
    const currentOverId = over?.id as string | undefined;
    const currentIndex = currentOverId ? columnIds.indexOf(currentOverId) : -1;

    let targetIndex = currentIndex;

    if (code === "ArrowRight") {
      targetIndex = Math.min(currentIndex + 1, columnIds.length - 1);
    } else if (code === "ArrowLeft") {
      targetIndex = Math.max(currentIndex - 1, 0);
    }
    // ArrowUp/ArrowDown stay on same column (no vertical reordering between items)

    const targetId = columnIds[targetIndex];
    if (!targetId) return undefined;

    const targetRect = droppableRects.get(targetId);
    if (!targetRect) return undefined;

    return {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2,
    };
  }

  return undefined;
}

// ── Column-to-transition mapping ──────────────────────────────────────────────

function transitionNameForColumn(col: ColumnName): string {
  switch (col) {
    case "In Progress": return "In Progress";
    case "In Review": return "Code Review";
    case "QA": return "In QA";
    case "Done": return "Done";
    default: return "To Do";
  }
}

// ── Status → Column resolver ──────────────────────────────────────────────────

function getColumn(status: string): ColumnName {
  const lower = status.toLowerCase();
  if (lower.includes("done") || lower.includes("closed")) return "Done";
  if (lower.includes("review") || lower.includes("code review")) return "In Review";
  if (lower.includes("qa") || lower.includes("testing")) return "QA";
  if (lower.includes("progress") || lower.includes("development")) return "In Progress";
  return "To Do";
}

// ── Draggable Ticket Card ─────────────────────────────────────────────────────

interface TicketCardProps {
  ticket: JiraIssue;
  isTransitioning: boolean;
  isDragOverlay?: boolean;
}

function TicketCard({ ticket, isTransitioning, isDragOverlay }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.key,
    data: { ticket },
  });

  const cardStyle = isDragOverlay
    ? "p-2 rounded-lg border bg-[#100d17] border-violet-500/50 shadow-lg shadow-violet-500/20 cursor-grabbing"
    : `p-2 rounded-lg border bg-[#100d17] transition-all ${
        isDragging
          ? "opacity-30 border-white/5"
          : "border-white/5 hover:border-white/10 cursor-grab"
      }`;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
      className={cardStyle}
      aria-label={`Ticket ${ticket.key}: ${ticket.summary}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] font-bold text-amber-400">{ticket.key}</span>
        <div className="flex items-center gap-1">
          {isTransitioning && (
            <Loader2 className="w-3 h-3 text-violet-400 animate-spin" aria-label="Transitioning" />
          )}
          {ticket.storyPoints !== undefined && (
            <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-1 rounded">
              {ticket.storyPoints}
            </span>
          )}
        </div>
      </div>
      <p className="text-[10px] text-white leading-snug line-clamp-2">{ticket.summary}</p>
    </div>
  );
}

// ── Droppable Column ──────────────────────────────────────────────────────────

interface BoardColumnProps {
  column: ColumnName;
  tickets: JiraIssue[];
  transitioningKey: string | null;
  activeTicketKey: string | null;
  activeSourceColumn: ColumnName | null;
}

function BoardColumn({ column, tickets, transitioningKey, activeTicketKey, activeSourceColumn }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  // Determine if this column is a valid drop target during a drag
  const isDragging = activeTicketKey !== null;
  const isSourceColumn = column === activeSourceColumn;
  const isValidTarget = isDragging && !isSourceColumn;
  const isInvalidTarget = isDragging && isSourceColumn;

  let columnClass = "bg-[#15121e]/30 border border-white/5 rounded-lg p-2 min-h-[300px] transition-all duration-200";
  if (isOver && isValidTarget) {
    // Active drop indicator
    columnClass = "bg-violet-500/10 border border-violet-500/40 rounded-lg p-2 min-h-[300px] transition-all duration-200 ring-1 ring-violet-500/30";
  } else if (isInvalidTarget) {
    // Dim invalid target (source column)
    columnClass = "bg-[#15121e]/30 border border-white/5 rounded-lg p-2 min-h-[300px] transition-all duration-200 opacity-40";
  } else if (isValidTarget) {
    // Subtle highlight for valid targets during drag
    columnClass = "bg-[#15121e]/30 border border-white/10 rounded-lg p-2 min-h-[300px] transition-all duration-200 border-dashed";
  }

  return (
    <div ref={setNodeRef} className={columnClass}>
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{column}</span>
        <span className="text-[10px] font-mono text-slate-600">{tickets.length}</span>
      </div>
      <div className="space-y-2">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.key}
            ticket={ticket}
            isTransitioning={transitioningKey === ticket.key}
          />
        ))}
      </div>
      {/* Drop indicator when dragging over */}
      {isOver && isValidTarget && (
        <div className="mt-2 h-8 rounded border-2 border-dashed border-violet-500/40 bg-violet-500/5 flex items-center justify-center">
          <span className="text-[9px] text-violet-400">Drop here</span>
        </div>
      )}
    </div>
  );
}

// ── Main Board Component ──────────────────────────────────────────────────────

export function SprintBoardView({ sprintNumber, committedKeys, totalCommittedPoints }: Props) {
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [activeTicketKey, setActiveTicketKey] = useState<string | null>(null);
  const [activeSourceColumn, setActiveSourceColumn] = useState<ColumnName | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pointer sensor with slight activation distance to avoid accidental drags
  // Keyboard sensor for accessibility: Space to pick up, Arrow keys to move, Enter to drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates })
  );

  const fetchBoard = useCallback(async () => {
    try {
      const keys = committedKeys.join(", ");
      if (!keys) { setTickets([]); setLoading(false); return; }
      const result = await jira.search(
        `issueKey in (${keys}) ORDER BY status ASC`,
        ["summary", "status", "priority", "assignee", "issuetype", "customfield_10016"],
        committedKeys.length
      );
      if (result.success) setTickets(result.issues);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [committedKeys]);

  useEffect(() => {
    fetchBoard();
    intervalRef.current = setInterval(fetchBoard, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchBoard]);

  // Group tickets by status column
  const grouped: Record<ColumnName, JiraIssue[]> = {
    "To Do": [], "In Progress": [], "In Review": [], "QA": [], "Done": [],
  };
  tickets.forEach((t) => { grouped[getColumn(t.status)].push(t); });

  // Burndown: points remaining = total - done points
  const donePoints = grouped["Done"].reduce((s, t) => s + (t.storyPoints ?? 0), 0);
  const remainingPoints = totalCommittedPoints - donePoints;
  const burnPercent = totalCommittedPoints > 0 ? Math.round((donePoints / totalCommittedPoints) * 100) : 0;

  // ── DnD Handlers ─────────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const ticketKey = event.active.id as string;
    setActiveTicketKey(ticketKey);
    const ticket = tickets.find((t) => t.key === ticketKey);
    if (ticket) {
      setActiveSourceColumn(getColumn(ticket.status));
      setAnnouncement(`Picked up ${ticketKey}: ${ticket.summary}`);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (over && activeTicketKey) {
      const targetColumn = over.id as string;
      if ((COLUMNS as readonly string[]).includes(targetColumn)) {
        setAnnouncement(`Moved to ${targetColumn}`);
      }
    }
  }

  function handleDragCancel() {
    if (activeTicketKey) {
      setAnnouncement(`Cancelled moving ${activeTicketKey}`);
    }
    setActiveTicketKey(null);
    setActiveSourceColumn(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTicketKey(null);
    setActiveSourceColumn(null);

    if (!over) {
      setAnnouncement(`Cancelled moving ${active.id}`);
      return;
    }

    const ticketKey = active.id as string;
    const targetColumn = over.id as ColumnName;
    const ticket = tickets.find((t) => t.key === ticketKey);
    if (!ticket) return;

    const sourceColumn = getColumn(ticket.status);
    if (sourceColumn === targetColumn) {
      setAnnouncement(`${ticketKey} returned to ${sourceColumn}`);
      return;
    }

    // Announce the drop
    setAnnouncement(`Dropped ${ticketKey} in ${targetColumn}`);

    // Optimistic update: move card immediately
    const previousTickets = [...tickets];
    setTickets((prev) =>
      prev.map((t) => (t.key === ticketKey ? { ...t, status: targetColumn } : t))
    );

    // Show loading indicator on the card
    setTransitioning(ticketKey);

    const transitionName = transitionNameForColumn(targetColumn);

    try {
      const result = await jira.transition(ticketKey, transitionName);
      if (!result.success) {
        // Revert on failure
        setTickets(previousTickets);
        const availableMsg = result.availableTransitions?.length
          ? ` Available: ${result.availableTransitions.join(", ")}`
          : "";
        setError(`${ticketKey}: ${result.error ?? "Transition unavailable"}.${availableMsg}`);
        setAnnouncement(`Failed to move ${ticketKey} to ${targetColumn}. Reverted to ${sourceColumn}.`);
        setTimeout(() => setError(null), 8000);
      } else {
        telemetry.emit("jira_board_ticket_moved", "info", {
          jiraKey: ticketKey,
          fromStatus: sourceColumn,
          toStatus: targetColumn,
        });
      }
    } catch (e: any) {
      // Revert on network error
      setTickets(previousTickets);
      setError(`${ticketKey}: ${e.message}`);
      setAnnouncement(`Failed to move ${ticketKey} to ${targetColumn}. Reverted to ${sourceColumn}.`);
      setTimeout(() => setError(null), 8000);
    } finally {
      setTransitioning(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Find the active ticket for the DragOverlay
  const activeTicket = activeTicketKey ? tickets.find((t) => t.key === activeTicketKey) : null;

  if (loading && tickets.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-white/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Burndown bar */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#15121e]/40 border border-white/5">
        <span className="text-xs text-slate-400">Sprint Burn:</span>
        <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${burnPercent}%` }}
          />
        </div>
        <span className="text-xs font-mono text-slate-300">
          {donePoints}/{totalCommittedPoints} SP ({burnPercent}%)
        </span>
        <span className="text-xs text-slate-500">{remainingPoints} remaining</span>
      </div>

      {/* Error toast */}
      {error && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs"
          role="alert"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* DnD Kanban Board */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Sprint board columns">
          {COLUMNS.map((col) => (
            <BoardColumn
              key={col}
              column={col}
              tickets={grouped[col]}
              transitioningKey={transitioning}
              activeTicketKey={activeTicketKey}
              activeSourceColumn={activeSourceColumn}
            />
          ))}
        </div>

        {/* Drag overlay — renders the card being dragged above everything */}
        <DragOverlay dropAnimation={null}>
          {activeTicket ? (
            <TicketCard
              ticket={activeTicket}
              isTransitioning={false}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ARIA live region for screen reader announcements */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </div>
    </div>
  );
}
