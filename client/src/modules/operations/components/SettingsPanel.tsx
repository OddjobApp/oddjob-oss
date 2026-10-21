import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Shield, Monitor, Clock, Cpu, DollarSign, Video, TerminalSquare, BrainCircuit, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { TrycuaSessionViewer } from "./TrycuaSessionViewer";
import { BillingSettingsSection } from "./BillingSettingsSection";
import { OrgAgentMailSettings } from "./OrgAgentMailSettings";
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";

export function SettingsPanel() {
    const { toast } = useToast();
    const { user } = useAuth();
    const [watchingSessionId, setWatchingSessionId] = useState<string | null>(null);

    const { data: settings, isLoading } = useQuery({
        queryKey: ["/api/org-settings"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/org-settings");
            return res.json();
        },
    });

    const { data: sessions } = useQuery({
        queryKey: ["/api/integrations/trycua/sessions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/integrations/trycua/sessions");
            const data = await res.json(); return (data.sessions ?? []) as any[];
        },
        refetchInterval: 5000,
        enabled: settings?.trycuaEnabled,
    });

    const updateSettingsMutation = useMutation({
        mutationFn: async (newSettings: any) => {
            const res = await apiRequest("PUT", "/api/org-settings", newSettings);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/org-settings"] });
            toast({ title: "Settings Updated", description: "Organization settings have been saved." });
        },
        onError: (err: any) => {
            toast({ title: "Update Failed", description: err.message, variant: "destructive" });
        },
    });

    if (isLoading) {
        return <div className="text-center p-6">Loading settings...</div>;
    }

    const handleToggle = (key: string, value: boolean) => {
        updateSettingsMutation.mutate({ ...settings, [key]: value });
    };

    const handleChange = (key: string, value: any) => {
        updateSettingsMutation.mutate({ ...settings, [key]: value });
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-end bg-black/20 p-6 rounded-3xl border border-white/5 backdrop-blur-2xl">
                <div>
                    <h1 className="text-4xl font-black tracking-tighter text-foreground">
                        Organization <span className="text-primary">Settings</span>
                    </h1>
                    <p className="text-muted-foreground font-medium mt-1">Configure global parameters, commercial subscriptions, and integrations.</p>
                </div>
            </div>

            {/* Commercial Billing & Subscription Section */}
            <BillingSettingsSection />
            {settings?.organizationId && <OrgAgentMailSettings key={`agentmail-${settings.organizationId}`} organizationId={settings.organizationId} />}
            {/* AI provider keys moved to Platform -> AI Models. */}
            <Link href="/platform/ai-models" className="flex items-center justify-between rounded-md border p-4 hover:bg-muted/40">
                <span className="flex items-center gap-2 font-medium"><BrainCircuit className="h-5 w-5 text-primary" />AI models and provider keys are in Platform → AI Models</span>
                <ArrowRight className="h-4 w-4" />
            </Link>

            <div className="grid grid-cols-1 gap-6">
                {/* Trycua Settings */}
                <Card className="border-white/5 bg-black/20 backdrop-blur-2xl">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-primary" />
                            <CardTitle>Trycua Integration</CardTitle>
                        </div>
                        <CardDescription>Secure desktop automation and sandboxing.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold">Enable Trycua</Label>
                                <p className="text-xs text-muted-foreground">Allow agents to provision secure VM sessions.</p>
                            </div>
                            <Switch 
                                checked={settings?.trycuaEnabled} 
                                onCheckedChange={(val) => handleToggle("trycuaEnabled", val)} 
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                                    <Monitor className="w-3 h-3" /> Default OS
                                </Label>
                                <Select 
                                    value={settings?.trycuaDefaultOs || "linux"} 
                                    onValueChange={(val) => handleChange("trycuaDefaultOs", val)}
                                    disabled={!settings?.trycuaEnabled}
                                >
                                    <SelectTrigger className="bg-foreground/5 border-white/10 rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="linux">Linux</SelectItem>
                                        <SelectItem value="windows">Windows</SelectItem>
                                        <SelectItem value="macos">macOS</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> Max Session Time (mins)
                                </Label>
                                <Input 
                                    type="number" 
                                    value={settings?.trycuaMaxSessionTime || 60} 
                                    onChange={(e) => handleChange("trycuaMaxSessionTime", parseInt(e.target.value))}
                                    className="bg-foreground/5 border-white/10 rounded-xl"
                                    disabled={!settings?.trycuaEnabled}
                                    min={1}
                                    max={1440}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* General Settings */}
                <Card className="border-white/5 bg-black/20 backdrop-blur-2xl">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Cpu className="w-5 h-5 text-primary" />
                            <CardTitle>Resource Governance</CardTitle>
                        </div>
                        <CardDescription>Control resource limits and concurrency.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                                    <Cpu className="w-3 h-3" /> Mission Concurrency
                                </Label>
                                <Input 
                                    type="number" 
                                    value={settings?.missionConcurrency || 1} 
                                    onChange={(e) => handleChange("missionConcurrency", parseInt(e.target.value))}
                                    className="bg-foreground/5 border-white/10 rounded-xl"
                                    min={1}
                                    max={20}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                                    <DollarSign className="w-3 h-3" /> Monthly Budget (USD)
                                </Label>
                                <Input 
                                    type="number" 
                                    value={settings?.monthlyBudgetUsd || 100} 
                                    onChange={(e) => handleChange("monthlyBudgetUsd", parseFloat(e.target.value))}
                                    className="bg-foreground/5 border-white/10 rounded-xl"
                                    min={0}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold">Datasets Integration</Label>
                                <p className="text-xs text-muted-foreground">Enable shared datasets across missions.</p>
                            </div>
                            <Switch 
                                checked={settings?.datasetsEnabled} 
                                onCheckedChange={(val) => handleToggle("datasetsEnabled", val)} 
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Agent Soul Settings */}
                <Card className="border-white/5 bg-black/20 backdrop-blur-2xl">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Cpu className="w-5 h-5 text-primary" />
                            <CardTitle>Agent Soul</CardTitle>
                        </div>
                        <CardDescription>Configure the personality and archetype of the assistant.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                Assistant Archetype
                            </Label>
                            <Input 
                                type="text" 
                                value={settings?.assistantSoulArchetype || ""} 
                                onChange={(e) => handleChange("assistantSoulArchetype", e.target.value)}
                                className="bg-foreground/5 border-white/10 rounded-xl"
                                placeholder="e.g. Helpful Assistant, Stern Auditor"
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>

                {/* Live Sessions */}
                {settings?.trycuaEnabled && (
                    <Card className="border-white/5 bg-black/20 backdrop-blur-2xl">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Video className="w-5 h-5 text-primary" />
                                <CardTitle>Active Sessions</CardTitle>
                            </div>
                            <CardDescription>Monitor and join running Trycua VM sessions.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {watchingSessionId && user ? (
                                <div className="h-[480px]">
                                    <TrycuaSessionViewer
                                        sessionId={watchingSessionId}
                                        organizationId={user.defaultOrgId ?? 1}
                                        userId={String(user.id)}
                                        onClose={() => setWatchingSessionId(null)}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {(!sessions || sessions.length === 0) && (
                                        <div className="py-8 text-center opacity-40">
                                            <TerminalSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                            <p className="text-sm text-muted-foreground">No active sessions</p>
                                        </div>
                                    )}
                                    {sessions?.filter((s: any) => s.status === "active").map((session: any) => (
                                        <div
                                            key={session.id}
                                            className="flex items-center justify-between p-3 rounded-xl bg-foreground/5 border border-white/5 hover:border-primary/20 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                                <div>
                                                    <p className="text-xs font-bold font-mono">{session.id.slice(0, 8)}…</p>
                                                    <p className="text-[10px] text-muted-foreground">{session.os} · {session.provider}</p>
                                                </div>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs rounded-lg border-white/10 hover:bg-primary/10 hover:border-primary/30"
                                                onClick={() => setWatchingSessionId(session.id)}
                                            >
                                                <Video className="w-3 h-3 mr-1" /> Join
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
        </div>
    );
}
