import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Clock, RotateCcw, AlertCircle, CheckCircle, Loader2, ChevronRight, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';

interface Job {
  id: number;
  name: string;
  type: string;
  description?: string;
}

interface JobRun {
  id: number;
  jobId: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  progress?: number;
}

interface PlatformJobRunnerBlockProps {
  title?: string;
  allowedJobIds?: number[];
  showHistory?: boolean;
  pollingIntervalMs?: number;
  onRunComplete?: (run: JobRun) => void;
}

export default function PlatformJobRunnerBlock({
  title = "Job Runner",
  allowedJobIds,
  showHistory = true,
  pollingIntervalMs = 3000,
  onRunComplete,
}: PlatformJobRunnerBlockProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<JobRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<JobRun | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const url = allowedJobIds 
        ? `/api/jobs?ids=${allowedJobIds.join(",")}` 
        : "/api/jobs";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // /api/jobs returns { items: [...] }; older shapes use { jobs } or a bare
      // array. Normalize to an array so jobs.map can't throw ".map is not a function".
      setJobs(Array.isArray(data) ? data : (data.jobs ?? data.items ?? []));
    } catch (e: any) {
      setError(e.message || "Failed to load jobs");
    }
  }, [allowedJobIds]);

  const fetchRuns = useCallback(async () => {
    if (!showHistory) return;
    try {
      const res = await fetch("/api/job-runs?limit=10");
      if (res.ok) {
        const data = await res.json();
        const runsList = Array.isArray(data) ? data : (data.runs ?? data.items ?? []);
        setRuns(runsList);
        
        // Check for active run
        const running = runsList.find((r: JobRun) => r.status === "running" || r.status === "pending");
        if (running) {
          setActiveRun(running);
        } else if (activeRun?.status === "running") {
          // Run completed
          const completed = runsList.find((r: JobRun) => r.id === activeRun.id);
          if (completed) {
            setActiveRun(completed);
            onRunComplete?.(completed);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch runs:", e);
    }
  }, [showHistory, activeRun, onRunComplete]);

  useEffect(() => {
    setLoading(true);
    fetchJobs().then(() => setLoading(false));
    fetchRuns();
  }, [fetchJobs, fetchRuns]);

  useEffect(() => {
    if (!activeRun || (activeRun.status !== "running" && activeRun.status !== "pending")) {
      return;
    }

    const interval = setInterval(fetchRuns, pollingIntervalMs);
    return () => clearInterval(interval);
  }, [activeRun, pollingIntervalMs, fetchRuns]);

  const startJob = async () => {
    if (!selectedJobId) return;

    setStarting(true);
    setError(null);

    try {
      const res = await fetch(`/api/jobs/${selectedJobId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const run: JobRun = await res.json();
      setActiveRun(run);
      setRuns(prev => [run, ...prev]);
    } catch (e: any) {
      setError(e.message || "Failed to start job");
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async (runId: number) => {
    try {
      await fetch(`/api/job-runs/${runId}/cancel`, { method: "POST" });
      fetchRuns();
    } catch (e) {
      console.error("Failed to cancel run:", e);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running": return "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 animate-pulse";
      case "completed": return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
      case "failed": return "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30";
      case "cancelled": return "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30";
      default: return "bg-foreground/10 text-foreground/40 border-foreground/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-3 w-3 animate-spin" />;
      case "completed": return <CheckCircle className="h-3 w-3" />;
      case "failed": return <AlertCircle className="h-3 w-3" />;
      case "cancelled": return <Square className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
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

  if (loading) {
    return (
      <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-foreground/5" />
          <Skeleton className="h-12 w-full bg-foreground/5" />
          <Skeleton className="h-32 w-full bg-foreground/5" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-bold text-foreground flex items-center gap-3">
          <Terminal className="h-5 w-5 text-emerald-400" />
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {/* Job Selector */}
        <div className="flex gap-2">
          <Select value={selectedJobId?.toString() || ""} onValueChange={v => setSelectedJobId(parseInt(v))}>
            <SelectTrigger className="flex-1 bg-foreground/5 border-foreground/10 text-foreground">
              <SelectValue placeholder="Select a job to run..." />
            </SelectTrigger>
            <SelectContent className="bg-card border-foreground/10">
              {jobs.map(job => (
                <SelectItem key={job.id} value={job.id.toString()} className="text-foreground">
                  {job.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={startJob}
            disabled={!selectedJobId || starting || (activeRun?.status === "running")}
            className="bg-indigo-500 hover:bg-indigo-400 text-foreground"
          >
            {starting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" /> Run</>
            )}
          </Button>
        </div>

        {/* Active Run */}
        {activeRun && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-lg bg-foreground/5 border border-foreground/10"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={getStatusColor(activeRun.status)}>
                  <span className="flex items-center gap-1.5">
                    {getStatusIcon(activeRun.status)}
                    {activeRun.status.toUpperCase()}
                  </span>
                </Badge>
                <span className="text-sm text-foreground/50">Run #{activeRun.id}</span>
              </div>
              {activeRun.status === "running" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancelRun(activeRun.id)}
                  className="text-rose-400 hover:text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
                >
                  <Square className="h-3 w-3 mr-1" /> Cancel
                </Button>
              )}
            </div>
            
            {activeRun.progress !== undefined && (
              <div className="mt-2">
                <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-indigo-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${activeRun.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <p className="text-xs text-foreground/40 mt-1">{activeRun.progress}% complete</p>
              </div>
            )}

            <div className="flex items-center gap-4 mt-3 text-xs text-foreground/40">
              <span>Duration: {formatDuration(activeRun.startedAt, activeRun.completedAt)}</span>
              {activeRun.startedAt && (
                <span>Started: {new Date(activeRun.startedAt).toLocaleTimeString()}</span>
              )}
            </div>
          </motion.div>
        )}

        {/* Run History */}
        {showHistory && runs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-foreground/40 uppercase tracking-wider">Recent Runs</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              <AnimatePresence>
                {runs.map((run, index) => (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedRun(run)}
                    className="flex items-center justify-between p-2 rounded hover:bg-foreground/5 cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-xs ${getStatusColor(run.status)}`}>
                        {getStatusIcon(run.status)}
                      </Badge>
                      <span className="text-sm text-foreground/70">Run #{run.id}</span>
                      <span className="text-xs text-foreground/40">
                        {jobs.find(j => j.id === run.jobId)?.name || `Job ${run.jobId}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground/30">
                        {formatDuration(run.startedAt, run.completedAt)}
                      </span>
                      <ChevronRight className="h-3 w-3 text-foreground/20 group-hover:text-foreground/50" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </CardContent>

      {/* Run Detail Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={getStatusColor(selectedRun?.status || "")}>
                {getStatusIcon(selectedRun?.status || "")}
                {selectedRun?.status.toUpperCase()}
              </Badge>
              <DialogTitle>Run #{selectedRun?.id}</DialogTitle>
            </div>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-background/40 rounded p-3">
                <p className="text-foreground/40 text-xs uppercase">Job</p>
                <p className="text-foreground">{jobs.find(j => j.id === selectedRun?.jobId)?.name || `Job ${selectedRun?.jobId}`}</p>
              </div>
              <div className="bg-background/40 rounded p-3">
                <p className="text-foreground/40 text-xs uppercase">Duration</p>
                <p className="text-foreground">{formatDuration(selectedRun?.startedAt, selectedRun?.completedAt)}</p>
              </div>
              <div className="bg-background/40 rounded p-3">
                <p className="text-foreground/40 text-xs uppercase">Started</p>
                <p className="text-foreground">{selectedRun?.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : "—"}</p>
              </div>
              <div className="bg-background/40 rounded p-3">
                <p className="text-foreground/40 text-xs uppercase">Completed</p>
                <p className="text-foreground">{selectedRun?.completedAt ? new Date(selectedRun.completedAt).toLocaleString() : "—"}</p>
              </div>
            </div>

            {selectedRun?.output && (
              <div className="space-y-2">
                <p className="text-foreground/40 text-xs uppercase">Output</p>
                <pre className="bg-background/60 rounded p-3 text-xs text-emerald-400 font-mono overflow-x-auto max-h-32 overflow-y-auto">
                  {selectedRun.output}
                </pre>
              </div>
            )}

            {selectedRun?.error && (
              <div className="space-y-2">
                <p className="text-foreground/40 text-xs uppercase">Error</p>
                <pre className="bg-rose-500/10 border border-rose-500/20 rounded p-3 text-xs text-rose-400 font-mono overflow-x-auto">
                  {selectedRun.error}
                </pre>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1 border-foreground/10 text-foreground hover:bg-foreground/5"
                onClick={() => {
                  if (selectedRun) {
                    setSelectedJobId(selectedRun.jobId);
                    setSelectedRun(null);
                  }
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" /> Run Again
              </Button>
              {selectedRun?.status === "running" && (
                <Button
                  variant="outline"
                  className="flex-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  onClick={() => selectedRun && cancelRun(selectedRun.id)}
                >
                  <Square className="h-4 w-4 mr-2" /> Cancel
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
