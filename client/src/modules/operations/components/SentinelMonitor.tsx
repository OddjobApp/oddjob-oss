import React from "react";
import { Activity, ShieldCheck, ShieldAlert, Zap } from "lucide-react";
import { Gauge } from "@/components/ui/gauge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface SentinelMonitorProps {
    alignmentScore: number;
    isCriticalDrift: boolean;
    lastAuditAt?: string;
    auditLog?: string | string[];
    priority?: number;
    onUpdate?: (updates: any) => void;
}

export function SentinelMonitor({ 
    alignmentScore, 
    isCriticalDrift, 
    lastAuditAt, 
    auditLog, 
    priority = 5, 
    onUpdate = () => {} 
}: SentinelMonitorProps) {
    const statusColor = isCriticalDrift ? "text-red-400" : alignmentScore > 80 ? "text-emerald-400" : "text-amber-400";
    const statusLabel = isCriticalDrift ? "CRITICAL DRIFT" : alignmentScore > 80 ? "OPTIMAL ALIGNMENT" : "MODERATE DRIFT";

    return (
        <Card className="bg-black/40 border-white/10 shadow-xl backdrop-blur-2xl overflow-hidden">
            <CardContent className="p-5 space-y-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl bg-foreground/5 border border-white/10 ${isCriticalDrift ? 'animate-pulse text-red-400 border-red-500/30' : 'text-primary'}`}>
                            {isCriticalDrift ? <ShieldAlert className="w-5 h-5" /> : <Activity className="w-5 h-5" />}
                        </div>
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest">The Sentinel</h3>
                            <p className="text-[10px] text-muted-foreground">Strategic Drift Monitor</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className={`text-xs font-bold ${statusColor}`}>{statusLabel}</p>
                        <p className="text-[10px] text-muted-foreground">Last Audit: {lastAuditAt ? new Date(lastAuditAt).toLocaleTimeString() : 'N/A'}</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="flex justify-center relative py-2">
                        <Gauge 
                            value={alignmentScore} 
                            className={`${statusColor} transition-all duration-1000`}
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className={`w-32 h-32 rounded-full blur-3xl opacity-10 ${isCriticalDrift ? 'bg-red-500' : 'bg-primary'}`} />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <div className="space-y-0.5">
                                <Label className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">Tactical Priority</Label>
                                <p className="text-[10px] text-foreground/40 font-medium">Resource allocation weight</p>
                            </div>
                            <span className="text-xl font-black text-primary">{priority}</span>
                        </div>
                        <Slider 
                            value={[priority]} 
                            max={10} 
                            step={1} 
                            onValueChange={([v]) => onUpdate({ priority: v })}
                            className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary h-4"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-white/5 space-y-1.5">
                            <div className="flex items-center gap-2 text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                                <Zap className="w-3 h-3 text-primary" /> Real-time Synthesis
                            </div>
                            <p className="text-[11px] leading-snug text-foreground/80">
                                {(() => {
                                    const logs = typeof auditLog === 'string' ? auditLog.split('\n') : auditLog;
                                    if (logs && logs.length > 0 && logs[0].trim()) {
                                        return logs[0];
                                    }
                                    return "Operational telemetry pending. Sentinel is currently aggregating mission vectors for synthesis.";
                                })()}
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <div className="flex-1 p-2.5 rounded-xl bg-foreground/[0.02] border border-white/5">
                                <p className="text-[9px] text-muted-foreground font-black uppercase">Confidence</p>
                                <p className="text-lg font-black">{alignmentScore}%</p>
                            </div>
                            <div className="flex-1 p-2.5 rounded-xl bg-foreground/[0.02] border border-white/5">
                                <p className="text-[9px] text-muted-foreground font-black uppercase">Status</p>
                                <p className={`text-[11px] font-black mt-0.5 ${statusColor}`}>
                                    {isCriticalDrift ? "RE-ROUTING" : "STABLE"}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Micro-sparkline or scanning bar simulation */}
                <div className="mt-6 h-1 w-full bg-foreground/5 rounded-full overflow-hidden relative">
                    <div className={`absolute top-0 bottom-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-scan`} />
                </div>
            </CardContent>
        </Card>
    );
}
