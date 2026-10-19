import { TrendingUp, DollarSign, Activity, Users, Target, Zap, Waves } from 'lucide-react';
import { AppDeployment, App } from '@shared/schema/apps';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';

interface AppAnalyticsTabProps {
    appId: number;
    app: App;
    deployment: AppDeployment;
}

export function AppAnalyticsTab({ appId, app, deployment }: AppAnalyticsTabProps) {
    const { data: analytics, isLoading, error } = useQuery({
        queryKey: ['/api/apps', appId, 'analytics'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/analytics`);
            return res.json();
        }
    });

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Card key={i}>
                            <CardHeader className="pb-2">
                                <Skeleton className="h-4 w-24" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-8 w-16 mb-2" />
                                <Skeleton className="h-3 w-32" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-5 w-40" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-[300px] w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-12 text-center text-destructive">
                Failed to load analytics.
            </div>
        );
    }

    const percentageSpent = analytics.budgetLimitUsd
        ? Math.min(100, Math.max(0, (analytics.currentSpendUsd / analytics.budgetLimitUsd) * 100))
        : 0;

    return (
        <div className="space-y-8 animate-page-in">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden relative group hover:border-primary/50 transition-all">
                        <div className="absolute top-0 left-0 w-1 h-full bg-primary/50 group-hover:bg-primary transition-all" />
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Total Launches</CardTitle>
                            <Activity className="w-4 h-4 text-primary animate-pulse" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-4xl font-black italic tracking-tighter text-foreground mb-1">
                                {analytics.totalLaunches || 0}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest italic flex items-center gap-1.5">
                                <Zap className="w-3 h-3" />
                                Successful Deployments
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden relative group hover:border-emerald-500/50 transition-all">
                        <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/50 group-hover:bg-emerald-500 transition-all" />
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Capital Burn</CardTitle>
                            <DollarSign className="w-4 h-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-4xl font-black italic tracking-tighter text-emerald-500 mb-1 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                                ${analytics.currentSpendUsd?.toFixed(2) || '0.00'}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest italic">
                                Realtime: ${(analytics.realtimeSpendUsd || 0).toFixed(6)}
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden relative group hover:border-violet-500/50 transition-all">
                        <div className="absolute top-0 left-0 w-1 h-full bg-violet-500/50 group-hover:bg-violet-500 transition-all" />
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Budget Ceiling</CardTitle>
                            <TrendingUp className="w-4 h-4 text-violet-400" />
                        </CardHeader>
                        <CardContent>
                            <div className={cn(
                                "text-4xl font-black italic tracking-tighter mb-2",
                                percentageSpent >= 90 ? "text-destructive" : "text-violet-400"
                            )}>
                                {analytics.budgetLimitUsd ? `$${analytics.budgetLimitUsd.toFixed(0)}` : '∞'}
                            </div>
                            {analytics.budgetLimitUsd && (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                                        <span className="opacity-40">Usage Level</span>
                                        <span className={percentageSpent >= 90 ? "text-destructive" : "text-violet-400"}>{Math.round(percentageSpent)}%</span>
                                    </div>
                                    <div className="w-full bg-foreground/5 rounded-full h-1.5 overflow-hidden border border-foreground/10 p-[1px]">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${percentageSpent}%` }}
                                            className={cn(
                                                "h-full rounded-full transition-all duration-1000",
                                                percentageSpent >= 90 ? "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]" : "bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]"
                                            )}
                                        />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            <Card className="glass-panel border-foreground/20 shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                    <TrendingUp className="w-32 h-32" />
                </div>
                <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                    <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                        <Waves className="w-4 h-4 text-primary" />
                        Temporal Mission Velocity
                    </CardTitle>
                    <CardDescription className="italic font-medium">30-day cross-sectional launch frequency telemetry.</CardDescription>
                </CardHeader>
                <CardContent className="h-[320px] pt-8">
                    {analytics.dailyStats && analytics.dailyStats.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analytics.dailyStats}>
                                <defs>
                                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis
                                    dataKey="date"
                                    fontSize={9}
                                    tick={{ fill: 'rgba(255,255,255,0.4)', fontWeight: 700 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                />
                                <YAxis fontSize={9} tick={{ fill: 'rgba(255,255,255,0.4)', fontWeight: 700 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                                    contentStyle={{ 
                                        backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                                        borderColor: 'rgba(255,255,255,0.1)', 
                                        borderRadius: '12px',
                                        backdropFilter: 'blur(8px)',
                                        fontSize: '11px',
                                        fontWeight: '700'
                                    }}
                                />
                                <Bar dataKey="launches" radius={[4, 4, 0, 0]}>
                                    {analytics.dailyStats.map((entry: any, i: number) => (
                                        <Cell key={i} fill="url(#barGradient)" />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                            <Activity className="w-12 h-12 opacity-10" />
                            <p className="text-sm font-black uppercase tracking-widest italic opacity-40">No launch activity telemetry available.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {analytics.userSpend && analytics.userSpend.length > 0 && (
                <Card className="glass-panel border-foreground/20 shadow-2xl overflow-hidden">
                    <CardHeader className="bg-foreground/5 border-b border-foreground/10">
                        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                            <Users className="w-4 h-4 text-primary" /> 
                            Operational Resource Allocation
                        </CardTitle>
                        <CardDescription className="italic font-medium">Monthly expenditure breakdown per-authorized agent operator.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-foreground/10">
                                    <TableHead className="text-[10px] font-black uppercase tracking-widest opacity-40">Operator ID</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase tracking-widest opacity-40">Cumulative Burn</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase tracking-widest opacity-40">Daily Mean</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase tracking-widest opacity-40">Last Engagement</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analytics.userSpend.map((u: any) => (
                                    <TableRow key={u.userId} className="hover:bg-foreground/5 transition-colors border-foreground/5">
                                        <TableCell className="font-mono text-[10px] font-bold text-muted-foreground">USER::{u.userId}</TableCell>
                                        <TableCell className="font-black text-sm italic tracking-tight text-foreground">${parseFloat(u.monthlySpendUsd || '0').toFixed(3)}</TableCell>
                                        <TableCell className="font-bold text-[11px] opacity-60">${parseFloat(u.dailySpendUsd || '0').toFixed(4)}</TableCell>
                                        <TableCell className="text-[10px] font-black text-muted-foreground uppercase italic pb-4">
                                            {u.lastSpendAt ? new Date(u.lastSpendAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'NEVER'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
