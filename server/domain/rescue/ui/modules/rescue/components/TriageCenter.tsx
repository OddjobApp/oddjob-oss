
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ShieldAlert, Cpu, UserCheck, Check, X, ArrowRight, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface RecoveryOption {
    id: string;
    label: string;
    description: string;
    successProbability: number;
    actionType: 'manual_takeover' | 'relax_constraints' | 'reroute_knowledge' | 'approve_tool' | 'reject_tool';
    params?: any;
}

interface TriageCenterProps {
    summary: string;
    options: RecoveryOption[];
    onSelectOption: (option: RecoveryOption) => void;
    onDismiss?: () => void;
}

export function TriageCenter({ summary, options, onSelectOption, onDismiss }: TriageCenterProps) {
    return (
        <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative shadow-2xl backdrop-blur-3xl">
            <div className="absolute inset-0 bg-gradient-to-br from-bronze-500/[0.05] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-bronze-500 to-transparent opacity-30 shadow-[0_0_20px_rgba(var(--bronze),0.5)]" />

            <CardHeader className="p-8 pb-4">
                <div className="flex items-center gap-4 mb-1">
                    <div className="p-3 rounded-2xl bg-bronze-500/10 border border-bronze-500/30 shadow-lg shadow-bronze-500/10 animate-pulse">
                        <ShieldAlert className="h-6 w-6 text-bronze-500" />
                    </div>
                    <div>
                        <CardTitle className="text-2xl uppercase tracking-tighter font-black italic text-foreground">
                            Triage <span className="text-bronze-500 text-glow-bronze">Center</span>
                        </CardTitle>
                        <CardDescription className="text-bronze-400/50 text-[10px] uppercase tracking-[0.4em] font-black mt-0.5">
                            Mission Recovery Protocol // V2
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-8 space-y-8">
                <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-6 rounded-[1.5rem] bg-bronze-900/10 border border-bronze-500/20 relative overflow-hidden group shadow-inner"
                >
                    <div className="absolute -right-6 -top-6 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity rotate-12">
                        <ShieldAlert size={120} />
                    </div>
                    <div className="flex gap-4 items-start relative z-10">
                        <div className="mt-1">
                            <div className="w-1.5 h-10 bg-bronze-500 rounded-full shadow-[0_0_10px_rgba(var(--bronze),0.5)]" />
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/90 font-medium italic">
                            <span className="text-bronze-500 font-black uppercase tracking-widest text-[10px] block mb-2 opacity-60">Anomaly Detected</span>
                            "{summary}"
                        </p>
                    </div>
                </motion.div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-bronze-500/60">Strategic Recovery Paths</h3>
                        <div className="flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-bronze-500/40" />
                            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Select Strategy</span>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {options.map((option, idx) => {
                            const maxProbability = Math.max(...options.map(o => o.successProbability));
                            const isRecommended = option.successProbability === maxProbability;
                            return <motion.button
                                key={option.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 + (idx * 0.1) }}
                                className="group w-full text-left p-6 rounded-[2rem] border border-foreground/5 bg-foreground/[0.02] hover:border-bronze-500/40 hover:bg-bronze-500/5 transition-all relative overflow-hidden active:scale-[0.98] shadow-sm hover:shadow-2xl hover:shadow-bronze-500/5"
                                onClick={() => onSelectOption(option)}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-background/40 border border-foreground/10 group-hover:border-bronze-500/40 group-hover:bg-bronze-500/10 transition-all shadow-inner">
                                            {option.actionType === 'manual_takeover' && <UserCheck className="h-5 w-5 text-amber-500" />}
                                            {option.actionType === 'relax_constraints' && <ShieldAlert className="h-5 w-5 text-emerald-500" />}
                                            {option.actionType === 'reroute_knowledge' && <Cpu className="h-5 w-5 text-primary" />}
                                            {option.actionType === 'approve_tool' && <Check className="h-5 w-5 text-green-400" />}
                                            {option.actionType === 'reject_tool' && <X className="h-5 w-5 text-red-400" />}
                                        </div>
                                        <div>
                                            <h4 className="font-black text-base text-foreground group-hover:text-bronze-500 transition-colors uppercase tracking-tight italic">
                                                {option.label}
                                            </h4>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Badge className="h-4 text-[8px] font-black uppercase tracking-widest bg-foreground/5 border-none text-muted-foreground/60 py-0 px-2 rounded-md group-hover:bg-bronze-500/20 group-hover:text-bronze-400 transition-colors">
                                                    {option.actionType.replaceAll('_', ' ')}
                                                </Badge>
                                                {isRecommended && <span className="text-[8px] font-black text-primary uppercase animate-pulse">Recommended</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-right">
                                        <div className="text-[10px] font-black text-bronze-500/60 mb-1.5 uppercase tracking-widest">
                                            Success Probability
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-mono font-black text-foreground">{Math.round(option.successProbability * 100)}%</span>
                                            <Progress
                                                value={option.successProbability * 100}
                                                className="h-1.5 w-24 bg-foreground/5 rounded-full overflow-hidden"
                                                indicatorClassName="bg-gradient-to-r from-bronze-600 to-bronze-400 shadow-[0_0_8px_rgba(var(--bronze),0.4)]"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4 items-center">
                                    <p className="text-[11px] text-muted-foreground/70 group-hover:text-foreground/90 transition-colors pl-[60px] leading-relaxed flex-1">
                                        {option.description}
                                    </p>
                                    <div className="opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                        <ArrowRight className="w-4 h-4 text-bronze-500" />
                                    </div>
                                </div>
                            </motion.button>
                        })}
                    </div>
                </div>

                <div className="pt-4 border-t border-foreground/5 flex justify-between items-center px-2">
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">
                        <Zap size={10} />
                        Session Durable
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-[9px] uppercase tracking-[0.3em] font-black text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-500/5 rounded-xl px-4 transition-all"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDismiss?.();
                        }}
                    >
                        De-escalate Protocol
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
