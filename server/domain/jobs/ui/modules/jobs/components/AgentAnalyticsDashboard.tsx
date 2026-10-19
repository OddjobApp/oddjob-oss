import React from "react";
import { useQuery } from "@tanstack/react-query";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    TrendingUp,
    AlertTriangle,
    CheckCircle,
    Clock,
    DollarSign
} from "lucide-react";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";

interface AgentAnalyticsDashboardProps {
    jobId: number;
}

export default function AgentAnalyticsDashboard({ jobId }: AgentAnalyticsDashboardProps) {
    const { data: analytics, isLoading, isError } = useQuery<any>({
        queryKey: [`/api/jobs/${jobId}/analytics`],
        enabled: !!jobId,
    });

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Skeleton className="h-48 rounded-lg" />
                    <Skeleton className="h-48 rounded-lg" />
                </div>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                <AlertTriangle className="w-10 h-10 text-destructive/40" />
                <p className="text-xs font-bold uppercase tracking-widest text-destructive">Failed to load analytics</p>
                <p className="text-[11px] text-muted-foreground">Could not retrieve execution data. Please refresh and try again.</p>
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                <TrendingUp className="w-12 h-12 text-muted-foreground/20" />
                <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No Analytics Data</p>
                    <p className="text-[11px] text-muted-foreground/60 max-w-[300px]">This agent has not been executed enough times to generate analytics.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard
                    title="Total Executions"
                    value={analytics.totalExecutions || 0}
                    icon={<Clock className="h-4 w-4" />}
                />
                <StatCard
                    title="Success Rate"
                    value={`${Math.round((analytics.successRate || 0) * 100)}%`}
                    icon={<CheckCircle className="h-4 w-4" />}
                />
                <StatCard
                    title="Avg Duration"
                    value={`${analytics.avgDuration || 0}s`}
                    icon={<Clock className="h-4 w-4" />}
                />
                <StatCard
                    title="Total Cost"
                    value={`$${(analytics.totalCost || 0).toFixed(4)}`}
                    icon={<DollarSign className="h-4 w-4" />}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Success/Failure Over Time */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-bold uppercase tracking-widest">Execution Trend</CardTitle>
                        <CardDescription>Success rate over time</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-48 flex flex-col items-center justify-center bg-muted/20 rounded gap-2 text-muted-foreground">
                            <TrendingUp className="w-6 h-6 opacity-30" />
                            <p className="text-xs font-medium">Execution trend chart coming soon</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Top Failure Reasons */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-bold uppercase tracking-widest">Top Failure Reasons</CardTitle>
                        <CardDescription>Why executions failed</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Reason</TableHead>
                                    <TableHead className="text-right">Count</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analytics.failures?.map((failure: any) => (
                                    <TableRow key={failure.reason}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                                                <Badge variant="outline">{failure.reason}</Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {failure.count}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {(!analytics.failures || analytics.failures.length === 0) && (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center text-muted-foreground">
                                            No failures recorded
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}

function StatCard({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
                        <p className="text-2xl font-black">{value}</p>
                    </div>
                    <div className="text-primary/20">{icon}</div>
                </div>
            </CardContent>
        </Card>
    );
}
