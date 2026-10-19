
import { useQuery } from "@tanstack/react-query";
import { Activity, ShieldCheck, Zap, Search, Eye, Cpu, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@domain-ui/core/ui/components/ui/tooltip";

interface GovernorHealth {
    dispatcher: {
        alive: boolean;
        lastPulse?: number;
        status: string;
        windows?: string[];
    };
    producer: {
        alive: boolean;
        status: string;
    };
}

export default function ConsensusDashboard() {
    const { data: health, isLoading, error } = useQuery<GovernorHealth>({
        queryKey: ["/api/governor/health"],
        refetchInterval: 5000, // Poll every 5s
    });

    const windows = [
        { id: "W-0", role: "Producer", icon: Zap, status: health?.producer.alive ? "HEALTHY" : "OFFLINE" },
        { id: "W-1", role: "Strategist", icon: Cpu, status: health?.dispatcher.alive ? "HEALTHY" : "OFFLINE" },
        { id: "W-2", role: "Critic", icon: ShieldCheck, status: health?.dispatcher.alive ? "HEALTHY" : "OFFLINE" },
        { id: "W-3", role: "Explorer", icon: Search, status: health?.dispatcher.alive ? "HEALTHY" : "OFFLINE" },
        { id: "W-4", role: "Auditor", icon: Eye, status: health?.dispatcher.alive ? "HEALTHY" : "OFFLINE" },
    ];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8 space-x-2 animate-pulse">
                <Activity className="h-5 w-5 text-muted-foreground animate-spin" />
                <span className="text-sm text-muted-foreground">Connecting to Governor Subsystem...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center p-8 text-destructive space-x-2">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to connect to Governor Subsystem</span>
            </div>
        );
    }

    return (
        <Card className="border-indigo-500/20 bg-indigo-500/5 mb-6 overflow-hidden">
            <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-indigo-400" />
                        <h3 className="text-sm font-semibold text-indigo-100 uppercase tracking-wider">Consensus Pulse Dashboard</h3>
                    </div>
                    <Badge variant={health?.dispatcher.alive ? "outline" : "destructive"} className={cn(
                        "text-[10px] uppercase font-bold px-2 py-0.5",
                        health?.dispatcher.alive ? "bg-green-500/10 text-green-400 border-green-500/20" : ""
                    )}>
                        {health?.dispatcher.alive ? "Systems Operational" : "Governor Dispatcher Offline"}
                    </Badge>
                </div>

                <div className="grid grid-cols-5 gap-4">
                    {windows.map((win) => (
                        <TooltipProvider key={win.id} delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex flex-col items-center group">
                                        <div className={cn(
                                            "h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-500 relative",
                                            win.status === "HEALTHY"
                                                ? "bg-card border-2 border-green-500/30 shadow-sm shadow-green-500/10 scale-100"
                                                : "bg-card/50 border border-border grayscale opacity-50 scale-95"
                                        )}>
                                            {win.status === "HEALTHY" && (
                                                <div className="absolute inset-0 rounded-xl bg-green-400/20 animate-ping duration-[3000ms]" />
                                            )}
                                            <win.icon className={cn(
                                                "h-6 w-6 transition-colors duration-500",
                                                win.status === "HEALTHY" ? "text-green-400" : "text-muted-foreground"
                                            )} />
                                        </div>
                                        <span className="mt-2 text-[10px] font-bold text-muted-foreground uppercase tracking-tighter group-hover:text-indigo-400 transition-colors">
                                            {win.id}
                                        </span>
                                        <span className="text-[9px] text-muted-foreground font-medium">
                                            {win.role}
                                        </span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                    <div className="space-y-1">
                                        <p className="font-bold">{win.id}: {win.role}</p>
                                        <p className="text-muted-foreground">Status: {win.status}</p>
                                        {win.id !== 'W-0' && health?.dispatcher.lastPulse && (
                                            <p className="text-[10px]">Last Heartbeat: {new Date(health.dispatcher.lastPulse).toLocaleTimeString()}</p>
                                        )}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
