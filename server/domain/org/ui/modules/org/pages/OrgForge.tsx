import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Shield, 
  Zap, 
  Target, 
  Brain, 
  Hammer, 
  TrendingUp, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  RefreshCw
} from "lucide-react";
import StatCard from "@domain-ui/core/ui/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";


export default function OrgForgePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: report, isLoading } = useQuery({
    queryKey: ["/api/org-forge/maturity"],
    queryFn: async () => {
      const res = await fetch("/api/org-forge/maturity");
      if (!res.ok) throw new Error("Failed to fetch maturity report");
      return res.json();
    }
  });

  const synthesizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/org-forge/soul/synthesize", { method: "POST" });
      if (!res.ok) throw new Error("Synthesis failed");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Soul Synthesized",
        description: "Organization soul traits have been refined based on recent data.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/org-forge/maturity"] });
    },
    onError: (err: any) => {
      toast({
        title: "Synthesis Failed",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  if (isLoading) return <div className="p-8 animate-pulse">Loading Org Forge...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Org Forge</h1>
        <p className="text-sm text-muted-foreground">The command center for agentic organization maturity and soul synthesis.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Maturity Index"
          value={`${report?.maturityIndex}%`}
          icon={Zap}
          description="Overall agency autonomy score"
        />
        <StatCard 
          title="Success Rate" 
          value={`${report?.stats.successRate}%`} 
          icon={CheckCircle2} 
          description="Mission fulfillment reliability"
        />
        <StatCard 
          title="Active Missions" 
          value={report?.stats.totalMissions} 
          icon={Target} 
          description="Total historical throughput"
        />
        <StatCard 
          title="Avg. Cost" 
          value={`$${report?.stats.avgCostUsd}`} 
          icon={TrendingUp} 
          description="Per-mission operational cost"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Maturity Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Maturity Dimensions</CardTitle>
                <CardDescription>Quantifying the organization's agentic capabilities.</CardDescription>
              </div>
              <Badge variant="secondary" className="px-3 py-1 font-mono uppercase text-[10px]">Industrial Grade</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2"><Target className="w-4 h-4 text-primary" /> Autonomy</span>
                <span>{report?.dimensions.autonomy}%</span>
              </div>
              <Progress value={report?.dimensions.autonomy} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-500" /> Reliability</span>
                <span>{report?.dimensions.reliability}%</span>
              </div>
              <Progress value={report?.dimensions.reliability} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-blue-500" /> Knowledge Depth</span>
                <span>{report?.dimensions.knowledge}%</span>
              </div>
              <Progress value={report?.dimensions.knowledge} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" /> Soul Resonance</span>
                <span>{report?.dimensions.soul}%</span>
              </div>
              <Progress value={report?.dimensions.soul} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Soul & Recommendations */}
        <div className="space-y-6">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> 
                Agency Soul
              </CardTitle>
              <CardDescription>Current organizational archetype</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary mb-2">
                {report?.settings?.assistantSoulArchetype || "The Unformed Entity"}
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {report?.settings?.assistantSoulArchetype
                  ? "Soul traits are active and influencing agent behavior across all missions."
                  : "Soul traits have not been synthesized yet. Run synthesis to define your organization's archetype."}
              </p>
              <Button 
                onClick={() => synthesizeMutation.mutate()} 
                disabled={synthesizeMutation.isPending}
                className="w-full flex items-center gap-2"
              >
                {synthesizeMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
                Refine Soul Traits
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Evolution Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {report?.recommendations.map((rec: string, i: number) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
