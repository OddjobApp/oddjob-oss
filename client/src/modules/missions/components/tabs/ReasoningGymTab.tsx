import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BrainCircuit, CheckCircle2, RefreshCcw, ShieldCheck, Sparkles, Target } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";

type Assessment = {
  assessedAt: string;
  overallScore: number;
  confidence: number;
  disposition: "promote_candidate" | "needs_review" | "revise";
  dimensions: Record<string, { score: number; evidence: string[]; gaps: string[] }>;
  pivotalEvents: Array<{ index: number; event: string; outcome: string }>;
  critic: { strengths: string[]; risks: string[]; recommendations: string[] };
  correctedPlan: string[];
  learningCandidates: Array<{ type: string; content: string; confidence: number }>;
  promotionGate: { eligible: boolean; requiredScore: number; blockers: string[]; requiresHumanReview: boolean };
};

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReasoningGymTab({ run }: { run?: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const runId = run?.id;
  const queryKey = ["mission-run", runId, "reasoning-assessment"];
  const { data, isLoading, isError } = useQuery<Assessment>({
    queryKey,
    enabled: Boolean(runId),
    queryFn: async () => {
      const response = await fetch(`/api/mission-runs/${runId}/reasoning-assessment`);
      if (!response.ok) throw new Error("Reasoning assessment could not be loaded");
      return response.json();
    },
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/mission-runs/${runId}/reasoning-assessment`, { method: "POST" });
      if (!response.ok) throw new Error("Reasoning assessment could not be refreshed");
      return response.json();
    },
    onSuccess: (assessment) => {
      queryClient.setQueryData(queryKey, assessment);
      toast({ title: "Reasoning assessment refreshed" });
    },
    onError: (error: Error) => toast({ title: "Assessment failed", description: error.message, variant: "destructive" }),
  });

  if (!runId) return <Card className="p-8 text-center text-muted-foreground">A mission run is required for reasoning assessment.</Card>;
  if (isLoading) return <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div>;
  if (isError || !data) return <Card className="p-8 text-center"><AlertTriangle className="mx-auto h-7 w-7 text-amber-500" /><p className="mt-3 font-semibold">Reasoning assessment unavailable</p><Button className="mt-4" variant="outline" onClick={() => refresh.mutate()}>Try again</Button></Card>;

  const scoreTone = data.overallScore >= 80 ? "text-emerald-700 dark:text-emerald-300" : data.overallScore >= 65 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";
  return (
    <div className="space-y-4">
      <Card className="border-foreground/10 bg-foreground/[0.04]">
        <CardContent className="flex flex-col justify-between gap-5 p-5 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4"><div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-violet-700 dark:text-violet-300"><BrainCircuit className="h-7 w-7" /></div><div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Trajectory assessment</p><div className="mt-1 flex items-end gap-3"><span className={cn("text-4xl font-bold tabular-nums", scoreTone)}>{data.overallScore}</span><span className="pb-1 text-sm text-muted-foreground">/ 100</span></div><p className="mt-1 text-xs text-muted-foreground">Confidence {Math.round(data.confidence * 100)}% · assessed {new Date(data.assessedAt).toLocaleString()}</p></div></div>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase">{label(data.disposition)}</Badge><Badge className={data.promotionGate.eligible ? "bg-emerald-600" : "bg-muted text-muted-foreground hover:bg-muted"}>{data.promotionGate.eligible ? "Promotion candidate" : "Gate closed"}</Badge><Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="rounded-xl"><RefreshCcw className={cn("mr-2 h-4 w-4", refresh.isPending && "animate-spin")} />Reassess</Button></div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Reasoning dimensions">
        {Object.entries(data.dimensions).map(([name, dimension]) => (
          <Card key={name} className="border-foreground/10 bg-foreground/[0.04]"><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label(name)}</p><span className="text-sm font-bold tabular-nums">{dimension.score}</span></div><Progress value={dimension.score} className="mt-3 h-1.5" /><p className="mt-3 text-xs leading-5 text-muted-foreground">{dimension.evidence[0] || dimension.gaps[0] || "Assessment evidence pending."}</p></CardContent></Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card className="border-foreground/10 bg-foreground/[0.04]"><CardHeader><CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><Target className="h-4 w-4 text-blue-500" />Critic and revision plan</CardTitle></CardHeader><CardContent className="space-y-4">
          {data.critic.strengths.length > 0 && <div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Strengths</p>{data.critic.strengths.map((item) => <p key={item} className="mt-2 flex gap-2 text-xs leading-5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{item}</p>)}</div>}
          <div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Corrected plan</p><ol className="mt-2 space-y-2">{data.correctedPlan.map((item, index) => <li key={item} className="flex gap-3 rounded-lg border border-foreground/10 bg-background/30 p-3 text-xs leading-5"><span className="font-bold text-muted-foreground">{index + 1}</span>{item}</li>)}</ol></div>
        </CardContent></Card>

        <Card className="border-foreground/10 bg-foreground/[0.04]"><CardHeader><CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><Sparkles className="h-4 w-4 text-violet-500" />Learning and promotion</CardTitle></CardHeader><CardContent className="space-y-3">
          {data.learningCandidates.length ? data.learningCandidates.map((candidate) => <div key={`${candidate.type}-${candidate.content}`} className="rounded-xl border border-foreground/10 bg-background/30 p-3"><div className="flex items-center justify-between gap-2"><Badge variant="outline" className="border-foreground/10 text-[9px] uppercase">{label(candidate.type)}</Badge><span className="text-[10px] font-semibold text-muted-foreground">{Math.round(candidate.confidence * 100)}% confidence</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{candidate.content}</p></div>) : <p className="text-xs text-muted-foreground">More trajectory evidence is needed before creating learning candidates.</p>}
          <div className="flex items-start gap-3 rounded-xl border border-foreground/10 p-3"><ShieldCheck className={cn("mt-0.5 h-5 w-5 shrink-0", data.promotionGate.eligible ? "text-emerald-500" : "text-muted-foreground")} /><div><p className="text-xs font-bold">Governed promotion gate</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Requires score {data.promotionGate.requiredScore}+, no critical blockers, held-out evaluation, and human review.</p>{data.promotionGate.blockers.map((blocker) => <p key={blocker} className="mt-1 text-xs text-amber-700 dark:text-amber-300">• {blocker}</p>)}</div></div>
        </CardContent></Card>
      </div>
    </div>
  );
}
