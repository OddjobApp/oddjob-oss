/**
 * SqlQueryPanel — execute read-only SQL queries with results table and history.
 */
import React, { useState } from "react";
import { Database, Play, Loader2, AlertCircle, Clock } from "lucide-react";
import { missions, records, telemetry } from "../lib/platform-client";
import { isReadOnlyQuery, findWriteKeyword } from "../lib/sql-validator";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  defectId?: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTimeMs: number;
}

export function SqlQueryPanel({ defectId }: Props) {
  const [query, setQuery] = useState("");
  const [database, setDatabase] = useState<"staging" | "development">("staging");
  const [description, setDescription] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<Array<{ query: string; rowCount: number; time: string }>>([]);

  async function handleExecute() {
    setError(null);
    if (!query.trim()) { setError("Query is required"); return; }

    // Client-side read-only validation
    if (!isReadOnlyQuery(query)) {
      const keyword = findWriteKeyword(query);
      setError(`Write operations are not allowed. Found: ${keyword}`);
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      telemetry.emit("sql_query_executed", "info", { database, defectId });

      const triggerResult = await missions.trigger("SQL Verification", {
        type: "sql_query",
        query: query.trim(),
        database,
        description: description.trim() || undefined,
      });

      // Store investigation record
      await records.create(COLLECTIONS.INVESTIGATIONS, {
        investigationId: crypto.randomUUID(),
        defectId,
        type: "sql_query",
        parameters: { query, database, description },
        results: { runId: triggerResult.runId, status: "triggered" },
        evidenceUrls: [],
        status: "running",
        startedAt: new Date().toISOString(),
      });

      // Add to history
      setHistory((prev) => [{ query: query.trim(), rowCount: 0, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      setResult({ columns: ["Status"], rows: [["Query triggered — Run #" + triggerResult.runId]], rowCount: 0, executionTimeMs: 0 });
    } catch (e: any) {
      setError(e.message ?? "Query execution failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sql-query" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          SQL Query (read-only) <span className="text-rose-400">*</span>
        </label>
        <textarea id="sql-query" value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }}
          placeholder="SELECT * FROM users WHERE created_at > NOW() - INTERVAL '24 hours' LIMIT 50;"
          rows={4}
          className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm text-white font-mono focus:outline-none focus:border-rose-500 resize-y ${error ? "border-rose-500" : "border-white/10"}`} />
        {error && <p className="mt-1 text-xs text-rose-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sql-db" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Database</label>
          <select id="sql-db" value={database} onChange={(e) => setDatabase(e.target.value as any)}
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500">
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </div>
        <div>
          <label htmlFor="sql-desc" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
          <input id="sql-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you checking?"
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
      </div>

      <button onClick={handleExecute} disabled={running || !query.trim()}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Executing...</> : <><Database className="w-4 h-4" /> Execute Query</>}
      </button>

      {/* Results */}
      {result && (
        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full text-xs text-left">
            <thead><tr className="bg-white/5 text-slate-400">{result.columns.map((c, i) => <th key={i} className="px-3 py-2">{c}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, i) => <tr key={i} className="border-t border-white/5">{row.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-300">{String(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h5 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Query History</h5>
          <div className="space-y-1">
            {history.map((h, i) => (
              <button key={i} onClick={() => setQuery(h.query)}
                className="w-full text-left px-3 py-1.5 rounded bg-white/3 border border-white/5 hover:border-white/10 text-[10px] text-slate-400 font-mono truncate transition-colors">
                <Clock className="w-3 h-3 inline mr-1" />{h.time} — {h.query.slice(0, 60)}...
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
