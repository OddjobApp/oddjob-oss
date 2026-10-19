import React from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Eye, FlaskConical, Hourglass, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShotState } from "./status";

/**
 * A status drawn as a shape as well as a colour, so approved, failed and waiting read
 * apart without telling green from red.
 */

const ICONS: Record<ShotState, LucideIcon> = {
  approved: CheckCircle2,
  ready_for_review: Eye,
  rendering: Loader2,
  queued: Clock,
  pending_approval: Hourglass,
  failed: AlertTriangle,
  rejected: XCircle,
  simulated: FlaskConical,
  none: CircleDashed,
};

export function StatusIcon({ status, className }: { status: ShotState; className?: string }) {
  const Icon = ICONS[status];
  return <Icon aria-hidden data-status-icon={status} className={cn("h-3 w-3 shrink-0", status === "rendering" && "motion-safe:animate-spin", className)} />;
}

/** A visible keyboard focus ring for the studio's plain buttons; the shared Button has its own. */
export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
