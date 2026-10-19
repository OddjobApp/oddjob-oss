import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { 
    Search, Cpu, FolderTree, Zap, Code2, AlertTriangle, 
    ShieldAlert, Activity, Layout, Info, AlertCircle, CheckCircle2,
    Loader2, BrainCircuit, Sparkles, ShieldCheck
} from "lucide-react";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useMutation, useQuery } from '@tanstack/react-query';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import type { AppDeployment } from "@shared/schema/apps";
import type { OceanTraits } from "@shared/schema/agent-deployments";
import { SoulConfigPanel, SoulArchetypeSelector } from "@domain-ui/ai/ui/modules/agent-ai";
import { cn } from "@/lib/utils";

interface XRaySymbol {
    id: string;
    name: string;
    kind: string;
    filePath: string;
    startLine: number;
    signature: string;
}

interface XRayMetrics {
    functionCount: number;
    classCount: number;
    callEdgeCount: number;
    parseErrors: number;
    potentialCircularRisks: number;
    maxDepth: number;
}

interface AuditFinding {
    category: "Prompt Safety" | "Budget Risk" | "Data Exposure" | "Persona Drift" | "Code Health";
    severity: "critical" | "warning" | "info";
    issue: string;
    recommendation: string;
}

export const AppIntelligenceTab: React.FC<{ appId: number; appSlug: string }> = ({ appId, appSlug }) => {
    const { toast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");
    const [symbols, setSymbols] = useState<XRaySymbol[]>([]);
    const [metrics, setMetrics] = useState<XRayMetrics | null>(null);
    const [auditFindings, setAuditFindings] = useState<AuditFinding[]>([]);
    const [loading, setLoading] = useState(true);
    const [auditing, setAuditing] = useState(false);
    const [impactTarget, setImpactTarget] = useState<string | null>(null);

    // Deployment logic moved from Hookups
    const { data: deployment } = useQuery<AppDeployment | null>({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null;
            return res.json();
        }
    });

    const mutation = useMutation({
        mutationFn: async (data: Partial<AppDeployment>) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/deploy`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/deploy`] });
            toast({ title: "Intelligence sync successful.", description: "Neural pathways updated." });
        },
    });

    const [form, setForm] = useState<Partial<AppDeployment>>({});

    useEffect(() => {
        if (deployment) {
            setForm({
                defaultModel: deployment.defaultModel || "gpt-4o",
                systemPrompt: deployment.systemPrompt || "",
                appMemoryEnabled: deployment.appMemoryEnabled ?? false,
                oceanTraits: (deployment as any).oceanTraits || { o: 50, c: 50, e: 50, a: 50, n: 50 },
                soulArchetype: (deployment as any).soulArchetype || "Lead Directive",
            });
        }
    }, [deployment]);

    useEffect(() => {
        const fetchStructuralData = async () => {
            try {
                setLoading(true);
                // 1. Fetch Symbols
                const symRes = await apiRequest('GET', `/api/xray/find?q=${searchQuery || ' '}`);
                const symData = await symRes.json();
                const filtered = symData.filter((s: XRaySymbol) => s.filePath.includes(appSlug));
                setSymbols(filtered);

                // 2. Fetch Metrics
                const metRes = await apiRequest('GET', `/api/xray/metrics/${appSlug}`);
                if (metRes.ok) {
                    setMetrics(await metRes.json());
                }
            } catch (err) {
                console.error("Failed to fetch app intelligence", err);
            } finally {
                setLoading(false);
            }
        };

        const timer = setTimeout(fetchStructuralData, 300);
        return () => clearTimeout(timer);
    }, [appSlug, searchQuery]);

    const runShadowAudit = async () => {
        try {
            setAuditing(true);
            const res = await apiRequest("POST", `/api/apps/${appId}/shadow-audit`, {});
            const data = await res.json();
            setAuditFindings(data.findings || []);
            
            if (data.findings?.length > 0) {
                toast({
                    title: "Audit Findings Reported",
                    description: `Detected ${data.findings.length} intelligence or security risks.`,
                    variant: "destructive"
                });
            } else {
                toast({
                    title: "Audit Passed",
                    description: "No structural or alignment regressions detected.",
                });
            }
        } catch (err: any) {
            toast({
                title: "Audit Failed",
                description: err.message,
                variant: "destructive"
            });
        } finally {
            setAuditing(false);
        }
    };

    const getComplexityLabel = (m: XRayMetrics) => {
        if (!m) return { label: "Unknown", color: "text-muted-foreground" };
        const ratio = m.callEdgeCount / (m.functionCount || 1);
        if (m.parseErrors > 0) return { label: "Broken", color: "text-red-500" };
        if (ratio > 5 || m.potentialCircularRisks > 2) return { label: "High Risk", color: "text-orange-500" };
        if (ratio > 2.5) return { label: "Dense", color: "text-yellow-500" };
        return { label: "Optimal", color: "text-emerald-500" };
    };

    const compInfo = metrics ? getComplexityLabel(metrics) : { label: "Calculating...", color: "text-muted-foreground" };

    const handleSaveIntelligence = () => {
        mutation.mutate(form);
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Neural Manifest & Personality */}
                <Card className="lg:col-span-2 bg-card/60 border-foreground/10 backdrop-blur-3xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none group-hover:opacity-10 transition-opacity">
                        <BrainCircuit className="w-48 h-48 text-primary" />
                    </div>
                    <CardHeader className="border-b border-foreground/5 bg-foreground/5">
                        <CardTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2 italic">
                            <BrainCircuit className="w-5 h-5 text-primary" />
                            Neural Manifest & Personality
                        </CardTitle>
                        <CardDescription>Configure the underlying intelligence model and agent persona matrix.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                                        <Cpu className="w-3 h-3" /> Intelligence Model
                                    </Label>
                                    <Select 
                                        value={form.defaultModel || "gpt-4o"} 
                                        onValueChange={(val) => setForm({...form, defaultModel: val})}
                                    >
                                        <SelectTrigger className="bg-background/20 border-foreground/5 h-12 text-sm font-bold shadow-inner">
                                            <SelectValue placeholder="Select Model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="gpt-4o">GPT-4o (Smartest)</SelectItem>
                                            <SelectItem value="gpt-4o-mini">GPT-4o Mini (Fast)</SelectItem>
                                            <SelectItem value="claude-3-5-sonnet">Claude 3.5 Sonnet</SelectItem>
                                            <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                                        <Sparkles className="w-3 h-3" /> Base Intelligence Instruction
                                    </Label>
                                    <Textarea
                                        className="min-h-[160px] bg-background/20 border-foreground/5 text-xs font-medium leading-relaxed shadow-inner"
                                        value={form.systemPrompt || ""}
                                        onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                                        placeholder="e.g. You are a professional analyst architecture designed for high-fidelity mission execution..."
                                    />
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between p-4 bg-foreground/5 border border-foreground/5 rounded-2xl group/toggle hover:bg-foreground/10 transition-all">
                                    <div className="space-y-1">
                                        <Label className="text-xs font-bold flex items-center gap-2">
                                            Persistent App Memory
                                        </Label>
                                        <p className="text-[10px] text-muted-foreground font-medium italic opacity-60">Vector-indexed Redis state persistence.</p>
                                    </div>
                                    <Switch
                                        checked={!!form.appMemoryEnabled}
                                        onCheckedChange={(val) => setForm({ ...form, appMemoryEnabled: val })}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                </div>

                                <div className="space-y-4 pt-2">
                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-violet-400 opacity-80">
                                        <Sparkles className="h-3 w-3" /> Agent Soul Layer
                                    </div>
                                    <SoulArchetypeSelector
                                        selectedId={form.soulArchetype || undefined}
                                        onSelect={(id, traits) => setForm({ ...form, soulArchetype: id, oceanTraits: traits })}
                                    />
                                    <div className="p-4 rounded-2xl bg-background/40 border border-foreground/5 shadow-inner">
                                        <SoulConfigPanel
                                            traits={form.oceanTraits as OceanTraits || { o: 50, c: 50, e: 50, a: 50, n: 50 }}
                                            onChange={(traits) => setForm({ ...form, oceanTraits: traits, soulArchetype: "Custom" })}
                                            archetype={form.soulArchetype || undefined}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                    <div className="p-4 border-t border-foreground/5 bg-foreground/5 flex justify-end">
                        <Button 
                            className="h-10 px-8 shadow-lg shadow-primary/20 font-black uppercase tracking-widest italic text-xs gap-2" 
                            onClick={handleSaveIntelligence} 
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                            Sync Neural Manifest
                        </Button>
                    </div>
                </Card>

                {/* Sidebar Health Context */}
                <div className="space-y-6 flex flex-col">
                    <Card className="flex-1 bg-card/40 border-foreground/10 backdrop-blur-xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-blue-400">
                                <FolderTree className="w-4 h-4" />
                                Workspace Telemetry
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 space-y-2 shadow-inner group/stat hover:bg-foreground/10 transition-all">
                                    <span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest block opacity-60">Symbols</span>
                                    <div className="text-2xl font-black italic tracking-tighter text-foreground group-hover/stat:text-primary transition-colors">{symbols.length}</div>
                                </div>
                                <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 space-y-2 shadow-inner group/stat hover:bg-foreground/10 transition-all">
                                    <span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest block opacity-60">Stability</span>
                                    <div className={cn("text-2xl font-black italic tracking-tighter truncate transition-colors", compInfo.color)}>
                                        {metrics?.parseErrors ? "Errors" : compInfo.label}
                                    </div>
                                </div>
                            </div>

                            {metrics && (
                                <div className="space-y-3 pt-4 border-t border-foreground/5 font-mono">
                                    <div className="flex justify-between text-[11px] uppercase tracking-tighter">
                                        <span className="text-muted-foreground/60">Logic Density</span>
                                        <span className="font-black text-blue-400">{(metrics.callEdgeCount / (metrics.functionCount || 1)).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-[11px] uppercase tracking-tighter">
                                        <span className="text-muted-foreground/60">Circular Risks</span>
                                        <span className={cn("font-black", metrics.potentialCircularRisks > 0 ? "text-orange-500" : "text-emerald-500")}>
                                            {metrics.potentialCircularRisks}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[11px] uppercase tracking-tighter">
                                        <span className="text-muted-foreground/60">Context Depth</span>
                                        <span className="font-black text-foreground">{metrics.maxDepth}</span>
                                    </div>
                                </div>
                            )}
                            
                            <Button 
                                className="w-full h-11 text-xs gap-3 bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-500/30 uppercase font-black tracking-widest italic mt-4"
                                onClick={runShadowAudit}
                                disabled={auditing}
                            >
                                {auditing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Running Triage...
                                    </>
                                ) : (
                                    <>
                                        <ShieldAlert className="w-4 h-4" />
                                        Trigger Shadow Audit
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Symbol Explorer - Moved to its own full-width or large grid below */}
                <Card className="lg:col-span-3 bg-card/40 border-foreground/10 backdrop-blur-xl overflow-hidden mt-6">

                    {/* Audit Findings */}
                    {auditFindings.length > 0 && (
                        <Card className="bg-background/60 border-red-500/20 backdrop-blur-2xl border-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-red-500 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    Adversarial Critique
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {auditFindings.map((finding, idx) => (
                                    <div key={idx} className="p-3 rounded-xl bg-red-500/5 border border-red-500/10 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Badge variant="outline" className={cn(
                                                "text-[9px] uppercase font-black",
                                                finding.severity === "critical" ? "bg-red-500/20 text-red-500 border-red-500/30" :
                                                finding.severity === "warning" ? "bg-amber-500/20 text-amber-500 border-amber-500/30" :
                                                "bg-blue-500/20 text-blue-500 border-blue-500/30"
                                            )}>
                                                {finding.category} • {finding.severity}
                                            </Badge>
                                        </div>
                                        <p className="text-[11px] font-bold text-foreground leading-tight">{finding.issue}</p>
                                        <div className="p-2 rounded bg-background/40 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                                            {finding.recommendation}
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {impactTarget && (
                        <Card className="bg-amber-500/5 border-amber-500/20 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <CardHeader>
                                <CardTitle className="text-sm font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4" />
                                    Impact Ready
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-[11px] text-muted-foreground">
                                    Symbol selected for Blast Radius analysis. View the <strong>System Graph</strong> to visualize the ripple effect.
                                </p>
                                <Button className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-foreground font-bold uppercase tracking-widest text-[10px]">
                                    Open X-Ray Explorer
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </Card>
            </div>
        </div>
    );
};
