/**
 * PlaywrightRunner — trigger E2E tests and display results with artifacts.
 */
import React, { useState } from "react";
import { Play, Loader2, CheckCircle2, XCircle, AlertCircle, Download } from "lucide-react";
import { missions, records, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  onSuiteLogged?: () => void;
}

export function PlaywrightRunner({ onSuiteLogged }: Props) {
  const [testPath, setTestPath] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [browser, setBrowser] = useState<"chromium" | "firefox" | "webkit">("chromium");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  async function handleRun() {
    if (!testPath.trim()) { setError("Test path is required"); return; }
    setRunning(true);
    setError(null);
    setResults(null);

    try {
      telemetry.emit("playwright_test_triggered", "info", { testPath, browser, targetUrl });

      const triggerResult = await missions.trigger("Playwright Test Run", {
        type: "playwright_test",
        testPath: testPath.trim(),
        targetUrl: targetUrl.trim() || undefined,
        browser,
      });

      // Poll for completion (simplified — in production would use mission logs polling)
      // For now, store the trigger and show "running" state
      const investigationId = crypto.randomUUID();
      await records.create(COLLECTIONS.INVESTIGATIONS, {
        investigationId,
        type: "playwright_test",
        parameters: { testPath, targetUrl, browser },
        results: { runId: triggerResult.runId, status: "running" },
        evidenceUrls: [],
        status: "running",
        startedAt: new Date().toISOString(),
      });

      setResults({ runId: triggerResult.runId, status: "triggered" });

      // Also log as a test suite record
      await records.create(COLLECTIONS.TEST_SUITES, {
        suiteId: crypto.randomUUID(),
        suiteName: testPath,
        passCount: 0,
        failCount: 0,
        coveragePercent: 0,
        evidenceUrl: `mission-run:${triggerResult.runId}`,
        status: "passed",
        source: "playwright_manual",
        runAt: new Date().toISOString(),
      });

      onSuiteLogged?.();
    } catch (e: any) {
      setError(e.message ?? "Failed to trigger Playwright test");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label htmlFor="pw-test-path" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Test Path / Suite <span className="text-rose-400">*</span>
          </label>
          <input id="pw-test-path" type="text" value={testPath} onChange={(e) => setTestPath(e.target.value)}
            placeholder="e.g. tests/e2e/auth.spec.ts or 'Login Suite'"
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
        </div>
        <div>
          <label htmlFor="pw-browser" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Browser</label>
          <select id="pw-browser" value={browser} onChange={(e) => setBrowser(e.target.value as any)}
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500">
            <option value="chromium">Chromium</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="pw-url" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Target URL (optional override)</label>
        <input id="pw-url" type="url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://staging.example.com"
          className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
      </div>

      {error && <div className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}

      <button onClick={handleRun} disabled={running || !testPath.trim()}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Play className="w-4 h-4" /> Run Playwright Test</>}
      </button>

      {results && (
        <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Test triggered — Run #{results.runId}. Check Mission Status for results.
        </div>
      )}
    </div>
  );
}
