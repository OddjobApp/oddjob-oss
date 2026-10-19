import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Square, RefreshCw, Search, Plus, AlertCircle, ChevronRight, Wifi } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';
import { useEventStream } from '../../hooks/useEventStream.js';

interface MissionRun {
  id: number;
  missionId?: number;
  name: string;
  status: "active" | "completed" | "failed" | "waiting_on_human" | "pending" | string;
  objective?: string;
  startedAt?: string;
  completedAt?: string;
}

const STATUS_CLASSES: Record<string, string> = {
  active:           "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  completed:        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  failed:           "bg-rose-500/15 text-rose-400 border-rose-500/30",
  waiting_on_human: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  pending:          "bg-foreground/10 text-foreground/40 border-foreground/10",
};

interface PlatformMissionsBlockProps {
  title?: string;
  allowLaunch?: boolean;
  allowAbort?: boolean;
  /** @deprecated Use SSE for real-time updates instead of polling */
  pollingIntervalMs?: number;
  onSelect?: (missionId: number) => void;
  /** Enable SSE for real-time updates (default: true) */
  useSSE?: boolean;
}

export default function PlatformMissionsBlock({
  title = "Missions",
  allowLaunch = false,
  allowAbort = true,
  pollingIntervalMs = 5000,
  onSelect,
  useSSE = true,
}: PlatformMissionsBlockProps) {
  const [missions, setMissions]     = useState<MissionRun[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchName, setLaunchName] = useState("");
  const [launchObj, setLaunchObj]   = useState("");
  const [launching, setLaunching]   = useState(false);
  const [abortingId, setAbortingId] = useState<number | null>(null);

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch("/api/oddjob/missions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const runs: MissionRun[] = (data.runs ?? data.missions ?? data ?? []).map((r: any) => ({
        id: r.runId ?? r.id,
        missionId: r.missionId,
        name: r.name ?? r.missionName ?? `Run #${r.runId ?? r.id}`,
        status: r.status ?? "pending",
        objective: r.objective ?? r.description,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      }));
      setMissions(runs);
      setLoading(false);
    } catch (e: any) {
      setError(e.message || "Failed to load missions.");
      setLoading(false);
    }
  }, []);

  // SSE for real-time updates
  const { isConnected: sseConnected, lastEvent } = useEventStream({
    type: useSSE ? ["mission.*", "mission_run.*"] : undefined,
    autoConnect: useSSE,
  });

  // Handle SSE events
  useEffect(() => {
    if (!useSSE || !lastEvent) return;
    
    // Refresh missions on relevant events
    if (lastEvent.eventType.startsWith("mission.") || lastEvent.eventType.startsWith("mission_run.")) {
      fetchMissions();
    }
  }, [lastEvent, useSSE, fetchMissions]);

  // Initial fetch and fallback polling
  useEffect(() => {
    fetchMissions();
    
    // Only use polling if SSE is disabled or not connected
    if (!useSSE) {
      const id = setInterval(fetchMissions, pollingIntervalMs);
      return () => clearInterval(id);
    }
  }, [fetchMissions, pollingIntervalMs, useSSE]);

  const handleLaunch = async () => {
    if (!launchName.trim()) return;
    setLaunching(true);
    try {
      await fetch("/api/oddjob/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: launchName.trim(), objective: launchObj.trim() }),
      });
      setLaunchOpen(false);
      setLaunchName("");
      setLaunchObj("");
      await fetchMissions();
    } catch (e: any) {
      setError(e.message || "Launch failed.");
    } finally {
      setLaunching(false);
    }
  };

  const handleAbort = async (runId: number) => {
    setAbortingId(runId);
    try {
      await fetch(`/api/oddjob/missions/${runId}`, { method: "DELETE" });
      await fetchMissions();
    } catch (e: any) {
      setError(e.message || "Abort failed.");
    } finally {
      setAbortingId(null);
    }
  };

  const filtered = missions.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.status.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = missions.filter(m => m.status === "active").length;

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-xl font-bold text-foreground">{title}</CardTitle>
          {activeCount > 0 && (
            <Badge className="bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 animate-pulse">
              {activeCount} active
            </Badge>
          )}
          {useSSE && sseConnected && (
            <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" title="Live updates enabled">
              <Wifi className="h-3 w-3 mr-1" /> LIVE
            </Badge>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="relative min-w-0 flex-1 md:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-foreground/30" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter missions…"
              className="pl-9 w-full md:w-48 bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/20"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={fetchMissions} className="text-foreground/30 hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {allowLaunch && (
            <Button onClick={() => setLaunchOpen(true)} size="sm" className="bg-indigo-500 hover:bg-indigo-400 text-foreground gap-1.5">
              <Plus className="h-4 w-4" /> Launch
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            <button onClick={() => setError(null)} className="ml-auto text-rose-400/60 hover:text-rose-400">×</button>
          </div>
        )}

        <div className="space-y-3 md:hidden">
          {loading
            ? Array(3).fill(0).map((_, i) => (
                <div key={i} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3">
                  <Skeleton className="h-5 w-2/3 bg-foreground/5" />
                  <Skeleton className="mt-3 h-4 w-full bg-foreground/5" />
                  <Skeleton className="mt-2 h-4 w-1/2 bg-foreground/5" />
                </div>
              ))
            : filtered.length === 0
            ? (
                <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-4 py-10 text-center text-sm text-foreground/30">
                  {search ? `No missions matching "${search}"` : "No missions yet."}
                </div>
              )
            : filtered.map((mission, i) => (
                <motion.div
                  key={mission.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.04 }}
                  className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3"
                  onClick={() => onSelect?.(mission.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{mission.name}</p>
                      <p className="mt-1 text-xs text-foreground/40">
                        {mission.startedAt ? new Date(mission.startedAt).toLocaleString() : "â€”"}
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_CLASSES[mission.status] ?? STATUS_CLASSES.pending}>
                      {mission.status.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-foreground/50">{mission.objective ?? "â€”"}</p>
                  {(onSelect || (allowAbort && mission.status === "active")) && (
                    <div className="mt-3 flex items-center justify-end gap-1">
                      {onSelect && (
                        <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onSelect(mission.id); }} className="h-8 w-8 text-indigo-400/70 hover:text-indigo-700 dark:text-indigo-300">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
                      {allowAbort && mission.status === "active" && (
                        <Button
                          variant="ghost" size="icon"
                          onClick={e => { e.stopPropagation(); handleAbort(mission.id); }}
                          disabled={abortingId === mission.id}
                          className="h-8 w-8 text-rose-400/70 hover:text-rose-400"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </motion.div>
              ))
          }
        </div>

        <Table className="hidden md:table">
          <TableHeader className="bg-foreground/5">
            <TableRow className="border-foreground/5 hover:bg-transparent">
              <TableHead className="text-foreground/50 text-xs uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-foreground/50 text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-foreground/50 text-xs uppercase tracking-wider">Objective</TableHead>
              <TableHead className="text-foreground/50 text-xs uppercase tracking-wider">Started</TableHead>
              <TableHead className="text-right text-foreground/50 text-xs uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array(5).fill(0).map((_, i) => (
                  <TableRow key={i} className="border-foreground/5">
                    {[1,2,3,4,5].map(j => <TableCell key={j}><Skeleton className="h-5 w-full bg-foreground/5" /></TableCell>)}
                  </TableRow>
                ))
              : filtered.length === 0
              ? (
                  <TableRow className="border-foreground/5">
                    <TableCell colSpan={5} className="text-center py-12 text-foreground/30">
                      {search ? `No missions matching "${search}"` : "No missions yet."}
                    </TableCell>
                  </TableRow>
                )
              : filtered.map((mission, i) => (
                  <motion.tr
                    key={mission.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.04 }}
                    className="border-foreground/5 hover:bg-foreground/5 transition-colors group cursor-pointer"
                    onClick={() => onSelect?.(mission.id)}
                  >
                    <TableCell className="font-medium text-foreground text-sm">{mission.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASSES[mission.status] ?? STATUS_CLASSES.pending}>
                        {mission.status.replace(/_/g, " ").toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/50 text-sm max-w-[200px] truncate">{mission.objective ?? "—"}</TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {mission.startedAt ? new Date(mission.startedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onSelect && (
                          <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onSelect(mission.id); }} className="h-7 w-7 text-indigo-400/60 hover:text-indigo-700 dark:text-indigo-300">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        )}
                        {allowAbort && mission.status === "active" && (
                          <Button
                            variant="ghost" size="icon"
                            onClick={e => { e.stopPropagation(); handleAbort(mission.id); }}
                            disabled={abortingId === mission.id}
                            className="h-7 w-7 text-rose-400/60 hover:text-rose-400"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
                ))
            }
          </TableBody>
        </Table>
      </CardContent>

      {/* Launch Dialog */}
      <Dialog open={launchOpen} onOpenChange={setLaunchOpen}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>Launch Mission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-foreground/50">Mission Name</label>
              <Input
                value={launchName}
                onChange={e => setLaunchName(e.target.value)}
                placeholder="e.g. Process Daily Report"
                className="bg-foreground/5 border-foreground/10 text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-foreground/50">Objective (optional)</label>
              <Input
                value={launchObj}
                onChange={e => setLaunchObj(e.target.value)}
                placeholder="What should this mission accomplish?"
                className="bg-foreground/5 border-foreground/10 text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLaunchOpen(false)} className="text-foreground/50">Cancel</Button>
            <Button onClick={handleLaunch} disabled={!launchName.trim() || launching} className="bg-indigo-500 hover:bg-indigo-400 text-foreground">
              {launching ? "Launching…" : "Launch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
