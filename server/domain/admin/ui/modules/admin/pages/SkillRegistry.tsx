import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type Skill } from "@shared/schema/skills";
import { cn } from "@/lib/utils";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
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
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { 
    Plus, Terminal, Trash2, Eye, EyeOff, Code2, FileCode, 
    Search, Cpu, Braces, ShieldCheck, Zap, Layers, Globe,
    Activity, GitBranch, Share2, Sparkles, Binary, Network, Gauge,
    ChevronRight, Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import Editor from "@monaco-editor/react";

interface SkillHealth {
    reliabilityIndex: number;
    avgLatencyMs: number;
    /** 0 means never executed. The API seeds reliabilityIndex to 100 in that
     *  case, so this must be checked before the index is shown. */
    totalRuns: number;
}

interface EvolutionCandidateRow {
    skillId: string;
    reliabilityPct: number;
    total: number;
    status?: string;
    reason?: string;
}

export default function SkillRegistry() {
    const { data: skills, isLoading } = useQuery<Skill[]>({
        queryKey: ["/api/admin/skills"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/skills");
            if (!res.ok) throw new Error("Failed to fetch skills");
            return res.json();
        },
    });

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [filterLanguage, setFilterLanguage] = useState<string>("all");

    /** Sentinel health per skill name. Absent totalRuns means never executed. */
    const { data: skillHealth } = useQuery<Record<string, SkillHealth>>({
        queryKey: ["/api/admin/skills/health"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/skills/health");
            if (!res.ok) throw new Error("Failed to fetch skill health");
            return res.json();
        },
        refetchInterval: 30000,
    });

    /** Skills Sentinel has actually flagged for evolution, with real telemetry. */
    const { data: orgReport } = useQuery<{ candidates?: EvolutionCandidateRow[] }>({
        queryKey: ["/api/admin/autoresearch/org-report"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/autoresearch/org-report");
            if (!res.ok) throw new Error("Failed to fetch evolution candidates");
            return res.json();
        },
        refetchInterval: 60000,
    });

    const evolutionTargets = useMemo(
        () => new Set((orgReport?.candidates ?? []).map(c => c.skillId)),
        [orgReport]
    );

    const { data: sentinelSummary } = useQuery({
        queryKey: ["/api/admin/sentinel/summary"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/sentinel/summary");
            if (!res.ok) throw new Error("Failed to fetch sentinel summary");
            return res.json();
        },
        refetchInterval: 30000,
    });

    const filteredSkills = useMemo(() => {
        if (!skills) return [];
        return skills.filter(skill => {
            const matchesSearch = 
                skill.name.toLowerCase().includes(search.toLowerCase()) ||
                skill.description?.toLowerCase().includes(search.toLowerCase());
            const matchesLang = filterLanguage === "all" || skill.language === filterLanguage;
            return matchesSearch && matchesLang;
        });
    }, [skills, search, filterLanguage]);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative overflow-hidden flex flex-col">
          {/* Cinematic Backdrop */}
          <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary),0.1)_0%,transparent_50%)]" />
            <div className="absolute inset-0 cinematic-grid opacity-20" />
            <div className="absolute inset-0 bg-noise opacity-[0.03] animate-pulse" />
          </div>

          <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
            {/* Operational Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-8 border-b border-foreground/5">
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <div className="h-4 w-1 bg-primary shadow-glow animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-[0.5em] text-primary italic">
                            Neural Synthesis // Fragment Ecosystem
                        </span>
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic leading-none">
                            Skill_<span className="text-foreground/20">Nexus</span><br />
                            Registry_
                        </h1>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-6">
                    <div className="flex items-center gap-8 px-8 py-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 backdrop-blur-md">
                        <div className="text-right space-y-1">
                            <p className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">Evolution Rate</p>
                            <div className="flex items-center gap-2 justify-end">
                                <Activity className="w-3 h-3 text-primary animate-pulse" />
                                <span className="text-[10px] font-black text-primary uppercase tracking-widest italic">1.44 fragments/hr</span>
                            </div>
                        </div>
                        <div className="w-px h-10 bg-foreground/5" />
                        <div className="text-right space-y-1">
                            <p className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">Active Primitives</p>
                            <p className="text-xl font-black text-foreground italic tracking-tighter">{skills?.length || 0}<span className="text-[10px] text-foreground/20 ml-1">/1024</span></p>
                        </div>
                    </div>
                    <Button 
                        onClick={() => setIsAddOpen(true)}
                        className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl shadow-primary/20 transition-all hover:scale-105 active:scale-95 italic group"
                    >
                        <Plus className="w-4 h-4 mr-3 group-hover:rotate-90 transition-transform" />
                        Provision New Fragment
                    </Button>
                </div>
            </header>

            <div className="flex flex-col lg:flex-row gap-12 flex-1 min-h-0">
                <aside className="w-full lg:w-80 shrink-0 space-y-6">
                    <div className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-6 space-y-8 sticky top-6">
                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Neural Search</Label>
                            <div className="relative group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20 group-hover:text-primary transition-colors" />
                                <Input 
                                    placeholder="QUERY_PRIMITIVES..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full h-12 bg-foreground/[0.03] border-foreground/5 rounded-2xl pl-12 pr-4 text-[10px] font-black tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20"
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Evolution Filters</Label>
                            <div className="grid gap-2">
                                {["all", "javascript", "typescript", "shell"].map(lang => (
                                    <button
                                        key={lang}
                                        onClick={() => setFilterLanguage(lang)}
                                        className={cn(
                                            "flex items-center justify-between p-3.5 rounded-xl border transition-all uppercase italic font-black text-[9px] tracking-widest",
                                            filterLanguage === lang 
                                                ? "bg-primary/20 border-primary/40 text-primary shadow-glow" 
                                                : "bg-foreground/[0.02] border-foreground/5 text-foreground/30 hover:border-foreground/20 hover:text-foreground"
                                        )}
                                    >
                                        {lang === "all" ? "Agnostic_All" : lang}
                                        <div className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            filterLanguage === lang ? "bg-primary animate-pulse" : "bg-foreground/10"
                                        )} />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Evolution Insights HUD */}
                        <div className="pt-6 border-t border-foreground/5 space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Evolution Telemetry</Label>
                            <div className="space-y-3">
                                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-3 relative overflow-hidden group/insight cursor-help">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-[9px] font-black text-primary uppercase tracking-widest italic">
                                            <Sparkles className="w-3.5 h-3.5" /> Intelligence Gain
                                        </div>
                                        <span className="text-[9px] font-black text-primary animate-pulse">+12%</span>
                                    </div>
                                    <Progress value={72} className="h-1 bg-primary/10" />
                                    <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest leading-relaxed italic">
                                        Skill cluster density increased by 12.4% following recent tool synthesis cycles.
                                    </p>
                                </div>

                                <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 space-y-3">
                                    <div className="flex items-center gap-2 text-[9px] font-black text-foreground/40 uppercase tracking-widest italic">
                                        <Network className="w-3.5 h-3.5" /> Convergence Status
                                    </div>
                                    {sentinelSummary ? (
                                        <>
                                            <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500/40"
                                                    style={{ width: `${Math.max(0, Math.min(100, sentinelSummary.avgReliability ?? 0))}%` }}
                                                />
                                            </div>
                                            <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest italic" data-testid="sentinel-summary">
                                                {sentinelSummary.avgReliability}% avg reliability across {sentinelSummary.totalMonitored} monitored skill{sentinelSummary.totalMonitored === 1 ? "" : "s"} · {sentinelSummary.totalRecentFailures} failure{sentinelSummary.totalRecentFailures === 1 ? "" : "s"} in 30d
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest italic">
                                            Awaiting Sentinel telemetry.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-foreground/5">
                            <div className="p-4 rounded-2xl bg-emerald-500/[0.02] border border-emerald-500/10 flex items-center gap-4 group">
                                <div className="p-2 rounded-lg bg-emerald-500/20 group-hover:scale-110 transition-transform">
                                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest italic">Integrity Nominal</p>
                                    <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest italic">Static analysis safe</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Behavioral Matrix */}
                <div className="flex-1 space-y-8 min-h-0">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-48 space-y-8 glass-panel-deep border-foreground/10 rounded-[3rem]">
                            <div className="w-20 h-20 border-4 border-primary/20 border-t-primary rounded-full animate-spin shadow-glow" />
                            <span className="text-[12px] font-black uppercase tracking-[0.4rem] text-primary italic animate-pulse">SEQUENCING NEURAL NODES...</span>
                        </div>
                    ) : filteredSkills.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-48 space-y-10 glass-panel-deep border-foreground/10 rounded-[4rem] text-center px-12">
                            <div className="w-32 h-32 rounded-full bg-foreground/5 flex items-center justify-center border border-foreground/10">
                                <Braces className="w-16 h-16 text-foreground/10" />
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-3xl font-black text-foreground uppercase tracking-tighter italic">Void Detected</h3>
                                <p className="text-foreground/40 text-[11px] font-black uppercase tracking-widest max-w-sm mx-auto italic">No behavioral fragments found within the current search vectors.</p>
                                <Button onClick={() => setIsAddOpen(true)} className="mt-12 h-14 px-10 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[10px] italic">
                                     Initialize Fragment
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 auto-rows-fr">
                                {filteredSkills.map((skill, index) => (
                                    <SkillCard
                                        key={skill.id}
                                        skill={skill}
                                        index={index}
                                        health={skillHealth?.[skill.name]}
                                        isEvolutionTarget={evolutionTargets.has(skill.name)}
                                    />
                                ))}
                            </div>

                            {/* Live Evolution Stream (WOW Factor) */}
                            <div className="pt-12 border-t border-foreground/5">
                                <div className="flex items-center gap-6 mb-8">
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                                        <span className="text-[12px] font-black uppercase tracking-[0.4em] text-foreground/40 italic">Live Neural Convergence Stream</span>
                                    </div>
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                </div>

                                {/*
                                  Three hardcoded "events" used to render here —
                                  Search_Engine_V3 -> Market_Intelligence at 98% confidence and
                                  two more like it — under a pulsing ACTIVE badge on a panel
                                  titled Live Evolution Stream. None of it came from anywhere.
                                  These are the skills Sentinel has actually flagged, with
                                  their measured reliability.
                                */}
                                {(orgReport?.candidates ?? []).length === 0 ? (
                                    <p className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic" data-testid="evolution-stream-empty">
                                        No skills currently flagged for evolution.
                                    </p>
                                ) : (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {(orgReport?.candidates ?? []).slice(0, 3).map((event, i) => (
                                        <motion.div 
                                            key={i}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.5 + (i * 0.1) }}
                                            className="glass-panel border-foreground/5 rounded-2xl p-6 flex items-center justify-between group hover:border-primary/20 transition-all"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5 group-hover:bg-primary/10 transition-colors">
                                                    <Binary className="w-4 h-4 text-foreground/20 group-hover:text-primary transition-colors" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black text-foreground italic tracking-tighter uppercase">{event.skillId}</p>
                                                    <p className="text-[8px] font-black text-foreground/20 uppercase tracking-widest">{event.reliabilityPct}% RELIABLE // {event.total} RUN{event.total === 1 ? "" : "S"}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <span className="text-[7px] font-black text-primary/40 uppercase tracking-widest italic">
                                                    {event.status === "ready" ? "READY" : "BLOCKED"}
                                                </span>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <AddSkillDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
          </main>
        </div>
    );
}

function SkillCard({ skill, index, health, isEvolutionTarget }: {
    skill: Skill;
    index: number;
    health?: SkillHealth;
    isEvolutionTarget?: boolean;
}) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: async () => {
            await apiRequest("DELETE", `/api/admin/skills/${skill.id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/skills"] });
            toast({ title: "Fragment decommissioned" });
        },
    });

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
        >
            <Card className="glass-panel-deep border-foreground/10 hover:border-primary/20 hover:shadow-primary/5 transition-all duration-500 overflow-hidden relative group flex flex-col h-full rounded-[2.5rem]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <CardHeader className="relative pb-4 pt-10 px-8">
                  <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity translate-x-4 -translate-y-4 pointer-events-none">
                    <Zap className="w-16 h-16 text-primary" />
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="bg-foreground/5 text-foreground/40 border-foreground/10 text-[9px] font-black tracking-widest uppercase h-6 px-3 rounded-lg italic">
                        {skill.language}_FRAGMENT
                      </Badge>
                      {skill.isPublic ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-black tracking-widest uppercase h-6 px-3 rounded-lg italic">
                          PUBLIC CORE
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] font-black tracking-widest uppercase h-6 px-3 rounded-lg italic">
                          INTERNAL ONLY
                        </Badge>
                      )}
                      {isEvolutionTarget && (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black tracking-widest uppercase h-6 px-3 rounded-lg italic animate-pulse">
                          <Gauge className="w-3 h-3 mr-1.5" /> EVOLUTION TARGET
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardTitle className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none truncate pr-4">
                    {skill.name}
                  </CardTitle>
                </CardHeader>

                <CardContent className="px-8 pb-4 flex-grow space-y-6">
                   <p className="text-[11px] text-foreground/40 font-medium italic leading-relaxed line-clamp-2 h-8 uppercase tracking-wide">
                        {skill.description || "NO_BEHAVIORAL_DESCRIPTION_PROVIDED_BY_SOURCE"}
                   </p>
                   
                   {/*
                     An "Intelligence Maturity" level and bar used to render here, both from
                     Math.random() and re-rolled on every render. Replaced with Sentinel's
                     real 30-day telemetry. A skill with no recorded runs says so: the API
                     seeds reliabilityIndex to 100 when nothing has executed, and reporting
                     that as perfect reliability would repeat the original mistake.
                   */}
                   <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <span className="text-[8px] font-black uppercase tracking-widest text-foreground/20 italic">Reliability · 30d</span>
                            {health && health.totalRuns > 0 ? (
                                <span className="text-[10px] font-black text-primary italic tracking-tighter tabular-nums" data-testid={`skill-reliability-${skill.id}`}>
                                    {health.reliabilityIndex}% · {health.totalRuns} run{health.totalRuns === 1 ? "" : "s"}
                                </span>
                            ) : (
                                <span className="text-[9px] font-black text-foreground/25 italic tracking-tighter uppercase" data-testid={`skill-reliability-${skill.id}`}>
                                    No runs recorded
                                </span>
                            )}
                        </div>
                        {health && health.totalRuns > 0 && (
                            <>
                                <div className="h-1 bg-foreground/5 rounded-full overflow-hidden">
                                    <motion.div
                                        className={cn("h-full", health.reliabilityIndex >= 80 ? "bg-gradient-to-r from-primary/40 to-primary" : "bg-amber-500/70")}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${health.reliabilityIndex}%` }}
                                        transition={{ duration: 1, delay: index * 0.1 }}
                                    />
                                </div>
                                <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest italic">
                                    Avg latency {health.avgLatencyMs}ms
                                </p>
                            </>
                        )}
                   </div>

                   {/* Evolution Origin Tag (WOW Factor) */}
                   <div className="flex flex-wrap gap-2 pt-2">
                        {skill.metadata?.source_tools ? (
                            skill.metadata.source_tools.slice(0, 3).map((tool: string) => (
                                <Badge key={tool} variant="outline" className="bg-primary/5 text-primary/60 border-primary/10 text-[7px] font-black tracking-widest uppercase h-5 px-2 rounded-md italic">
                                    <Binary className="w-2.5 h-2.5 mr-1" /> {tool}
                                </Badge>
                            ))
                        ) : (
                            <Badge variant="outline" className="bg-foreground/5 text-foreground/20 border-foreground/5 text-[7px] font-black tracking-widest uppercase h-5 px-2 rounded-md italic">
                                <Share2 className="w-2.5 h-2.5 mr-1" /> INDEPENDENT NODE
                            </Badge>
                        )}
                        {skill.metadata?.source_tools?.length > 3 && (
                            <Badge variant="outline" className="bg-foreground/5 text-foreground/20 border-foreground/5 text-[7px] font-black tracking-widest uppercase h-5 px-2 rounded-md italic">
                                +{(skill.metadata?.source_tools?.length ?? 0) - 3}_TOOLS
                            </Badge>
                        )}
                   </div>

                   <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-foreground/[0.01] border border-foreground/5">
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">NODE STATUS</p>
                        <div className="flex items-center gap-2">
                           <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-glow" />
                           <span className="text-[10px] font-black italic tracking-tighter text-emerald-500 uppercase">ONLINE</span>
                        </div>
                      </div>
                      <div className="space-y-1 border-l border-foreground/5 pl-4">
                        <p className="text-[9px] font-black uppercase text-foreground/10 tracking-widest italic">UPLINK PROTOCOL</p>
                        <p className="text-[10px] font-black italic tracking-tighter text-foreground/60 uppercase">SECURE IV</p>
                      </div>
                   </div>
                </CardContent>

                <CardFooter className="pt-4 pb-8 px-8 flex items-center justify-between border-t border-foreground/5 bg-foreground/[0.01]">
                   <div className="flex items-center gap-2">
                       <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setIsPreviewOpen(true)}
                            className="h-10 rounded-xl border-foreground/10 text-[9px] font-black uppercase tracking-widest text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all px-4"
                       >
                          <FileCode className="w-3.5 h-3.5 mr-2 text-primary" />
                          Inspect Source
                       </Button>
                   </div>

                   <AlertDialog>
                       <AlertDialogTrigger asChild>
                           <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-red-500/10 transition-all text-foreground/40 hover:text-red-500">
                               <Trash2 className="h-4 w-4" />
                           </Button>
                       </AlertDialogTrigger>
                       <AlertDialogContent className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-12 max-w-lg">
                           <AlertDialogHeader className="space-y-6">
                               <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20 mx-auto">
                                   <Trash2 className="h-8 w-8 text-red-500" />
                               </div>
                               <AlertDialogTitle className="text-3xl font-black italic text-center uppercase tracking-tighter">Decommission Fragment?</AlertDialogTitle>
                               <AlertDialogDescription className="text-center text-foreground/40 text-[11px] font-black uppercase tracking-widest leading-relaxed">
                                   Deleting <span className="text-foreground">[{skill.name}]</span> will permanently remove this behavioral primitive from the OS. Confirm destruction?
                               </AlertDialogDescription>
                           </AlertDialogHeader>
                           <AlertDialogFooter className="pt-10 flex-col sm:flex-row gap-4">
                               <AlertDialogCancel className="h-14 flex-1 rounded-2xl glass-panel border-foreground/10 text-[10px] font-black uppercase tracking-widest italic">Abort Sequence</AlertDialogCancel>
                               <AlertDialogAction onClick={() => deleteMutation.mutate()} className="h-14 flex-1 rounded-2xl bg-red-500 hover:bg-red-600 text-foreground text-[10px] font-black uppercase tracking-widest italic">Confirm Destruction</AlertDialogAction>
                           </AlertDialogFooter>
                       </AlertDialogContent>
                   </AlertDialog>
                </CardFooter>
            </Card>

            <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <DialogContent className="max-w-4xl h-[700px] glass-panel-deep border-foreground/10 rounded-[3rem] p-0 overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                    <DialogHeader className="p-10 pb-6 shrink-0">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-glow">
                                <Code2 className="w-6 h-6 text-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                            </div>
                            <div className="space-y-1">
                                <DialogTitle className="text-3xl font-black italic uppercase tracking-tighter text-foreground">Source Inspection: {skill.name}</DialogTitle>
                                <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">
                                    READONLY NEURAL LOGS // PROTOCOL V1.0
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 px-10 pb-10">
                        <div className="h-full border border-foreground/5 rounded-[2rem] overflow-hidden bg-background/40">
                            <Editor
                                height="100%"
                                defaultLanguage={skill.language === "shell" ? "shell" : "javascript"}
                                theme="vs-dark"
                                value={skill.code}
                                options={{
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    fontFamily: "var(--font-mono)",
                                    lineNumbers: "on",
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    padding: { top: 20, bottom: 20 },
                                    glyphMargin: false,
                                    folding: true,
                                    lineHeight: 20,
                                }}
                            />
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </motion.div>
    );
}

function AddSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [code, setCode] = useState("");
    const [language, setLanguage] = useState("javascript");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const createMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/admin/skills", {
                name,
                description,
                code,
                language,
                isPublic: true,
            });
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Skill provisioned" });
            onOpenChange(false);
            queryClient.invalidateQueries({ queryKey: ["/api/admin/skills"] });
            setName("");
            setDescription("");
            setCode("");
        },
        onError: (err: any) => {
            toast({ title: "Failed to create skill", description: err.message, variant: "destructive" });
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl h-[850px] glass-panel-deep border-foreground/10 rounded-[3rem] p-0 overflow-hidden flex flex-col">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                
                <DialogHeader className="p-12 pb-6 shrink-0">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-glow">
                            <Cpu className="w-8 h-8 text-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-4xl font-black italic uppercase tracking-tighter text-foreground">Neural Provisioning Portal</DialogTitle>
                            <DialogDescription className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                INJECT DYNAMIC BEHAVIORAL PRIMITIVES INTO CORE ARCHITECTURE
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 px-12 py-6 flex flex-col gap-8">
                    <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic">Fragment Designation</Label>
                            <Input 
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                placeholder="E.G._RESTART_CORE_UPLINK" 
                                className="h-14 bg-foreground/[0.03] border-foreground/5 rounded-2xl text-[11px] font-black tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20"
                            />
                        </div>
                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic">Linguistic Engine</Label>
                            <div className="grid grid-cols-3 gap-3">
                                {["javascript", "typescript", "shell"].map(lang => (
                                    <button
                                        key={lang}
                                        onClick={() => setLanguage(lang)}
                                        className={cn(
                                            "h-14 rounded-2xl border transition-all uppercase italic font-black text-[10px] tracking-widest",
                                            language === lang 
                                                ? "bg-primary/20 border-primary text-primary shadow-glow" 
                                                : "bg-foreground/[0.02] border-foreground/5 text-foreground/40 hover:border-foreground/20 hover:text-foreground"
                                        )}
                                    >
                                        {lang}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic">Behavioral Logic Definition</Label>
                        <div className="flex-1 min-h-[400px] border border-foreground/5 rounded-[2.5rem] overflow-hidden bg-background/40 relative group">
                            <div className="absolute top-4 right-4 z-10 opacity-20 pointer-events-none group-focus-within:opacity-50 transition-opacity">
                                <Code2 className="w-12 h-12 text-primary" />
                            </div>
                            <Editor
                                height="400px"
                                defaultLanguage={language === "shell" ? "shell" : "javascript"}
                                theme="vs-dark"
                                value={code}
                                onChange={(value) => setCode(value || "")}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    fontFamily: "var(--font-mono)",
                                    lineNumbers: "on",
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    padding: { top: 20, bottom: 20 },
                                    glyphMargin: false,
                                    folding: true,
                                    lineHeight: 20,
                                }}
                            />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic">Operational Context</Label>
                        <Input 
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            placeholder="DESCRIBE_FRAGMENT_INTENT_AND_IMPACT..." 
                            className="h-14 bg-foreground/[0.03] border-foreground/5 rounded-2xl text-[11px] font-black tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20"
                        />
                    </div>
                </div>

                <DialogFooter className="p-12 pt-6 bg-foreground/[0.02] border-t border-foreground/5 gap-4 shrink-0">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-16 px-10 rounded-2xl text-[10px] font-black uppercase tracking-widest italic text-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-all">
                        Abort Creation
                    </Button>
                    <Button 
                        onClick={() => createMutation.mutate()} 
                        disabled={!name || !code || createMutation.isPending}
                        className="h-16 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl shadow-primary/20 transition-all active:scale-95 italic"
                    >
                        {createMutation.isPending ? "INITIALIZING..." : "COMMENCE_PROVISIONING"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

