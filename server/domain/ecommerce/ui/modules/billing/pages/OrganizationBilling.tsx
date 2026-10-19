import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CreditCard, Zap, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function OrganizationBilling() {
    const { selectedOrgId } = useOrgContext();
    const { toast } = useToast();

    const { data: org, isLoading } = useQuery<any>({
        queryKey: [`/api/organizations/${selectedOrgId}`],
        enabled: !!selectedOrgId
    });

    const checkoutMutation = useMutation({
        mutationFn: async (planId: string) => {
            const res = await apiRequest("POST", "/api/billing/checkout", {
                planId,
                successUrl: window.location.href + "?success=true",
                cancelUrl: window.location.href + "?canceled=true"
            });
            return res.json();
        },
        onSuccess: (data) => {
            if (data.url) window.location.href = data.url;
        },
        onError: (error: any) => {
            toast({
                title: "Checkout failed",
                description: error.message,
                variant: "destructive"
            });
        }
    });

    if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    const isPro = org?.subscriptionStatus === 'active';

    return (
        <div className="container mx-auto p-6 space-y-6">
            <header className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Billing & Subscriptions</h1>
                <p className="text-muted-foreground">Manage your organization's subscription plan and payment methods.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-primary/20 bg-sidebar/5 shadow-premium">
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center">
                            Current Plan
                            <Badge variant={isPro ? "default" : "secondary"} className={isPro ? "bg-green-500/20 text-green-700 border-green-500/30" : ""}>
                                {isPro ? "Pro Plan" : "Free Tier"}
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            {isPro ? "Your organization has full access to all features." : "Upgrade to Pro for unlimited missions and advanced agent models."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span>Unlimited Mission Launches</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span>Advanced AI Reasoning Models</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span>Priority Execution Queue</span>
                        </div>
                    </CardContent>
                    {!isPro && (
                        <CardFooter>
                            <Button
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={() => checkoutMutation.mutate("price_premium_monthly")} // Replace with actual Stripe Price ID
                                disabled={checkoutMutation.isPending}
                            >
                                {checkoutMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                                Upgrade to Pro - $49/mo
                            </Button>
                        </CardFooter>
                    )}
                </Card>

                <Card className="border-border shadow-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-primary" />
                            Payment Method
                        </CardTitle>
                        <CardDescription>
                            Managed via Stripe Secure Portal
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center p-8 text-center bg-muted rounded-lg mx-6 mb-6 border border-dashed">
                        {isPro ? (
                            <>
                                <CheckCircle2 className="w-10 h-10 text-green-500 mb-2" />
                                <p className="text-sm font-medium">Valid payment method on file</p>
                                <Button variant="link" className="text-primary mt-2">Manage in Stripe Portal</Button>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="w-10 h-10 text-foreground mb-2" />
                                <p className="text-sm text-muted-foreground">No payment method added</p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

