
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { MapPin, Navigation, Clock, ShieldCheck, Map as MapIcon, Loader2, Phone, Maximize2, Activity, Zap, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@domain-ui/core/ui/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import styles from "./RescueStatusCard.module.css";
import { RescueMap } from './RescueMap.js';

interface RescueStatusCardProps {
    sessionId: number;
}

export function RescueStatusCard({ sessionId }: RescueStatusCardProps) {
    const { data: session, isLoading, error } = useQuery<any>({
        queryKey: [`/api/rescue/sessions/${sessionId}`],
        enabled: !!sessionId,
        refetchInterval: 5000,
    });

    // H3 risk field for the map overlay. Derived from the incident's fixed
    // location and severity, so unlike the session itself it does not change
    // every few seconds — fetched once per session rather than on the 5s poll.
    const { data: riskField } = useQuery<{ hexCells?: Array<{ h3Index: string; risk: number }> }>({
        queryKey: [`/api/rescue/sessions/${sessionId}/risk-field`],
        enabled: !!sessionId,
        staleTime: Infinity,
        retry: false,
    });

    const queryClient = useQueryClient();

    const cancelMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/rescue/sessions/${sessionId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: "User cancelled from status card" })
            });
            if (!res.ok) throw new Error("Failed to cancel");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/rescue/sessions/${sessionId}`] });
        },
        onError: (err: Error) => {
            console.error('[RescueStatusCard] Cancel failed:', err.message);
        }
    });

    const [verifying, setVerifying] = useState(false);
    const [pin, setPin] = useState("");
    const [selectedRating, setSelectedRating] = useState(5);
    const [ratingSubmitted, setRatingSubmitted] = useState(false);

    // Real-time Event Stream Connection
    useEffect(() => {
        if (!sessionId) return;

        const eventSource = new EventSource(`/api/rescue/sessions/${sessionId}/stream`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("[RescueStatus] Real-time event received:", data.eventType);
                queryClient.invalidateQueries({ queryKey: [`/api/rescue/sessions/${sessionId}`] });
            } catch (err) {
                console.error("[RescueStatus] SSE parse error:", err);
            }
        };

        eventSource.onerror = () => {
            console.warn("[RescueStatus] SSE connection lost — will auto-reconnect");
        };

        return () => {
            eventSource.close();
        };
    }, [sessionId, queryClient]);

    const verifyMutation = useMutation({
        mutationFn: async (code: string) => {
            const res = await fetch(`/api/rescue/sessions/${sessionId}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            if (!res.ok) throw new Error(`Verification failed (${res.status})`);
            const data = await res.json();
            if (!data.success) throw new Error("Invalid Code");
            return data;
        },
        onSuccess: () => {
            setVerifying(false);
            setPin("");
            queryClient.invalidateQueries({ queryKey: [`/api/rescue/sessions/${sessionId}`] });
        }
    });

    if (isLoading) {
        return (
            <Card className="w-full max-w-md glass-panel-deep border-foreground/10 bg-background/40 shadow-2xl rounded-[2.5rem] overflow-hidden">
                <CardContent className="p-12 flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                        <Loader2 className="h-10 w-10 animate-spin text-primary relative z-10" />
                        <div className="absolute inset-0 bg-primary/20 blur-xl animate-pulse" />
                    </div>
                    <div className="text-center space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-primary animate-pulse">Initializing Stream</p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-40">Connecting to Responder Core...</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error || !session) {
        return (
            <Card className="w-full max-w-md glass-panel-deep border-foreground/10 bg-background/40 shadow-2xl rounded-[2.5rem] overflow-hidden">
                <CardContent className="p-12 flex flex-col items-center justify-center space-y-4 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400">Stream Unavailable</p>
                    <p className="text-[9px] text-foreground/30">Could not load session data. Please refresh or contact support.</p>
                </CardContent>
            </Card>
        );
    }

    const statusColors: Record<string, string> = {
        'REQUESTED': 'border-amber-500/30 text-amber-400 bg-amber-500/10',
        'ACCEPTED': 'border-blue-500/30 text-blue-400 bg-blue-500/10',
        'ENROUTE': 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10',
        'ARRIVED': 'border-green-500/30 text-green-400 bg-green-500/10',
        'COMPLETED': 'border-zinc-500/30 text-muted-foreground bg-zinc-500/10',
        'FAILED': 'border-red-500/30 text-red-400 bg-red-500/10',
        'CANCELLED': 'border-zinc-500/30 text-muted-foreground bg-zinc-500/20',
    };

    const statusLabels: Record<string, string> = {
        'REQUESTED': 'Searching for Providers',
        'ACCEPTED': 'Provider Assigned',
        'ENROUTE': 'Provider En Route',
        'ARRIVED': 'Provider Arrived',
        'COMPLETED': 'Dispatch Completed',
        'FAILED': 'Dispatch Failed',
        'CANCELLED': 'Dispatch Cancelled',
    };

    const mapCenter = {
        lat: session.userLocation?.lat || 40.7484,
        lng: session.userLocation?.lng || -73.9857
    };

    const mapMarkers = [
        {
            id: 'user',
            lat: mapCenter.lat,
            lng: mapCenter.lng,
            type: 'user' as const,
            label: 'Requestor'
        },
        ...(session.helperLocation ? [{
            id: 'helper',
            lat: session.helperLocation.lat,
            lng: session.helperLocation.lng,
            type: 'helper' as const,
            label: session.providerName || 'Provider'
        }] : [])
    ];

    return (
        <Card data-testid="rescue-status-card" className="w-full max-w-md glass-panel-deep border-foreground/10 bg-background/40 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.6)] rounded-[2.5rem] overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-30" />

            <CardHeader className="p-8 pb-4 border-b border-foreground/5 bg-foreground/[0.02]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={cn(
                            "p-2.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10",
                            session.status === 'ENROUTE' && "animate-pulse"
                        )}>
                            <Navigation className={cn("h-5 w-5", session.status === 'ENROUTE' ? "text-indigo-400" : "text-primary")} />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-black tracking-tighter uppercase italic text-foreground leading-none">Service Dispatch</CardTitle>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                                <Activity size={10} className="text-emerald-500 animate-pulse" />
                                Real-time Telemetry
                            </p>
                        </div>
                    </div>
                    <Badge data-testid="rescue-status-badge" variant="outline" className={cn("px-4 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-full border-2", statusColors[session.status] || 'border-foreground/20')}>
                        {statusLabels[session.status] || session.status}
                    </Badge>
                </div>
            </CardHeader>

            <CardContent className="p-8 space-y-8">
                {/* Visual Map/Progress */}
                <div className="relative aspect-video rounded-[2rem] overflow-hidden border border-foreground/10 bg-background group shadow-inner">
                    <RescueMap
                        center={mapCenter}
                        zoom={14}
                        markers={mapMarkers}
                        hexCells={riskField?.hexCells ?? []}
                        className="w-full h-full contrast-[1.05]"
                        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
                        interactive={true}
                        routePoints={session.routePoints}
                    />
                    
                    <div className="absolute inset-0 pointer-events-none border-[1px] border-foreground/10 rounded-[2rem]" />
                    <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]" />

                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                        <div className="flex items-center gap-2 text-[9px] font-black text-foreground/80 uppercase tracking-widest bg-background/60 px-3 py-1.5 rounded-xl backdrop-blur-md border border-foreground/10">
                            <MapPin className="h-3 w-3 text-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                            {session.userLocation?.address || "Locating..."}
                        </div>
                        <div className="p-2 bg-background/60 rounded-xl backdrop-blur-md border border-foreground/10">
                            <Search size={12} className="text-foreground/40" />
                        </div>
                    </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-5 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/5 space-y-3 shadow-inner group/item hover:bg-foreground/[0.05] transition-colors"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[9px] text-foreground/30 uppercase font-black tracking-widest">
                                <Clock className="h-3.5 w-3.5 text-primary/60" />
                                Est. Response
                            </div>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        </div>
                        <div className="text-2xl font-black font-mono text-primary italic tracking-tighter">
                            {session.etaSeconds ? `${Math.floor(session.etaSeconds / 60)}m ${session.etaSeconds % 60}s` : '--'}
                        </div>
                        <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                            <motion.div initial={{ width: 0 }} animate={{ width: "68%" }} className="h-full bg-primary" />
                        </div>
                    </motion.div>
                    
                    {/*
                      Asset maintenance standing. The dispatch pipeline verifies the
                      submitted serial against Managed Assets, but that result only
                      ever reached the operations console — the requester, who is the
                      one waiting, had no way to see whether their asset was covered.
                      Renders whatever verification actually concluded, including the
                      unverified cases, so this never overstates coverage.
                    */}
                    {(session.metadata as any)?.assetVerification && (
                        <motion.div
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            data-testid="rescue-maintenance-status"
                            className="p-5 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/5 space-y-2 shadow-inner group/item hover:bg-foreground/[0.05] transition-colors"
                        >
                            <div className="flex items-center gap-1.5 text-[9px] text-foreground/30 uppercase font-black tracking-widest">
                                <ShieldCheck className={cn(
                                    "h-3.5 w-3.5",
                                    (session.metadata as any).assetVerification.verified
                                        ? "text-emerald-400/60"
                                        : "text-amber-400/60"
                                )} />
                                Asset Maintenance
                            </div>
                            <div className={cn(
                                "text-xs uppercase tracking-[0.15em] font-black italic",
                                (session.metadata as any).assetVerification.verified
                                    ? "text-emerald-400"
                                    : "text-amber-400"
                            )}>
                                {(session.metadata as any).assetVerification.status}
                            </div>
                            {(session.metadata as any).assetVerification.contract && (
                                <div className="text-[10px] text-foreground/40 font-mono tracking-tight">
                                    {(session.metadata as any).assetVerification.contract}
                                    {(session.metadata as any).assetVerification.serialNumber
                                        ? ` · ${(session.metadata as any).assetVerification.serialNumber}`
                                        : ''}
                                </div>
                            )}
                        </motion.div>
                    )}

                    <motion.div
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-5 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/5 space-y-3 shadow-inner group/item hover:bg-foreground/[0.05] transition-colors"
                    >
                        <div className="flex items-center gap-1.5 text-[9px] text-foreground/30 uppercase font-black tracking-widest">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/60" />
                            Protocol Verification
                        </div>
                        <div className="text-2xl font-black font-mono text-emerald-400 flex items-baseline gap-2 italic tracking-tighter">
                            {session.arrivalProtocolVerified ? (
                                <span className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-black italic">Verified Secure</span>
                            ) : (
                                <>
                                    <span>{session.verificationCode || '----'}</span>
                                    <span className="text-[9px] text-foreground/30 font-black uppercase tracking-widest not-italic">PIN</span>
                                </>
                            )}
                        </div>
                        <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                            <motion.div 
                                className={cn("h-full", styles.dynamicWidth, session.arrivalProtocolVerified ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-foreground/10")} 
                                initial={false}
                                animate={{ width: session.arrivalProtocolVerified ? '100%' : '30%' }}
                            />
                        </div>
                    </motion.div>
                </div>

                {/* Helper Profile Section */}
                {session.providerId && (
                    <div className="flex items-center justify-between p-6 rounded-3xl bg-primary/5 border border-primary/10 shadow-inner group cursor-pointer hover:bg-primary/10 transition-all">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-primary/20 shadow-xl shadow-primary/10 group-hover:scale-110 transition-all">
                                <span className="text-primary font-black text-xl italic">{session.providerName?.[0] || 'P'}</span>
                            </div>
                            <div>
                                <h4 className="text-base font-black text-foreground italic tracking-tight uppercase leading-none">{session.providerName}</h4>
                                <div className="flex items-center gap-2 mt-2">
                                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-primary/20 text-primary/60 px-2 py-0 rounded-md">Tier Verified</Badge>
                                    <p className="text-[9px] text-foreground/30 font-black uppercase tracking-widest">ID: {String(session.providerId).slice(0, 8)}</p>
                                </div>
                            </div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-12 w-12 rounded-2xl text-primary bg-primary/10 hover:bg-primary hover:text-foreground border border-primary/10 transition-all group-hover:rotate-12">
                            <Phone className="h-5 w-5" />
                        </Button>
                    </div>
                )}
                {/* Requestor Provider Rating Section */}
                {session.status === 'COMPLETED' && (
                    <div className="w-full space-y-3 p-5 rounded-3xl bg-foreground/[0.02] border border-foreground/10 text-center">
                        <div className="text-[10px] font-black text-foreground/50 uppercase tracking-[0.3em]">Rate Service Provider</div>
                        <h4 className="text-sm font-black text-foreground uppercase italic">{session.providerName || "Apex Field Response"}</h4>
                        
                        {ratingSubmitted ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs py-1 px-3">
                                Rating Submitted: {selectedRating} ★
                            </Badge>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-center gap-2">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            type="button"
                                            onClick={() => setSelectedRating(star)}
                                            className={cn(
                                                "text-2xl transition-transform hover:scale-125 focus:outline-none",
                                                star <= selectedRating ? "text-amber-400" : "text-foreground/20"
                                            )}
                                        >
                                            ★
                                        </button>
                                    ))}
                                </div>
                                <Button
                                    size="sm"
                                    className="w-full h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-[10px] uppercase tracking-wider rounded-xl"
                                    onClick={() => setRatingSubmitted(true)}
                                >
                                    Submit Provider Rating
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>

            <CardFooter className="p-6 border-t border-foreground/5 bg-foreground/[0.02] flex gap-4">
                {session.status !== 'COMPLETED' && session.status !== 'CANCELLED' && session.status !== 'FAILED' && (
                    <Button
                        variant="outline"
                        className="flex-1 h-12 rounded-2xl border-foreground/10 bg-foreground/[0.02] text-foreground/60 font-black uppercase tracking-widest text-[9px] hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 transition-all active:scale-95"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                    >
                        {cancelMutation.isPending ? "De-escalating..." : "Abort Dispatch"}
                    </Button>
                )}
                {session.status === 'ARRIVED' && !session.arrivalProtocolVerified && (
                    <div className="flex-1 flex gap-3">
                        {verifying ? (
                            <div className="flex-1 flex gap-2">
                                <input
                                    aria-label="Arrival verification PIN"
                                    autoFocus
                                    className="flex-1 h-12 bg-background/40 border border-foreground/10 rounded-xl px-4 text-sm text-foreground font-mono placeholder:text-foreground/20 focus:outline-none focus:border-primary"
                                    placeholder="----"
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                />
                                <Button
                                    className="h-12 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-foreground font-black uppercase tracking-widest text-[10px] shadow-xl shadow-emerald-500/20"
                                    onClick={() => verifyMutation.mutate(pin)}
                                    disabled={verifyMutation.isPending || pin.length < 4}
                                >
                                    {verifyMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : "Verify"}
                                </Button>
                            </div>
                        ) : (
                            <Button
                                className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest text-[9px] shadow-2xl shadow-primary/20 transition-all active:scale-95 animate-pulse-glow"
                                onClick={() => setVerifying(true)}
                            >
                                Verify Final Handshake
                            </Button>
                        )}
                    </div>
                )}
            </CardFooter>

            <div className="flex items-center justify-center gap-2 py-4 border-t border-foreground/5">
                <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                </div>
                <span className="text-[8px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">Encrypted Operational Stream</span>
                <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                    <div className="w-1 h-1 rounded-full bg-primary/40" />
                </div>
            </div>
        </Card >
    );
}

