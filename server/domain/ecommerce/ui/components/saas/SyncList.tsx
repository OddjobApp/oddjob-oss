import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import {
    RefreshCw,
    Edit,
    Trash2,
    MoreHorizontal,
    Database,
    ArrowRightLeft,
    Plus,
    CheckCircle,
    XCircle,
    Clock,
    Zap,
    Link,
    Unlink,
    Activity,
    Search
} from "lucide-react";
import { SyncConfiguration } from './types.js';
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Input } from "@domain-ui/core/ui/components/ui/input";

interface SyncListProps {
    syncConfigs: SyncConfiguration[];
    isLoading: boolean;
    onEdit: (sync: SyncConfiguration) => void;
    onManualSync?: (platform: string) => void;
    onDeleteSync?: (sync: SyncConfiguration) => void;
}

const CONFLICT_RESOLUTION_OPTIONS = [
    { value: "last_write_wins", label: "LAST_WRITE_WINS" },
    { value: "manual_review", label: "MANUAL_REVIEW" },
    { value: "source_priority", label: "SOURCE_PRIORITY" },
    { value: "target_priority", label: "TARGET_PRIORITY" }
];

export function SyncList({
    syncConfigs,
    isLoading,
    onEdit,
    onManualSync,
    onDeleteSync
}: SyncListProps) {

    const syncColumns: Column<SyncConfiguration>[] = [
        {
            key: 'platform',
            header: 'NEURAL_BRIDGE',
            render: (sync: SyncConfiguration) => (
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                        <Database className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-black italic uppercase tracking-tighter text-foreground">{sync.platform}</span>
                </div>
            ),
        },
        {
            key: 'enabled',
            header: 'LINK_STATUS',
            render: (sync: SyncConfiguration) => (
                <div className="flex items-center space-x-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", sync.enabled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-foreground/20")} />
                    <Badge className={cn("text-[9px] font-black uppercase italic tracking-widest", 
                        sync.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-foreground/5 text-foreground/40 border-foreground/10"
                    )}>
                        {sync.enabled ? 'SYNCHRONIZED' : 'DORMANT'}
                    </Badge>
                </div>
            ),
        },
        {
            key: 'sync_interval',
            header: 'HEARTBEAT_INTERVAL',
            render: (sync: SyncConfiguration) => (
                <div className="flex items-center gap-2 text-[10px] font-bold text-foreground/60 italic uppercase tracking-widest">
                    <Clock className="w-3 h-3" />
                    <span>Every {sync.sync_interval}m</span>
                </div>
            ),
        },
        {
            key: 'conflict_resolution',
            header: 'LOGIC_GATE_PROTOCOL',
            render: (sync: SyncConfiguration) => (
                <Badge variant="outline" className="border-foreground/10 text-[9px] font-black italic uppercase tracking-widest text-foreground/40 pt-0.5">
                    {CONFLICT_RESOLUTION_OPTIONS.find(opt => opt.value === sync.conflict_resolution)?.label || sync.conflict_resolution}
                </Badge>
            ),
        },
        {
            key: 'last_sync',
            header: 'LAST_HANDSHAKE',
            render: (sync: SyncConfiguration) => (
                <span className="text-[10px] font-mono font-bold text-foreground/20 uppercase tracking-tighter">
                    {sync.last_sync ? new Date(sync.last_sync).toLocaleTimeString() : 'WAITING_SIGNAL'}
                </span>
            ),
        },
        {
            key: 'actions',
            header: 'CONTROL',
            render: (sync: SyncConfiguration) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="hover:bg-foreground/5 border border-transparent hover:border-foreground/10 transition-all rounded-lg h-8 w-8 p-0">
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-background/90 border-foreground/10 backdrop-blur-xl rounded-xl p-1.5">
                        <DropdownMenuItem onClick={() => onManualSync?.(sync.platform)} className="text-[10px] font-black uppercase tracking-widest italic group">
                            <RefreshCw className="w-3.5 h-3.5 mr-2 group-hover:text-primary transition-all" />
                            Command_Sync
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(sync)} className="text-[10px] font-black uppercase tracking-widest italic group">
                            <Edit className="w-3.5 h-3.5 mr-2 group-hover:text-primary transition-all" />
                            Recalibrate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => onDeleteSync?.(sync)}
                            className="text-rose-500 text-[10px] font-black uppercase tracking-widest italic focus:bg-rose-500/10 focus:text-rose-500 group"
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Purge_Link
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ];

    return (
        <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden">
            <CardHeader className="p-8 border-b border-foreground/5 bg-foreground/[0.01]">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground">
                            Active_Linkage <span className="text-primary font-light not-italic">Grid</span>
                        </CardTitle>
                        <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic">
                            Manage bidirectional high-fidelity data tunnels and synchronization protocols.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-4 bg-foreground/[0.03] p-1 rounded-xl border border-foreground/5 px-4 h-10">
                            <Search className="w-3.5 h-3.5 text-foreground/40" />
                            <Input 
                                placeholder="SEARCH LINKAGES..." 
                                className="bg-transparent border-none text-[10px] font-black italic uppercase tracking-widest h-8 w-48 shadow-none focus-visible:ring-0 p-0"
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="py-24 flex flex-col items-center justify-center space-y-4">
                        <RefreshCw className="w-8 h-8 text-primary opacity-20 animate-spin" />
                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Scanning Connection Polarity...</span>
                    </div>
                ) : syncConfigs.length === 0 ? (
                    <div className="py-24 flex flex-col items-center justify-center space-y-6">
                        <div className="w-20 h-20 rounded-full bg-foreground/[0.02] flex items-center justify-center border border-foreground/5">
                            <Unlink className="w-8 h-8 text-foreground/10" />
                        </div>
                        <div className="text-center space-y-1">
                            <h3 className="text-xl font-black italic uppercase text-foreground/40 tracking-tighter">No Active Linkages Detected</h3>
                            <p className="text-[9px] font-black uppercase tracking-widest text-foreground/20 italic">Initialize a new tunnel to begin synchronization.</p>
                        </div>
                    </div>
                ) : (
                    <div className="border-none">
                        <DataTable
                            data={syncConfigs}
                            columns={syncColumns}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
