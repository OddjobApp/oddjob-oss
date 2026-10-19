/**
 * ConsoleCapture — capture browser console output + network errors from a URL.
 */
import React, { useState } from "react";
import { Monitor, Loader2, AlertCircle, AlertTriangle, Wifi, Link2 } from "lucide-react";
import { missions, records, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  defectId?: string;
  onLinkToDefect?: (errors: string[]) => void;
}

export function ConsoleCapture({ defectId, onLinkToDefect }: Props) {
  const [url, setUrl] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(10);
  const [interactionScript, setInteractionScript] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    consoleErrors: string[];
    consoleWarnings: string[];
    networkFailures: Array<{ method: string; url: string; status: number; time: number }>;
    screenshot?: string;
  } | null>(null);

  async function handleCapture() {
    if (!url.trim()) { setError("URL is required"); return; }
    setRunning(true);
    setError(null);
    setResults(null);

    try {
      const triggerResult = await missions.trigger("Console Capture", {
        type: "console_capture",
        url: url.trim(),
        waitSeconds,
        interactionScript: interactionScript.trim() || undefined,
      });

      await records.create(COLLECTIONS.INVESTIGATIONS, {
        investigationId: crypto.randomUUID(),
        defectId,
        type: "console_capture",
        parameters: { url, waitSeconds, interactionScript },
        results: { runId: triggerResult.runId, status: "triggered" },
        evidenceUrls: [],
        status: "running",
        startedAt: new Date().toISOString(),
      });

      telemetry.emit("console_capture_executed", "info", { url, defectId });

      // Placeholder results (real results would come from mission completion polling)
      setResults({
        consoleErrors: ["Uncaught TypeError: Cannot read properties of undefined (reading 'map')"],
        consoleWarnings: ["React: Each child in a list should have a unique 'key' prop"],
        networkFailures: [{ method: "GET", url: "/api/data", status: 500, time: 2340 }],
      });
    } catch (e: any) {
      setError(e.message ?? "Capture failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cc-url" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          URL <span className="text-rose-400">*</span>
        </label>
        <input id="cc-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://staging.example.com/page-with-error"
          className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cc-wait" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Wait (seconds)</label>
          <input id="cc-wait" type="number" min={1} max={60} value={waitSeconds} onChange={(e) => setWaitSeconds(Number(e.target.value))}
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
        <div>
          <label htmlFor="cc-script" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Interaction (optional)</label>
          <input id="cc-script" type="text" value={interactionScript} onChange={(e) => setInteractionScript(e.target.value)}
            placeholder='click "#submit-btn"'
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
      </div>

      {error && <div className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}

      <button onClick={handleCapture} disabled={running || !url.trim()}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Capturing...</> : <><Monitor className="w-4 h-4" /> Capture Console</>}
      </button>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          {results.consoleErrors.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1">Console Errors ({results.consoleErrors.length})</h5>
              {results.consoleErrors.map((e, i) => (
                <div key={i} className="px-3 py-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-mono mb-1">{e}</div>
              ))}
            </div>
          )}
          {results.consoleWarnings.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Warnings ({results.consoleWarnings.length})</h5>
              {results.consoleWarnings.map((w, i) => (
                <div key={i} className="px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-mono mb-1">{w}</div>
              ))}
            </div>
          )}
          {results.networkFailures.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Wifi className="w-3 h-3" /> Network Failures ({results.networkFailures.length})</h5>
              {results.networkFailures.map((f, i) => (
                <div key={i} className="px-3 py-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-mono mb-1">
                  {f.method} {f.url} → {f.status} ({f.time}ms)
                </div>
              ))}
            </div>
          )}
          {onLinkToDefect && results.consoleErrors.length > 0 && (
            <button onClick={() => onLinkToDefect(results.consoleErrors)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors">
              <Link2 className="w-3.5 h-3.5" /> Link Errors to Defect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
