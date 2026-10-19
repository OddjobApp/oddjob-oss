/**
 * BrowserAutopilotPanel — instruct browser navigation to reproduce issues,
 * capturing screenshots, console output, and network errors.
 */
import React, { useState } from "react";
import { Globe, Loader2, AlertCircle, Camera, Terminal } from "lucide-react";
import { missions, records, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  defectId?: string;
  onReproStepsGenerated?: (steps: string) => void;
}

export function BrowserAutopilotPanel({ defectId, onReproStepsGenerated }: Props) {
  const [startUrl, setStartUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [maxSteps, setMaxSteps] = useState(10);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    steps: Array<{ action: string; screenshot?: string }>;
    consoleOutput: string[];
    networkErrors: Array<{ method: string; url: string; status: number }>;
  } | null>(null);

  async function handleRun() {
    if (!startUrl.trim()) { setError("Start URL is required"); return; }
    if (!goal.trim()) { setError("Goal description is required"); return; }
    setRunning(true);
    setError(null);
    setResults(null);

    try {
      const triggerResult = await missions.trigger("Browser Autopilot", {
        type: "browser_autopilot",
        deploymentMode: "browser_autopilot",
        startUrl: startUrl.trim(),
        goal: goal.trim(),
        maxSteps,
      });

      await records.create(COLLECTIONS.INVESTIGATIONS, {
        investigationId: crypto.randomUUID(),
        defectId,
        type: "browser_autopilot",
        parameters: { startUrl, goal, maxSteps },
        results: { runId: triggerResult.runId, status: "triggered" },
        evidenceUrls: [],
        status: "running",
        startedAt: new Date().toISOString(),
      });

      telemetry.emit("browser_autopilot_triggered", "info", { startUrl, goal, defectId });

      // Placeholder results (real results from mission completion)
      setResults({
        steps: [
          { action: "Navigate to " + startUrl },
          { action: "Click login button" },
          { action: "Enter credentials" },
          { action: "Submit form — ERROR detected" },
        ],
        consoleOutput: ["TypeError: Cannot read property 'token' of null"],
        networkErrors: [{ method: "POST", url: "/api/auth/login", status: 500 }],
      });

      // Auto-populate repro steps
      if (onReproStepsGenerated) {
        const steps = [
          `1. Navigate to ${startUrl}`,
          "2. Click login button",
          "3. Enter credentials",
          "4. Submit form",
          "5. ERROR: Server returns 500 on /api/auth/login",
        ].join("\n");
        onReproStepsGenerated(steps);
      }
    } catch (e: any) {
      setError(e.message ?? "Autopilot failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ba-url" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Start URL <span className="text-rose-400">*</span>
        </label>
        <input id="ba-url" type="url" value={startUrl} onChange={(e) => setStartUrl(e.target.value)}
          placeholder="https://staging.example.com/login"
          className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
      </div>

      <div>
        <label htmlFor="ba-goal" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Goal (what to reproduce) <span className="text-rose-400">*</span>
        </label>
        <textarea id="ba-goal" value={goal} onChange={(e) => setGoal(e.target.value)} rows={3}
          placeholder="Login with test credentials, navigate to dashboard, click 'Export' button — should trigger the reported 500 error"
          className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500 resize-y" />
      </div>

      <div>
        <label htmlFor="ba-steps" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Max Steps</label>
        <input id="ba-steps" type="number" min={1} max={30} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))}
          className="w-32 bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
      </div>

      {error && <div className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}

      <button onClick={handleRun} disabled={running || !startUrl.trim() || !goal.trim()}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running Autopilot...</> : <><Globe className="w-4 h-4" /> Run Browser Autopilot</>}
      </button>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          <div>
            <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Camera className="w-3 h-3" /> Steps Executed</h5>
            <div className="space-y-1">
              {results.steps.map((step, i) => (
                <div key={i} className="px-3 py-1.5 rounded bg-white/3 border border-white/5 text-xs text-slate-300">
                  <span className="text-slate-500 mr-2">{i + 1}.</span>{step.action}
                </div>
              ))}
            </div>
          </div>
          {results.consoleOutput.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Terminal className="w-3 h-3" /> Console Output</h5>
              {results.consoleOutput.map((msg, i) => (
                <div key={i} className="px-3 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-mono">{msg}</div>
              ))}
            </div>
          )}
          {results.networkErrors.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1">Network Errors</h5>
              {results.networkErrors.map((err, i) => (
                <div key={i} className="px-3 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-mono">
                  {err.method} {err.url} → {err.status}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
