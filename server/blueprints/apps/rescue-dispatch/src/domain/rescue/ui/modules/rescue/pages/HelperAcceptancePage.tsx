import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { MapPin, Navigation, Check, X, ShieldAlert, Loader2, Phone, Clock, Route, Wrench, MessageSquare, Bot, Sparkles } from "lucide-react";
import { RescueMap } from "@domain-ui/rescue/ui/modules/rescue";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface DispatchItem {
    id: string;
    serviceType: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    address: string;
    distanceKm: number;
    estMinutes: number;
    compensation: string;
    status: string;
    serialNumber?: string;
}

const MOCK_PROVIDER_DISPATCHES: DispatchItem[] = [
    {
        id: "RSC-001",
        serviceType: "Generator Overheat",
        priority: "Critical",
        address: "200 N Spring St, Los Angeles, CA",
        distanceKm: 4.2,
        estMinutes: 8,
        compensation: "$120.00",
        status: "Enroute",
        serialNumber: "GEN-8842-X"
    },
    {
        id: "RSC-002",
        serviceType: "Core Buffer Failure",
        priority: "Medium",
        address: "450 S Grand Ave, Los Angeles, CA",
        distanceKm: 6.8,
        estMinutes: 18,
        compensation: "$85.00",
        status: "Queued",
        serialNumber: "BUF-9102-Y"
    }
];

