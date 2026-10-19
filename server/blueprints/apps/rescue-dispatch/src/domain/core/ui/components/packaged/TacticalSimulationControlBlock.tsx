import React, { useState, useMemo } from "react";
import { Compass, Sparkles, AlertTriangle, ShieldCheck, Zap, ArrowRight, Play } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";

interface SimulationEstimate {
  squadId: string;
  name: string;
  distanceKm: number;
  etaMinutes: number;
  breachRiskPercent: number;
  isOptimal: boolean;
}

interface TacticalSimulationControlBlockProps {
  title?: string;
  onApplySimulation?: (target: string, priority: string, selectedSquad: string) => void;
}

export default function TacticalSimulationControlBlock({
  title = "What-If Route & Capacity Simulation",
  onApplySimulation
}: TacticalSimulationControlBlockProps) {
  const [targetName, setTargetName] = useState("Downtown Substation Grid B");
  const [priority, setPriority] = useState<"Critical" | "High" | "Medium">("Critical");
  const [activeSquad, setActiveSquad] = useState("SQ-ALPHA");

  const estimates: SimulationEstimate[] = useMemo(() => {
    const slaTarget = priority === "Critical" ? 10 : priority === "High" ? 20 : 45;
    return [
      {
        squadId: "SQ-ALPHA",
        name: "Squad Alpha",
        distanceKm: 2.4,
        etaMinutes: 4,
        breachRiskPercent: Math.round((4 / slaTarget) * 45),
        isOptimal: true
      },
      {
        squadId: "SQ-BRAVO",
        name: "Squad Bravo",
        distanceKm: 5.8,
        etaMinutes: 11,
        breachRiskPercent: Math.min(99, Math.round((11 / slaTarget) * 75)),
        isOptimal: false
      },
      {
        squadId: "SQ-CHARLIE",
        name: "Squad Charlie",
        distanceKm: 8.1,
        etaMinutes: 16,
        breachRiskPercent: Math.min(99, Math.round((16 / slaTarget) * 95)),
        isOptimal: false
      }
    ];
  }, [priority]);

  const getRiskClasses = (risk: number) => {
    if (risk < 30) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (risk < 60) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  };

  return (
    <Card className="border border-amber-500/30 bg-[#120f08] text-[#f2f7f5] rounded-2xl overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-amber-500/20 px-5 py-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-amber-200 tracking-tight">{title}</CardTitle>
            <p className="text-xs text-amber-300/70 font-mono">Eulerian proximity matrix & SLA breach prediction</p>
          </div>
        </div>

        <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-xs px-2.5 py-0.5 font-mono">
          EULERIAN H3 MESH
        </Badge>
      </CardHeader>

      <CardContent className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
              Simulated Target Location
            </label>
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              className="w-full px-3 py-1.5 bg-black/50 border border-amber-500/30 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
              Incident Urgency Level
            </label>
            <div className="flex gap-1.5">
              {(["Critical", "High", "Medium"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    priority === p
                      ? "bg-amber-500 text-black shadow-md font-extrabold"
                      : "bg-white/5 text-muted-foreground hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">
            Calculated Fleet Response Matrix
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {estimates.map((est) => (
              <div
                key={est.squadId}
                onClick={() => setActiveSquad(est.squadId)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  activeSquad === est.squadId
                    ? "bg-amber-500/15 border-amber-500/50 shadow-lg"
                    : "bg-black/30 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white">{est.name}</span>
                  {est.isOptimal && (
                    <span className="text-[9px] font-mono font-bold text-amber-400 uppercase">
                      ★ Optimal
                    </span>
                  )}
                </div>

                <div className="flex justify-between text-xs font-mono text-muted-foreground my-1.5">
                  <span>{est.distanceKm} km</span>
                  <span className="text-white font-bold">{est.etaMinutes}m ETA</span>
                </div>

                <div className={`text-[10px] px-2 py-0.5 rounded border font-mono flex items-center justify-between ${getRiskClasses(est.breachRiskPercent)}`}>
                  <span>Breach Risk</span>
                  <strong>{est.breachRiskPercent}%</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={() => onApplySimulation?.(targetName, priority, activeSquad)}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 rounded-xl"
          >
            <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
            Apply Optimal Route to Mesh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
