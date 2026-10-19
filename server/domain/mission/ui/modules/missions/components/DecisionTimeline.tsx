/**
 * Decision Timeline
 * Checkpoint cards from mission history with missionContext snapshot.
 * Plan: merge mission chat with checkpoint cards; on each checkpoint or human_approval
 * pause render "Checkpoint Card" with missionContext snapshot and reason.
 * Fetches from workgroupBlackboardHistory + approvalRequests joined by timestamps.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Link } from "wouter";
import { format, isValid } from "date-fns";
import { BookmarkCheck, History, ChevronDown, ChevronRight, ShieldCheck, UserCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { ApprovalDetailDialog } from "@domain-ui/apps/ui/components/approvals/ApprovalDetailDialog";
import { cn } from "@/lib/utils";

interface DecisionTimelineProps {
  missionRunId: number | null;
}

type TimelineItem =
  | { type: "checkpoint"; blackboard: unknown; changeReason: string | null; createdAt: string }
  | { type: "approval"; id: number; status: string; createdAt: string; decisionAt: string | null; contextSnapshot?: any; jobName?: string; agentSlug?: string; formName?: string; pipelineName?: string; comments?: string | null };

export function DecisionTimeline({ missionRunId }: DecisionTimelineProps) {
  const [selectedApproval, setSelectedApproval] = useState<any | null>(null);
  const queryClient = useQueryClient();
  
  const { data: timeline = [], isLoading } = useQuery<TimelineItem[]>({
    queryKey: [`/api/mission-runs/${missionRunId}/timeline`],
    enabled: !!missionRunId,
  });

  if (!missionRunId) return null;

  if (isLoading) return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg font-bold tracking-tight">Decision Timeline</CardTitle>
        </div>
        <CardDescription>Checkpoint and approval history for this mission.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-md bg-muted/40 border border-border p-3 space-y-1.5">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  if (!Array.isArray(timeline) || timeline.length === 0) return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg font-bold tracking-tight">Decision Timeline</CardTitle>
        </div>
        <CardDescription>Checkpoint and approval history for this mission.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center py-6">No checkpoints or approvals recorded yet.</p>
      </CardContent>
    </Card>
  );

  const formatReason = (r: string | null) => {
    if (!r) return "Checkpoint";
    if (r === "checkpoint:milestone_complete") return "Milestone";
    if (r.startsWith("checkpoint:")) return r.replace("checkpoint:", "").replace(/_/g, " ");
    return r;
  };

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg font-bold tracking-tight">Decision Timeline</CardTitle>
        </div>
        <CardDescription>Checkpoint and approval history for this mission.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[280px] overflow-auto">
          {timeline.slice(0, 15).map((item, i) =>
            item.type === "checkpoint" ? (
              <CheckpointCard key={`cp-${i}`} cp={item} formatReason={formatReason} />
            ) : (
              <ApprovalCard 
                key={`approval-${item.id}`} 
                item={item} 
                onClick={() => setSelectedApproval(item)} 
              />
            )
          )}
        </div>

        <ApprovalDetailDialog
          open={!!selectedApproval}
          onOpenChange={(open) => !open && setSelectedApproval(null)}
          approval={selectedApproval ? {
            id: selectedApproval.id,
            pipelineName: selectedApproval.pipelineName || "Mission Control",
            stepName: selectedApproval.formName || selectedApproval.jobName || "Strategic Decision",
            createdAt: selectedApproval.createdAt,
            contextSnapshot: selectedApproval.contextSnapshot || {},
            pipelineExecutionId: 0,
            status: selectedApproval.status,
            comments: selectedApproval.comments,
          } : null}
          onDecision={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs/${missionRunId}/timeline`] });
            setSelectedApproval(null);
          }}
        />
      </CardContent>
    </Card>
  );
}

function CheckpointCard({
  cp,
  formatReason,
}: {
  cp: { blackboard: unknown; changeReason: string | null; createdAt: string };
  formatReason: (r: string | null) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const blackboard = cp.blackboard as Record<string, unknown> | undefined;
  const hasSnapshot = blackboard && Object.keys(blackboard).length > 0;

  return (
    <div className="rounded-md bg-muted/40 border border-border overflow-hidden">
      <div
        className="flex items-start gap-3 p-2 cursor-pointer hover:bg-muted/60 transition-colors"
        onClick={() => hasSnapshot && setExpanded(!expanded)}
      >
        <div className="shrink-0 mt-0.5">
          {hasSnapshot ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-primary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-primary" />
            )
          ) : (
            <BookmarkCheck className="w-4 h-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Badge
            variant="outline"
            className="text-[10px] uppercase mb-1 border-primary/20 text-primary"
          >
            {formatReason(cp.changeReason)}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {isValid(new Date(cp.createdAt)) ? format(new Date(cp.createdAt), "MMM d, h:mm a") : "Unknown time"}
          </p>
        </div>
      </div>
      {hasSnapshot && expanded && (
        <div className="px-2 pb-2 pt-0 border-t border-border mt-1">
          {blackboard.hil_modified_output || blackboard.result ? (
            <div className="text-[11px] text-foreground p-2 bg-background/30 rounded border border-border/50 mt-1">
              {typeof (blackboard.hil_modified_output || blackboard.result) === 'string' 
                ? (String(blackboard.hil_modified_output || blackboard.result))
                : JSON.stringify(blackboard.hil_modified_output || blackboard.result, null, 2)}
              {Boolean(blackboard.hil_comments) && (
                <div className="mt-2 text-[10px] text-muted-foreground italic border-t border-border/30 pt-1">
                  Note: {String(blackboard.hil_comments)}
                </div>
              )}
            </div>
          ) : (
            <pre className="text-[10px] font-mono text-muted-foreground overflow-auto max-h-24 whitespace-pre-wrap break-words">
              {JSON.stringify(blackboard, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  item,
  onClick,
}: {
  item: { id: number; status: string; createdAt: string; decisionAt: string | null; jobName?: string; agentSlug?: string; formName?: string; comments?: string | null };
  onClick: () => void;
}) {
  const isResolved = item.status !== "pending";
  const isApproved = item.status === "approved";

  return (
    <div 
      className={cn(
        "rounded-md bg-muted/40 border border-border overflow-hidden transition-all hover:border-primary/50 cursor-pointer shadow-sm hover:shadow-md",
        !isResolved && "border-amber-500/30 bg-amber-500/5 animate-in fade-in zoom-in-95 duration-300"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 p-2">
        <div className="shrink-0 mt-0.5">
          {isResolved ? (
            <UserCheck
              className={`w-4 h-4 ${isApproved ? "text-green-500" : "text-red-500"}`}
            />
          ) : (
            <ShieldCheck className="w-4 h-4 text-amber-500 animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] uppercase",
                isApproved ? "border-green-500/20 text-green-400" :
                item.status === "rejected" ? "border-red-500/20 text-red-400" :
                "border-amber-500/20 text-amber-400"
              )}
            >
              {item.status === "pending" ? "Action Required" : item.status}
            </Badge>
            {!isResolved && (
              <span className="text-[9px] font-black text-amber-500 uppercase flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Interactive
              </span>
            )}
          </div>
          <p className="text-[11px] font-bold text-foreground mb-0.5" onClick={(e) => e.stopPropagation()}>
            {item.agentSlug ? (
              <Link href={`/a/${item.agentSlug}`}>
                <span className="hover:text-primary transition-colors cursor-pointer">{item.formName || item.jobName || "Strategic Intervention"}</span>
              </Link>
            ) : (
              item.formName || item.jobName || "Strategic Intervention"
            )}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {isValid(new Date(item.createdAt)) ? format(new Date(item.createdAt), "MMM d, h:mm a") : "Unknown"}
            {item.decisionAt && isValid(new Date(item.decisionAt)) && (
              <> → {format(new Date(item.decisionAt), "MMM d, h:mm a")}</>
            )}
          </p>
          {item.comments && (
            <div className="mt-2 p-1.5 bg-background/50 rounded border border-border/50 text-[10px] italic text-muted-foreground line-clamp-2">
              "{item.comments}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
