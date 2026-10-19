import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { StatusBadge } from "./StatusBadge.js";
import type { SessionListItem, SessionStatus } from "../types/index.js";

// Default sort priority: blocked first, then active, then everything else.
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  blocked: 0,
  active: 1,
  paused: 2,
  pending: 3,
  timed_out: 4,
  failed: 5,
  completed: 6,
  cancelled: 7,
};

function duration(item: SessionListItem): string {
  const start = new Date(item.startedAt).getTime();
  const end = item.completedAt ? new Date(item.completedAt).getTime() : Date.now();
  if (Number.isNaN(start)) return "-";
  const s = Math.floor((end - start) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function phaseProgress(item: SessionListItem): string {
  const total = item.phases.length;
  if (total === 0) return "-";
  const done = item.phases.filter((p) => p.status === "completed").length;
  return `${done}/${total}`;
}

export interface SessionTableProps {
  sessions: SessionListItem[];
  onRowClick?: (id: string) => void;
  isLoading?: boolean;
}

export function SessionTable({ sessions, onRowClick, isLoading }: SessionTableProps) {
  const sorted = [...sessions].sort((a, b) => {
    const p = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9);
    if (p !== 0) return p;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  if (!isLoading && sorted.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground" data-testid="session-table-empty">No sessions match the current filter.</p>;
  }

  return (
    <div data-testid="session-table">
      <div className="space-y-3 md:hidden">
        {sorted.map((s) => (
          // The card and the table row below are two renderings of one
          // session and both sit in the DOM at once: jsdom applies no media
          // queries, so `md:hidden` hides nothing there. They carried the same
          // test id, which made every getByTestId ambiguous.
          <button
            key={s.id}
            type="button"
            className="w-full rounded-lg border border-border/70 bg-card/60 p-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-default"
            onClick={() => onRowClick?.(s.id)}
            disabled={!onRowClick}
            data-testid={`session-card-${s.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">{s.id.slice(0, 8)}</p>
                <p className="mt-1 truncate text-sm font-medium">{s.templateId}</p>
              </div>
              <StatusBadge status={s.status} blockedReason={s.blockedReason} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Phase</p>
                <p className="mt-1 capitalize">{s.currentPhase?.replace(/_/g, " ") ?? "-"}</p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">Progress</p>
                <p className="mt-1">{phaseProgress(s)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="mt-1">{new Date(s.startedAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">Cost / Duration</p>
                <p className="mt-1">${s.totalCostUsd.toFixed(2)} / {duration(s)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => (
              <TableRow
                key={s.id}
                className={onRowClick ? "cursor-pointer" : undefined}
                onClick={() => onRowClick?.(s.id)}
                data-testid={`session-row-${s.id}`}
              >
                <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                <TableCell>{s.templateId}</TableCell>
                <TableCell><StatusBadge status={s.status} blockedReason={s.blockedReason} /></TableCell>
                <TableCell className="capitalize">{s.currentPhase?.replace(/_/g, " ") ?? "-"}</TableCell>
                <TableCell>{phaseProgress(s)}</TableCell>
                <TableCell className="text-right">${s.totalCostUsd.toFixed(2)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(s.startedAt).toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">{duration(s)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
