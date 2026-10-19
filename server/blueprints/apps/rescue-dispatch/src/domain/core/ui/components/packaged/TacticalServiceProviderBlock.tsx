import React, { useState } from "react";
import { Truck, Clock, ShieldCheck, PhoneCall, CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export interface ServiceProviderItem {
  id: string;
  name: string;
  specialty: string;
  status: "Available" | "Enroute" | "Standby";
  etaMinutes: number;
  contact: string;
  rating: number;
}

const DEFAULT_PROVIDERS: ServiceProviderItem[] = [
  {
    id: "PRO-ALPHA",
    name: "Apex Field Response",
    specialty: "High-Voltage & Power Grid",
    status: "Available",
    etaMinutes: 4,
    contact: "+1 (555) 019-2834",
    rating: 4.9
  },
  {
    id: "PRO-BRAVO",
    name: "Titan Heavy Recovery",
    specialty: "Structural & Heavy Rigging",
    status: "Enroute",
    etaMinutes: 12,
    contact: "+1 (555) 018-9943",
    rating: 4.8
  },
  {
    id: "PRO-CHARLIE",
    name: "Aero Drone Surveillance",
    specialty: "Thermal Aerial Survey",
    status: "Available",
    etaMinutes: 2,
    contact: "+1 (555) 017-4821",
    rating: 5.0
  }
];

interface TacticalServiceProviderBlockProps {
  title?: string;
  providers?: ServiceProviderItem[];
  onContactProvider?: (id: string) => void;
}

export default function TacticalServiceProviderBlock({
  title = "Service Provider Network",
  providers: initialProviders = DEFAULT_PROVIDERS,
  onContactProvider
}: TacticalServiceProviderBlockProps) {
  const [providers, setProviders] = useState<ServiceProviderItem[]>(initialProviders);

  const getStatusClasses = (s: ServiceProviderItem["status"]) => {
    switch (s) {
      case "Available": return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
      case "Enroute": return "bg-indigo-500/20 text-indigo-300 border-indigo-500/40";
      default: return "bg-slate-500/20 text-slate-300 border-slate-500/40";
    }
  };

  return (
    <Card className="border border-white/10 bg-[#0c1116] text-[#f2f7f5] rounded-2xl overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-white/10 px-5 py-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-white tracking-tight">{title}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono">External emergency and utility contractor roster</p>
          </div>
        </div>
        <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-xs px-2.5 py-0.5 font-mono">
          3 On-Call
        </Badge>
      </CardHeader>

      <CardContent className="p-5 divide-y divide-white/5">
        {providers.map((p) => (
          <div key={p.id} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                <Badge className={`text-[10px] px-2 py-0.2 border ${getStatusClasses(p.status)}`}>
                  {p.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {p.specialty} · ★ {p.rating.toFixed(1)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right font-mono">
                <span className="text-[10px] text-muted-foreground block">EST. ARRIVAL</span>
                <span className="text-xs font-bold text-emerald-400 flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3" /> {p.etaMinutes} mins
                </span>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => onContactProvider?.(p.id)}
                className="h-8 text-xs px-3 bg-white/5 hover:bg-white/10 text-white border-white/10"
              >
                <PhoneCall className="h-3 w-3 mr-1 text-cyan-400" />
                Dispatch
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
