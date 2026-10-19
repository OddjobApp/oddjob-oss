import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { RotateCcw, ShieldCheck, Zap, AlertTriangle, Fingerprint, BrainCircuit, Activity, HandMetal } from 'lucide-react';
import type { AppDeployment } from "@shared/schema/apps";
import { cn } from "@/lib/utils";
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@domain-ui/core/ui/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@domain-ui/core/ui/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@domain-ui/core/ui/components/ui/dialog';

interface AuditFinding {
    category: string;
    severity: 'critical' | 'warning' | 'info';
    issue: string;
    recommendation: string;
}

interface AppControlPanelProps {
    appId: number;
    currentVersion: string;
    versions?: string[];
}

const severityColor = (s: string) => {
    if (s === 'critical') return 'border-destructive/40 bg-destructive/5 text-destructive';
    if (s === 'warning') return 'border-orange-400/40 bg-orange-400/5 text-orange-600';
    return 'border-border/50 bg-muted/30 text-muted-foreground';
};

export function AppControlPanel({ appId, currentVersion, versions }: AppControlPanelProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedVersion, setSelectedVersion] = useState<string>("");
    const [auditOpen, setAuditOpen] = useState(false);
    const [auditFindings, setAuditFindings] = useState<AuditFinding[]>([]);

    // Deployment logic for Guardrails
    const { data: deployment } = useQuery<AppDeployment | null>({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null;
            return res.json();
        }
    });

    const guardrailMutation = useMutation({
        mutationFn: async (updatedData: Partial<AppDeployment>) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/deploy`, updatedData);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/deploy`] });
            toast({ title: "Guardrails Synced", description: "Operational parameters have been hardened." });
        },
        onError: (err: any) => {
            toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
        }
    });

    const [form, setForm] = useState<Partial<AppDeployment>>({});

    React.useEffect(() => {
        if (deployment) {
            setForm({
                budgetLimitUsd: deployment.budgetLimitUsd || "",
                userBudgetLimit: deployment.userBudgetLimit || "",
                hilEnabled: deployment.hilEnabled ?? false,
            });
        }
    }, [deployment]);

    const handleSaveGuardrails = () => {
        guardrailMutation.mutate(form);
    };

    const { data: healthData } = useQuery({
        queryKey: ['/api/apps', appId, 'health'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/health`);
            return res.json();
        },
        refetchInterval: 30000,
    });

    const rollbackMutation = useMutation({
        mutationFn: async (version: string) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/rollback`, { version });
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Vibe Rollback Successful",
                description: `App has been reverted to wave checkpoint ${data.version}.`,
            });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
        },
        onError: (err: any) => {
            toast({
                title: "Rollback Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const auditMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/apps/${appId}/shadow-audit`);
            return res.json();
        },
        onSuccess: (data) => {
            setAuditFindings(data.findings || []);
            setAuditOpen(true);
        },
        onError: (err: any) => {
            toast({ title: "Audit Failed", description: err.message, variant: "destructive" });
        }
    });

    const hasVersions = versions && versions.length > 0;
    const isHealthy = healthData?.status === "healthy";

    return (
        <>
            <div className="space-y-6">
            {/* --- Overview Banner --- */}
            <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-primary" />
                                Runtime & Deployment Controls
                            </CardTitle>
                            <CardDescription className="text-xs text-muted-foreground mt-0.5">Manage release versions, operational guardrails, and budget caps.</CardDescription>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground mb-1 font-medium">Current Version</p>
                                <Badge variant="secondary" className="font-semibold text-xs px-2.5 py-0.5">v{currentVersion}</Badge>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground mb-1 font-medium">Health Status</p>
                                <div className="flex items-center gap-2 justify-end">
                                    <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-yellow-500'}`} />
                                    <span className={`text-xs font-semibold ${isHealthy ? 'text-emerald-500' : 'text-yellow-500'}`}>
                                        {healthData?.status ? healthData.status.toUpperCase() : "CHECKING..."}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* --- Version Management --- */}
                <Card className="border border-border bg-card">
                    <CardHeader className="py-4 px-6 border-b border-border/50">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                            <RotateCcw className="w-4 h-4 text-muted-foreground" />
                            Version Management
                        </CardTitle>
                        <CardDescription className="text-xs">Version rollback and configuration audit.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="space-y-3">
                            <Label className="text-xs font-medium text-foreground flex items-center gap-2">
                                <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" /> Rollback Version
                            </Label>
                            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                <p className="text-xs text-muted-foreground">Revert to a previous release version if unexpected behavior occurs.</p>
                                {hasVersions ? (
                                    <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                                        <SelectTrigger className="h-9 text-xs">
                                            <SelectValue placeholder="Select target version..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {versions!.map(v => (
                                                <SelectItem key={v} value={v}>Version {v}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="h-9 flex items-center px-3 rounded-lg bg-muted text-xs text-muted-foreground">
                                        Initial release (no previous versions)
                                    </div>
                                )}
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full h-9 text-xs font-medium"
                                            disabled={rollbackMutation.isPending || !hasVersions || !selectedVersion}
                                        >
                                            {rollbackMutation.isPending ? "Reverting..." : "Revert to Selected Version"}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm Version Rollback</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This app will be reverted to version <strong>{selectedVersion}</strong>.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction 
                                                onClick={() => rollbackMutation.mutate(selectedVersion)}
                                            >
                                                Confirm Rollback
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-border/50">
                            <Label className="text-xs font-medium text-foreground flex items-center gap-2">
                                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" /> Security & Configuration Audit
                            </Label>
                            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                <p className="text-xs text-muted-foreground">Run an automated security audit against deployment configuration and API endpoints.</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 text-xs font-medium gap-2"
                                    onClick={() => auditMutation.mutate()}
                                    disabled={auditMutation.isPending}
                                >
                                    {auditMutation.isPending ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                    Run Configuration Audit
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* --- Operational Guardrails --- */}
                <Card className="border border-border bg-card flex flex-col">
                    <CardHeader className="py-4 px-6 border-b border-border/50">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                            <ShieldCheck className="w-4 h-4 text-primary" />
                            Operational Guardrails
                        </CardTitle>
                        <CardDescription className="text-xs">Fiscal controls and human-in-the-loop governance.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6 flex-1">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-medium text-foreground">
                                    Org Budget Limit (USD)
                                </Label>
                                <Input
                                    type="number"
                                    className="h-9 text-xs"
                                    value={form.budgetLimitUsd || ""}
                                    onChange={(e) => setForm({ ...form, budgetLimitUsd: e.target.value })}
                                    placeholder="No Limit"
                                />
                                <p className="text-[11px] text-muted-foreground">Monthly expenditure cap.</p>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-medium text-foreground">
                                    Per-User Limit (USD)
                                </Label>
                                <Input
                                    type="number"
                                    className="h-9 text-xs"
                                    value={form.userBudgetLimit || ""}
                                    onChange={(e) => setForm({ ...form, userBudgetLimit: e.target.value })}
                                    placeholder="No Limit"
                                />
                                <p className="text-[11px] text-muted-foreground">Per-user monthly limit.</p>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/50">
                            <div className="flex items-center justify-between p-4 bg-muted/40 border border-border rounded-xl">
                                <div className="space-y-0.5">
                                    <Label className="text-xs font-medium text-foreground">Human-In-The-Loop (HIL)</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Require manual human confirmation before autonomous mutations.
                                    </p>
                                </div>
                                <Switch
                                    checked={!!form.hilEnabled}
                                    onCheckedChange={(val) => setForm({ ...form, hilEnabled: val })}
                                />
                            </div>
                        </div>
                    </CardContent>
                    <div className="p-4 border-t border-border/50 bg-muted/20 flex justify-end">
                        <Button 
                            size="sm"
                            className="h-9 px-6 text-xs font-medium" 
                            onClick={handleSaveGuardrails} 
                            disabled={guardrailMutation.isPending}
                        >
                            {guardrailMutation.isPending ? <Activity className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
                            Save Guardrails
                        </Button>
                    </div>
                </Card>
            </div>
        </div>

        <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" /> Shadow Audit Results
                    </DialogTitle>
                    <DialogDescription>
                        {auditFindings.length === 0 ? "No issues found." : `${auditFindings.length} finding(s) detected.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                    {auditFindings.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">All clear — no issues detected in this deployment configuration.</div>
                    ) : auditFindings.map((f, i) => (
                        <div key={i} className={`p-4 rounded-lg border space-y-1 ${severityColor(f.severity)}`}>
                            <div className="flex items-center gap-2 font-semibold text-sm">
                                <Badge variant="outline" className="text-xs capitalize">{f.severity}</Badge>
                                <span>{f.category}</span>
                            </div>
                            <p className="text-sm font-medium">{f.issue}</p>
                            <p className="text-xs opacity-80">{f.recommendation}</p>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    </>
);
}

