import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { DollarSign, TrendingUp, History, ArrowUpRight } from "lucide-react";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function DeveloperEarnings() {
    const { selectedOrgId } = useOrgContext();

    const { data: accrued, isLoading: loadingAccrued } = useQuery<any>({
        queryKey: ["/api/billing/accrued"],
        enabled: !!selectedOrgId
    });

    const { data: payouts, isLoading: loadingPayouts } = useQuery<any[]>({
        queryKey: ["/api/billing/payouts"],
        enabled: !!selectedOrgId
    });

    const { data: earningsByApp } = useQuery<any[]>({
        queryKey: ["/api/apps/developer/earnings"],
        enabled: !!selectedOrgId
    });

    if (loadingAccrued || loadingPayouts) {
        return (
            <div className="container mx-auto p-6 space-y-6">
                <header className="space-y-2">
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-4 w-96" />
                </header>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 col-span-2 w-full" />
                </div>
                <Card>
                    <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
                    <CardContent><Skeleton className="h-[200px] w-full" /></CardContent>
                </Card>
            </div>
        );
    }

    const totalAccrued = accrued?.total || 0;
    const progressWidth = Math.min((totalAccrued / 50) * 100, 100);

    // Group earnings by day for the chart
    const dailyEarnings = (payouts || []).slice(0, 30).reduce((acc: any[], payout) => {
        const date = format(new Date(payout.createdAt), 'yyyy-MM-dd');
        const amount = parseFloat(payout.amountUsd);
        const existing = acc.find(item => item.date === date);
        if (existing) {
            existing.amount += amount;
        } else {
            acc.push({ date, amount });
        }
        return acc;
    }, []).reverse();

    return (
        <div className="container mx-auto p-6 space-y-6">
            <header className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Developer Earnings</h1>
                <p className="text-muted-foreground">Track your accrued earnings from app launches and view payout history.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-primary text-primary-foreground border-none shadow-premium overflow-hidden relative">
                    <CardHeader className="relative z-10">
                        <CardTitle className="text-foreground/80 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5" />
                            Accrued Balance
                        </CardTitle>
                        <div className="text-4xl font-black mt-2">
                            ${(totalAccrued).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <CardDescription className="text-foreground/60">
                            Available for next payout cycle
                        </CardDescription>
                    </CardHeader>
                    <ArrowUpRight className="absolute bottom-[-10px] right-[-10px] w-32 h-32 text-foreground/10 rotate-12" />
                </Card>

                <Card className="col-span-2 border-border">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="w-5 h-5 text-primary" />
                            Payment Threshold
                        </CardTitle>
                        <CardDescription>
                            Payouts are processed automatically once your balance exceeds $50.00.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Progress
                            value={progressWidth}
                            indicatorClassName="bg-primary"
                            className="h-4 bg-muted"
                        />
                        <div className="flex justify-between mt-2 text-xs text-muted-foreground font-medium">
                            <span>$0.00</span>
                            <span>$50.00 Threshold</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-border">
                    <CardHeader>
                        <CardTitle>Daily Earnings</CardTitle>
                        <CardDescription>Revenue trajectory over recent active days</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {dailyEarnings.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyEarnings}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                                    <XAxis
                                        dataKey="date"
                                        fontSize={10}
                                        tickFormatter={(val) => format(new Date(val), 'MMM dd')}
                                    />
                                    <YAxis fontSize={10} />
                                    <Tooltip
                                        labelFormatter={(val) => format(new Date(val), 'PPP')}
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                                    />
                                    <Bar dataKey="amount" fill="#cd7f32" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm italic">
                                No recent earnings data to display.
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="border-border">
                    <CardHeader>
                        <CardTitle>Accrual History</CardTitle>
                        <CardDescription>Detailed breakdown of your earnings from app launches.</CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-[300px] overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>Date</TableHead>
                                    <TableHead>App</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {payouts?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground italic">
                                            No earnings recorded yet.
                                        </TableCell>
                                    </TableRow>
                                ) : payouts?.slice(0, 10).map((payout) => (
                                    <TableRow key={payout.id}>
                                        <TableCell>{format(new Date(payout.createdAt), 'MMM dd')}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-mono">#{payout.appId}</Badge>
                                        </TableCell>
                                        <TableCell className="font-bold text-green-600">
                                            +${parseFloat(payout.amountUsd).toFixed(2)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={payout.status === 'paid' ? 'default' : 'secondary'}
                                                className={payout.status === 'paid' ? 'bg-green-500/10 text-green-600 border-green-500/20' : ''}
                                            >
                                                {payout.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {earningsByApp && earningsByApp.length > 0 && (
                <Card className="border-border">
                    <CardHeader>
                        <CardTitle>Earnings by App</CardTitle>
                        <CardDescription>Per-app payout totals grouped by status.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>App</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {earningsByApp.map((row: any, i: number) => (
                                    <TableRow key={i}>
                                        <TableCell>{row.appName || `#${row.appId}`}</TableCell>
                                        <TableCell>
                                            <Badge variant={row.status === 'paid' ? 'default' : 'secondary'}>{row.status}</Badge>
                                        </TableCell>
                                        <TableCell className="font-bold">${parseFloat(row.total || '0').toFixed(2)}</TableCell>
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

