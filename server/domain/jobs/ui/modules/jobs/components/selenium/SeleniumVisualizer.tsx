
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
    Monitor, 
    MousePointer2, 
    Type, 
    Search, 
    CheckCircle2, 
    AlertCircle, 
    Loader2,
    Eye,
    History,
    Activity,
    ExternalLink
} from "lucide-react";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { useEventStream } from "@domain-ui/core/ui/hooks/use-event-stream";

interface SeleniumStep {
    action: string;
    selector?: string;
    success: boolean;
    durationMs: number;
    error?: string;
    timestamp: string;
    screenshot?: string;
}

interface SeleniumVisualizerProps {
    jobId: number | string;
    isActive: boolean;
}

export function SeleniumVisualizer({ jobId, isActive }: SeleniumVisualizerProps) {
    const [steps, setSteps] = useState<SeleniumStep[]>([]);
    const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");

    // Listen for live selenium progress events
    const { events: streamEvents } = useEventStream({ eventType: `selenium-run:${jobId}` });
    const lastEvent = streamEvents[streamEvents.length - 1] ?? null;

    useEffect(() => {
        if (!lastEvent) return;

        if (lastEvent.eventType === 'selenium.step_completed') {
            const step: SeleniumStep = {
                ...lastEvent.payload,
                timestamp: new Date().toISOString()
            };
            
            setSteps(prev => [step, ...prev].slice(0, 50));
            if (step.screenshot) {
                setCurrentScreenshot(step.screenshot);
            }
            setStatus(step.success ? "running" : "error");
        }

        if (lastEvent.eventType === 'selenium.run_started') {
            setStatus("running");
            setSteps([]);
        }

        if (lastEvent.eventType === 'selenium.run_completed') {
            setStatus("success");
        }
    }, [lastEvent]);

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'click': return <MousePointer2 className="w-4 h-4" />;
            case 'type': return <Type className="w-4 h-4" />;
            case 'goto': return <ExternalLink className="w-4 h-4" />;
            case 'extract': return <Search className="w-4 h-4" />;
            default: return <Activity className="w-4 h-4" />;
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full h-[600px]">
            {/* Main Browser Viewport */}
            <Card className="lg:col-span-2 relative overflow-hidden bg-background border-border flex flex-col rounded-3xl shadow-2xl">
                <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500/50" />
                            <div className="w-3 h-3 rounded-full bg-amber-500/50" />
                            <div className="w-3 h-3 rounded-full bg-emerald-500/50" />
                        </div>
                        <div className="h-6 w-px bg-muted mx-2" />
                        <div className="flex items-center gap-2 bg-muted/50 px-3 py-1 rounded-lg border border-border">
                            <Eye className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-xs font-mono text-foreground tracking-tight">LIVE BROWSER STREAM</span>
                        </div>
                    </div>
                    {status === "running" && (
                        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            AUTOPILOT ACTIVE
                        </Badge>
                    )}
                </div>

                <div className="flex-1 relative bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-900 to-black flex items-center justify-center p-4">
                    <AnimatePresence mode="wait">
                        {currentScreenshot ? (
                            <motion.img 
                                key={currentScreenshot}
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0 }}
                                src={`data:image/png;base64,${currentScreenshot}`}
                                className="max-w-full max-h-full rounded-lg shadow-2xl border border-foreground/10 object-contain"
                            />
                        ) : (
                            <div className="text-center space-y-4">
                                <Monitor className="w-16 h-16 text-foreground mx-auto" />
                                <div className="space-y-1">
                                    <p className="text-muted-foreground font-medium">Waiting for browser initialization...</p>
                                    <p className="text-xs text-muted-foreground uppercase tracking-widest">Awaiting Headless Stream</p>
                                </div>
                            </div>
                        )}
                    </AnimatePresence>

                    {/* Overlay effects */}
                    <div className="absolute inset-0 pointer-events-none border-[12px] border-border/20" />
                </div>
            </Card>

            {/* Sidebar: Step History */}
            <Card className="bg-card/50 border-border backdrop-blur-xl flex flex-col rounded-3xl overflow-hidden">
                <div className="p-4 border-b border-border flex items-center gap-2">
                    <History className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">Action History</h3>
                </div>

                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-3">
                        <AnimatePresence initial={false}>
                            {steps.length === 0 ? (
                                <div className="py-8 text-center text-muted-foreground italic text-xs">
                                    No actions recorded yet
                                </div>
                            ) : (
                                steps.map((step, idx) => (
                                    <motion.div
                                        key={step.timestamp + idx}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className={`p-3 rounded-xl border transition-all ${
                                            step.success 
                                                ? 'bg-muted/30 border-border/50' 
                                                : 'bg-red-500/5 border-red-500/20'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className={`p-1.5 rounded-lg ${step.success ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'}`}>
                                                    {getActionIcon(step.action)}
                                                </div>
                                                <span className="text-xs font-bold uppercase text-foreground">{step.action}</span>
                                            </div>
                                            {step.success ? (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                            ) : (
                                                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                                            )}
                                        </div>
                                        
                                        {step.selector && (
                                            <p className="text-[10px] font-mono text-muted-foreground truncate mb-1">
                                                {step.selector}
                                            </p>
                                        )}
                                        
                                        {!step.success && step.error && (
                                            <p className="text-[10px] text-red-400 leading-tight">
                                                {step.error}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-[9px] text-muted-foreground uppercase font-bold">{step.durationMs}ms</span>
                                            <span className="text-[9px] text-muted-foreground">{new Date(step.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </AnimatePresence>
                    </div>
                </ScrollArea>
            </Card>
        </div>
    );
}
