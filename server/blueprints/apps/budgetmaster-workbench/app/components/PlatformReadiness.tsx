"use client";

import { useCallback, useEffect, useState } from "react";
import { hil, records } from "../../lib/platform-client";

type Health = "checking" | "healthy" | "degraded";

export function PlatformReadiness() {
  const [health, setHealth] = useState<Health>("checking");
  const [detail, setDetail] = useState("Checking ledger and approval services…");
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const check = useCallback(async () => {
    setHealth("checking");
    const [ledger, approvals] = await Promise.allSettled([
      records.list("finance_accounts"),
      hil.pending(),
    ]);
    const failures = [ledger, approvals].filter((result) => result.status === "rejected").length;
    setLastChecked(new Date().toLocaleTimeString());
    if (failures === 0) {
      setHealth("healthy");
      setDetail("Finance records and human approval services are connected.");
    } else {
      setHealth("degraded");
      setDetail("Read-only review remains available. Writes, approvals, and mission triggers may be unavailable.");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  return (
    <div className={`mb-8 rounded-xl border px-4 py-3 text-sm ${health === "degraded" ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : health === "healthy" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-slate-700 bg-white/5 text-slate-300"}`} role="status">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold">{health === "healthy" ? "Sovereign finance services connected" : health === "degraded" ? "BudgetMaster is in degraded mode" : "Checking BudgetMaster readiness"}</div>
          <div className="mt-1 text-xs opacity-75">{detail}{lastChecked ? ` Last checked ${lastChecked}.` : ""}</div>
        </div>
        {health === "degraded" && <button type="button" onClick={() => void check()} className="self-start rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold hover:bg-amber-400/10">Retry services</button>}
      </div>
    </div>
  );
}
