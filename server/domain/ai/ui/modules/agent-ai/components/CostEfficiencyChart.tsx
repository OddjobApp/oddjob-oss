import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Download, TrendingDown, TrendingUp, DollarSign, Activity, Zap } from "lucide-react";
import { motion } from "framer-motion";

interface CostTrend {
    period: string;
    totalRuns: number;
    totalSteps: number;
    avgStepsPerRun: number;
    estimatedCost: number;
}

interface CostEfficiencyChartProps {
    data: CostTrend[];
    detailed?: boolean;
}

export function CostEfficiencyChart({ data, detailed = false }: CostEfficiencyChartProps) {
    const totalCost = data.reduce((sum, item) => sum + parseFloat(String(item.estimatedCost)), 0);
    const totalRuns = data.reduce((sum, item) => sum + item.totalRuns, 0);
    const avgCostPerRun = totalRuns > 0 ? totalCost / totalRuns : 0;

    const midpoint = Math.floor(data.length / 2);
    const firstHalfAvg = data.slice(0, midpoint).reduce((sum, item) => sum + parseFloat(String(item.estimatedCost)), 0) / (midpoint || 1);
    const secondHalfAvg = data.slice(midpoint).reduce((sum, item) => sum + parseFloat(String(item.estimatedCost)), 0) / (data.length - midpoint || 1);
    const trendDirection = secondHalfAvg > firstHalfAvg ? 'up' : 'down';
    const trendPercentage = firstHalfAvg > 0 ? Math.abs(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100).toFixed(1) : 0;

    const handleExport = () => {
        const csv = [
            ['Period', 'Total Runs', 'Total Steps', 'Avg Steps/Run', 'Estimated Cost'].join(','),
            ...data.map(row => [
                row.period,
                row.totalRuns,
                row.totalSteps,
                row.avgStepsPerRun,
                row.estimatedCost
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cost-trends-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-80 space-y-4">
                <div className="w-16 h-16 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center opacity-20">
                    <DollarSign className="w-8 h-8" />
                </div>
                <p className="text-[10px] font-black text-foreground/10 uppercase tracking-[0.4em] italic">FISCAL TELEMETRY EMPTY</p>
            </div>
        );
    }

    return (
        <div className="space-y-10">
            {/* Summary HUD Overlay */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: "Aggregate_Expenditure", value: `$${totalCost.toFixed(2)}`, icon: DollarSign, color: "text-primary" },
                    { label: "Unit_Inference_Cost", value: `$${avgCostPerRun.toFixed(4)}`, icon: Zap, color: "text-amber-500" },
                    { 
                        label: "Efficiency_Delta", 
                        value: `${trendPercentage}%`, 
                        icon: trendDirection === 'up' ? TrendingUp : TrendingDown, 
                        color: trendDirection === 'up' ? "text-red-500" : "text-emerald-500",
                        detail: trendDirection === 'up' ? "COST_INCREASE" : "EFFICIENCY_GAIN"
                    }
                ].map((stat, i) => (
                    <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="p-6 rounded-[2rem] bg-foreground/[0.02] border border-foreground/5 space-y-2 group hover:bg-foreground/[0.04] transition-all"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">{stat.label}</span>
                            <stat.icon className={`w-3.5 h-3.5 ${stat.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
                        </div>
                        <div className="flex items-baseline gap-3">
                            <span className="text-2xl font-black italic tracking-tighter text-foreground">{stat.value}</span>
                            {'detail' in stat && <span className={`text-[8px] font-black uppercase tracking-widest ${stat.color} italic opacity-60`}>{stat.detail}</span>}
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Tactical Chart */}
            <div className="h-[340px] w-full relative group">
                <div className="absolute inset-0 bg-primary/5 blur-[100px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                <ResponsiveContainer width="100%" height="100%">
                    {detailed ? (
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                            <XAxis
                                dataKey="period"
                                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)', fontWeight: '900' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => {
                                    const date = new Date(value);
                                    return `${date.getMonth() + 1}/${date.getDate()}`;
                                }}
                            />
                            <YAxis
                                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)', fontWeight: '900' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => `$${value}`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#000',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                                    padding: '12px'
                                }}
                                itemStyle={{
                                    fontSize: '11px',
                                    fontWeight: '900',
                                    fontStyle: 'italic',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em'
                                }}
                                labelStyle={{
                                    fontSize: '9px',
                                    fontWeight: '900',
                                    color: 'rgba(255,255,255,0.2)',
                                    marginBottom: '4px',
                                    textTransform: 'uppercase'
                                }}
                                formatter={(value: any) => [`$${parseFloat(value).toFixed(4)}`, 'COST_INCURRED']}
                            />
                            <Area
                                type="monotone"
                                dataKey="estimatedCost"
                                stroke="hsl(var(--primary))"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorCost)"
                                animationDuration={2000}
                            />
                        </AreaChart>
                    ) : (
                        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                            <XAxis
                                dataKey="period"
                                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)', fontWeight: '900' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => {
                                    const date = new Date(value);
                                    return `${date.getMonth() + 1}/${date.getDate()}`;
                                }}
                            />
                            <YAxis
                                yAxisId="left"
                                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)', fontWeight: '900' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => `$${value}`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#000',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    padding: '12px'
                                }}
                            />
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="estimatedCost"
                                stroke="hsl(var(--primary))"
                                strokeWidth={3}
                                dot={{ r: 4, fill: '#000', stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                                activeDot={{ r: 6, fill: 'hsl(var(--primary))', stroke: '#fff', strokeWidth: 2 }}
                                animationDuration={1500}
                            />
                        </LineChart>
                    )}
                </ResponsiveContainer>
            </div>

            {/* Tactical Controls */}
            <div className="flex items-center justify-between pt-6 border-t border-foreground/5">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                        <span className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">Predictive Modeling: NOMINAL</span>
                    </div>
                </div>
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleExport}
                    className="h-10 px-8 rounded-xl border-foreground/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest italic hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all"
                >
                    <Download className="h-3.5 w-3.5 mr-2" />
                    GENERATE MANIFEST
                </Button>
            </div>
        </div>
    );
}
