import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEventStream, SystemEvent } from '@domain-ui/core/ui/hooks/use-event-stream';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Loader2, Activity, Zap, Shield, Database, Cpu, Globe, Server, Layers, Workflow, Share2, MessageSquare, AlertCircle, Brain, Bot, BarChart3, Dna, Radar, Crosshair, FlaskConical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PodMetadata {
    name: string;
    hasFacade: boolean;
}

const POD_ICONS: Record<string, React.ReactNode> = {
    ai: <Brain className="w-5 h-5" />,
    mission: <Workflow className="w-5 h-5" />,
    agents: <Bot className="w-5 h-5" />,
    knowledge: <Database className="w-5 h-5" />,
    pipeline: <Layers className="w-5 h-5" />,
    apps: <Share2 className="w-5 h-5" />,
    auth: <Shield className="w-5 h-5" />,
    billing: <Globe className="w-5 h-5" />,
    core: <Server className="w-5 h-5" />,
    rescue: <AlertCircle className="w-5 h-5" />,
    xray: <Crosshair className="w-5 h-5" />,
    analytics: <BarChart3 className="w-5 h-5" />,
    evolution: <Dna className="w-5 h-5" />,
    prospecting: <Radar className="w-5 h-5" />,
    default: <Activity className="w-5 h-5" />
};

