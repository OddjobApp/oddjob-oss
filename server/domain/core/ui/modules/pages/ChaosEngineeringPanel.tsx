import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
  Zap, Activity, AlertTriangle, CheckCircle2, Timer, Wifi, 
  Play, RotateCcw, ShieldAlert, BarChart3, Loader2, FlaskConical,
  ChevronLeft, Clock
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface ChaosStatus {
  enabled: boolean;
  orgId: number;
  success: boolean;
  message: string;
  data: {
    latencyFlag: { delayMs: number; injectedAt: string; injectedBy: string; expiresAt: string } | null;
    activeIncident: { id: string; title: string; severity: string; status: string; createdAt: string } | null;
    recentEventsCount: number;
    recentEvents: any[];
  };
}

const DRILL_TOOLS = [
  {
    id: "set_latency_flag",
    label: "Inject Latency",
    description: "Inject artificial delay into staging DB queries via Redis flag. Auto-expires in 15 minutes.",
    icon: Timer,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    body: { delayMs: 3000 },
    destructive: true,
  },
  {
    id: "reset_latency_flag",
    label: "Reset Latency",
    description: "Remove the active latency injection flag and restore normal DB query performance.",
    icon: RotateCcw,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    body: {},
    destructive: false,
  },
  {
    id: "trigger_monitoring_incident",
    label: "Trigger Incident",
    description: "Create a simulated monitoring incident and fire a Slack alert — tests your on-call runbook.",
    icon: AlertTriangle,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    body: { severity: "high" },
    destructive: true,
  },
  {
    id: "resolve_pagerduty_alert",
    label: "Resolve Incident",
    description: "Resolve the active chaos incident, simulating PagerDuty alert resolution.",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    body: {},
    destructive: false,
  },
  {
    id: "run_http_latency_checks",
    label: "HTTP Latency Check",
    description: "Measure response latency against the staging health endpoint (3 iterations).",
    icon: Activity,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    body: { iterations: 3 },
    destructive: false,
  },
  {
    id: "query_metrics",
    label: "Query Metrics",
    description: "Snapshot the current chaos state: active flags, open incidents, and recent events.",
    icon: BarChart3,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    body: { lookbackMinutes: 30 },
    destructive: false,
  },
];

