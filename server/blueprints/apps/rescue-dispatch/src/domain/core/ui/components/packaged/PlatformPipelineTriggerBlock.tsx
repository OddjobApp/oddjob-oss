import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, CheckCircle2, XCircle, Loader2, ChevronDown, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Progress } from '../ui/progress.js';

interface Pipeline {
  id: number;
  name: string;
  description?: string;
  stepCount?: number;
}

interface StepOutput {
  stepIndex: number;
  name?: string;
  status: "completed" | "failed" | "running" | "pending" | string;
  output?: any;
}

interface Execution {
  execId: number;
  status: "running" | "completed" | "failed" | string;
  steps: StepOutput[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const EXEC_STATUS_ICON: Record<string, React.ReactNode> = {
  running:   <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed:    <XCircle className="h-4 w-4 text-rose-400" />,
};

const STEP_CLASSES: Record<string, string> = {
  completed: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  failed:    "bg-rose-500/15 border-rose-500/30 text-rose-400",
  running:   "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
  pending:   "bg-white/5 border-white/10 text-white/30",
};

interface PlatformPipelineTriggerBlockProps {
  /** If provided, only these pipeline IDs are shown in the picker */
  allowedPipelineIds?: number[];
  title?: string;
  showExecutionHistory?: boolean;
  onComplete?: (execId: number) => void;
}

export default function PlatformPipelineTriggerBlock({
  allowedPipelineIds,
  title = "Pipeline Trigger",
  showExecutionHistory = true,
  onComplete,
}: PlatformPipelineTriggerBlockProps) {
  const [pipelines, setPipelines]       = useState<Pipeline[]>([]);
  const [selectedId, setSelectedId]     = useState<string>("");
  const [loading, setLoading]           = useState(true);
  const [triggering, setTriggering]     = useState(false);
  const [execution, setExecution]       = useState<Execution | null>(null);
  const [polling, setPolling]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/oddjob/pipelines");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let all: Pipeline[] = (data.pipelines ?? data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        stepCount: p.steps?.length ?? p.stepCount,
      }));
      if (allowedPipelineIds?.length) {
        all = all.filter(p => allowedPipelineIds.includes(p.id));
      }
      setPipelines(all);
      if (all.length === 1) setSelectedId(String(all[0].id));
    } catch (e: any) {
      setError(e.message || "Failed to load pipelines.");
    } finally {
      setLoading(false);
    }
  }, [allowedPipelineIds]);

  useEffect(() => { fetchPipelines(); }, [fetchPipelines]);

  // Poll execution status while running
  useEffect(() => {
    if (!execution || execution.status !== "running") return;
    setPolling(true);
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/oddjob/pipelines/executions/${execution.execId}`);
        if (!res.ok) return;
        const data = await res.json();
        const updated: Execution = {
          execId: data.execId ?? data.runId ?? execution.execId,
          status: data.status,
          steps: (data.stepOutputs ?? data.steps ?? []).map((s: any, i: number) => ({
            stepIndex: i,
            name: s.name ?? s.stepName,
            status: s.status,
            output: s.output,
          })),
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          error: data.error,
        };
        setExecution(updated);
        if (data.status !== "running") {
          setPolling(false);
          clearInterval(id);
          if (data.status === "completed") onComplete?.(updated.execId);
        }
      } catch { /* non-fatal */ }
    }, 2500);
    return () => { clearInterval(id); setPolling(false); };
  }, [execution?.execId, execution?.status]);

  const handleTrigger = async () => {
    if (!selectedId) return;
    setTriggering(true);
    setError(null);
    setExecution(null);
    try {
      const res = await fetch(`/api/oddjob/pipelines/${selectedId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId: Number(selectedId) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExecution({
        execId: data.runId ?? data.execId ?? data.id,
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      setError(e.message || "Trigger failed.");
    } finally {
      setTriggering(false);
    }
  };

  const selectedPipeline = pipelines.find(p => String(p.id) === selectedId);
  const completedSteps = execution?.steps.filter(s => s.status === "completed").length ?? 0;
  const totalSteps = execution?.steps.length || selectedPipeline?.stepCount || 0;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-xl font-bold text-white">{title}</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Pipeline picker */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-white/40">Select Pipeline</label>
          {loading ? (
            <Skeleton className="h-10 bg-white/5 rounded-lg" />
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white">
                <SelectValue placeholder="Choose a pipeline…" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10 text-white">
                {pipelines.map(p => (
                  <SelectItem key={p.id} value={String(p.id)} className="focus:bg-white/10">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      {p.stepCount && <span className="ml-2 text-white/30 text-xs">{p.stepCount} steps</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedPipeline?.description && (
            <p className="text-white/40 text-xs">{selectedPipeline.description}</p>
          )}
        </div>

        {/* Trigger button */}
        <Button
          onClick={handleTrigger}
          disabled={!selectedId || triggering || execution?.status === "running"}
          className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold gap-2 h-11"
        >
          {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {triggering ? "Triggering…" : execution?.status === "running" ? "Running…" : "Trigger Pipeline"}
        </Button>

        {/* Execution status */}
        <AnimatePresence>
          {execution && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 overflow-hidden"
            >
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {EXEC_STATUS_ICON[execution.status] ?? <Loader2 className="h-4 w-4 animate-spin" />}
                    <span className="text-sm font-bold text-white capitalize">{execution.status}</span>
                    <span className="text-white/30 text-xs font-mono">#{execution.execId}</span>
                  </div>
                  {execution.status === "running" && totalSteps > 0 && (
                    <span className="text-white/40 text-xs">{completedSteps}/{totalSteps} steps</span>
                  )}
                </div>

                {execution.status === "running" && totalSteps > 0 && (
                  <Progress value={progress} className="h-1.5 bg-white/10" />
                )}

                {/* Step list */}
                {showExecutionHistory && execution.steps.length > 0 && (
                  <div className="space-y-1.5">
                    {execution.steps.map((step, i) => (
                      <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${STEP_CLASSES[step.status] ?? STEP_CLASSES.pending}`}>
                        <span className="text-white/30">{String(i + 1).padStart(2, "0")}</span>
                        <span className="flex-1">{step.name ?? `Step ${i + 1}`}</span>
                        <Badge variant="outline" className={`text-[10px] ${STEP_CLASSES[step.status] ?? STEP_CLASSES.pending}`}>
                          {step.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                {execution.error && (
                  <p className="text-rose-400 text-xs font-mono bg-rose-500/10 p-2 rounded">{execution.error}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
