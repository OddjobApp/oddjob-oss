
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { BrainCircuit, Coins, Zap } from 'lucide-react';

interface AIUsageLog {
    id: number;
    provider: string;
    model: string;
    totalTokens: number;
    costUsd: string; // Decimal string
}

interface AIMetricsProps {
    usageLogs?: AIUsageLog[];
}

export function AIMetrics({ usageLogs = [] }: AIMetricsProps) {
    if (!usageLogs || usageLogs.length === 0) return null;

    const totalCost = usageLogs.reduce((sum, log) => sum + parseFloat(log.costUsd || '0'), 0);
    const totalTokens = usageLogs.reduce((sum, log) => sum + log.totalTokens, 0);

    // Group by Model
    const byModel = usageLogs.reduce((acc, log) => {
        const key = `${log.provider}/${log.model}`;
        if (!acc[key]) acc[key] = { cost: 0, tokens: 0, count: 0 };
        acc[key].cost += parseFloat(log.costUsd || '0');
        acc[key].tokens += log.totalTokens;
        acc[key].count++;
        return acc;
    }, {} as Record<string, { cost: number; tokens: number; count: number }>);

    return (
        <Card className="shadow-sm border-indigo-100 bg-indigo-50/10">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-indigo-700">
                    <BrainCircuit className="h-4 w-4" />
                    AI Consumption
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Coins className="h-3 w-3" /> Total Cost
                        </span>
                        <span className="text-xl font-bold text-foreground">
                            ${totalCost.toFixed(6)}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Zap className="h-3 w-3" /> Total Tokens
                        </span>
                        <span className="text-xl font-bold text-foreground">
                            {totalTokens.toLocaleString()}
                        </span>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">Breakdown by Model</div>
                    {Object.entries(byModel).map(([model, metrics]) => (
                        <div key={model} className="flex items-center justify-between text-xs bg-background/50 p-2 rounded border">
                            <div className="font-medium truncate max-w-[150px]">{model}</div>
                            <div className="flex items-center gap-3 text-muted-foreground">
                                <span>{metrics.count} calls</span>
                                <span>{metrics.tokens} tks</span>
                                <span className="font-bold text-foreground">${metrics.cost.toFixed(5)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
