import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Activity,
    AlertTriangle,
    Compass,
    Eye,
    Layers,
    MapPin,
    Navigation,
    Radio,
    RefreshCw,
    Shield,
    Zap
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { cn } from "@/lib/utils.js";

export interface SpatialSignalMarker {
    id: string;
    lat: number;
    lng: number;
    title: string;
    type: "vehicle" | "anomaly" | "asset" | "squad";
    severity?: "Low" | "Medium" | "High" | "Critical";
    h3Index?: string;
    speedKmh?: number;
    status?: string;
}

export interface PlatformSpatialSignalBlockProps {
    title?: string;
    description?: string;
    center?: { lat: number; lng: number };
    showH3Mesh?: boolean;
    filterSeverity?: "All" | "High+" | "CriticalOnly";
    autoPollMs?: number;
    className?: string;
}

// Endpoint this block reads. NOTE: as of writing nothing serves it — the block
// therefore renders SAMPLE_SIGNALS and labels itself "Sample data" until a real
// feed exists. Do not remove that label without wiring the endpoint.
const SIGNALS_ENDPOINT = "/api/spatial/signals";

// Illustrative markers for preview/empty state. NOT telemetry.
const SAMPLE_SIGNALS: SpatialSignalMarker[] = [
    {
        id: "SIG-8842",
        lat: 34.0522,
        lng: -118.2437,
        title: "GEN-8842-X Overheat",
        type: "anomaly",
        severity: "Critical",
        h3Index: "8829a54f59fffff",
        status: "Active Alert"
    },
    {
        id: "SQD-04",
        lat: 34.0560,
        lng: -118.2490,
        title: "Squad 4 Rapid Unit",
        type: "squad",
        severity: "Low",
        speedKmh: 42,
        h3Index: "8829a54f5bfffff",
        status: "Enroute"
    },
    {
        id: "AST-9102",
        lat: 34.0480,
        lng: -118.2390,
        title: "Buffer Station Beta",
        type: "asset",
        severity: "Medium",
        h3Index: "8829a54f51fffff",
        status: "Operational"
    }
];

