import React, { useState } from "react";
import { motion } from "framer-motion";
import { Users, Shield, Radio, Activity, Navigation, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export interface SquadUnit {
  id: string;
  name: string;
  status: "Active" | "Deploying" | "Standby";
  healthScore: number;
  mission?: string;
  personnel: number;
  sector: string;
}

const DEFAULT_SQUADS: SquadUnit[] = [
  {
    id: "SQ-ALPHA",
    name: "Squad Alpha",
    status: "Active",
    healthScore: 94,
    mission: "Sector 7 Critical Dispatch",
    personnel: 4,
    sector: "Sector 7 (Downtown)"
  },
  {
    id: "SQ-BRAVO",
    name: "Squad Bravo",
    status: "Deploying",
    healthScore: 88,
    mission: "Substation Delta Transformer",
    personnel: 3,
    sector: "Sector 5 (South Park)"
  },
  {
    id: "SQ-CHARLIE",
    name: "Squad Charlie",
    status: "Standby",
    healthScore: 100,
    personnel: 5,
    sector: "Central Depot"
  },
  {
    id: "SQ-DELTA",
    name: "Squad Delta",
    status: "Standby",
    healthScore: 72,
    personnel: 2,
    sector: "Station West"
  }
];

interface TacticalSquadStatusBlockProps {
  title?: string;
  squads?: SquadUnit[];
  onDeploySquad?: (id: string) => void;
}

export default function TacticalSquadStatusBlock({
  title = "Squad Fleet Readiness",
  squads: initialSquads = DEFAULT_SQUADS,
  onDeploySquad
}: TacticalSquadStatusBlockProps) {
  const [squads, setSquads] = useState<SquadUnit[]>(initialSquads);

  const handleDeploy = (id: string) => {
    setSquads((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "Deploying" } : s))
    );
    onDeploySquad?.(id);
  };

  const getStatusClasses = (s: SquadUnit["status"]) => {
    switch (s) {
      case "Active": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
      case "Deploying": return "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse";
      default: return "bg-slate-500/20 text-slate-300 border-slate-500/40";
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 90) return "bg-emerald-500";
    if (score >= 75) return "bg-amber-500";
    return "bg-rose-500";
  };

  return (
    <Card className="border border-white/10 bg-[#0c1116] text-[#f2f7f5] rounded-2xl overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-white/10 px-5 py-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-white tracking-tight">{title}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono">Field operator readiness and live status</p>
          </div>
        </div>
        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-xs px-2.5 py-0.5">
          {squads.filter((s) => s.status !== "Standby").length} Active in Field
        </Badge>
      </CardHeader>

      <CardContent className="p-5 divide-y divide-white/5">
        {squads.map((sq) => (
          <div key={sq.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">{sq.name}</h4>
                  <Badge className={`text-[10px] px-2 py-0.2 border ${getStatusClasses(sq.status)}`}>
                    {sq.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {sq.sector} · {sq.personnel} Operatives
                </p>
              </div>

              {sq.status === "Standby" ? (
                <Button
                  size="sm"
                  onClick={() => handleDeploy(sq.id)}
                  className="h-7 text-[10px] px-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
                >
                  <Navigation className="h-3 w-3 mr-1" />
                  Dispatch
                </Button>
              ) : (
                <span className="text-xs font-mono text-cyan-400/90 truncate max-w-[150px]">
                  {sq.mission}
                </span>
              )}
            </div>

            {/* Health Bar */}
            <div>
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-1">
                <span>Unit Integrity</span>
                <span className="text-white font-bold">{sq.healthScore}%</span>
              </div>
              <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${sq.healthScore}%` }}
                  transition={{ duration: 0.6 }}
                  className={`h-full rounded-full ${getHealthColor(sq.healthScore)}`}
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
