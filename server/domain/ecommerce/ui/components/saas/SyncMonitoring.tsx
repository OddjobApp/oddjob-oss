import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import {
    Zap,
    Database,
    CheckCircle,
    XCircle,
    Activity,
    Clock,
    Search,
    RefreshCw,
    ShieldAlert
} from "lucide-react";
import { SyncHistoryEvent } from './types.js';
import { apiRequest } from "@/lib/queryClient";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Input } from "@domain-ui/core/ui/components/ui/input";

export function SyncMonitoring() {
    // Fetch sync history
    const { data: syncHistoryData, isLoading: historyLoading } = useQuery<{ history: SyncHistoryEvent[] }>({
        queryKey: ['/api/saas/monitoring/history'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/saas/monitoring/history');
            return res.json();
        },
        refetchInterval: 5000, // Poll every 5 seconds
    });

    const syncHistory = syncHistoryData?.history || [];

    const historyColumns: Column<SyncHistoryEvent>[] = [
        {
            key: 'timestamp',
            header: 'EVENT_TIMESTAMP',
            render: (event: SyncHistoryEvent) => (
                <div className="flex items-center gap-2 font-mono text-[10px] text-foreground/40 font-bold uppercase tracking-tighter">
                    <Clock className="w-3 h-3" />
                    {new Date(event.timestamp).toLocaleTimeString()}
                </div>
            ),
        },
        {
            key: 'platform',
            header: 'NEURAL_BRIDGE',
            render: (event: SyncHistoryEvent) => (
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-foreground/[0.03] border border-foreground/10 flex items-center justify-center">
                        {event.platform === 'jira' ? <Zap className="w-4 h-4 text-blue-500/60" /> : <Database className="w-4 h-4 text-foreground/40" />}
                    </div>
                    <span className="font-black italic uppercase tracking-tighter text-foreground">{event.platform}</span>
                </div>
            ),
        },
        {
            key: 'sync_type',
            header: 'HANDSHAKE_TYPE',
            render: (event: SyncHistoryEvent) => (
                <Badge variant="outline" className="border-foreground/10 text-[9px] font-black italic uppercase tracking-widest text-foreground/40 pt-0.5">
                    {event.sync_type}
                </Badge>
            ),
        },
        {
            key: 'status',
            header: 'OUTCOME',
            render: (event: SyncHistoryEvent) => (
                <div className="flex items-center space-x-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", event.status === 'success' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]")} />
                    <span className={cn("text-[9px] font-black uppercase italic tracking-widest", event.status === 'success' ? 'text-emerald-400' : 'text-rose-500')}>
                        {event.status === 'success' ? 'COMPLETED' : 'TERMINATED'}
                    </span>
                </div>
            ),
        },
        {
            key: 'details',
            header: 'TELEMETRY_DATA',
            render: (event: SyncHistoryEvent) => (
                <div className="flex items-center gap-2 text-[10px] font-bold text-foreground/60 italic uppercase tracking-widest leading-none">
                    {event.status === 'success' ? (
                        <>
                            <Activity className="w-3 h-3 text-emerald-500/60" />
                            <span>{event.details?.items_synced || 0} Objects Synchronized</span>
                        </>
                    ) : (
                        <>
                            <ShieldAlert className="w-3 h-3 text-rose-500/60" />
                            <span className="text-rose-500/60">{event.details?.error || 'Unknown Protocol Error'}</span>
                        </>
                    )}
                </div>
            ),
        },
    ];

    return (
        <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden">
            <CardHeader className="p-8 border-b border-foreground/5 bg-foreground/[0.01]">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground">
                            Live_Handshake <span className="text-primary font-light not-italic">Feed</span>
                        </CardTitle>
                        <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic">
                            High-frequency monitoring of active bidirectional data linkups.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/20 text-primary text-[9px] font-black uppercase italic animate-pulse">
                            <Activity className="w-3 h-3" />
                            Live_Scanning
                        </div>
                        <div className="flex items-center gap-4 bg-foreground/[0.03] p-1 rounded-xl border border-foreground/5 px-4 h-10">
                            <Search className="w-3.5 h-3.5 text-foreground/40" />
                            <Input 
                                placeholder="FILTER HANDSHAKES..." 
                                className="bg-transparent border-none text-[10px] font-black italic uppercase tracking-widest h-8 w-48 shadow-none focus-visible:ring-0 p-0"
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {historyLoading ? (
                    <div className="py-24 flex flex-col items-center justify-center space-y-4">
                        <RefreshCw className="w-8 h-8 text-primary opacity-20 animate-spin" />
                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Decoding Signal Stream...</span>
                    </div>
                ) : (
                    <div className="border-none">
                        <DataTable
                            data={syncHistory}
                            columns={historyColumns}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
