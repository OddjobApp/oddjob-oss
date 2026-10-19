import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, PieChart, Pie, AreaChart, Area
} from "recharts";
import { motion } from "framer-motion";
import { 
  Zap, 
  TrendingUp, 
  Activity, 
  DollarSign, 
  ShieldAlert, 
  Clock,
  ChevronRight,
  ArrowUpRight,
  Target,
  FlaskConical,
  Sparkles,
  AlertTriangle,
  Briefcase,
  Code,
  Loader2,
  ChevronLeft,
  Cpu,
  Wifi,
  WifiOff
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { useLocation } from "wouter";
import { MetricSummaryCard } from "@oddjob/design-system";

/**
 * SLM health status hook — polls /api/v1/health every 60s.
 * Returns whether Ollama is healthy, degraded, or offline.
 */
function useSLMStatus() {
  const { data } = useQuery<any>({
    queryKey: ["/api/v1/health"],
    refetchInterval: 60000,
    retry: false,
  });
  const ollamaStatus = data?.checks?.ollama?.status as string | undefined;
  if (!ollamaStatus || ollamaStatus === "offline") return "cloud" as const;
  if (ollamaStatus === "degraded") return "degraded" as const;
  return "local" as const;
}

interface CostStats {
  /**
   * Set by the server when these figures are INVENTED rather than measured.
   * It was already on the wire and nothing read it, so demo numbers were
   * indistinguishable from real spend.
   */
  demo?: boolean;
  dailyCosts: { date: string; cost: number }[];
  modelCosts: { model: string; cost: number }[];
  topPipelines: { pipelineId: number; name: string; totalCost: number }[];
  topAgents: { agentId: number; name: string; totalCost: number }[];
  totalSpend: number;
  orgBudget: {
    monthlyBudget: number;
    currentMonthSpend: number;
    resetDay: number;
    lastResetAt: string | null;
  } | null;
  activeMissions: {
    id: number;
    name: string;
    budgetLimit: number;
    currentSpend: number;
  }[];
  spendHistory: {
    month: number;
    year: number;
    totalSpend: number;
    budgetLimit: number;
    date: string;
  }[];
  insights: {
    id: string;
    type: "warning" | "optimization" | "success";
    title: string;
    description: string;
    impact: string;
    actionLabel?: string;
    actionPath?: string;
  }[];
}

function formatCurrency(value: unknown) {
  const amount = typeof value === "number" ? value : parseFloat(String(value || "0"));
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function CyclePredictionCard({ cycle }: { cycle: any }) {
  const { data: prediction, isLoading, error, refetch, isFetching } = useQuery<any>({
    queryKey: [`/api/predictive/cycles/${cycle.id}`],
    refetchInterval: 30000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/50 border border-foreground/5 shadow-xl overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-1/3 bg-muted" />
          <Skeleton className="h-4 w-1/4 bg-muted" />
        </div>
        <Skeleton className="h-4 w-full bg-muted" />
        <Skeleton className="h-6 w-full bg-muted" />
      </Card>
    );
  }

  if (error || !prediction) {
    return (
      <Card className="bg-card/60 border border-amber-500/20 shadow-xl overflow-hidden p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[9px] font-mono uppercase">
                  Cycle #{cycle.id}
                </Badge>
                <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
                  Forecast unavailable
                </span>
              </div>
              <h3 className="text-sm font-bold text-foreground truncate">{cycle.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The cycle is still available. Prediction telemetry could not be refreshed.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="shrink-0"
          >
            {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
            Retry forecast
          </Button>
        </div>
      </Card>
    );
  }

  const prob = prediction.successProbability;
  const isHigh = prob >= 70;
  const isMed = prob >= 40 && prob < 70;
  const color = isHigh ? "text-emerald-400" : isMed ? "text-amber-400" : "text-rose-400";
  const progressBg = isHigh ? "bg-emerald-500" : isMed ? "bg-amber-500" : "bg-rose-500";
  const borderTone = isHigh ? "border-emerald-500/10" : isMed ? "border-amber-500/10" : "border-rose-500/10";

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn("bg-card/70 border backdrop-blur-md shadow-2xl overflow-hidden p-6 space-y-5 transition-all hover:bg-card/95", borderTone)}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Badge variant="outline" className="bg-card border-primary/20 text-primary text-[9px] font-mono mb-2 uppercase">
              Cycle #{cycle.id}
            </Badge>
            <h3 className="text-sm font-bold text-foreground tracking-tight">{cycle.name}</h3>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cycle.objective}</p>
          </div>
          <div className="text-right">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono block">Success probability</span>
            <span className={cn("text-2xl font-black font-mono", color)}>{prob}%</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>Confidence bounds</span>
            <span>[{prediction.confidenceInterval?.[0] ?? 0}% - {prediction.confidenceInterval?.[1] ?? 100}%]</span>
          </div>
          <div className="w-full bg-background h-3 rounded-full overflow-hidden p-0.5 border border-foreground/5 relative">
            <div className={cn("h-full rounded-full transition-all duration-500", progressBg)} style={{ width: `${prob}%` }} />
            <div 
              className="absolute top-0 bottom-0 bg-foreground/10 border-x border-foreground/25 pointer-events-none"
              style={{
                left: `${prediction.confidenceInterval?.[0] ?? 0}%`,
                width: `${(prediction.confidenceInterval?.[1] ?? 100) - (prediction.confidenceInterval?.[0] ?? 0)}%`
              }}
            />
          </div>
        </div>

        {prediction.keyFactors && prediction.keyFactors.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trajectory Drivers</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {prediction.keyFactors.map((factor: any, idx: number) => {
                const isImpactNeg = factor.impact < 0;
                const impactColor = isImpactNeg ? "text-rose-400" : "text-emerald-400";
                return (
                  <div key={idx} className="bg-background/40 rounded-lg p-2 border border-foreground/5 flex flex-col justify-between">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[11px] font-medium text-foreground truncate">{factor.factor}</span>
                      <span className={cn("text-[11px] font-mono font-bold shrink-0", impactColor)}>
                        {isImpactNeg ? "" : "+"}{Math.round(factor.impact)}%
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] font-mono text-muted-foreground">
                      <span>Val: <span className="text-muted-foreground font-bold">{factor.current}</span></span>
                      <span>Opt: <span className="text-primary">{factor.expected}</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {prediction.recommendations && prediction.recommendations.length > 0 && (
          <div className="space-y-1.5 bg-background/30 rounded-lg p-3 border border-foreground/5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Strategic Advisory
            </h4>
            <ul className="space-y-1 animate-pulse-subtle">
              {prediction.recommendations.map((rec: string, idx: number) => (
                <li key={idx} className="text-[11px] text-foreground flex items-start gap-1.5">
                  <span className="text-primary select-none">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function PredictiveStatsCard({ stats, onRetrain }: { stats: any; onRetrain: () => void }) {
  const [retraining, setRetraining] = useState(false);
  const handleRetrain = async () => {
    setRetraining(true);
    try {
      await onRetrain();
    } finally {
      setRetraining(false);
    }
  };

  return (
    <Card className="bg-card/70 border border-primary/10 backdrop-blur-md shadow-2xl p-6 flex flex-col lg:flex-row justify-between items-center gap-6">
      <div className="space-y-2 text-center lg:text-left">
        <h3 className="text-lg font-black text-foreground tracking-tight flex items-center justify-center lg:justify-start gap-2 font-heading">
          <Activity className="w-5 h-5 text-primary" />
          VSM Trajectory Forecasting Models
        </h3>
        <p className="text-xs text-muted-foreground max-w-xl">
          Trajectory prediction models are trained continuously using local SLM telemetry. Accuracy is optimized through reinforcement loops on completed cycle iterations.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center lg:justify-end gap-6 w-full lg:w-auto">
        <div className="text-center font-mono">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Trained models</span>
          <span className="text-2xl font-black text-foreground">{stats?.totalModels ?? 0}</span>
        </div>

        <div className="text-center font-mono">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Average accuracy</span>
          <span className="text-2xl font-black text-primary">{Math.round((stats?.averageAccuracy ?? 0) * 100)}%</span>
        </div>

        <div className="text-center font-mono">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Last optimization</span>
          <span className="text-xs text-foreground font-bold block mt-1">
            {stats?.lastTrained ? new Date(stats.lastTrained).toLocaleDateString() : "Never"}
          </span>
        </div>

        <Button
          onClick={handleRetrain}
          disabled={retraining}
          className="bg-transparent border border-primary text-primary hover:bg-[#CD7F32] hover:text-background font-bold uppercase tracking-wider text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shrink-0"
        >
          {retraining ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Retraining...
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4 mr-2" />
              Trigger Reinforcement
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function PredictiveVSMView() {
  const { data: predStats, refetch: refetchStats } = useQuery<any>({
    queryKey: ["/api/predictive/stats"],
    refetchInterval: 30000,
  });

  const { data: cyclesData, isLoading: isCyclesLoading } = useQuery<any>({
    queryKey: ["/api/cycles"],
    refetchInterval: 30000,
  });

  const handleRetrain = async () => {
    await fetch("/api/predictive/train", { method: "POST" });
    refetchStats();
  };

  if (isCyclesLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="font-mono text-xs uppercase tracking-widest animate-pulse">Accessing VSM Telemetry...</p>
      </div>
    );
  }

  const cyclesList = cyclesData?.cycles || [];

  return (
    <div className="relative z-10 space-y-6">
      <PredictiveVSMViewInner stats={predStats} onRetrain={handleRetrain} cyclesList={cyclesList} />
    </div>
  );
}

function PredictiveVSMViewInner({ stats, onRetrain, cyclesList }: { stats: any; onRetrain: () => void; cyclesList: any[] }) {
  return (
    <div className="space-y-6">
      <PredictiveStatsCard stats={stats} onRetrain={onRetrain} />

      <div className="space-y-4">
        <h3 className="text-lg font-black text-foreground tracking-tight font-heading uppercase tracking-wider">Current Cycle Forecasts</h3>
        {cyclesList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-card/40 rounded-xl border border-foreground/5">
            <Activity className="w-12 h-12 mb-3 text-muted-foreground opacity-40" />
            <p className="text-xs uppercase tracking-widest font-mono text-muted-foreground">No Active Cycle Models Available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {cyclesList.map((cycle: any) => (
              <CyclePredictionCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CostDashboard() {
  const [, setLocation] = useLocation();
  const slmStatus = useSLMStatus();
  const [viewMode, setViewMode] = useState<"business" | "developer">(() => {
    const saved = localStorage.getItem("oddjob_view_mode");
    return saved === "developer" ? "developer" : "business";
  });
  const [subTab, setSubTab] = useState<"overview" | "predictive">("overview");

  const toggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === "business" ? "developer" : "business";
      localStorage.setItem("oddjob_view_mode", next);
      return next;
    });
  };

  const { data: stats, isLoading, error } = useQuery<CostStats>({
    queryKey: ["/api/analytics/cost-dashboard"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-muted-foreground">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="font-medium animate-pulse">Accessing Fiscal Intelligence Nexus...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-background min-h-screen">
        <Card className="border-red-500/20 bg-red-500/5 backdrop-blur-xl">
          <CardHeader>
            <div className="flex items-center gap-3 text-red-500 mb-2">
              <ShieldAlert className="w-6 h-6" />
              <CardTitle className="text-xl font-bold">System Connection Failure</CardTitle>
            </div>
            <CardDescription className="text-red-400/80">
              Failed to load fiscal analytics: {(error as Error).message}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const COLORS = ["#CD7F32", "#8E7662", "#AD703C", "#A28A78", "#8C5C32", "#634E3F"];

  const monthlyBudget = stats?.orgBudget?.monthlyBudget || 0;
  const currentMonthSpend = stats?.orgBudget?.currentMonthSpend || 0;
  const budgetRemaining = Math.max(monthlyBudget - currentMonthSpend, 0);
  const budgetUsedPct = monthlyBudget > 0 ? Math.min((currentMonthSpend / monthlyBudget) * 100, 100) : 0;

  const businessSummaryCards = [
    {
      label: "MTD Total Spend",
      value: formatCurrency(currentMonthSpend),
      helper: monthlyBudget > 0 ? `${budgetUsedPct.toFixed(0)}% of limit consumed` : "Unlimited limit set",
      icon: DollarSign,
      tone: "text-primary border-primary/20 bg-primary/10",
    },
    {
      label: "Remaining Threshold",
      value: monthlyBudget > 0 ? formatCurrency(budgetRemaining) : "∞",
      helper: `Resets on day ${stats?.orgBudget?.resetDay || "N/A"} of the month`,
      icon: Target,
      tone: "text-muted-foreground border-border/20 bg-muted/10",
    },
    {
      label: "Active Operations",
      value: String(stats?.activeMissions?.length || 0),
      helper: "Missions actively spending budget",
      icon: Zap,
      tone: "text-primary border-primary/20 bg-primary/10",
    },
    {
      label: "Optimization Alerts",
      value: String(stats?.insights?.length || 0),
      helper: stats?.insights && stats.insights.length > 0 ? "Cost reduction insights found" : "Fiscal structures nominal",
      icon: Sparkles,
      tone: "text-muted-foreground border-border/20 bg-muted/10",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground p-4 space-y-4 relative overflow-hidden flex flex-col font-sans">
      {/* Ambient Gradient Glow */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/10 via-muted/5 to-transparent pointer-events-none" />

      {/* Cinematic grid overlay for Developer Mode */}
      {viewMode === "developer" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute inset-0 cinematic-grid opacity-20" />
          <div className="scanline-overlay absolute inset-0 opacity-[0.02]" />
        </div>
      )}

      {/* Header Section */}
      <header className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-border/50">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => window.history.back()}
            className="rounded-full hover:bg-card/60"
          >
            <ChevronLeft className="w-5 h-5 text-primary" />
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-black tracking-tighter text-foreground font-heading">
                {viewMode === "business" ? "Fiscal Intelligence" : "BUDGET_NEXUS"}
              </h1>
              {stats?.demo ? (
                <Badge
                  variant="outline"
                  className="bg-amber-500/15 border-amber-500/50 text-amber-400 text-[10px] font-mono"
                  title="These figures are generated sample data, not this organization's spend."
                >
                  DEMO DATA — NOT REAL SPEND
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-card/70 border-primary/30 text-primary text-[10px] font-mono">
                  AUDIT OK
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground font-medium flex items-center gap-2 text-sm">
              <Activity className="w-4 h-4 text-primary" />
              {viewMode === "business" 
                ? "Overview of organization budgets, autonomous mission burns, and resource costs." 
                : "Developer telemetry, neural model costs, and optimization pipelines."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end mr-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Next Reset</p>
            <p className="text-xs font-mono text-foreground">
              Day {stats?.orgBudget?.resetDay || "N/A"} of Month
            </p>
          </div>
          {/* SLM Status Badge */}
          <div className="hidden md:flex items-center">
            {slmStatus === "local" ? (
              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono text-[9px] uppercase tracking-widest gap-1.5 px-2.5 py-1">
                <Wifi className="w-3 h-3" />
                SLM: LOCAL
              </Badge>
            ) : slmStatus === "degraded" ? (
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-[9px] uppercase tracking-widest gap-1.5 px-2.5 py-1">
                <Cpu className="w-3 h-3" />
                SLM: PARTIAL
              </Badge>
            ) : (
              <Badge className="bg-primary/10 text-primary border border-primary/20 font-mono text-[9px] uppercase tracking-widest gap-1.5 px-2.5 py-1">
                <WifiOff className="w-3 h-3" />
                SLM: CLOUD FALLBACK
              </Badge>
            )}
          </div>
          <Button 
            onClick={toggleViewMode} 
            variant="outline" 
            className="border-none bg-card/80 text-primary hover:bg-card hover:text-primary/80 font-bold rounded-xl shadow-lg transition-all"
          >
            {viewMode === "business" ? (
              <>
                <Briefcase className="w-4 h-4 mr-2 text-primary" />
                Business Mode
              </>
            ) : (
              <>
                <Code className="w-4 h-4 mr-2 text-muted-foreground" />
                Developer Mode
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Sub-tab Selection */}
      <div className="relative z-10 flex gap-2 border-b border-border/50 pb-2">
        <Button
          onClick={() => setSubTab("overview")}
          variant={subTab === "overview" ? "default" : "ghost"}
          className={cn(
            "text-xs font-bold uppercase tracking-wider rounded-xl px-4 py-2 transition-all",
            subTab === "overview"
              ? "bg-[#CD7F32] text-background hover:bg-[#CD7F32]/90 font-bold"
              : "text-muted-foreground hover:text-foreground hover:bg-card/40"
          )}
        >
          <Activity className="w-3.5 h-3.5 mr-2" />
          Standard Overview
        </Button>
        <Button
          onClick={() => setSubTab("predictive")}
          variant={subTab === "predictive" ? "default" : "ghost"}
          className={cn(
            "text-xs font-bold uppercase tracking-wider rounded-xl px-4 py-2 transition-all",
            subTab === "predictive"
              ? "bg-[#CD7F32] text-background hover:bg-[#CD7F32]/90 font-bold"
              : "text-muted-foreground hover:text-foreground hover:bg-card/40"
          )}
        >
          <TrendingUp className="w-3.5 h-3.5 mr-2" />
          Predictive VSM Forecasts
        </Button>
      </div>

      {/* Main Grid View */}
      {subTab === "overview" ? (
        viewMode === "business" ? (
          // ==========================================
          // BUSINESS PERSONA VIEW
          // ==========================================
          <div className="relative z-10 space-y-6">
          {/* Executive Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {businessSummaryCards.map((card) => (
              <MetricSummaryCard
                key={card.label}
                title={card.label}
                value={card.value}
                description={card.helper}
                icon={card.icon}
                className="bg-card/70 backdrop-blur-[24px] border-none shadow-2xl"
              />
            ))}
          </div>

          {/* Core Analytics Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Historical Spend */}
            <Card className="lg:col-span-8 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden flex flex-col">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-black tracking-tight text-foreground font-heading">Spend History</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Monthly organization spend trend compared to budget thresholds.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80 pb-6">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...(stats?.spendHistory || [])].reverse()}>
                    <defs>
                      <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#CD7F32" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#CD7F32" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }} 
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                      tickFormatter={(val) => `$${val}`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1A1412', border: 'none', borderRadius: '1rem', fontSize: '11px', color: '#fff' }}
                      itemStyle={{ color: '#CD7F32' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="totalSpend" 
                      stroke="#CD7F32" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorSpend)" 
                      name="Total Spend"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="budgetLimit" 
                      stroke="#8E7662" 
                      strokeDasharray="5 5" 
                      fill="transparent"
                      name="Budget Threshold"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Model Allocations */}
            <Card className="lg:col-span-4 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden flex flex-col">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-black tracking-tight text-foreground font-heading">Resource Allocation</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Attribution of API costs across foundational LLM models.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80 flex items-center justify-center relative">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats?.modelCosts || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={6}
                        dataKey="cost"
                        nameKey="model"
                      >
                        {stats?.modelCosts?.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1A1412', border: 'none', borderRadius: '1rem', fontSize: '11px', color: '#fff' }}
                      />
                    </PieChart>
                 </ResponsiveContainer>
                 <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                   <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Models</span>
                   <span className="text-2xl font-black text-foreground font-heading">{stats?.modelCosts?.length || 0}</span>
                 </div>
              </CardContent>
            </Card>
          </div>

          {/* Active Missions & Insight Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Active Mission Limits */}
            <Card className="lg:col-span-6 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-black tracking-tight text-foreground font-heading">Mission Budgets & Burn</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Active operations limits and real-time cost attribution.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(!stats?.activeMissions || stats.activeMissions.length === 0) ? (
                  <div className="flex flex-col items-center justify-center py-12 opacity-30">
                    <Activity className="w-12 h-12 mb-3 text-muted-foreground" />
                    <p className="text-xs uppercase tracking-widest font-bold">No Active Operations</p>
                  </div>
                ) : (
                  stats.activeMissions.map((mission) => {
                    const progress = Math.min((mission.currentSpend / mission.budgetLimit) * 100, 100);
                    return (
                      <div 
                        key={mission.id}
                        onClick={() => setLocation(`/missions/${mission.id}`)}
                        className="group p-4 rounded-xl border-none bg-card/40 hover:bg-card/80 transition-all flex items-center justify-between cursor-pointer"
                      >
                        <div className="space-y-2 flex-1 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(205,127,50,0.5)] animate-pulse" />
                            <h4 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{mission.name}</h4>
                          </div>
                          <div className="flex items-center gap-6">
                             <div className="flex flex-col">
                               <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Spent</span>
                               <span className="text-xs font-mono font-bold text-foreground">{formatCurrency(mission.currentSpend)}</span>
                             </div>
                             <div className="flex flex-col">
                               <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Limit</span>
                               <span className="text-xs font-mono font-bold text-muted-foreground">{formatCurrency(mission.budgetLimit)}</span>
                             </div>
                             <div className="flex-1 pt-1">
                                <Progress value={progress} className="h-1 bg-card/50 [&>div]:bg-primary" />
                             </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Smart Optimization Insights */}
            <Card className="lg:col-span-6 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-black tracking-tight text-foreground font-heading">Fiscal Insights</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Automated cost reduction and structural resource optimizations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(!stats?.insights || stats.insights.length === 0) ? (
                  <div className="flex flex-col items-center justify-center py-12 opacity-30">
                    <Sparkles className="w-12 h-12 mb-3 text-muted-foreground" />
                    <p className="text-xs uppercase tracking-widest font-bold">Scanning for optimizations...</p>
                  </div>
                ) : (
                  stats.insights.map((insight) => (
                    <div 
                      key={insight.id}
                      className={`p-4 rounded-xl border-none space-y-3 transition-all ${
                        insight.type === 'warning' 
                          ? 'bg-rose-500/10 text-rose-400' 
                          : insight.type === 'success'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          insight.type === 'warning' ? 'bg-rose-500/20' : 'bg-primary/20'
                        }`}>
                          {insight.type === 'warning' ? (
                            <AlertTriangle className="w-4 h-4 text-rose-500" />
                          ) : (
                            <Sparkles className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">{insight.title}</h4>
                          <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">{insight.impact}</p>
                        </div>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed font-medium">{insight.description}</p>
                      {insight.actionLabel && (
                        <div className="flex justify-end pt-1">
                          <Button 
                            size="sm" 
                            variant="link"
                            className="text-xs text-primary p-0 hover:text-primary/85 h-auto font-bold"
                            onClick={() => insight.actionPath && setLocation(insight.actionPath)}
                          >
                            {insight.actionLabel}
                            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        // ==========================================
        // DEVELOPER TELEMETRY VIEW
        // ==========================================
        <div className="relative z-10 space-y-6 animate-page-in">
          {/* Tech Spec Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "spend_att_mtd", value: formatCurrency(currentMonthSpend), icon: DollarSign, bgClass: "bg-primary/10", textClass: "text-primary" },
              { label: "budget_max", value: formatCurrency(monthlyBudget), icon: Target, bgClass: "bg-muted/10", textClass: "text-muted-foreground" },
              { label: "total_neural_models", value: stats?.modelCosts?.length || 0, icon: Activity, bgClass: "bg-primary/10", textClass: "text-primary" },
              { label: "active_autonomous_burns", value: stats?.activeMissions?.length || 0, icon: Zap, bgClass: "bg-muted/10", textClass: "text-muted-foreground" },
            ].map((stat, i) => (
              <Card key={i} className="bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", stat.bgClass)}>
                    <stat.icon className={cn("w-5 h-5", stat.textClass)} />
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold font-mono">{stat.label}</p>
                    <p className="text-xl font-mono font-bold text-foreground">{stat.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Top Agent Spend Attribution */}
            {stats?.topAgents && stats.topAgents.length > 0 && (
              <Card className="lg:col-span-6 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-black tracking-tight text-foreground font-mono">agent resource burn</CardTitle>
                  <CardDescription className="text-muted-foreground font-mono text-xs">
                    Top agent attribution models by cumulative compute cost.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {stats.topAgents.map((agent) => {
                    const maxCost = stats.topAgents[0]?.totalCost || 1;
                    const pct = Math.round((agent.totalCost / maxCost) * 100);
                    return (
                      <div key={agent.agentId} className="space-y-1.5 font-mono">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground font-bold">{agent.name || `agent_#${agent.agentId}`}</span>
                          <span className="font-bold text-primary">{formatCurrency(agent.totalCost)}</span>
                        </div>
                        <div className="w-full bg-card/50 rounded-full h-1.5 overflow-hidden">
                          <style>{`.agent-progress-${agent.agentId} { width: ${pct}%; }`}</style>
                          {/* eslint-disable-next-line react/forbid-dom-props */}
                          <div className={`bg-primary h-full rounded-full agent-progress-${agent.agentId}`} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Top Pipeline Execution Costs */}
            {stats?.topPipelines && stats.topPipelines.length > 0 && (
              <Card className="lg:col-span-6 bg-card/70 backdrop-blur-[24px] border-none shadow-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-black tracking-tight text-foreground font-mono">pipeline cost profile</CardTitle>
                  <CardDescription className="text-muted-foreground font-mono text-xs">
                    Workflow and data synchronization pipeline compute burns.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {stats.topPipelines.map((pipeline) => {
                    const maxCost = stats.topPipelines[0]?.totalCost || 1;
                    const pct = Math.round((pipeline.totalCost / maxCost) * 100);
                    return (
                      <div key={pipeline.pipelineId} className="space-y-1.5 font-mono">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground font-bold">{pipeline.name || `pipeline_#${pipeline.pipelineId}`}</span>
                          <span className="font-bold text-muted-foreground">{formatCurrency(pipeline.totalCost)}</span>
                        </div>
                        <div className="w-full bg-card/50 rounded-full h-1.5 overflow-hidden">
                          <style>{`.pipeline-progress-${pipeline.pipelineId} { width: ${pct}%; }`}</style>
                          {/* eslint-disable-next-line react/forbid-dom-props */}
                          <div className={`bg-muted h-full rounded-full pipeline-progress-${pipeline.pipelineId}`} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) ) : (
        <PredictiveVSMView />
      )}

      {/* Global CSS Styles for overlays and specific widgets */}
      <style>{`
        .cinematic-grid {
          background-image: 
            linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
          background-size: 32px 32px;
        }
        .scanline-overlay {
          background: linear-gradient(
            to bottom,
            transparent 50%,
            rgba(0, 0, 0, 0.4) 50%
          );
          background-size: 100% 4px;
        }
      `}</style>
    </div>
  );
}