export default function PlatformSpatialSignalBlock({
    title = "Spatial Signal Intelligence",
    description = "Live Eulerian Hexagonal Telemetry & Field Operations",
    center = { lat: 34.0522, lng: -118.2437 },
    showH3Mesh = true,
    filterSeverity = "All",
    autoPollMs = 5000,
    className
}: PlatformSpatialSignalBlockProps) {
    const [signals, setSignals] = useState<SpatialSignalMarker[]>(SAMPLE_SIGNALS);
    const [selectedSignal, setSelectedSignal] = useState<SpatialSignalMarker | null>(null);
    const [meshActive, setMeshActive] = useState(showH3Mesh);
    const [isRefreshing, setIsRefreshing] = useState(false);
    // `null` until a fetch has actually succeeded. Never advance this on a failed
    // poll: a ticking "Synced HH:MM:SS" over stale sample data is a live-ness claim
    // the component cannot back up.
    const [lastSync, setLastSync] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);

    const refreshSignals = async () => {
        setIsRefreshing(true);
        try {
            const res = await fetch(SIGNALS_ENDPOINT);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error("Unexpected payload");
            setSignals(data);
            setIsLive(true);
            setLastSync(new Date().toLocaleTimeString());
        } catch {
            // Fall back to sample markers, but SAY SO. Silently keeping the samples
            // while the header reads "live" is how an operator ends up trusting
            // three hardcoded pins during an incident.
            setSignals(SAMPLE_SIGNALS);
            setIsLive(false);
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        void refreshSignals();
        if (!autoPollMs) return;
        const interval = setInterval(refreshSignals, autoPollMs);
        return () => clearInterval(interval);
    }, [autoPollMs]);

    const filteredSignals = signals.filter(s => {
        if (filterSeverity === "CriticalOnly") return s.severity === "Critical";
        if (filterSeverity === "High+") return s.severity === "High" || s.severity === "Critical";
        return true;
    });

    return (
        <Card className={cn("relative w-full overflow-hidden border-border/40 bg-card/60 backdrop-blur-2xl rounded-2xl shadow-xl", className)}>
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/30 pb-3">
                <div>
                    <CardTitle className="text-base font-black uppercase tracking-wider flex items-center gap-2">
                        {/* Green + pulsing means a fetch actually succeeded. */}
                        <Radio className={cn("w-4 h-4", isLive ? "text-emerald-400 animate-pulse" : "text-muted-foreground/50")} />
                        {title}
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">
                        {description}
                        {isLive && lastSync ? (
                            <> • Synced {lastSync}</>
                        ) : (
                            <> • <span className="font-semibold text-amber-500" data-testid="spatial-sample-data">Sample data — no live feed</span></>
                        )}
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMeshActive(!meshActive)}
                        className={cn("h-8 text-xs font-mono gap-1.5", meshActive ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/10" : "text-muted-foreground")}
                    >
                        <Layers className="w-3.5 h-3.5" />
                        H3 HEX MESH
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={refreshSignals}
                        disabled={isRefreshing}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="p-0 relative h-[420px] bg-background overflow-hidden">{/* theme-lint-ignore: fixed-dark radar canvas — the radial-gradient hex pattern and marker overlays are drawn onto it */}
                {/* Tactical Radar / Satellite Hex Pattern */}
                <div className="absolute inset-0 opacity-25 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />
                
                {meshActive && (
                    <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-500/20 via-transparent to-transparent" />
                )}

                {/* Radar Sweep Effect */}
                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 3.5, opacity: [0, 0.25, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-cyan-400/40 rounded-full pointer-events-none"
                />

                {/* Live Markers */}
                {filteredSignals.map((signal, idx) => {
                    const offsetX = 50 + (signal.lng - center.lng) * 800;
                    const offsetY = 50 - (signal.lat - center.lat) * 800;
                    const isSelected = selectedSignal?.id === signal.id;

                    return (
                        <motion.div
                            key={signal.id}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: idx * 0.1 }}
                            onClick={() => setSelectedSignal(signal)}
                            className="absolute cursor-pointer -translate-x-1/2 -translate-y-1/2 z-10 group"
                            style={{ left: `${Math.max(8, Math.min(92, offsetX))}%`, top: `${Math.max(8, Math.min(92, offsetY))}%` }}
                        >
                            <div className="relative flex flex-col items-center">
                                <div className={cn(
                                    "w-4 h-4 rounded-full flex items-center justify-center transition-all shadow-lg",
                                    signal.severity === "Critical" ? "bg-rose-500 text-white ring-4 ring-rose-500/20" :
                                    signal.severity === "High" ? "bg-amber-500 text-white ring-4 ring-amber-500/20" :
                                    signal.type === "squad" ? "bg-emerald-500 text-white ring-4 ring-emerald-500/20" :
                                    "bg-cyan-500 text-white ring-4 ring-cyan-500/20",
                                    isSelected && "scale-125 ring-8"
                                )}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />{/* theme-lint-ignore: pulse dot on a saturated severity marker */}
                                </div>
                                <div className="mt-1 px-1.5 py-0.5 rounded bg-card/90 border border-border text-[10px] font-mono text-foreground/85 whitespace-nowrap shadow-md">
                                    {signal.title}
                                </div>
                            </div>
                        </motion.div>
                    );
                })}

                {/* Selected Signal Detail Overlay */}
                <AnimatePresence>
                    {selectedSignal && (
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 15 }}
                            className="absolute bottom-4 left-4 right-4 bg-card/95 border border-border/80 backdrop-blur-xl p-4 rounded-xl shadow-2xl z-20"
                        >
                            <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Badge className={cn(
                                            "text-[10px] font-black uppercase",
                                            selectedSignal.severity === "Critical" ? "bg-rose-500/20 text-rose-400 border-rose-500/40" :
                                            selectedSignal.severity === "High" ? "bg-amber-500/20 text-amber-400 border-amber-500/40" :
                                            "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                        )}>
                                            {selectedSignal.severity || selectedSignal.type}
                                        </Badge>
                                        <h4 className="text-sm font-bold text-white">{selectedSignal.title}</h4>{/* theme-lint-ignore: panel is bg-card/95, dark in both themes */}
                                    </div>
                                    <p className="text-xs text-muted-foreground flex items-center gap-3 font-mono">
                                        <span>ID: {selectedSignal.id}</span>
                                        {selectedSignal.h3Index && <span>H3: {selectedSignal.h3Index}</span>}
                                        {selectedSignal.speedKmh !== undefined && <span>Speed: {selectedSignal.speedKmh} km/h</span>}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedSignal(null)}
                                    className={"text-xs text-muted-foreground hover:text-white h-7 px-2" /* theme-lint-ignore: panel is bg-card/95, dark in both themes */}
                                >
                                    Dismiss
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardContent>
        </Card>
    );
}
