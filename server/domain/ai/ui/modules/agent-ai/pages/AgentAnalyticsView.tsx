
import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell
} from "recharts";
import { Loader2, Wrench } from "lucide-react";

interface ToolUsage {
    toolName: string;
    count: number;
}

interface AgentAnalyticsViewProps {
    title?: string;
    description?: string;
}

export default function AgentAnalyticsView({
    title = "Agent Analytics",
    description = "Performance metrics and tool usage patterns.",
}: AgentAnalyticsViewProps) {
    const { data: toolUsage, isLoading } = useQuery<ToolUsage[]>({
        queryKey: ["agent-tool-analytics"],
        queryFn: async () => {
            const res = await fetch("/api/agent/analytics/tools");
            if (!res.ok) throw new Error("Failed to fetch analytics");
            return res.json();
        },
    });

    const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff8042", "#a4de6c", "#d0ed57", "#8dd1e1", "#83a6ed", "#8e43e7", "#ffc658"];

    return (
        <div className="w-full p-4 h-full space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                    <p className="text-muted-foreground mt-1">
                        {description}
                    </p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="col-span-2 md:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Wrench className="h-5 w-5 text-primary" />
                            Top Tool Usage
                        </CardTitle>
                        <CardDescription>
                            Most frequently used tools by the agent across all runs.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[400px] w-full">
                            {isLoading ? (
                                <div className="flex h-full items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={toolUsage}
                                        layout="vertical"
                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} strokeOpacity={0.2} />
                                        <XAxis type="number" hide />
                                        <YAxis
                                            type="category"
                                            dataKey="toolName"
                                            width={150}
                                            tick={{ fontSize: 12 }}
                                            interval={0}
                                        />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            cursor={{ fill: 'transparent' }}
                                        />
                                        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                                            {toolUsage?.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Placeholder for future charts */}
                <Card className="col-span-2 md:col-span-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground bg-muted/20 border-dashed">
                    <div className="max-w-xs">
                        <h3 className="text-lg font-semibold mb-2">Cost & Performance</h3>
                        <p className="text-sm">Additional metrics coming soon (Tokens/Run, Success Rate, Latency).</p>
                    </div>
                </Card>
            </div>
        </div>
    );
}
