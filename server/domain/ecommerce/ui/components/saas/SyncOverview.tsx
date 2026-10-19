import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
    ArrowRightLeft,
    Settings,
    Database,
    CheckCircle,
    Activity,
    Network,
    Link,
    Cpu,
    Zap,
    Radio
} from "lucide-react";
import { SyncConfiguration, Connector } from './types.js';
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SyncOverviewProps {
    syncConfigs: SyncConfiguration[];
    connectors: Connector[];
}

export function SyncOverview({
    syncConfigs,
    connectors,
}: SyncOverviewProps) {
    const activeSyncs = syncConfigs.filter(s => s.enabled).length;
    
    return (
        <div className="space-y-8">
            {/* Stat Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: 'Active_Linkages', val: activeSyncs, icon: Link, detail: 'Operational Handshakes', color: 'text-emerald-500' },
                    { label: 'Tunnel_Array', val: syncConfigs.length, icon: Radio, detail: 'Configured Pathways', color: 'text-foreground' },
                    { label: 'Data_Throughput', val: '0', icon: Database, detail: 'Records Sync\'d (24h)', color: 'text-primary' },
                    { label: 'Link_Integrity', val: '100%', icon: ShieldCheck, detail: 'Success Coefficient', color: 'text-blue-500' },
                ].map((stat, i) => (
                    <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                    >
                        <Card className="glass-panel-deep border-foreground/10 rounded-3xl overflow-hidden relative group p-6">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center justify-between mb-4">
                                <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic">{stat.label}</div>
                                <stat.icon className={cn("w-4 h-4 transition-transform group-hover:scale-110", stat.color)} />
                            </div>
                            <div className={cn("text-3xl font-black italic tracking-tighter uppercase", stat.color)}>
                                {stat.val}
                            </div>
                            <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 mt-1">{stat.detail}</div>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* Neural Bridges Grid */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
            >
                <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-10 relative overflow-hidden bg-foreground/[0.01]">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Cpu className="w-32 h-32" />
                    </div>
                    <div className="space-y-8 relative z-10">
                        <div className="space-y-2">
                            <h3 className="text-3xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                                <Network className="w-8 h-8 text-primary shadow-[0_0_15px_rgba(var(--primary),0.4)]" />
                                Neural_Bridge Vitality
                            </h3>
                            <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/40 max-w-2xl italic leading-relaxed">
                                Monitor the real-time operational status of all established high-fidelity data bridges across the neural matrix.
                            </p>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {connectors.filter(c => c.is_enabled).map((connector, i) => {
                                const hasConfig = syncConfigs.some(s => s.platform.toLowerCase() === connector.platform.toLowerCase());
                                return (
                                    <motion.div 
                                      key={connector.platform}
                                      initial={{ opacity: 0, scale: 0.95 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{ delay: 0.5 + i * 0.05 }}
                                      className="p-6 rounded-3xl bg-foreground/[0.02] border border-foreground/5 hover:border-primary/20 hover:bg-foreground/[0.04] transition-all group"
                                    >
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="w-10 h-10 rounded-xl bg-foreground/[0.03] border border-foreground/10 flex items-center justify-center text-foreground/40 group-hover:text-primary transition-colors">
                                                <Database className="w-5 h-5" />
                                            </div>
                                            <Badge className={cn("text-[9px] font-black uppercase italic tracking-widest", 
                                                hasConfig ? "bg-primary/10 text-primary border-primary/20" : "bg-foreground/5 text-foreground/20 border-foreground/10"
                                            )}>
                                                {hasConfig ? 'SYNCHRONIZED' : 'UNLINKED'}
                                            </Badge>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-xl font-black italic uppercase tracking-tighter text-foreground group-hover:text-primary transition-colors">{connector.platform}</div>
                                            <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">Node_ID: {connector.config_name}</div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                </Card>
            </motion.div>
        </div>
    );
}

const ShieldCheck = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
);
