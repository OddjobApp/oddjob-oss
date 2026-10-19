import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  Ban,
  Loader2,
} from "lucide-react";
import type { SessionStatus } from "../types/index.js";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";

const STATUS_CONFIG: Record<SessionStatus, { label: string; variant: BadgeVariant; Icon: typeof Activity }> = {
  active: { label: "Active", variant: "info", Icon: Activity },
  blocked: { label: "Blocked", variant: "destructive", Icon: AlertTriangle },
  completed: { label: "Completed", variant: "success", Icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", Icon: XCircle },
  pending: { label: "Pending", variant: "secondary", Icon: Clock },
  paused: { label: "Paused", variant: "warning", Icon: Pause },
  timed_out: { label: "Timed Out", variant: "warning", Icon: Clock },
  cancelled: { label: "Cancelled", variant: "outline", Icon: Ban },
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export interface StatusBadgeProps {
  status: SessionStatus;
  /** Quality-gate failure reason, shown in a tooltip for `blocked`. */
  blockedReason?: string;
  /** Current fix-attempt number, shown for `active`. */
  attemptNumber?: number;
  /** Elapsed time (ms) for the active attempt, shown for `active`. */
  elapsedMs?: number;
}

export function StatusBadge({ status, blockedReason, attemptNumber, elapsedMs }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const { label, variant, Icon } = config;

  const activeSuffix =
    status === "active" && (attemptNumber || elapsedMs !== undefined)
      ? ` · ${attemptNumber ? `attempt ${attemptNumber}` : ""}${
          attemptNumber && elapsedMs !== undefined ? " · " : ""
        }${elapsedMs !== undefined ? formatElapsed(elapsedMs) : ""}`
      : "";

  const badge = (
    <Badge variant={variant} className="inline-flex items-center gap-1" data-testid={`status-badge-${status}`}>
      <Icon className={status === "active" ? "w-3 h-3 animate-pulse" : "w-3 h-3"} />
      {label}
      {activeSuffix}
    </Badge>
  );

  if (status === "blocked" && blockedReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <Badge variant={variant} className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {label}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-xs">{blockedReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}
