import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { missionRunPath } from "@/lib/paths";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Activity,
  Zap,
  Package
} from "lucide-react";
import { Link } from "wouter";

export interface TimelineEvent {
  id: number | string;
  type: 'job_start' | 'job_success' | 'job_failure' | 'alert' | 'schedule_trigger' | 'pipeline_start' | 'pipeline_end' | 'skill_ingested';
  title: string;
  description?: string;
  timestamp: string | Date;
  entityId?: number; 
  link?: string; 
  meta?: Record<string, any>;
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
  className?: string;
  maxHeight?: string;
}

export function ActivityTimeline({ events, className, maxHeight = "h-[400px]" }: ActivityTimelineProps) {
  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'job_success': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'job_failure': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'alert': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'schedule_trigger': return <Clock className="w-4 h-4 text-blue-500" />;
      case 'pipeline_start': return <Zap className="w-4 h-4 text-purple-500" />;
      case 'pipeline_end': return <Activity className="w-4 h-4 text-muted-foreground" />;
      case 'job_start': return <Activity className="w-4 h-4 text-blue-400" />;
      case 'skill_ingested': return <Package className="w-4 h-4 text-indigo-500" />;
      default: return <Activity className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getEventLink = (event: TimelineEvent) => {
    // The server already resolves a link per event from the audit row's entityType
    // (dashboard.service.ts) — a pipeline audit becomes /pipelines/:id, a knowledge
    // node becomes /knowledge/graph. That is the authority, because only the server
    // knows which table entityId came from.
    if (event.link) return event.link;

    // Explicitly carried ids, not inferred ones.
    if (event.meta?.missionId && event.meta?.runId) {
      return missionRunPath(event.meta.missionId, event.meta.runId);
    }

    // Links that need no id are still safe to derive.
    if (event.type === 'alert') return `/health/alerts`;

    // Everything else is deliberately not linked.
    //
    // `type` is a display category — 'job_success', 'pipeline_start' — not an
    // entity type, so building an entity URL from it guesses at which table
    // entityId belongs to. `type.includes('pipeline')` used to send entityId to
    // /health/monitoring/:id, which resolves pipeline_step_executions; but events
    // reach that branch from `agent-*` audit rows, whose entityId is nothing of
    // the sort. A knowledge-graph node is likewise typed 'pipeline_end'.
    //
    // An event the server could not link is left inert rather than pointed at a
    // page that will 404.
    return null;
  };

  if (events.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center p-8 text-center text-muted-foreground", className)}>
        <Activity className="w-8 h-8 mb-2 opacity-20" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <ScrollArea className={cn("pr-4", maxHeight, className)}>
      <div className="relative pl-2 space-y-6">
        {/* Vertical Line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />

        {events.map((event, index) => {
          const isLast = index === events.length - 1;
          const link = getEventLink(event);
          const timeAgo = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });

          return (
            <div key={event.id} className="relative flex gap-4 group">
              {/* Dot/Icon */}
              <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-background border ring-4 ring-background shadow-sm mt-0.5">
                {getEventIcon(event.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex flex-col gap-0.5">
                  <div className="text-sm font-medium text-foreground truncate flex items-center gap-2">
                    {link ? (
                      <Link href={link} className="hover:text-primary hover:underline transition-colors">
                        {event.title}
                      </Link>
                    ) : (
                      <span>{event.title}</span>
                    )}
                  </div>
                  {event.description && (
                    <p className="text-xs text-muted-foreground break-words line-clamp-2">
                      {event.description}
                    </p>
                  )}
                  <span className="text-[10px] text-muted-foreground/60 font-mono mt-1">
                    {timeAgo}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
