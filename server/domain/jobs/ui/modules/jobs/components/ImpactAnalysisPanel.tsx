import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { BarChart3, TrendingUp, AlertTriangle } from 'lucide-react';
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

interface ImpactAnalysisPanelProps {
    jobId: number;
}

export const ImpactAnalysisPanel: React.FC<ImpactAnalysisPanelProps> = ({ jobId }) => {
    return (
        <Card className="glass-panel-deep border-foreground/5 shadow-2xl rounded-[2.5rem] overflow-hidden">
            <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] px-8 py-6">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] italic">Impact Assessment Matrix</CardTitle>
                        <CardDescription className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest mt-1 italic">
                            Predictive analysis of downstream state mutations and systemic ripple effects.
                        </CardDescription>
                    </div>
                    <BarChart3 className="w-5 h-5 text-primary opacity-50" />
                </div>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-6 bg-foreground/[0.02] border border-foreground/5 rounded-3xl group hover:border-primary/30 transition-all">
                        <TrendingUp className="w-5 h-5 text-emerald-400 mb-4" />
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Success Reliability</div>
                        <div className="text-2xl font-black italic tracking-tight">98.4%</div>
                    </div>
                    <div className="p-6 bg-foreground/[0.02] border border-foreground/5 rounded-3xl group hover:border-primary/30 transition-all">
                        <AlertTriangle className="w-5 h-5 text-amber-400 mb-4" />
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">State Drift Risk</div>
                        <div className="text-2xl font-black italic tracking-tight">Low</div>
                    </div>
                    <div className="p-6 bg-foreground/[0.02] border border-foreground/5 rounded-3xl group hover:border-primary/30 transition-all">
                        <BarChart3 className="w-5 h-5 text-primary mb-4" />
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Resource Overhead</div>
                        <div className="text-2xl font-black italic tracking-tight">Normal</div>
                    </div>
                </div>

                <div className="p-8 bg-primary/5 border border-primary/10 rounded-[2rem] relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[60px] rounded-full -mr-16 -mt-16" />
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-4">Downstream Dependency Graph</h4>
                    <div className="flex flex-col gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex items-center gap-4 bg-background/20 p-4 border border-foreground/5 rounded-2xl">
                                <div className="w-8 h-8 rounded-xl bg-foreground/5 flex items-center justify-center text-[10px] font-black">0{i}</div>
                                <div className="flex-1">
                                    <div className="text-[11px] font-bold uppercase tracking-wider">Sub-system_{i * 100}</div>
                                    <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Mutation Probability: {(10 / i).toFixed(1)}%</div>
                                </div>
                                <div className="w-24 h-1.5">
                                    <Progress value={100 / i} className="h-full bg-foreground/5" indicatorClassName="bg-primary" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
