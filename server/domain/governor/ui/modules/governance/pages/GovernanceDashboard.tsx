import React from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ShieldAlert,
    Users,
    Zap
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface HealthMetric {
    label: string;
    value: string | number;
    trend: 'up' | 'down' | 'stable';
    status: 'healthy' | 'warning' | 'critical';
}

function MetricCard({
    title,
    value,
    icon: Icon,
    description,
    trend
}: {
    title: string;
    value: string;
    icon: any;
    description?: string;
    trend?: string
}) {
    return (
        <Card className="shadow-soft border-none bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {description && (
                    <p className="text-xs text-muted-foreground mt-1">
                        {description}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export default function GovernanceDashboard() {
    const { data: stats } = useQuery({
        queryKey: ["/api/governor/stats"],
        // Fallback to safe defaults if API fails or is loading
        select: (data: any) => ({
            activePolicies: data.activePolicies ?? 0,
            violations24h: data.recentViolations ?? 0,
            pendingApprovals: data.pendingApprovals ?? 0,
            systemHealth: data.systemHealth ?? 'Unknown',
            totalPolicies: data.totalPolicies ?? 0
        })
    });

    const displayStats = stats || {
        activePolicies: '-',
        violations24h: '-',
        pendingApprovals: '-',
        systemHealth: 'Loading...'
    };

    return (
        <div className="p-8 space-y-8 max-w-7xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                    <Activity className="w-8 h-8 text-primary" />
                    Governance Status
                </h1>
                <p className="text-muted-foreground mt-1">
                    Real-time overview of compliance, system health, and enforcing policies.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    title="Active Policies"
                    value={displayStats.activePolicies.toString()}
                    icon={CheckCircle2}
                    description={stats ? `of ${stats.totalPolicies} total policies` : "Loading..."}
                />
                <MetricCard
                    title="Violations (24h)"
                    value={displayStats.violations24h.toString()}
                    icon={ShieldAlert}
                    description="Actions blocked by Governor"
                />
                <MetricCard
                    title="Pending Approvals"
                    value={displayStats.pendingApprovals.toString()}
                    icon={Users}
                    description="Requires admin Review"
                />
                <MetricCard
                    title="System Health"
                    value={displayStats.systemHealth}
                    icon={Activity}
                    description={displayStats.systemHealth === 'Healthy' ? "All systems operational" : "Check system logs"}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 shadow-soft border-none">
                    <CardHeader>
                        <CardTitle>Recent Violations</CardTitle>
                        <CardDescription>
                            Policy infractions detected and blocked by the Governor.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {/*
                          Three identical rows used to render here from
                          [1, 2, 3].map(...): "Budget Limit Exceeded — Job #882
                          attempted to consume $15.00 (Limit $10.00) — 2h ago".
                          The job number, the amounts and the timestamp were all
                          literals, repeated three times, on a page whose purpose
                          is to report what the Governor actually blocked.

                          /api/governor/stats returns counts, not incidents, so
                          the real violation count is shown instead. Restore the
                          itemised feed when an endpoint exposes the individual
                          records.
                        */}
                        <div className="space-y-4" data-testid="governance-recent-violations">
                            {displayStats.violations24h === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No policy infractions recorded in the last 24 hours.
                                </p>
                            ) : (
                                <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/5 border border-foreground/5">
                                    <div className="p-2 rounded-full bg-red-500/10">
                                        <AlertTriangle className="w-4 h-4 text-red-500" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-medium">
                                            {displayStats.violations24h} infraction
                                            {displayStats.violations24h === 1 ? "" : "s"} in the last 24 hours
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            Per-incident detail is not exposed by the Governor stats endpoint yet.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3 shadow-soft border-none">
                    <CardHeader>
                        <CardTitle>Quick Actions</CardTitle>
                        <CardDescription>
                            Common governance tasks and overrides.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="p-3 hover:bg-muted/10 cursor-pointer rounded-lg flex items-center gap-3 transition-colors">
                            <Zap className="w-4 h-4 text-yellow-500" />
                            <div className="flex-1">
                                <div className="font-medium text-sm">Emergency Override</div>
                                <div className="text-xs text-muted-foreground">Grant temporary unlimited access</div>
                            </div>
                        </div>
                        <div className="p-3 hover:bg-muted/10 cursor-pointer rounded-lg flex items-center gap-3 transition-colors">
                            <Users className="w-4 h-4 text-blue-500" />
                            <div className="flex-1">
                                <div className="font-medium text-sm">Review Approvals</div>
                                <div className="text-xs text-muted-foreground">5 pending requests</div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
