/**
 * FleetAvailabilityBadge — shows agent availability near action buttons.
 */
import React, { useState, useEffect, useRef } from "react";
import { Cpu, AlertTriangle } from "lucide-react";
import { fleet } from "../lib/platform-client";

const TARGET_AGENTS = ["systems analyst", "backend", "frontend"];

export function FleetAvailabilityBadge() {
  const [busy, setBusy] = useState(0);
  const [idle, setIdle] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchFleet() {
    try {
      const data = await fleet.workload();
      const relevant = (data.agents ?? []).filter((a) =>
        TARGET_AGENTS.some((name) => a.agent.toLowerCase().includes(name))
      );
      setBusy(relevant.filter((a) => a.status === "active" || a.status === "blocked").length);
      setIdle(relevant.filter((a) => a.status === "idle" || a.status === "completed").length);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchFleet();
    intervalRef.current = setInterval(fetchFleet, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  if (loading) return <span className="text-[10px] text-slate-500">Checking fleet...</span>;
  if (error) return <span className="text-[10px] text-slate-500">Fleet: Unknown</span>;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold ${
      busy > 0 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
    }`}>
      <Cpu className="w-3 h-3" />
      {busy > 0 ? <><AlertTriangle className="w-3 h-3" /> {busy} busy</> : <>{idle} idle</>}
    </span>
  );
}