export default function HelperAcceptancePage() {
    const [, params] = useRoute("/h/:token");
    const token = params?.token;
    const [status, setStatus] = useState<'IDLE' | 'ACCEPTING' | 'ACCEPTED' | 'REJECTED'>('IDLE');
    const [dispatches, setDispatches] = useState<DispatchItem[]>(MOCK_PROVIDER_DISPATCHES);
    const [activeTab, setActiveTab] = useState<'DISPATCHES' | 'COPILOT'>('DISPATCHES');
    const [copilotQuery, setCopilotQuery] = useState('');
    const [copilotLogs, setCopilotLogs] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([
        { role: 'agent', text: 'Apex Response Co-Pilot online. Active capacity 2/3. Ready for route optimization or tech spec lookups.' }
    ]);
    const [isOptimizing, setIsOptimizing] = useState(false);

    const { data: session, isLoading } = useQuery<any>({
        queryKey: [`/api/rescue/resolve-token/${token}`],
        enabled: !!token,
        initialData: {
            id: 29,
            serviceType: 'TOW',
            status: 'REQUESTED',
            requestedAt: new Date().toISOString(),
            userLocation: {
                lat: 34.0522,
                lng: -118.2437,
                address: "200 N Spring St, Los Angeles, CA 90012"
            },
            compensation: "$120.00",
            distanceKm: 4.2
        }
    });

    const handleOptimizeRoute = () => {
        setIsOptimizing(true);
        setTimeout(() => {
            setCopilotLogs(prev => [
                ...prev,
                { role: 'user', text: 'Optimize travel route for active dispatches RSC-001 and RSC-002.' },
                { role: 'agent', text: '⚡ Route Optimized: 1. RSC-001 (Site 4 - 4.2km, 8m ETA) → 2. RSC-002 (Grand Ave - 6.8km, 18m ETA). Est. total savings: 14 mins.' }
            ]);
            setIsOptimizing(false);
            setActiveTab('COPILOT');
        }, 1200);
    };

    const handleSendCopilotQuery = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!copilotQuery.trim()) return;

        const userMsg = copilotQuery;
        setCopilotQuery('');
        setCopilotLogs(prev => [...prev, { role: 'user', text: userMsg }]);

        setTimeout(() => {
            let responseText = "Co-Pilot: Logged technician update. Telemetry & Ops Control notified.";
            if (userMsg.toLowerCase().includes('spec') || userMsg.toLowerCase().includes('gen-8842-x')) {
                responseText = "📄 Asset Specs [GEN-8842-X]: 250kW Commercial Diesel Generator. Oil Temp Spec: <95°C. Verified Active Maintenance Contract #MC-8842.";
            } else if (userMsg.toLowerCase().includes('route') || userMsg.toLowerCase().includes('optimize')) {
                responseText = "⚡ Route Sequence: 1. 200 N Spring St (ETA 8m) → 2. 450 S Grand Ave (ETA 22m). Capacity load optimal (2/3).";
            } else if (userMsg.toLowerCase().includes('part') || userMsg.toLowerCase().includes('coolant')) {
                responseText = "🔧 Parts Check: Coolant Pump CP-900 is IN STOCK at Apex Main Depot (Bin B-14).";
            }

            setCopilotLogs(prev => [...prev, { role: 'agent', text: responseText }]);
        }, 800);
    };

    return (
        <div className="min-h-screen bg-background flex flex-col p-6 space-y-6 relative overflow-hidden font-sans">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary),0.05),transparent_70%)] pointer-events-none" />
            <div className="cinematic-grid absolute inset-0 opacity-10 pointer-events-none" />
            <div className="scanline-overlay absolute inset-0 pointer-events-none opacity-[0.02]" />

            <header className="flex items-center justify-between pb-6 border-b border-foreground/5 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                        <ShieldAlert className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                        <span className="text-xs font-black text-foreground tracking-[0.2em] uppercase italic">Apex Field <span className="text-primary italic">Response</span></span>
                        <div className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Provider Capacity: 2 / 3 Active
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        size="sm" 
                        variant={activeTab === 'DISPATCHES' ? 'default' : 'outline'}
                        className="h-8 rounded-xl text-[10px] font-black uppercase tracking-wider"
                        onClick={() => setActiveTab('DISPATCHES')}
                    >
                        Dispatches (2)
                    </Button>
                    <Button 
                        size="sm" 
                        variant={activeTab === 'COPILOT' ? 'default' : 'outline'}
                        className="h-8 rounded-xl text-[10px] font-black uppercase tracking-wider gap-1"
                        onClick={() => setActiveTab('COPILOT')}
                    >
                        <Bot className="h-3.5 w-3.5 text-emerald-400" /> AI Co-Pilot
                    </Button>
                </div>
            </header>

            <main className="flex-1 space-y-6 relative z-10">
                {activeTab === 'DISPATCHES' ? (
                    <>
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-black text-foreground uppercase tracking-widest flex items-center gap-2">
                                <Navigation className="h-4 w-4 text-primary" /> Active Field Dispatch Queue
                            </h2>
                            <Button 
                                size="sm" 
                                className="h-8 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wider gap-1.5 rounded-xl"
                                onClick={handleOptimizeRoute}
                                disabled={isOptimizing}
                            >
                                {isOptimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
                                Optimize Route
                            </Button>
                        </div>

                        <div className="space-y-4">
                            {dispatches.map((item) => (
                                <motion.div 
                                    key={item.id}
                                    initial={{ y: 15, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    className="glass-panel-deep border-foreground/10 rounded-[2rem] p-6 space-y-4 bg-foreground/[0.02] backdrop-blur-3xl hover:border-primary/30 transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Badge className="bg-primary/20 text-primary border-primary/40 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-md">
                                                {item.id}
                                            </Badge>
                                            <Badge variant="outline" className={cn("text-[9px] font-black uppercase px-2.5 py-0.5 rounded-md", item.priority === 'Critical' ? 'border-rose-500/50 text-rose-400 bg-rose-500/10' : 'border-amber-500/50 text-amber-400 bg-amber-500/10')}>
                                                {item.priority}
                                            </Badge>
                                        </div>
                                        <span className="text-emerald-400 text-xs font-black italic">{item.compensation}</span>
                                    </div>

                                    <div>
                                        <h3 className="text-lg font-black text-foreground uppercase italic tracking-tight">{item.serviceType}</h3>
                                        <div className="flex items-center gap-2 text-[11px] text-foreground/50 font-bold uppercase tracking-wider mt-1">
                                            <MapPin className="h-3.5 w-3.5 text-primary" /> {item.address}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] font-bold text-foreground/40 pt-2 border-t border-foreground/5">
                                        <span>Serial: <strong className="text-foreground">{item.serialNumber}</strong></span>
                                        <span>ETA: <strong className="text-emerald-400">{item.estMinutes}m</strong></span>
                                        <span>Distance: <strong className="text-foreground">{item.distanceKm}km</strong></span>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </>
                ) : (
                    <Card className="border-foreground/10 bg-foreground/[0.02] backdrop-blur-3xl rounded-[2.5rem] overflow-hidden">
                        <CardHeader className="border-b border-foreground/5 pb-4">
                            <CardTitle className="text-sm font-black text-foreground uppercase tracking-widest flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-emerald-400" /> Field Technician AI Co-Pilot
                            </CardTitle>
                            <CardDescription className="text-[11px] text-foreground/40 uppercase tracking-wider">
                                Ask for asset schematics, route pacing, or parts availability
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="h-64 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                                {copilotLogs.map((log, index) => (
                                    <div 
                                        key={index}
                                        className={cn(
                                            "p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%]",
                                            log.role === 'user' 
                                                ? "ml-auto bg-primary/20 text-foreground border border-primary/30 font-medium" 
                                                : "mr-auto bg-foreground/5 text-foreground/80 border border-foreground/10"
                                        )}
                                    >
                                        {log.text}
                                    </div>
                                ))}
                            </div>

                            <form onSubmit={handleSendCopilotQuery} className="flex gap-2 pt-2 border-t border-foreground/5">
                                <input 
                                    type="text"
                                    value={copilotQuery}
                                    onChange={(e) => setCopilotQuery(e.target.value)}
                                    placeholder="Ask Co-Pilot (e.g. 'specs for GEN-8842-X' or 'optimize route')..."
                                    className="flex-1 bg-background/60 border border-foreground/10 rounded-xl px-4 py-2.5 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
                                />
                                <Button type="submit" size="sm" className="rounded-xl h-10 bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider px-4">
                                    Send
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                )}
            </main>

            <footer className="grid grid-cols-2 gap-4 pt-4 relative z-10 border-t border-foreground/5">
                <Button 
                    variant="outline" 
                    className="h-12 rounded-2xl border-foreground/10 bg-foreground/[0.02] text-foreground/60 font-black uppercase tracking-widest text-[10px] hover:bg-rose-500/10 hover:text-rose-400 transition-all" 
                    onClick={() => setStatus('REJECTED')}
                >
                    <X className="h-4 w-4 mr-1.5" /> De-escalate
                </Button>
                <Button 
                    className="h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-background font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 transition-all" 
                    onClick={() => setStatus('ACCEPTED')}
                >
                    <Check className="h-4 w-4 mr-1.5" /> Accept Missions (2)
                </Button>
            </footer>
        </div>
    );
}

