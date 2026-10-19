import React, { useState } from "react";
import { motion } from "framer-motion";
import { Map as MapIcon, Crosshair, Navigation, Layers, Radio } from "lucide-react";
import { Card } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";

interface Marker {
    id: string;
    lat: number;
    lng: number;
    title: string;
    status: "active" | "warning" | "error" | "offline";
}

interface TacticalMapControlProps {
    center?: { lat: number; lng: number };
    zoom?: number;
    markers?: Marker[];
}

export default function TacticalMapControl({
    center = { lat: 34.0522, lng: -118.2437 },
    zoom = 12,
    markers = [
        { id: "1", lat: 34.0522, lng: -118.2437, title: "HQ Delta", status: "active" },
        { id: "2", lat: 34.0622, lng: -118.2537, title: "Unit 09", status: "warning" }
    ]
}: TacticalMapControlProps) {
    const [activeLayer, setActiveLayer] = useState("tactical");

    return (
        <Card className="relative h-[500px] w-full bg-background border-foreground/10 overflow-hidden shadow-2xl rounded-2xl group">
            {/* Mock Map Background (Grid Pattern) */}
            <div className="absolute inset-0 bg-background overflow-hidden">
                {/* The grid is drawn here rather than through a `tactical-grid`
                    class. That class lives in client/src/index.css — the platform's
                    stylesheet — and this block is shipped into forged apps that do
                    not load it, so the pattern silently resolved to nothing and the
                    map read as a map that had failed to load. currentColor keeps it
                    theme-aware instead of the stylesheet's hardcoded #333. */}
                <div
                    className="absolute inset-0 opacity-20 text-foreground"
                    style={{
                        backgroundImage:
                            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
                        backgroundSize: "40px 40px",
                    }}
                />
                
                {/* Radar Scan Effect */}
                <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 4, opacity: [0, 0.2, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-emerald-500/30 rounded-full"
                />

                {/* Markers */}
                {markers.map((marker, i) => (
                    <motion.div
                        key={marker.id}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.2 }}
                        className="absolute flex flex-col items-center gap-1 -translate-x-1/2 -translate-y-1/2"
                        // Positioned directly. These were custom properties read by
                        // .dynamic-left/.dynamic-top, which are also platform-only
                        // classes: inside a forged app every marker lost its offset
                        // and collapsed onto the container's top-left corner.
                        style={{
                            left: `${50 + (marker.lng - center.lng) * 500}%`,
                            top: `${50 - (marker.lat - center.lat) * 500}%`,
                        }}
                    >
                        <div className="relative">
                            <div className={`w-3 h-3 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                marker.status === 'active' ? 'bg-emerald-500' : 
                                marker.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
                            }`} />
                            <div className={`absolute inset-0 rounded-full animate-ping opacity-50 ${
                                marker.status === 'active' ? 'bg-emerald-500' : 
                                marker.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
                            }`} />
                        </div>
                        <div className="bg-background/80 backdrop-blur-md border border-foreground/10 px-2 py-0.5 rounded text-[9px] text-foreground/80 font-mono tracking-tighter whitespace-nowrap">
                            {marker.title}
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Controls Overlay */}
            <div className="absolute top-4 left-4 flex flex-col gap-2">
                <Button variant="secondary" size="icon" className="bg-background/60 backdrop-blur-xl border-foreground/10 text-foreground hover:bg-background/80">
                    <Crosshair className="w-4 h-4" />
                </Button>
                <Button variant="secondary" size="icon" className="bg-background/60 backdrop-blur-xl border-foreground/10 text-foreground hover:bg-background/80">
                    <Navigation className="w-4 h-4" />
                </Button>
            </div>

            <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                <Badge variant="outline" className="bg-background/60 backdrop-blur-xl border-emerald-500/50 text-emerald-400 font-mono gap-1.5 px-3 py-1">
                    <Radio className="w-3 h-3 animate-pulse" />
                    LIVE TELEMETRY
                </Badge>
                <div className="flex bg-background/60 backdrop-blur-xl border border-foreground/10 rounded-lg p-1 overflow-hidden">
                    <Button 
                        onClick={() => setActiveLayer("tactical")}
                        className={`h-7 px-3 text-[10px] rounded-md transition-all ${activeLayer === "tactical" ? "bg-foreground/10 text-foreground" : "bg-transparent text-foreground/40 hover:text-foreground/60"}`}
                    >
                        TACTICAL
                    </Button>
                    <Button 
                        onClick={() => setActiveLayer("sat")}
                        className={`h-7 px-3 text-[10px] rounded-md transition-all ${activeLayer === "sat" ? "bg-foreground/10 text-foreground" : "bg-transparent text-foreground/40 hover:text-foreground/60"}`}
                    >
                        SATELLITE
                    </Button>
                </div>
            </div>

            {/* Map Info Footer */}
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none">
                <div className="bg-background/60 backdrop-blur-xl border border-foreground/10 p-3 rounded-xl pointer-events-auto">
                    <div className="flex items-center gap-4 text-foreground/60 font-mono text-[10px]">
                        <div>LAT: {center.lat.toFixed(4)}</div>
                        <div>LNG: {center.lng.toFixed(4)}</div>
                        <div>ZOOM: {zoom}x</div>
                    </div>
                </div>
                <div className="flex gap-2 pointer-events-auto">
                    <Button variant="secondary" size="sm" className="bg-background/60 backdrop-blur-xl border-foreground/10 text-foreground/60 hover:text-foreground gap-2 h-8 px-3 text-[10px]">
                        <Layers className="w-3.5 h-3.5" />
                        LAYERS
                    </Button>
                </div>
            </div>

            {/* Scanner Overlay Line */}
            <motion.div 
                animate={{ top: ["0%", "100%", "0%"] }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="absolute left-0 right-0 h-[1px] bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.5)] z-10"
            />
        </Card>
    );
};
