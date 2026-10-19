import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  Zap,
  DollarSign,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  Swords,
  ChevronDown,
  ChevronUp,
  Network,
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AgoraCanvas } from "@domain-ui/agora/ui/AgoraCanvas";

interface AgoraDeliberationBriefingProps {
  approvalId: number;
  onResolved?: () => void;
}

export function AgoraDeliberationBriefing({
  approvalId,
  onResolved,
}: AgoraDeliberationBriefingProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showCanvas, setShowCanvas] = useState<boolean>(false);
  const [directives, setDirectives] = useState<string>("");

  const { data: approval, isLoading, isError } = useQuery<{
    id: number;
    status: string;
    pipelineName?: string;
    stepName?: string;
  }>({
    queryKey: [`/api/approvals/${approvalId}`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/approvals/${approvalId}`);
      return response.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/approvals/${approvalId}/decision`, {
        decision: "approved",
        comments: directives || "Approved via Agora Deliberation Room",
      });
    },
    onSuccess: () => {
      toast({
        title: "Execution Authorized",
        description: `Approval #${approvalId} has been recorded.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: [`/api/approvals/${approvalId}`] });
      onResolved?.();
    },
    onError: (err: any) => {
      toast({
        title: "Authorization Failed",
        description: err.message || "Failed to submit approval",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/approvals/${approvalId}/decision`, {
        decision: "rejected",
        comments: directives || "Rejected with directives via Agora Deliberation Room",
      });
    },
    onSuccess: () => {
      toast({
        title: "Proposal Rejected",
        description: `Approval #${approvalId} rejected. Directives sent to lead agent.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: [`/api/approvals/${approvalId}`] });
      onResolved?.();
    },
    onError: (err: any) => {
      toast({
        title: "Rejection Failed",
        description: err.message || "Failed to reject proposal",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 bg-muted/20 border-b border-border/50 text-xs text-muted-foreground animate-pulse flex items-center gap-2">
        <Swords className="h-4 w-4 text-indigo-400" />
        Loading Agora Deliberation Briefing...
      </div>
    );
  }

  if (isError || !approval) {
    return <div role="alert" className="p-4 text-sm text-destructive">Unable to load this approval. It may be unavailable or you may not have access.</div>;
  }

  const isResolved = approval.status !== "pending";
  const pipelineName = approval?.pipelineName || "Mission Execution";
  const stepName = approval?.stepName || "High-Impact Step";

  return (
    <Card className="rounded-none border-x-0 border-t-0 border-b border-indigo-500/30 bg-card/95 backdrop-blur-md shadow-md">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <Swords className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-[9px] uppercase px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                Agora Deliberation #{approvalId}
              </Badge>
              <Badge
                variant={isResolved ? "secondary" : "default"}
                className={cn(
                  "text-[10px] font-bold uppercase",
                  !isResolved && "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse"
                )}
              >
                {isResolved ? `Resolved (${approval?.status})` : "Pending Human Quorum"}
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold tracking-tight text-foreground truncate mt-0.5">
              Topic: {pipelineName} — {stepName}
            </CardTitle>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-7 text-xs gap-1 border-indigo-500/30",
              showCanvas ? "bg-indigo-500/20 text-indigo-300" : "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
            )}
            onClick={() => setShowCanvas(!showCanvas)}
          >
            <Network className="h-3.5 w-3.5" />
            {showCanvas ? "Hide Live Graph" : "Collaborative Graph"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {isExpanded ? "Collapse Briefing" : "Expand Briefing"}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 pt-2 space-y-4 text-xs">
          {/* Live Collaborative Visual Graph Canvas */}
          {showCanvas && (
            <div className="h-64 w-full rounded-xl border border-indigo-500/30 overflow-hidden relative shadow-inner bg-black/40">
              <AgoraCanvas roomId={`deliberation-${approvalId}`} approvalId={approvalId} />
            </div>
          )}

          {/* Background & Summary */}
          <div className="p-3.5 rounded-xl bg-foreground/[0.02] border border-border/60 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-foreground">
              <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
              <span>Background & What Happened</span>
            </div>
            <p className="text-muted-foreground leading-relaxed text-[11px]">
              The autonomous agent paused at <strong className="text-foreground">{stepName}</strong> because this operation
              touches sensitive workspace entities or exceeds automated confidence thresholds. Opposing personas have formulated
              distinct stances below to help you decide.
            </p>
          </div>

          {/* Opposing Personas Perspectives */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Guardian */}
            <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-red-400 flex items-center gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" /> Guardian (Security)
                </span>
                <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">
                  Risk & Safety
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Advocates verifying rollbacks and safeguarding active records against potential locking or schema drift.
              </p>
            </div>

            {/* Optimizer */}
            <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-400 flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> Optimizer (Lead Agent)
                </span>
                <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                  Performance
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Highlights throughput improvements, verified canary tests, and eliminating downstream pipeline bottlenecks.
              </p>
            </div>

            {/* FinOps */}
            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" /> FinOps (Efficiency)
                </span>
                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  Token Budget
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Recommends taking lightweight hedge snapshots given negligible token cost ($0.003) vs. outage downtime.
              </p>
            </div>
          </div>

          {/* Interactive Resolution Action Bar */}
          {!isResolved && (
            <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="Optional directives or modifications for the lead agent..."
                  value={directives}
                  onChange={(e) => setDirectives(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/60 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-foreground"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending || approveMutation.isPending}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject with Directives
                </Button>

                <Button
                  size="sm"
                  className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                  onClick={() => approveMutation.mutate()}
                  disabled={rejectMutation.isPending || approveMutation.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Authorize Execution
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
