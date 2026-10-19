/**
 * Mission Tracker
 * Displays mission status, horizontal pipeline track, and pause/resume controls.
 * Plan: horizontal track of pipelineSequence pipelines; each step shows status;
 * 'Waiting' steps show pulsing state and reason (e.g. "Waiting for signed_contract.pdf").
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Play, Pause, FileQuestion, UserCheck, Activity, CheckCircle2, Loader2, Clock, AlertCircle, Trash2, FileText, ChevronRight, CircleStop, Users } from "lucide-react";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { formatDistanceToNow, isValid } from "date-fns";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";
import { missionRunPath } from "@/lib/paths";
import { MissionDagView } from './MissionDagView.js';
import { useState } from "react";
import { Link } from "wouter";
import type { MissionRun, Mission } from "@shared/schema/missions";

interface MissionTrackerProps {
  missionId: number;
}

function formatETC(ms: number): string {
  if (ms < 0) return "calculating...";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min > 60) {
    const hr = Math.floor(min / 60);
    return `~${hr}h ${min % 60}m remaining`;
  }
  if (min > 0) return `~${min}m ${sec % 60}s remaining`;
  return `~${sec}s remaining`;
}

/** Dwell time overlay: "Waiting since X" - uses API for server-side delta when available */
function DwellTimeOverlay({
  missionRunId,
  lastCheckpointAt,
}: {
  missionRunId: number;
  lastCheckpointAt: string | Date;
}) {
  const { data: dwell } = useQuery<{ waitingSinceHuman: string | null }>({
    queryKey: [`/api/mission-runs/${missionRunId}/dwell-time`],
    enabled: !!missionRunId,
    refetchInterval: 60_000, // Refresh every minute when waiting
  });
  const date = new Date(lastCheckpointAt);
  const display = dwell?.waitingSinceHuman ?? (isValid(date) ? formatDistanceToNow(date, { addSuffix: false }) : "unknown duration");
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
      <Clock className="w-3 h-3 shrink-0" />
      <span>Waiting since {display}</span>
    </div>
  );
}

const statusLabels: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  waiting_on_file: "Waiting for file",
  waiting_on_human: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
};

const statusFilterOptions = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "waiting_on_human", label: "Waiting for approval" },
  { value: "waiting_on_file", label: "Waiting for file" },
  { value: "paused", label: "Paused" },
] as const;

interface MissionRunCardProps {
  mission: MissionRun;
  allMissions: MissionRun[];
  pipelinesMap: Record<number, { name: string }>;
  showDag: Record<number, boolean>;
  setShowDag: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  selectedMissions: number[];
  toggleSelection: (id: number) => void;
  setDeleteIds: (ids: number[]) => void;
  resumeMutation: any;
  pauseMutation: any;
  terminateMutation: any;
  depth?: number;
}

