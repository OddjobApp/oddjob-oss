import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Download, Pause, Play, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { cn } from "@/lib/utils";

interface LogLine {
  id: string;
  message: string;
  level: "info" | "warn" | "error" | "success" | "debug" | string;
  timestamp: string;
}

interface MissionStatus {
  status: "active" | "completed" | "failed" | "waiting_on_human" | string;
}

const LEVEL_CLASSES: Record<string, string> = {
  error:   "text-rose-400",
  warn:    "text-amber-300",
  success: "text-emerald-400",
  debug:   "text-white/30",
  info:    "text-white/70",
};

const LEVEL_PREFIX: Record<string, string> = {
  error:   "[ERR]",
  warn:    "[WRN]",
  success: "[OK ]",
  debug:   "[DBG]",
  info:    "[INF]",
};

interface PlatformMissionLogBlockProps {
  missionId: number;
  title?: string;
  maxLines?: number;
  autoScroll?: boolean;
  pollingIntervalMs?: number;
  height?: string;
}

export default function PlatformMissionLogBlock({
  missionId,
  title = "Mission Log",
  maxLines = 300,
  autoScroll = true,
  pollingIntervalMs = 2000,
  height = "400px",
}: PlatformMissionLogBlockProps) {
  const [logs, setLogs]           = useState<LogLine[]>([]);
  const [status, setStatus]       = useState<string>("active");
  const [loading, setLoading]     = useState(true);
  const [paused, setPaused]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const scrollRef                 = useRef<HTMLDivElement>(null);
  const seenIds                   = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback(() => {
    if (autoScroll && !paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll, paused]);

  useEffect(() => { scrollToBottom(); }, [logs, scrollToBottom]);

  const fetchLogs = useCallback(async () => {
    if (paused) return;
    try {
      // Fetch run status
      const statusRes = await fetch(`/api/oddjob/missions/${missionId}/status`);
      if (statusRes.ok) {
        const s: MissionStatus = await statusRes.json();
        setStatus(s.status);
      }

      // Fetch logs
      const logsRes = await fetch(`/api/oddjob/missions/${missionId}/logs`);
      if (!logsRes.ok) throw new Error(`HTTP ${logsRes.status}`);
      const data = await logsRes.json();

      const incoming: LogLine[] = (data.logs ?? data ?? [])
        .map((l: any, i: number) => ({
          id: l.id ?? `${missionId}-${i}-${l.timestamp ?? Date.now()}`,
          message: l.message ?? l.content ?? String(l),
          level: l.level ?? l.type ?? "info",
          timestamp: l.timestamp ?? l.createdAt ?? new Date().toISOString(),
        }))
        .filter((l: LogLine) => !seenIds.current.has(l.id));

      if (incoming.length > 0) {
        incoming.forEach(l => seenIds.current.add(l.id));
        setLogs(prev => {
          const combined = [...prev, ...incoming];
          return combined.slice(-maxLines);
        });
      }

      setLoading(false);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to fetch logs.");
      setLoading(false);
    }
  }, [missionId, paused, maxLines]);

  useEffect(() => {
    seenIds.current.clear();
    setLogs([]);
    setLoading(true);
    fetchLogs();
  }, [missionId]);

  useEffect(() => {
    const isTerminal = status === "completed" || status === "failed";
    if (isTerminal) return;
    const id = setInterval(fetchLogs, pollingIntervalMs);
    return () => clearInterval(id);
  }, [fetchLogs, status, pollingIntervalMs]);

  const handleDownload = () => {
    const text = logs.map(l =>
      `[${new Date(l.timestamp).toISOString()}] ${LEVEL_PREFIX[l.level] ?? "[INF]"} ${l.message}`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mission-${missionId}-log.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isTerminal = status === "completed" || status === "failed";
  const statusColor = status === "active" ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
    : status === "completed" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    : status === "failed" ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
    : "bg-amber-500/20 text-amber-300 border-amber-500/30";

  return (
    <Card className="bg-black/60 border-white/10 backdrop-blur-xl flex flex-col dynamic-height" style={{ "--dynamic-height": height } as React.CSSProperties}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base font-bold text-white font-mono">{title}</CardTitle>
          <Badge variant="outline" className={statusColor}>
            {isTerminal ? status.toUpperCase() : (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                {status.replace(/_/g, " ").toUpperCase()}
              </span>
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon"
            onClick={() => setPaused(p => !p)}
            className="h-7 w-7 text-white/30 hover:text-white"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setLogs([]); seenIds.current.clear(); }} className="h-7 w-7 text-white/30 hover:text-white" title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDownload} disabled={logs.length === 0} className="h-7 w-7 text-white/30 hover:text-white" title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto font-mono text-[11px] leading-relaxed bg-black/40 p-4 space-y-0.5"
        >
          {loading ? (
            <div className="space-y-2 pt-2">
              {Array(8).fill(0).map((_, i) => (
                <Skeleton 
                  key={i} 
                  className="h-4 bg-white/5 dynamic-width" 
                  style={{ "--dynamic-width": `${60 + Math.random() * 35}%` } as React.CSSProperties} 
                />
              ))}
            </div>
          ) : error ? (
            <p className="text-rose-400 pt-2">{error}</p>
          ) : logs.length === 0 ? (
            <p className="text-white/20 pt-2">Waiting for log output…</p>
          ) : (
            <AnimatePresence initial={false}>
              {logs.map(line => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex gap-3 hover:bg-white/5 px-1 rounded group"
                >
                  <span className="text-white/20 shrink-0 select-none">
                    {new Date(line.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`shrink-0 select-none font-bold ${LEVEL_CLASSES[line.level] ?? "text-white/70"}`}>
                    {LEVEL_PREFIX[line.level] ?? "[INF]"}
                  </span>
                  <span className={LEVEL_CLASSES[line.level] ?? "text-white/70"}>
                    {line.message}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          {/* Live indicator when active */}
          {!isTerminal && !paused && !loading && (
            <div className="flex items-center gap-2 pt-2 text-white/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