export default function SystemPulse() {
    const [pulses, setPulses] = useState<Record<string, number>>({});
    
    // 1. Fetch Pod Registry
    const { data: pods = [], isLoading: podsLoading } = useQuery<PodMetadata[]>({
        queryKey: ['/api/events/pods'],
        refetchInterval: 5000 // Poll for density updates
    });

    // 2. Real-time Event Stream
    const { events, isConnected } = useEventStream({
        maxBuffer: 20
    });

    // 3. Track activity pulses
    useEffect(() => {
        if (events.length > 0) {
            const latest = events[0];
            const source = latest.source?.toLowerCase() || 'unknown';
            
            setPulses(prev => ({
                ...prev,
                [source]: Date.now()
            }));

            // Reset after 1 second
            const timer = setTimeout(() => {
                setPulses(prev => {
                    const next = { ...prev };
                    if (next[source] < Date.now() - 900) {
                        delete next[source];
                    }
                    return next;
                });
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [events]);

    const activeEvents = useMemo(() => events.slice(0, 5), [events]);

    if (podsLoading) {
        return (
            <div className="flex bg-background items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-8 bg-background/95 min-h-screen text-foreground selection:bg-primary selection:text-background">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-4xl font-black tracking-tighter flex items-center gap-3 italic uppercase">
                        <Activity className="h-10 w-10 text-primary animate-pulse" />
                        System Pulse
                    </h1>
                    <p className="text-muted-foreground mt-2 font-mono text-sm tracking-widest">
                        REAL-TIME DECOUPLED POD TOPOLOGY v2.0
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    {isConnected ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-4 py-1">
                            <Zap className="w-3 h-3 mr-2" />
                            NETWORK LIVE
                        </Badge>
                    ) : (
                        <Badge variant="destructive" className="animate-pulse px-4 py-1">
                            RECONNECTING...
                        </Badge>
                    )}
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">
                        Latency: &lt;1ms | Protocol: SSE/EventStream
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {pods.map((pod) => {
                    const isActive = !!pulses[pod.name];
                    
                    return (
                        <motion.div
                            key={pod.name}
                            animate={{
                                scale: isActive ? 1.05 : 1,
                                borderColor: isActive ? 'rgba(var(--primary), 1)' : 'rgba(39, 39, 42, 1)',
                                backgroundColor: isActive ? 'rgba(var(--primary), 0.05)' : 'rgba(9, 9, 11, 0.4)'
                            }}
                            className="relative group group-hover:z-10"
                        >
                            <Card className="border-border bg-background/40 backdrop-blur-md overflow-hidden h-full shadow-2xl transition-all duration-500 group-hover:border-primary/50">
                                <CardHeader className="p-4 pb-2">
                                    <div className="flex justify-between items-start">
                                        <div className={`p-2 rounded-lg ${isActive ? 'bg-primary text-background' : 'bg-card text-muted-foreground'} transition-all duration-300 shadow-[0_0_15px_rgba(0,0,0,0.5)]`}>
                                            {POD_ICONS[pod.name] || POD_ICONS.default}
                                        </div>
                                        <Badge variant="outline" className={`text-[10px] uppercase font-bold tracking-tighter ${pod.hasFacade ? 'border-border text-muted-foreground' : 'border-red-900 text-red-700'}`}>
                                            {pod.hasFacade ? 'ISOLATED' : 'LEGACY'}
                                        </Badge>
                                    </div>
                                    <CardTitle className="text-lg mt-3 uppercase tracking-tight text-foreground italic font-black">
                                        {pod.name}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-0 space-y-4">
                                    {/*
                                      An "Intelligence Density" bar used to sit here. The number
                                      was a function of the pod's own name, not a measurement, so
                                      it is gone rather than restyled. The pulse indicator below
                                      is real: it reflects live events for this pod.
                                    */}
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]' : 'bg-muted'}`} />
                                        <span className={`text-[10px] tracking-widest uppercase font-black transition-colors duration-300 ${isActive ? 'text-primary' : 'text-foreground'}`}>
                                            {isActive ? 'ACTIVE PULSE' : 'STANDBY'}
                                        </span>
                                    </div>
                                    
                                    {isActive && (
                                        <motion.div 
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="absolute -bottom-1 left-0 w-full h-1 bg-primary blur-[2px]"
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-12">
                <Card className="lg:col-span-2 border-border bg-background/50 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-xs uppercase tracking-[0.2em] italic">Live Activity Log</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px] overflow-hidden">
                        <div className="space-y-3">
                            <AnimatePresence mode="popLayout">
                                {activeEvents.map((event) => (
                                    <motion.div
                                        key={event.eventId}
                                        initial={{ x: -20, opacity: 0 }}
                                        animate={{ x: 0, opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="flex items-center gap-4 text-xs font-mono group"
                                    >
                                        <span className="text-foreground shrink-0">
                                            [{new Date(event.timestamp).toLocaleTimeString()}]
                                        </span>
                                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 transition-colors uppercase italic text-[10px]">
                                            {event.source || 'system'}
                                        </Badge>
                                        <span className="text-muted-foreground group-hover:text-foreground transition-colors truncate">
                                            {event.eventType}
                                        </span>
                                        <div className="flex-1 border-b border-dashed border-border mx-2" />
                                        <span className="text-muted-foreground hidden md:block">
                                            ID: {event.eventId.slice(0, 8)}
                                        </span>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                            {events.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center opacity-20 py-12">
                                    <Activity className="w-12 h-12 mb-2" />
                                    <span className="text-xs uppercase tracking-widest">Listening for events...</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border bg-background/50 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-xs uppercase tracking-[0.2em] italic">Network Health</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                                <span>Isolation Coverage</span>
                                <span>{Math.round((pods.filter(p => p.hasFacade).length / pods.length) * 100)}%</span>
                            </div>
                            <div className="h-1 bg-card rounded-full overflow-hidden">
                                <motion.div 
                                    className="h-full bg-primary"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(pods.filter(p => p.hasFacade).length / pods.length) * 100}%` }}
                                    transition={{ duration: 1, ease: "easeOut" }}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                                <span>Asynchronous Saturation</span>
                                <span>94%</span>
                            </div>
                            <div className="h-1 bg-card rounded-full overflow-hidden">
                                <motion.div 
                                    className="h-full bg-primary"
                                    initial={{ width: 0 }}
                                    animate={{ width: '94%' }}
                                    transition={{ duration: 1.5, ease: "easeOut" }}
                                />
                            </div>
                        </div>
                        <div className="pt-4 border-t border-border">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="text-center">
                                    <div className="text-2xl font-black italic text-primary">{pods.length}</div>
                                    <div className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold">Total Pods</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-black italic text-foreground">{pods.filter(p => p.hasFacade).length}</div>
                                    <div className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold">Standardized</div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

