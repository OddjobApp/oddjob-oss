import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { CreditCard, CheckCircle2, ExternalLink, Zap, ShieldCheck, AlertCircle, Sparkles } from "lucide-react";

export function BillingSettingsSection() {
    const { toast } = useToast();

    const { data: summary, isLoading, refetch } = useQuery({
        queryKey: ["/api/billing/summary"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/billing/summary");
            return res.json();
        },
    });

    const checkoutMutation = useMutation({
        mutationFn: async (planId: string) => {
            const res = await apiRequest("POST", "/api/billing/checkout", { planId });
            return res.json();
        },
        onSuccess: (data: { url?: string }) => {
            if (data.url) {
                window.location.href = data.url;
            } else {
                toast({ title: "Checkout Error", description: "No checkout URL returned.", variant: "destructive" });
            }
        },
        onError: (err: any) => {
            toast({ title: "Checkout Failed", description: err.message, variant: "destructive" });
        },
    });

    const portalMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/billing/portal", {});
            return res.json();
        },
        onSuccess: (data: { url?: string }) => {
            if (data.url) {
                window.location.href = data.url;
            } else {
                toast({ title: "Portal Error", description: "No portal URL returned.", variant: "destructive" });
            }
        },
        onError: (err: any) => {
            toast({ title: "Portal Access Failed", description: err.message, variant: "destructive" });
        },
    });

    if (isLoading) {
        return (
            <Card className="border-border bg-card/60 backdrop-blur-2xl">
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                    Loading subscription and billing data...
                </CardContent>
            </Card>
        );
    }

    const currentPlan = summary?.currentPlan;
    const status = summary?.subscriptionStatus || "free";
    const usage = summary?.usage || { missionsThisMonth: 0, missionsLimit: 25, seatsUsed: 1, seatsLimit: 1 };
    const plans = summary?.availablePlans || [];

    const isPastDue = status === "past_due";
    const isActive = status === "active";
    const isFree = status === "free" || !status;

    // Infinity does not survive JSON: the server's unlimited quota arrives as null.
    const missionsUnlimited = usage.missionsLimit == null || usage.missionsLimit === Infinity;
    const missionPct = missionsUnlimited ? 0 : Math.min(100, Math.round((usage.missionsThisMonth / (usage.missionsLimit || 1)) * 100));

    return (
        <div className="space-y-6">
            {/* Status Alert if Past Due */}
            {isPastDue && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <div className="flex-1">
                        <span className="font-bold">Payment Past Due:</span> Your latest subscription renewal failed. Please update your payment method to keep autonomous cycles active.
                    </div>
                    <Button
                        size="sm"
                        variant="destructive"
                        className="rounded-xl shrink-0"
                        onClick={() => portalMutation.mutate()}
                        disabled={portalMutation.isPending}
                    >
                        Update Card
                    </Button>
                </div>
            )}

            {/* Current Plan Overview Card */}
            <Card className="border-border bg-card/60 backdrop-blur-2xl">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-primary" />
                            <CardTitle>Subscription & Plans</CardTitle>
                        </div>
                        <Badge
                            variant={isActive ? "default" : isPastDue ? "destructive" : "secondary"}
                            className="uppercase tracking-wider font-mono text-xs px-2.5 py-0.5 rounded-full"
                        >
                            {status}
                        </Badge>
                    </div>
                    <CardDescription>
                        Manage your organization's subscription tier, usage quotas, and invoices.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-muted/30 border border-border">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-black tracking-tight text-foreground">{currentPlan?.name || "Free Trial"}</h3>
                                {currentPlan?.priceMonthlyUsd ? (
                                    <span className="text-sm font-bold text-muted-foreground">${currentPlan.priceMonthlyUsd}/month</span>
                                ) : (
                                    <span className="text-sm font-bold text-muted-foreground">Free</span>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 max-w-lg">
                                {currentPlan?.tagline || "Autonomous agent teams and visual workflows."}
                            </p>
                        </div>

                        {summary?.hasCustomerAccount && (
                            <Button
                                variant="outline"
                                className="rounded-xl border-border hover:bg-primary/10 hover:border-primary/30 shrink-0"
                                onClick={() => portalMutation.mutate()}
                                disabled={portalMutation.isPending}
                            >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Manage Billing & Invoices
                            </Button>
                        )}
                    </div>

                    {/* Usage Meters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-background/50 border border-border space-y-2">
                            <div className="flex justify-between text-xs font-bold">
                                <span className="text-muted-foreground">Monthly Missions</span>
                                <span className="font-mono text-foreground">{usage.missionsThisMonth} / {missionsUnlimited ? "Unlimited" : usage.missionsLimit}</span>
                            </div>
                            <Progress value={missionPct} className="h-2" />
                            <p className="text-[11px] text-muted-foreground">Resets at the start of your billing cycle.</p>
                        </div>

                        <div className="p-4 rounded-xl bg-background/50 border border-border space-y-2">
                            <div className="flex justify-between text-xs font-bold">
                                <span className="text-muted-foreground">Active Seats</span>
                                <span className="font-mono text-foreground">{usage.seatsUsed} / {usage.seatsLimit}</span>
                            </div>
                            <Progress value={Math.min(100, Math.round((usage.seatsUsed / (usage.seatsLimit || 1)) * 100))} className="h-2" />
                            <p className="text-[11px] text-muted-foreground">Operators authorized in this organization.</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Plan Tier Selection Grid */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Available Commercial Tiers</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {plans.filter((p: any) => p.id !== "free").map((plan: any) => {
                        const isCurrent = currentPlan?.id === plan.id;

                        return (
                            <div
                                key={plan.id}
                                className={`relative flex flex-col justify-between p-5 rounded-2xl border transition-all ${
                                    plan.popular
                                        ? "bg-card/90 border-primary/40 shadow-lg shadow-primary/5"
                                        : "bg-card/40 border-border hover:border-border/80"
                                }`}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider">
                                        Most Popular
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div>
                                        <h4 className="text-lg font-black tracking-tight text-foreground">{plan.name}</h4>
                                        <p className="text-xs text-muted-foreground mt-0.5">{plan.tagline}</p>
                                    </div>

                                    <div className="flex items-baseline gap-1">
                                        <span className="text-3xl font-black text-foreground">${plan.priceMonthlyUsd}</span>
                                        <span className="text-xs text-muted-foreground">/ month</span>
                                    </div>

                                    <div className="space-y-2 pt-2 border-t border-border">
                                        {plan.features.slice(0, 5).map((feature: string, idx: number) => (
                                            <div key={idx} className="flex items-start gap-2 text-xs text-foreground/90">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                                                <span>{feature}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-6">
                                    <Button
                                        className="w-full rounded-xl font-bold"
                                        variant={isCurrent ? "secondary" : plan.popular ? "default" : "outline"}
                                        disabled={isCurrent || checkoutMutation.isPending}
                                        onClick={() => checkoutMutation.mutate(plan.id)}
                                    >
                                        {isCurrent ? (
                                            "Current Plan"
                                        ) : checkoutMutation.isPending ? (
                                            "Redirecting..."
                                        ) : (
                                            <>
                                                <Zap className="w-3.5 h-3.5 mr-1.5" />
                                                Upgrade to {plan.name}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