export default function ChaosEngineeringPanel() {
  const [, setLocation] = useLocation();
  const [lastResult, setLastResult] = useState<{ tool: string; result: any } | null>(null);
  const queryClient = useQueryClient();

  const { data: status, isLoading, refetch } = useQuery<ChaosStatus>({
    queryKey: ["/api/chaos/status"],
    refetchInterval: 30000,
  });

  const drillMutation = useMutation({
    mutationFn: async ({ tool, body }: { tool: string; body: any }) => {
      const res = await apiRequest("POST", `/api/chaos/drills/${tool}`, body);
      return { tool, result: await res.json() };
    },
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/chaos/status"] });
    },
  });

  const isActive = status?.data?.latencyFlag !== null || status?.data?.activeIncident !== null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 space-y-6 relative">
      {/* Ambient glow */}
      <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-rose-900/10 to-transparent pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center gap-4 pb-4 border-b border-foreground/5">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} className="rounded-full hover:bg-foreground/5">
          <ChevronLeft className="w-5 h-5 text-primary" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <FlaskConical className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-black tracking-tighter text-foreground">Chaos Engineering</h1>
            <Badge
              className={cn(
                "font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 border",
                status?.enabled
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  : "bg-card/60 text-muted-foreground border-foreground/10"
              )}
            >
              {status?.enabled ? "CHAOS ENABLED" : "SIMULATION MODE"}
            </Badge>
            {isActive && (
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 animate-pulse">
                ⚡ DRILL ACTIVE
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Adversarial agent testing — inject failures, measure resilience, verify your runbooks.
            {!status?.enabled && (
              <span className="ml-2 text-primary font-bold">Set CHAOS_ENABLED=true to enable real injection.</span>
            )}
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          className="border-foreground/10 bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30 font-mono text-xs"
        >
          <Activity className="w-3.5 h-3.5 mr-2" />
          Refresh
        </Button>
      </header>

      {/* Active State Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i} className="bg-card/60 border-none animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Latency Flag Status */}
          <Card className={cn(
            "bg-card/60 border backdrop-blur-md transition-all",
            status?.data?.latencyFlag ? "border-amber-500/30 shadow-amber-500/10 shadow-lg" : "border-foreground/5"
          )}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center",
                status?.data?.latencyFlag ? "bg-amber-500/20" : "bg-foreground/5"
              )}>
                <Timer className={cn("w-5 h-5", status?.data?.latencyFlag ? "text-amber-400" : "text-muted-foreground")} />
              </div>
              <div className="flex-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold font-mono">Latency Injection</p>
                {status?.data?.latencyFlag ? (
                  <>
                    <p className="text-foreground font-bold text-sm">{status.data.latencyFlag.delayMs}ms delay active</p>
                    <p className="text-[10px] text-amber-400/70 font-mono mt-0.5">
                      Expires: {new Date(status.data.latencyFlag.expiresAt).toLocaleTimeString()}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm font-mono">No active injection</p>
                )}
              </div>
              <div className={cn("w-2 h-2 rounded-full", status?.data?.latencyFlag ? "bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]" : "bg-muted")} />
            </CardContent>
          </Card>

          {/* Active Incident Status */}
          <Card className={cn(
            "bg-card/60 border backdrop-blur-md transition-all",
            status?.data?.activeIncident ? "border-rose-500/30 shadow-rose-500/10 shadow-lg" : "border-foreground/5"
          )}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center",
                status?.data?.activeIncident ? "bg-rose-500/20" : "bg-foreground/5"
              )}>
                <ShieldAlert className={cn("w-5 h-5", status?.data?.activeIncident ? "text-rose-400" : "text-muted-foreground")} />
              </div>
              <div className="flex-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold font-mono">Active Incident</p>
                {status?.data?.activeIncident ? (
                  <>
                    <p className="text-foreground font-bold text-sm truncate max-w-[180px]">{status.data.activeIncident.title}</p>
                    <p className="text-[10px] text-rose-400/70 font-mono mt-0.5">
                      Severity: {status.data.activeIncident.severity?.toUpperCase()}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm font-mono">No open incidents</p>
                )}
              </div>
              <div className={cn("w-2 h-2 rounded-full", status?.data?.activeIncident ? "bg-rose-400 animate-pulse shadow-[0_0_8px_rgba(248,113,113,0.6)]" : "bg-muted")} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Drill Tools Grid */}
      <div className="relative z-10">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 font-mono">Available Drills</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {DRILL_TOOLS.map((tool) => {
            const isRunning = drillMutation.isPending && (drillMutation.variables as any)?.tool === tool.id;
            return (
              <Card
                key={tool.id}
                className={cn("bg-card/60 border border-foreground/5 backdrop-blur-md hover:border-foreground/10 transition-all group")}
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center border", tool.bg, tool.border)}>
                      <tool.icon className={cn("w-4.5 h-4.5", tool.color)} />
                    </div>
                    {tool.destructive && (
                      <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono text-[8px] uppercase tracking-widest">
                        DESTRUCTIVE
                      </Badge>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{tool.label}</h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{tool.description}</p>
                  </div>
                  <Button
                    onClick={() => drillMutation.mutate({ tool: tool.id, body: tool.body })}
                    disabled={isRunning}
                    size="sm"
                    className={cn(
                      "w-full text-xs font-bold uppercase tracking-wider transition-all font-mono",
                      tool.destructive
                        ? "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20"
                        : "bg-foreground/5 text-foreground hover:bg-foreground/10 border border-foreground/10"
                    )}
                  >
                    {isRunning ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Running...</>
                    ) : (
                      <><Play className="w-3.5 h-3.5 mr-2" />Execute Drill</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Last Result */}
      {lastResult && (
        <div className="relative z-10">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 font-mono">Last Drill Result</h2>
          <Card className="bg-card/60 border border-foreground/5 backdrop-blur-md">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                {lastResult.result?.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {lastResult.tool.replace(/_/g, " ")}
                    {lastResult.result?.simulated && (
                      <span className="ml-2 text-amber-400">[SIMULATED]</span>
                    )}
                  </p>
                  <p className="text-sm text-foreground font-medium mt-0.5">{lastResult.result?.message}</p>
                </div>
              </div>
              {lastResult.result?.data && (
                <pre className="text-[10px] font-mono text-muted-foreground bg-background/30 rounded-lg p-3 overflow-auto max-h-48 leading-relaxed">
                  {JSON.stringify(lastResult.result.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
