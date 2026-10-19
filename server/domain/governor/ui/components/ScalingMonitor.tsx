
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Activity, Server, Clock, AlertTriangle } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface ScalingInstance {
    id: number;
    appName: string;
    appSlug: string;
    status: string;
    port: number;
    createdAt: string;
}

export default function ScalingMonitor() {
    const [instances, setInstances] = useState<ScalingInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchStatus = async () => {
        try {
            const response = await fetch("/api/governor/scaling-status");
            if (!response.ok) throw new Error("Failed to fetch fleet status");
            const data = await response.json();
            setInstances(data);
        } catch (error) {
            console.error("[ScalingMonitor] Error:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000); // 5s poll
        return () => clearInterval(interval);
    }, []);

    if (loading) return null;

    return (
        <Card className="border-border bg-muted text-foreground shadow-sm overflow-hidden">
            <CardHeader className="bg-card/50 border-b border-border py-3">
                <CardTitle className="text-xs font-bold text-foreground uppercase tracking-widest flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-blue-400" />
                    Fleet Scaling Events
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-700">
                    {instances.length === 0 ? (
                        <div className="p-8 text-center text-xs text-muted-foreground">
                            No active scaling events detected.
                        </div>
                    ) : (
                        instances.map((inst) => (
                            <div key={inst.id} className="p-3 flex items-start gap-3 hover:bg-muted/50 transition-colors">
                                <div className="mt-1">
                                    {inst.status === 'running' ? (
                                        <div className="bg-emerald-900/50 p-1.5 rounded-full">
                                            <Server className="h-3 w-3 text-emerald-300" />
                                        </div>
                                    ) : (
                                        <div className="bg-amber-900/50 p-1.5 rounded-full">
                                            <Clock className="h-3 w-3 text-amber-300" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-0.5">
                                        <div className="text-xs font-bold text-foreground truncate">{inst.appName}</div>
                                        <div className="text-[9px] text-muted-foreground font-mono">
                                            {new Date(inst.createdAt).toLocaleTimeString()}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge 
                                            variant="outline" 
                                            className={`text-[9px] px-1 py-0 border-none uppercase ${
                                                inst.status === 'running' ? 'text-emerald-300 bg-emerald-900/50' : 'text-amber-300 bg-amber-900/50'
                                            }`}
                                        >
                                            {inst.status}
                                        </Badge>
                                        <span className="text-[9px] text-muted-foreground">Port {inst.port}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="p-3 bg-card/30 border-t border-border flex items-center justify-between">
                    <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                        <div className="h-1 w-1 rounded-full bg-emerald-500" />
                        Live Updates Active
                    </div>
                    <Button 
                        variant="link" 
                        size="sm" 
                        className="h-auto p-0 text-[10px] text-blue-400 font-bold"
                        onClick={() => toast({ title: "Policy Update", description: "Scaling aggression set to BUILT-IN default." })}
                    >
                        Adjust Policy
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
