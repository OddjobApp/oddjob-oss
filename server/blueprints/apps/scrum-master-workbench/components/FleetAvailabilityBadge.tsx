/**
 * FleetAvailabilityBadge — compact badge showing dev agent availability.
 */
import React, { useState, useEffect, useRef } from "react";
import { Cpu, AlertTriangle } from "lucide-react";
import { fleet, telemetry } from "../lib/platform-client";
import type { FleetAgent } from "../lib/platform-client";

interface Props {
  sprintNumber: number;
}

const DEV_AGENTS = ["ai-backend-dev", "ai-frontend-dev", "ai-qa-engineer"];

export function FleetAvailabilityBadge({ sprintNumber }: Props) {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchFleet() {
    try {
      const data = await fleet.workload();
      const devAgents = (data.agents ?? []).filter((a) =>
        DEV_AGENTS.some((name) => a.agent.toLowerCase().includes(name.replace("ai-", "")))
      );
      setAgents(devAgents);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchFleet();
    intervalRef.current = setInterval(fetchFleet, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const busyAgents = agents.filter((a) => a.status === "active" || a.status === "blocked");
  const idleAgents = agents.filter((a) => a.status === "idle" || a.status === "completed");
  const hasBusy = busyAgents.length > 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-slate-500">
        <Cpu className="w-3.5 h-3.5 animate-pulse" /> Checking fleet...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-slate-500">
        <Cpu className="w-3.5 h-3.5" /> Fleet: Unknown
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
      hasBusy
        ? "bg-amber-500/5 border-amber-500/20 text-amber-400"
        : "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
    }`}>
      <Cpu className="w-3.5 h-3.5 shrink-0" />
      <div className="flex-1">
        {hasBusy ? (
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            <span className="font-semibold">{busyAgents.length} agent{busyAgents.length !== 1 ? "s" : ""} busy</span>
            <span className="text-amber-400/70">— tickets may queue</span>
          </div>
        ) : (
          <span className="font-semibold">{idleAgents.length} agent{idleAgents.length !== 1 ? "s" : ""} idle — ready</span>
        )}
      </div>
      {hasBusy && (
        <div className="flex gap-1">
          {busyAgents.slice(0, 2).map((a) => (
            <span key={a.agent} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-[9px] font-mono truncate max-w-[80px]">
              {a.agent.replace("ai-", "")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
