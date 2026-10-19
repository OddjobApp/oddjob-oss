import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, CheckCircle, XCircle, Clock, Loader2, ChevronRight, GitBranch, RotateCcw, AlertCircle, MoreHorizontal, PauseCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Progress } from '../ui/progress.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js';

interface Pipeline {
  id: number;
  name: string;
  description?: string;
}

interface PipelineExecution {
  id: number;
  pipelineId: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";
  currentStepIndex: number;
  totalSteps: number;
  startedAt?: string;
  completedAt?: string;
  steps: PipelineStep[];
  output?: Record<string, any>;
  error?: string;
}

interface PipelineStep {
  id: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: any;
  error?: string;
}

interface PlatformPipelineStatusBlockProps {
  pipelineId?: number;
  title?: string;
  showExecutions?: boolean;
  maxExecutions?: number;
  pollingIntervalMs?: number;
  onExecutionComplete?: (execution: PipelineExecution) => void;
}

export default function PlatformPipelineStatusBlock({
  pipelineId,
  title = "Pipeline Status",
  showExecutions = true,
  maxExecutions = 5,
  pollingIntervalMs = 3000,
  onExecutionComplete,
}: PlatformPipelineStatusBlockProps) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [executions, setExecutions] = useState<PipelineExecution[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(pipelineId || null);
  const [activeExecution, setActiveExecution] = useState<PipelineExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState<PipelineExecution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/pipelines");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipelines(data.pipelines ?? data ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load pipelines");
    }
  }, []);

  const fetchExecutions = useCallback(async () => {
    try {
      const url = selectedPipelineId 
        ? `/api/pipelines/${selectedPipelineId}/executions?limit=${maxExecutions}`
        : `/api/pipeline-executions?limit=${maxExecutions}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const execs = data.executions ?? data ?? [];
      setExecutions(execs);

      // Check for active execution
      const running = execs.find((e: PipelineExecution) => 
        e.status === "running" || e.status === "pending"
      );
      if (running) {
        setActiveExecution(running);
      } else if (activeExecution?.status === "running") {
        const completed = execs.find((e: PipelineExecution) => e.id === activeExecution.id);
        if (completed) {
          setActiveExecution(completed);
          onExecutionComplete?.(completed);
        }
      }
    } catch (e: any) {
      console.error("Failed to fetch executions:", e);
    }
  }, [selectedPipelineId, maxExecutions, activeExecution, onExecutionComplete]);

  useEffect(() => {
    setLoading(true);
    fetchPipelines().then(() => setLoading(false));
    fetchExecutions();
  }, [fetchPipelines, fetchExecutions]);

  useEffect(() => {
    if (!activeExecution || (activeExecution.status !== "running" && activeExecution.status !== "pending")) {
      return;
    }

    const interval = setInterval(fetchExecutions, pollingIntervalMs);
    return () => clearInterval(interval);
  }, [activeExecution, pollingIntervalMs, fetchExecutions]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running": return "bg-indigo-500 text-white";
      case "completed": return "bg-emerald-500 text-white";
      case "failed": return "bg-rose-500 text-white";
      case "cancelled": return "bg-amber-500 text-black";
      case "paused": return "bg-yellow-500 text-black";
      default: return "bg-white/20 text-white/70";
    }
  };

  const getStepStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "failed": return <XCircle className="h-4 w-4 text-rose-400" />;
      case "running": return <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />;
      case "skipped": return <MoreHorizontal className="h-4 w-4 text-white/30" />;
      default: return <Clock className="h-4 w-4 text-white/30" />;
    }
  };

  const calculateProgress = (execution: PipelineExecution): number => {
    if (execution.totalSteps === 0) return 0;
    const completedSteps = execution.steps.filter(s => 
      s.status === "completed" || s.status === "failed" || s.status === "skipped"
    ).length;
    return Math.round((completedSteps / execution.totalSteps) * 100);
  };

  const formatDuration = (start?: string, end?: string) => {
    if (!start) return "—";
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const seconds = Math.floor((endTime - startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);

  if (loading) {
    return (
      <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-white/5" />
          <Skeleton className="h-12 w-full bg-white/5" />
          <Skeleton className="h-32 w-full bg-white/5" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitBranch className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-xl font-bold text-white">{title}</CardTitle>
          </div>
          {!pipelineId && pipelines.length > 0 && (
            <select
              value={selectedPipelineId || ""}
              onChange={e => setSelectedPipelineId(e.target.value ? parseInt(e.target.value) : null)}
              className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
            >
              <option value="">All Pipelines</option>
              {pipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
        {currentPipeline?.description && (
          <p className="text-sm text-white/50 mt-1">{currentPipeline.description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {/* Active Execution */}
        {activeExecution && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge className={getStatusColor(activeExecution.status)}>
                  {activeExecution.status.toUpperCase()}
                </Badge>
                <span className="text-sm text-white/70">Execution #{activeExecution.id}</span>
              </div>
              <span className="text-xs text-white/40">
                {formatDuration(activeExecution.startedAt)}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-white/50">
                <span>Progress</span>
                <span>{calculateProgress(activeExecution)}%</span>
              </div>
              <Progress 
                value={calculateProgress(activeExecution)} 
                className="h-2 bg-white/10"
              />
            </div>

            <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
              {activeExecution.steps.map((step, idx) => (
                <TooltipProvider key={step.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap ${
                        step.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                        step.status === "failed" ? "bg-rose-500/20 text-rose-300" :
                        step.status === "running" ? "bg-indigo-500/20 text-indigo-300 animate-pulse" :
                        "bg-white/10 text-white/40"
                      }`}>
                        {getStepStatusIcon(step.status)}
                        <span className="truncate max-w-[100px]">{step.name}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-zinc-900 border-white/10">
                      <p>{step.name} — {step.status}</p>
                      {step.error && <p className="text-rose-400 text-xs mt-1">{step.error}</p>}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </motion.div>
        )}

        {/* Execution History */}
        {showExecutions && executions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Recent Executions</p>
            <div className="space-y-1">
              <AnimatePresence>
                {executions.map((execution, index) => (
                  <motion.div
                    key={execution.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedExecution(execution)}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <Badge className={`text-xs ${getStatusColor(execution.status)}`}>
                        {execution.status}
                      </Badge>
                      <div>
                        <p className="text-sm text-white">Execution #{execution.id}</p>
                        <p className="text-xs text-white/40">
                          {execution.steps.filter(s => s.status === "completed").length} / {execution.totalSteps} steps
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-white/40">
                          {formatDuration(execution.startedAt, execution.completedAt)}
                        </p>
                        <p className="text-xs text-white/30">
                          {execution.startedAt ? new Date(execution.startedAt).toLocaleDateString() : "—"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {executions.length === 0 && !activeExecution && (
          <div className="text-center py-8 text-white/30">
            <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No executions yet</p>
            <p className="text-sm mt-1">Run a pipeline to see it here</p>
          </div>
        )}
      </CardContent>

      {/* Execution Detail Dialog */}
      <Dialog open={!!selectedExecution} onOpenChange={() => setSelectedExecution(null)}>
        <DialogContent className="bg-zinc-900 border-white/10 text-white max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Badge className={getStatusColor(selectedExecution?.status || "")}>
                {selectedExecution?.status.toUpperCase()}
              </Badge>
              <DialogTitle>Execution #{selectedExecution?.id}</DialogTitle>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-black/40 rounded p-3">
                  <p className="text-white/40 text-xs uppercase">Duration</p>
                  <p className="text-white font-medium">
                    {formatDuration(selectedExecution?.startedAt, selectedExecution?.completedAt)}
                  </p>
                </div>
                <div className="bg-black/40 rounded p-3">
                  <p className="text-white/40 text-xs uppercase">Progress</p>
                  <p className="text-white font-medium">
                    {selectedExecution ? calculateProgress(selectedExecution) : 0}%
                  </p>
                </div>
                <div className="bg-black/40 rounded p-3">
                  <p className="text-white/40 text-xs uppercase">Steps</p>
                  <p className="text-white font-medium">
                    {selectedExecution?.steps.filter(s => s.status === "completed").length} / {selectedExecution?.totalSteps}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Steps</p>
                <div className="space-y-1">
                  {selectedExecution?.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        step.status === "completed" ? "bg-emerald-500/10 border border-emerald-500/20" :
                        step.status === "failed" ? "bg-rose-500/10 border border-rose-500/20" :
                        step.status === "running" ? "bg-indigo-500/10 border border-indigo-500/20" :
                        "bg-white/5 border border-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-white/30 text-sm w-6">{idx + 1}</span>
                        {getStepStatusIcon(step.status)}
                        <span className="text-white font-medium">{step.name}</span>
                      </div>
                      <div className="text-right">
                        {step.startedAt && (
                          <p className="text-xs text-white/40">
                            {formatDuration(step.startedAt, step.completedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedExecution?.error && (
                <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <p className="text-rose-400 text-sm font-medium mb-1">Execution Error</p>
                  <p className="text-rose-300/70 text-sm">{selectedExecution.error}</p>
                </div>
              )}

              {selectedExecution?.output && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40 uppercase tracking-wider">Output</p>
                  <pre className="bg-black/60 rounded p-3 text-xs text-emerald-400 font-mono overflow-x-auto">
                    {JSON.stringify(selectedExecution.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              className="flex-1 border-white/10 text-white hover:bg-white/5"
              onClick={() => {
                if (selectedExecution) {
                  setSelectedPipelineId(selectedExecution.pipelineId);
                  setSelectedExecution(null);
                }
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Run Again
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-white/10 text-white hover:bg-white/5"
              onClick={() => window.open(`/pipelines/${selectedExecution?.pipelineId}/executions/${selectedExecution?.id}`, "_blank")}
            >
              <GitBranch className="h-4 w-4 mr-2" /> View Full Details
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