function MissionRunCard({
  mission,
  allMissions,
  pipelinesMap,
  showDag,
  setShowDag,
  selectedMissions,
  toggleSelection,
  setDeleteIds,
  resumeMutation,
  pauseMutation,
  terminateMutation,
  depth = 0
}: MissionRunCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = allMissions.filter(r => (r as any).parentId === mission.id);
  const seq = (mission.pipelineSequence as number[]) || [];
  const ctx = mission.missionContext as { launchError?: string; plan?: any } | null;
  const launchError = ctx?.launchError;
  const rc = mission.resumeCondition as { type?: string; filePattern?: string; folderPath?: string } | null;
  const waitingReason =
    mission.status === "waiting_on_file" && rc?.filePattern
      ? `Waiting for ${rc.filePattern}`
      : mission.status === "waiting_on_human"
        ? "Waiting for approval"
        : null;

  return (
    <div className={cn(
      "flex flex-col gap-2.5 p-4 rounded-lg bg-muted/40 border border-border hover:border-primary/20 transition-colors",
      depth > 0 && "border-l-primary/20"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Checkbox
            checked={selectedMissions.includes(mission.id)}
            onCheckedChange={() => toggleSelection(mission.id)}
            className="border-border/80 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
          />
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate" title={mission.name}>{mission.name}</span>
              {mission.status === "active" && (
                <div className="flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">RUN-{mission.id}</span>
              {depth > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[8px] bg-muted border-border/30 text-muted-foreground/80">
                  Sub-Agent
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] uppercase shrink-0",
            mission.status === "active" && "border-green-500/30 text-green-400",
            mission.status === "waiting_on_file" && "border-amber-500/30 text-amber-400 animate-pulse",
            mission.status === "waiting_on_human" && "border-blue-500/30 text-blue-400 animate-pulse",
            mission.status === "paused" && "border-border/80 text-muted-foreground",
            mission.status === "completed" && "border-border/50 text-muted-foreground",
            mission.status === "failed" && "border-red-500/30 text-red-400"
          )}
        >
          {statusLabels[mission.status] ?? mission.status}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 pl-7">
        <Link href={mission.missionId == null ? `/operations/runs/${mission.id}` : missionRunPath(mission.missionId, mission.id)} className="inline-flex items-center gap-1 h-6 px-2 text-[10px] text-blue-400 border border-blue-400/20 bg-blue-400/10 hover:bg-blue-400/20 transition-colors rounded-md" title="View Detailed Run Report">
          <FileText className="w-3 h-3" />
          Report
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
          onClick={() => setDeleteIds([mission.id])}
          title="Delete Mission"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
        {mission.status === 'active' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-primary border border-primary/20 bg-primary/5"
            onClick={() => setShowDag(prev => ({ ...prev, [mission.id]: !prev[mission.id] }))}
          >
            <Activity className="w-3 h-3 mr-1" />
            {showDag[mission.id] ? "Linear" : "Graph"}
          </Button>
        )}
        {mission.status === "active" && (mission as any).estimatedTimeRemainingMs !== undefined && (mission as any).estimatedTimeRemainingMs !== null && (
          <div className="flex items-center gap-1 text-[10px] text-primary font-mono bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded ml-auto">
            <Clock className="w-3 h-3" />
            {formatETC((mission as any).estimatedTimeRemainingMs)}
          </div>
        )}
      </div>

      {children.length > 0 && (
        <div className="mt-1 space-y-1.5 pl-7 pr-2 pb-1">
          <div className="flex justify-between items-center text-[9px] text-muted-foreground uppercase font-black tracking-widest opacity-70">
            <span className="flex items-center gap-1.5 text-primary/80">
              <Users className="w-2.5 h-2.5" />
              Sub-Agent Hierarchy
            </span>
            <span>{children.filter(c => c.status === "completed").length}/{children.length} Resolved</span>
          </div>
          <div className="h-1 w-full bg-muted/50 rounded-full overflow-hidden border border-border/20">
            <div 
              className={cn("progress-fill shadow-[0_0_10px_rgba(205,127,50,0.4)]", `[--progress-width:${(children.filter(c => c.status === "completed").length / children.length) * 100}%]`)} 
            />
          </div>
        </div>
      )}

      {showDag[mission.id] && (mission.missionContext as any)?.plan ? (
        <MissionDagView plan={(mission.missionContext as any).plan} />
      ) : (
        <>
          {launchError && (
            <div className="flex items-start gap-2 text-xs text-amber-400/90 bg-amber-500/10 rounded px-2 py-1.5 border border-amber-500/20" title={launchError}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{launchError}</span>
            </div>
          )}

          {/* Dynamic Mission Trace Visualization */}
          {Array.isArray((mission as any).dynamicTrace) && (mission as any).dynamicTrace.length > 0 ? (
            <div className="flex flex-col gap-2 p-2 bg-purple-500/5 border border-purple-500/10 rounded-md">
              <h4 className="text-xs font-semibold text-purple-400 font-mono tracking-widest uppercase mb-1">Dynamic Autonomous Trace</h4>
              <div className="space-y-1 mt-1">
                {((mission as any).dynamicTrace).map((trace: any, idx: number) => (
                  <div key={idx} className="flex gap-2 text-[10px] items-start">
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full mt-1 shrink-0",
                      trace.type === 'error' ? 'bg-red-500' : 
                      trace.event === 'ai_thinking' ? 'bg-amber-500' : 'bg-purple-500'
                    )} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-foreground">
                        <span className="text-muted-foreground mr-2">[{new Date(trace.timestamp).toLocaleTimeString()}]</span>
                        {trace.event}
                      </span>
                      {trace.event === 'ai_thinking' ? (
                        <div className="flex flex-col gap-1 mt-1 p-2 bg-amber-500/5 border border-amber-500/20 rounded text-amber-700 dark:text-amber-200/80 italic">
                          <span className="font-mono text-[9px] uppercase tracking-tighter opacity-50">Internal Monologue</span>
                          <span className="whitespace-pre-wrap">{typeof trace.note === 'object' ? JSON.stringify(trace.note) : trace.note}</span>
                        </div>
                      ) : (
                        trace.note && <span className="text-muted-foreground mt-0.5">{typeof trace.note === 'object' ? JSON.stringify(trace.note) : trace.note}</span>
                      )}
                      {trace.error && <span className="text-red-400 mt-0.5">{typeof trace.error === 'object' ? JSON.stringify(trace.error) : trace.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : seq.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {seq.map((pipeId: number, idx: number) => {
                const label = pipelinesMap[pipeId]?.name ?? `Pipeline ${pipeId}`;
                const isCurrent = mission.currentPipelineId === pipeId;
                const currentIdx = mission.currentPipelineId ? seq.indexOf(mission.currentPipelineId) : -1;
                const isCompleted =
                  mission.status === "completed" || (currentIdx >= 0 && idx < currentIdx);
                const isWaiting =
                  isCurrent &&
                  (mission.status === "waiting_on_file" || mission.status === "waiting_on_human");

                return (
                  <div key={pipeId} className="flex items-center gap-1">
                    <Link
                      href={`/operations/workstreams/${pipeId}`}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80",
                        isCompleted && "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20",
                        isWaiting && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse",
                        isCurrent && !isWaiting && "bg-primary/10 text-primary border border-primary/20",
                        !isCurrent && !isCompleted && "bg-muted text-muted-foreground border border-border/50"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                      ) : isWaiting ? (
                        <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                      ) : null}
                      <span className="truncate max-w-[120px]">{label}</span>
                    </Link>
                    {idx < seq.length - 1 && (
                      <span className="text-muted-foreground/50">→</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(mission.status === "waiting_on_file" || mission.status === "waiting_on_human") && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {mission.status === "waiting_on_file" ? (
                  <FileQuestion className="w-3 h-3 shrink-0" />
                ) : (
                  <UserCheck className="w-3 h-3 shrink-0" />
                )}
                <span>
                  {waitingReason ??
                    (mission.status === "waiting_on_file"
                      ? `Awaiting file in ${rc?.folderPath ?? "folder"}`
                      : "Pending human approval")}
                </span>
              </div>
              {mission.lastCheckpointAt && (
                <DwellTimeOverlay missionRunId={mission.id} lastCheckpointAt={mission.lastCheckpointAt} />
              )}
            </>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-1">
        {(mission.status === "waiting_on_file" ||
          mission.status === "waiting_on_human" ||
          mission.status === "paused") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-[10px] border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => resumeMutation.mutate(mission.id)}
              disabled={resumeMutation.isPending}
            >
              <Play className="w-3 h-3 mr-1" />
              Resume
            </Button>
          )}

        {mission.status === "active" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-[10px] border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => pauseMutation.mutate(mission.id)}
            disabled={pauseMutation.isPending}
          >
            <Pause className="w-3 h-3 mr-1" />
            Pause
          </Button>
        )}

        {(mission.status === "active" ||
          mission.status === "waiting_on_file" ||
          mission.status === "waiting_on_human" ||
          mission.status === "paused") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => terminateMutation.mutate(mission.id)}
              disabled={terminateMutation.isPending}
            >
              <CircleStop className="w-3 h-3 mr-1" />
              Stop
            </Button>
          )}
      </div>

      {children.length > 0 && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <span className="flex items-center gap-1">Collapse Sub-Agents <ChevronRight className="w-3 h-3 rotate-90" /></span>
            ) : (
              <span className="flex items-center gap-1">Expand Sub-Agents ({children.length}) <ChevronRight className="w-3 h-3" /></span>
            )}
          </Button>
          {isExpanded && (
            <div className="ml-4 mt-3 border-l-2 border-dashed border-border/20 pl-4 space-y-4">
              {children.map(child => (
                <MissionRunCard
                  key={child.id}
                  mission={child}
                  allMissions={allMissions}
                  pipelinesMap={pipelinesMap}
                  showDag={showDag}
                  setShowDag={setShowDag}
                  selectedMissions={selectedMissions}
                  toggleSelection={toggleSelection}
                  setDeleteIds={setDeleteIds}
                  resumeMutation={resumeMutation}
                  pauseMutation={pauseMutation}
                  terminateMutation={terminateMutation}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MissionTracker({ missionId }: MissionTrackerProps) {
  const { toast } = useToast();
  const [showDag, setShowDag] = useState<Record<number, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedMissions, setSelectedMissions] = useState<number[]>([]);
  const [deleteIds, setDeleteIds] = useState<number[] | null>(null);

  const invalidateMissionRunQueries = () => {
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("/api/mission-runs"),
    });
  };

  const toggleSelection = (id: number) => {
    setSelectedMissions(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedMissions.length === missions.length) {
      setSelectedMissions([]);
    } else {
      setSelectedMissions(missions.map((m: MissionRun) => m.id));
    }
  };

  const missionsQuery = useQuery<MissionRun[]>({
    queryKey: [
      statusFilter === "all"
        ? `/api/mission-runs?missionId=${missionId}`
        : `/api/mission-runs?missionId=${missionId}&status=${encodeURIComponent(statusFilter)}`,
    ],
    enabled: !!missionId,
    refetchInterval: missionId ? 5000 : false, // Poll to pick up launch errors
  });
  const missions = Array.isArray(missionsQuery.data) ? missionsQuery.data : [];
  const isLoading = missionsQuery.isLoading;

  const { data: pipelinesList = [] } = useQuery<any[]>({
    queryKey: ["/api/pipelines"],
    enabled: !!missionId,
  });
  const pipelinesMap: Record<number, { name: string }> = {};
  for (const p of Array.isArray(pipelinesList) ? pipelinesList : []) {
    if (p?.id != null) pipelinesMap[p.id] = { name: p.name ?? `Pipeline ${p.id}` };
  }

  const resumeMutation = useMutation({
    mutationFn: async (runId: number) => {
      await apiRequest("POST", `/api/mission-runs/${runId}/resume`, {});
    },
    onSuccess: () => {
      invalidateMissionRunQueries();
      toast({ title: "Mission resumed", description: "Pipeline will continue." });
    },
    onError: (err: any) => {
      toast({ title: "Resume failed", description: err.message, variant: "destructive" });
    },
  });

  const terminateMutation = useMutation({
    mutationFn: async (runId: number) => {
      await apiRequest("POST", `/api/mission-runs/${runId}/terminate`, {});
    },
    onSuccess: () => {
      invalidateMissionRunQueries();
      toast({ title: "Mission terminated", description: "Run has been stopped." });
    },
    onError: (err: any) => {
      toast({ title: "Stop failed", description: err.message, variant: "destructive" });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (runId: number) => {
      await apiRequest("POST", `/api/mission-runs/${runId}/pause`, {});
    },
    onSuccess: () => {
      invalidateMissionRunQueries();
      toast({ title: "Mission paused", description: "Pipeline execution paused." });
    },
    onError: (err: any) => {
      toast({ title: "Pause failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await apiRequest("POST", "/api/mission-runs/bulk-delete", { ids });
    },
    onSuccess: (data: any) => {
      invalidateMissionRunQueries();
      setSelectedMissions([]);
      toast({ title: "Missions deleted", description: `Deleted ${data?.deletedCount ?? 'selected'} missions.` });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg font-bold tracking-tight">Mission Tracker</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-14 rounded-md" />
              <Skeleton className="h-6 w-14 rounded-md" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  if (missions.length === 0) {
    return (
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg font-bold tracking-tight">Mission Tracker</CardTitle>
          </div>
          <CardDescription>No active runs for this mission.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg font-bold tracking-tight">Mission Tracker</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {selectedMissions.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                onClick={() => setDeleteIds(selectedMissions)}
                disabled={bulkDeleteMutation.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Delete ({selectedMissions.length})
              </Button>
            )}
            <select
              aria-label="Filter missions by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-border/50 bg-foreground/5 px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
            >
              {statusFilterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={missions.length > 0 && selectedMissions.length === missions.length}
              onCheckedChange={toggleSelectAll}
              className="border-border/80 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <label htmlFor="select-all" className="cursor-pointer select-none">Select All</label>
          </div>
          <span>{missions.length} Missions</span>
        </div>
        <CardDescription className="px-6 py-2">Pipeline status and controls.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px] px-6 py-4">
          <div className="space-y-4">
            {missions
              .filter(m => !(m as any).parentId || !missions.some(p => p.id === (m as any).parentId))
              .map((mission) => (
                <MissionRunCard
                  key={mission.id}
                  mission={mission}
                  allMissions={missions}
                  pipelinesMap={pipelinesMap}
                  showDag={showDag}
                  setShowDag={setShowDag}
                  selectedMissions={selectedMissions}
                  toggleSelection={toggleSelection}
                  setDeleteIds={setDeleteIds}
                  resumeMutation={resumeMutation}
                  pauseMutation={pauseMutation}
                  terminateMutation={terminateMutation}
                  depth={0}
                />
              ))}
          </div>
        </ScrollArea>
      </CardContent>

      <AlertDialog open={deleteIds !== null} onOpenChange={(open) => !open && setDeleteIds(null)}>
        <AlertDialogContent className="bg-background border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Missions?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently delete {deleteIds?.length === 1 ? 'this mission' : `${deleteIds?.length ?? 0} missions`} and all associated execution history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted border-border/50 hover:bg-muted/80">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-foreground border-transparent"
              onClick={() => {
                if (deleteIds) {
                  bulkDeleteMutation.mutate(deleteIds);
                  setDeleteIds(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

