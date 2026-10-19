import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@domain-ui/core/ui/components/ui/card";
import {
    DollarSign,
    Clock,
    TrendingUp,
    Zap,
    BarChart3
} from "lucide-react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";

interface ROIMetrics {
    netSavings: string;
    hoursSaved: string;
    roiMultiplier: string;
    periodOps: number;
    automationCost: string;
    humanCostEquivalent: string;
}

interface ROITrend {
    date: string;
    savings: string;
    tasks: number;
}

export default function ROIAnalytics() {
    const { data: metrics, isLoading: isMetricsLoading } = useQuery<ROIMetrics>({
        queryKey: ["/api/analytics/roi"],
    });

    const { data: trend, isLoading: isTrendLoading } = useQuery<ROITrend[]>({
        queryKey: ["/api/analytics/roi/trend"],
    });

    if (isMetricsLoading || isTrendLoading) {
        return <div className="p-8">Loading analytics...</div>;
    }

    const {
        netSavings = "0.00",
        hoursSaved = "0.0",
        roiMultiplier = "0x",
        periodOps = 0
    } = metrics || {};

    return (
        <div className="p-4 md:p-6 space-y-8 w-full">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                    <TrendingUp className="w-8 h-8 text-primary" />
                    ROI & Value Analytics
                </h1>
                <p className="text-muted-foreground mt-1">
                    Quantifying the value of your autonomous workforce.
                </p>
            </div>

            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="shadow-soft border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Net Savings (30d)
                        </CardTitle>
                        <DollarSign className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        {/* Colour follows the sign. Hardcoded green rendered a
                            LOSS as a gain — the page showed "$-0.05" in the
                            same green it uses for savings. */}
                        <div
                            className={`text-2xl font-bold ${
                                Number(netSavings) < 0 ? "text-red-500" : "text-green-500"
                            }`}
                        >
                            ${netSavings}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Vs. human equivalent cost
                        </p>
                    </CardContent>
                </Card>

                <Card className="shadow-soft border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Time Saved
                        </CardTitle>
                        <Clock className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{hoursSaved} Hours</div>
                        <p className="text-xs text-muted-foreground">
                            Manual labor diverted
                        </p>
                    </CardContent>
                </Card>

                <Card className="shadow-soft border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Efficiency Multiplier
                        </CardTitle>
                        <Zap className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-500">{roiMultiplier}</div>
                        <p className="text-xs text-muted-foreground">
                            Return on automated spend
                        </p>
                    </CardContent>
                </Card>

                <Card className="shadow-soft border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Ops Automated
                        </CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{periodOps}</div>
                        <p className="text-xs text-muted-foreground">
                            Successful task executions
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Trend Chart */}
            <Card className="shadow-soft border-none">
                <CardHeader>
                    <CardTitle>Cumulative Savings Trend</CardTitle>
                    <CardDescription>
                        Projected cost savings over time based on executed workflows.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trend}>
                                <defs>
                                    <linearGradient id="colorSavings" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    stroke="#666"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#666"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(value) => `$${value}`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#10b981' }}
                                    formatter={(value: any) => [`$${value}`, 'Savings']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="savings"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorSavings)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
