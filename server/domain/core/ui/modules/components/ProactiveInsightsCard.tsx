import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Sparkles, TrendingUp, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface Insight {
    id: string;
    type: "optimization" | "warning" | "success";
    title: string;
    description: string;
    impact: string;
    actionLabel?: string;
    actionPath?: string;
}

export function ProactiveInsightsCard() {
    const { data: insights = [] } = useSuspenseQuery<Insight[]>({
        queryKey: ["/api/dashboard/insights"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/dashboard/insights");
            return res.json();
        },
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
    });

    if (insights.length === 0) return null;

    return (
        <Card className="border-border/40 bg-card overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
            <CardHeader className="border-b bg-muted/30 px-5 py-4 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="bg-primary/10 p-1.5 rounded-lg">
                        <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-base font-semibold text-foreground">Proactive Insights</CardTitle>
                </div>
                <Badge variant="outline" className="bg-background text-primary border-primary/20 uppercase text-[10px] tracking-widest font-bold">
                    AI Insights
                </Badge>
            </CardHeader>
            <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                    {insights.map((insight) => (
                        <li key={insight.id} className="p-4 hover:bg-muted/30 transition-colors group">
                            <div className="flex gap-4">
                                <div className="mt-1">
                                    {insight.type === "optimization" && <TrendingUp className="h-4 w-4 text-blue-500" />}
                                    {insight.type === "warning" && <AlertCircle className="h-4 w-4 text-amber-500" />}
                                    {insight.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                                </div>
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                                        <span className="text-[10px] font-medium text-muted-foreground uppercase">{insight.impact}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
                                    {insight.actionLabel && insight.actionPath && (
                                        <div className="pt-2">
                                            <Link href={insight.actionPath}>
                                                <Button variant="ghost" size="sm" className="h-7 px-0 text-primary hover:bg-transparent hover:text-primary/80 text-xs font-semibold group-hover:translate-x-1 transition-transform">
                                                    {insight.actionLabel}
                                                    <ArrowRight className="ml-1 h-3 w-3" />
                                                </Button>
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="p-4 bg-muted/20 border-t border-border/40">
                    <p className="text-[10px] text-muted-foreground text-center italic">
                        Real-time system monitoring active. No immediate intervention required.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
