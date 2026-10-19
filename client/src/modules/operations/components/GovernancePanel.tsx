
import React from "react";
import { ShieldCheck, Target, DollarSign, Cpu, Settings2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GovernancePanelProps {
    priority: number;
    budgetLimitUsd: string;
    tokenLimit: number;
    isPaused: boolean;
    onUpdate: (data: any) => void;
    onRequestEdit?: () => void;
}

export function GovernancePanel({ priority, budgetLimitUsd, tokenLimit, isPaused, onUpdate, onRequestEdit }: GovernancePanelProps) {
    const [hardBudgetHalt, setHardBudgetHalt] = React.useState(true);
    const [criticalDriftPause, setCriticalDriftPause] = React.useState(true);

    return (
        <Card className="bg-black/40 border-white/5 backdrop-blur-2xl overflow-hidden">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                            <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-black uppercase tracking-widest">Governance</h3>
                        </div>
                    </div>
                    <Badge variant={isPaused ? "destructive" : "outline"} className="rounded-full uppercase text-[8px] font-black tracking-widest px-2 py-0.5">
                        {isPaused ? "Override" : "Active"}
                    </Badge>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-white/5 space-y-3">
                            <div className="flex items-center gap-2 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                <DollarSign className="w-3 h-3 text-primary" /> Budget Cap
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-xs text-muted-foreground">$</span>
                                <span className="text-xl font-black">{budgetLimitUsd}</span>
                            </div>
                            <Button 
                                variant="ghost" size="sm" 
                                className="w-full h-7 text-[8px] uppercase font-black tracking-widest bg-foreground/5 hover:bg-foreground/10 rounded-lg"
                                onClick={onRequestEdit}
                            >
                                Adjust Cap
                            </Button>
                        </div>
                        <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-white/5 space-y-3">
                            <div className="flex items-center gap-2 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                <Cpu className="w-3 h-3 text-primary" /> Token Reservoir
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-xl font-black">{tokenLimit.toLocaleString()}</span>
                                <span className="text-[9px] text-muted-foreground uppercase font-black">k</span>
                            </div>
                            <Button 
                                variant="ghost" size="sm" 
                                className="w-full h-7 text-[8px] uppercase font-black tracking-widest bg-foreground/5 hover:bg-foreground/10 rounded-lg"
                                onClick={onRequestEdit}
                            >
                                Refill Pool
                            </Button>
                        </div>
                    </div>

                    {/* Toggles */}
                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-foreground/[0.02] border border-white/5">
                            <div className="flex items-center gap-3">
                                <Lock className="w-4 h-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-bold">Hard Budget Halt</p>
                                    <p className="text-[9px] text-muted-foreground">Kill all missions upon breach.</p>
                                </div>
                            </div>
                            <Switch checked={hardBudgetHalt} onCheckedChange={setHardBudgetHalt} />
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-xl bg-foreground/[0.02] border border-white/5">
                            <div className="flex items-center gap-3">
                                <Settings2 className="w-4 h-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-bold">Critical Drift Pause</p>
                                    <p className="text-[9px] text-muted-foreground">Sentinel auto-override.</p>
                                </div>
                            </div>
                            <Switch checked={criticalDriftPause} onCheckedChange={setCriticalDriftPause} />
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                    <Button 
                        onClick={() => onUpdate({ hardBudgetHalt, criticalDriftPause })}
                        className="w-full bg-primary hover:bg-primary/90 text-[10px] font-black uppercase tracking-widest h-10 rounded-xl shadow-lg shadow-primary/20"
                    >
                        Commit Strategic Changes
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
