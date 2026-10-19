/**
 * LogReaderPanel — search application logs by time range, severity, and keyword.
 */
import React, { useState } from "react";
import { FileText, Search, Loader2, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { missions, records, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  defectId?: string;
  jiraKey?: string;
}

interface LogEntry {
  timestamp: string;
  severity: "ERROR" | "WARN" | "INFO" | "DEBUG";
  service: string;
  message: string;
  fullText?: string;
}

const TIME_RANGES = ["Last 15 min", "Last 1 hour", "Last 24 hours", "Custom"] as const;
const SEVERITIES = ["ERROR", "WARN", "INFO", "DEBUG"] as const;

export function LogReaderPanel({ defectId, jiraKey }: Props) {
  const [timeRange, setTimeRange] = useState<string>("Last 1 hour");
  const [severity, setSeverity] = useState<string[]>(["ERROR", "WARN"]);
  const [keyword, setKeyword] = useState(jiraKey ?? "");
  const [service, setService] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  function toggleSeverity(sev: string) {
    setSeverity((prev) => prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]);
  }

  async function handleSearch() {
    setRunning(true);
    setError(null);
    setEntries([]);

    try {
      const triggerResult = await missions.trigger("Log Search", {
        type: "log_reader",
        timeRange,
        severity,
        keyword: keyword.trim() || undefined,
        service: service.trim() || undefined,
      });

      await records.create(COLLECTIONS.INVESTIGATIONS, {
        investigationId: crypto.randomUUID(),
        defectId,
        type: "log_reader",
        parameters: { timeRange, severity, keyword, service },
        results: { runId: triggerResult.runId, status: "triggered" },
        evidenceUrls: [],
        status: "running",
        startedAt: new Date().toISOString(),
      });

      telemetry.emit("log_search_executed", "info", { timeRange, severity, defectId });

      // Placeholder entries (real results from mission completion)
      setEntries([
        { timestamp: new Date().toISOString(), severity: "ERROR", service: "api-server", message: "NullPointerException in UserService.getProfile()", fullText: "java.lang.NullPointerException\n  at UserService.getProfile(UserService.java:142)\n  at UserController.handleRequest(UserController.java:89)" },
        { timestamp: new Date(Date.now() - 60000).toISOString(), severity: "WARN", service: "api-server", message: "Slow query detected: 2340ms for SELECT * FROM orders", fullText: "Query: SELECT * FROM orders WHERE user_id = 12345 AND status IN ('pending', 'processing')\nExecution time: 2340ms\nRows scanned: 1,234,567" },
      ]);
    } catch (e: any) {
      setError(e.message ?? "Log search failed");
    } finally {
      setRunning(false);
    }
  }

  const severityColor: Record<string, string> = {
    ERROR: "bg-rose-500/20 text-rose-400",
    WARN: "bg-amber-500/20 text-amber-400",
    INFO: "bg-blue-500/20 text-blue-400",
    DEBUG: "bg-slate-700 text-slate-400",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Time Range</label>
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500">
            {TIME_RANGES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Severity</label>
          <div className="flex flex-wrap gap-1">
            {SEVERITIES.map((s) => (
              <button key={s} onClick={() => toggleSeverity(s)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${severity.includes(s) ? severityColor[s] : "bg-white/5 text-slate-600"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Keyword</label>
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. NullPointer"
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Service</label>
          <input type="text" value={service} onChange={(e) => setService(e.target.value)}
            placeholder="e.g. api-server"
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
      </div>

      {error && <div className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}

      <button onClick={handleSearch} disabled={running || severity.length === 0}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</> : <><Search className="w-4 h-4" /> Search Logs</>}
      </button>

      {/* Log entries */}
      {entries.length > 0 && (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {entries.map((entry, i) => (
            <div key={i} className={`rounded-lg border transition-colors ${
              entry.severity === "ERROR" ? "bg-rose-500/5 border-rose-500/20" : "bg-white/3 border-white/5"
            }`}>
              <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                className="w-full text-left px-3 py-2 flex items-center gap-2">
                {expandedIdx === i ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                <span className="text-[10px] text-slate-600 font-mono shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${severityColor[entry.severity]}`}>{entry.severity}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{entry.service}</span>
                <span className={`text-xs truncate flex-1 ${jiraKey && entry.message.includes(jiraKey) ? "text-amber-300 bg-amber-500/10 px-1 rounded" : "text-slate-300"}`}>
                  {entry.message}
                </span>
              </button>
              {expandedIdx === i && entry.fullText && (
                <pre className="px-3 pb-3 text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-all">{entry.fullText}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
