import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Clock, Radio, CheckCircle2, RefreshCw, ArrowUpRight, Search, ShieldAlert, Zap } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export interface RescueIncident {
  id: string;
  target: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: "Waiting" | "In-Progress" | "Enroute" | "Resolved";
  slaMinutes: number;
  address: string;
  assignedSquad?: string;
}

const DEFAULT_RESCUES: RescueIncident[] = [
  {
    id: "RSC-001",
    target: "Sector 7 Data Node 4",
    priority: "Critical",
    status: "In-Progress",
    slaMinutes: 12,
    address: "450 S Grand Ave, Sector 7",
    assignedSquad: "Squad Alpha"
  },
  {
    id: "RSC-002",
    target: "Central Core Buffer",
    priority: "Medium",
    status: "Waiting",
    slaMinutes: 45,
    address: "800 Wilshire Blvd, Sector 3"
  },
  {
    id: "RSC-003",
    target: "Substation Delta Transformer",
    priority: "High",
    status: "Enroute",
    slaMinutes: 18,
    address: "1200 S Hope St, Sector 5",
    assignedSquad: "Squad Bravo"
  },
  {
    id: "RSC-004",
    target: "Thermal Sensor Cluster 9",
    priority: "Low",
    status: "Waiting",
    slaMinutes: 90,
    address: "333 S Figueroa, Sector 2"
  }
];

interface TacticalDispatchQueueBlockProps {
  collection?: string;
  title?: string;
  rescues?: RescueIncident[];
  onDeploy?: (id: string) => void;
  onAssign?: (id: string) => void;
  onComplete?: (id: string) => void;
}

export default function TacticalDispatchQueueBlock({
  title = "Priority Rescues Triage",
  rescues: initialRescues = DEFAULT_RESCUES,
  onDeploy,
  onAssign,
  onComplete
}: TacticalDispatchQueueBlockProps) {
  const [items, setItems] = useState<RescueIncident[]>(initialRescues);
  const [filter, setFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const handleAction = (id: string, newStatus: RescueIncident["status"]) => {
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
    );
    if (newStatus === "In-Progress") onDeploy?.(id);
    else if (newStatus === "Enroute") onAssign?.(id);
    else if (newStatus === "Resolved") onComplete?.(id);
  };

  const filtered = items.filter((r) => {
    if (filter !== "ALL" && r.priority.toUpperCase() !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return r.target.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    }
    return true;
  });

  const getPriorityClasses = (p: RescueIncident["priority"]) => {
    switch (p) {
      case "Critical": return "bg-rose-500/20 text-rose-300 border-rose-500/40";
      case "High": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "Medium": return "bg-sky-500/20 text-sky-300 border-sky-500/40";
      default: return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    }
  };

  const getStatusClasses = (s: RescueIncident["status"]) => {
    switch (s) {
      case "In-Progress": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse";
      case "Enroute": return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
      case "Resolved": return "bg-slate-500/20 text-muted-foreground border-slate-500/40 line-through";
      default: return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
    }
  };

  return (
    <Card className="border border-white/10 bg-[#0c1116] text-[#f2f7f5] rounded-2xl overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-white/10 px-5 py-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-foreground tracking-tight">{title}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono">Real-time incident dispatch and SLA monitoring</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter incidents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-background/40 border border-foreground/10 rounded-lg text-xs text-foreground focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-white/5">
            {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                  filter === p ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <AnimatePresence>
            {filtered.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="p-4 rounded-xl bg-[#10171d] border border-white/5 hover:border-white/15 transition-all flex flex-col justify-between gap-3 group"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-bold text-cyan-400 tracking-wider">{item.id}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge className={`text-[10px] px-2 py-0.5 border ${getPriorityClasses(item.priority)}`}>
                        {item.priority}
                      </Badge>
                      <Badge className={`text-[10px] px-2 py-0.5 border ${getStatusClasses(item.status)}`}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground group-hover:text-cyan-300 transition-colors">
                    {item.target}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 font-mono">
                    <span>{item.address}</span>
                  </p>
                </div>

                <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>SLA: {item.slaMinutes}m</span>
                    {item.assignedSquad && (
                      <span className="text-cyan-400/90 ml-1">· {item.assignedSquad}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.status !== "Resolved" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(item.id, "In-Progress")}
                          className="h-7 text-[10px] px-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          Deploy
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(item.id, "Resolved")}
                          className="h-7 text-[10px] px-2 bg-white/5 hover:bg-white/10 text-white/80 border-white/10"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Complete
                        </Button>
                      </>
                    ) : (
                      <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Resolved
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
