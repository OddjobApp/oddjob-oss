import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { 
  Loader2, 
  RotateCcw, 
  ChevronLeft, 
  Clock, 
  Activity, 
  Shield, 
  Zap, 
  Target,
  CheckCircle2,
  Monitor,
  Briefcase,
  Code,
  AlertTriangle,
  DollarSign,
  Flag,
  PlayCircle,
  Download,
  FileText,
} from "lucide-react";
import StrategyAwareTabs from "../components/StrategyAwareTabs";
import { useStrategyStyles } from "../hooks/useMissionStrategy";
import WaveGovernancePanel from "../components/widgets/WaveGovernancePanel";
import BusinessImpactWidget from "../components/widgets/BusinessImpactWidget";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { deriveFailureDiagnosis } from "@shared/operations-attention";
import { cn } from "@/lib/utils";

// Simple fetch wrapper for API calls
async function apiGet(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw Object.assign(new Error(`API error: ${res.status}`), { status: res.status });
  return res.json();
}

function withSelectedOrg(path: string) {
  if (typeof window === "undefined") return path;
  const stored = sessionStorage.getItem("selectedOrganizationId");
  if (!stored) return path;
  const parsed = parseInt(stored, 10);
  if (Number.isNaN(parsed)) return path;
  const url = new URL(path, window.location.origin);
  if (!url.searchParams.has("orgId")) url.searchParams.set("orgId", String(parsed));
  return `${url.pathname}${url.search}`;
}

async function apiPost(path: string, body?: any) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`API error: ${res.status}`), { status: res.status });
  return res.json();
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

function formatStatus(status: string | undefined) {
  if (!status) return "Not started";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function MissionRunPage() {
  // useParams reads whichever route matched, so this page works at the legacy
  // /missions/..., the /operations/missions/... form, and the project-namespaced
  // /projects/:key/missions/... form without enumerating each pattern here.
  const params = useParams();
  const missionId = params?.missionId ? parseInt(params.missionId) : null;
  const runId = params?.runId ? parseInt(params.runId) : null;
  
  const [mission, setMission] = useState<any>(null);
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Retained separately so a permanent 404 can be told apart from a transient
  // connection failure — the two need different copy and different actions.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"business" | "developer">(() => {
    const saved = localStorage.getItem("oddjob_view_mode");
    return saved === "developer" ? "developer" : "business";
  });

  const toggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === "business" ? "developer" : "business";
      localStorage.setItem("oddjob_view_mode", next);
      return next;
    });
  };

  useEffect(() => {
    if (missionId && runId) {
      loadData();
      // Poll for updates if run is active
      const interval = setInterval(() => {
        if (run?.status === "active" || run?.status === "running") {
          loadData(true);
        }
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [missionId, runId, run?.status]);

  const loadData = async (isPoll = false) => {
    try {
      if (!isPoll) {
        setLoading(true);
        setError(null);
        setErrorStatus(null);
      }
      
      const [missionData, runData] = await Promise.all([
        apiGet(withSelectedOrg(`/api/missions/${missionId}`)),
        apiGet(withSelectedOrg(`/api/mission-runs/${runId}`))
      ]);
      
      setMission(missionData);
      setRun(runData);
      setError(null);
      setErrorStatus(null);
    } catch (err: any) {
      if (!isPoll) {
        setError(err.message || "Failed to load mission run");
        setErrorStatus(typeof err?.status === "number" ? err.status : null);
      }
    } finally {
      if (!isPoll) setLoading(false);
    }
  };

  const hasAppSlug = !!(
    (mission?.blackboard as any)?.viaAppSlug || 
    (mission?.blackboard as any)?.forge_app_slug || 
    (mission?.blackboard as any)?.appSlug
  );
  const previewSlug = (mission?.blackboard as any)?.viaAppSlug || 
    (mission?.blackboard as any)?.forge_app_slug || 
    (mission?.blackboard as any)?.appSlug || 
    mission?.name?.toLowerCase().replace(/\s+/g, '-') || 
    'preview';
  const previewUrl = `/forged/${previewSlug}/`;

  const styles = useStrategyStyles(mission?.executionStrategy || "pre_planned");
  const missionContext = (run?.missionContext as any) || {};
  const isFailed = run?.status === "failed";
  // Same diagnosis the Needs Attention queue shows, derived from the run's own context.
  const diagnosis = isFailed ? deriveFailureDiagnosis(missionContext, run?.failureReason) : null;
  const { toast } = useToast();
  const [recovering, setRecovering] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);

  const handleExportAudit = async (format: "json" | "html" = "json") => {
    if (!runId) return;
    setExportingAudit(true);
    try {
      const response = await fetch(withSelectedOrg(`/api/mission-runs/${runId}/audit-bundle${format === "html" ? "?format=html" : ""}`), {
        credentials: "include",
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error?.message || `Audit export failed (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
        || `mission-run-${runId}-audit.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: format === "html" ? "Audit report exported" : "Audit evidence exported",
        description: format === "html"
          ? "The printable report shows evidence provenance, limitations, integrity, and signing status."
          : "The bundle includes provenance, claim limitations, and a SHA-256 evidence chain.",
      });
    } catch (error: any) {
      toast({
        title: "Audit export failed",
        description: error?.message || "The evidence bundle could not be generated.",
        variant: "destructive",
      });
    } finally {
      setExportingAudit(false);
    }
  };
  const handleRecover = async (strategy: string) => {
    if (!runId) return;
    setRecovering(true);
    try {
      const res = await fetch(`/api/mission-runs/${runId}/recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ strategy }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Recovery failed to start");
      toast({ title: "Recovery started", description: `Applied "${strategy}" to this run.` });
    } catch (e: any) {
      toast({ title: "Recovery failed", description: e.message, variant: "destructive" });
    } finally {
      setRecovering(false);
    }
  };
  const budgetLimit = parseFloat(mission?.budgetLimitUsd || "0");
  const runCost = parseFloat(run?.costUsd || "0");
  const budgetRemaining = Math.max(budgetLimit - runCost, 0);
  const budgetUsed = budgetLimit > 0 ? Math.min((runCost / budgetLimit) * 100, 100) : 0;
  const cycleCount = missionContext?.cycleCount || 1;
  const outputCount = Array.isArray(mission?.deliverables) ? mission.deliverables.length : 0;
  const latestCheckpoint = missionContext?.forgeStatus?.status === "awaiting_wave_approval"
    ? `Awaiting approval for phase ${missionContext?.forgeStatus?.currentWaveId || 1}`
    : run?.status === "failed"
      ? "Run needs attention before it can continue"
      : run?.status === "completed"
        ? "Run completed successfully"
        : "Execution is in progress";
  const businessSummaryCards = [
    {
      label: "Run status",
      value: formatStatus(run?.status),
      helper: latestCheckpoint,
      icon: run?.status === "failed" ? AlertTriangle : CheckCircle2,
      tone: run?.status === "failed" ? "text-red-400 border-red-500/20 bg-red-500/10" : "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    },
    {
      label: "Budget remaining",
      value: formatCurrency(budgetRemaining),
      helper: budgetLimit > 0 ? `${budgetUsed.toFixed(0)}% of plan used` : "No budget cap set",
      icon: DollarSign,
      tone: "text-amber-400 border-amber-500/20 bg-amber-500/10",
    },
    {
      label: "Outputs tracked",
      value: String(outputCount),
      helper: outputCount > 0 ? "Deliverables available for review" : "Outputs will appear as work completes",
      icon: Flag,
      tone: "text-sky-400 border-sky-500/20 bg-sky-500/10",
    },
    {
      label: "Next action",
      value: missionContext?.forgeStatus?.status === "awaiting_wave_approval" ? "Review approval" : "Monitor progress",
      helper: missionContext?.forgeStatus?.status === "awaiting_wave_approval"
        ? "Approve the next phase or request revisions"
        : "Check updates, outputs, and spend",
      icon: PlayCircle,
      tone: "text-violet-400 border-violet-500/20 bg-violet-500/10",
    },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-muted-foreground">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="font-medium animate-pulse">Initializing Mission Interface...</p>
      </div>
    );
  }

  if (error) {
    // A 404 is a permanent answer, not a connection problem: the run was
    // deleted or never existed. Offering "Re-establish Connection" for it
    // sends people to retry something that can never succeed.
    const isNotFound = errorStatus === 404;

    return (
      <div className="p-8 bg-background min-h-screen">
        <Card
          className={cn(
            "backdrop-blur-xl",
            isNotFound
              ? "border-amber-500/20 bg-amber-500/5"
              : "border-red-500/20 bg-red-500/5",
          )}
        >
          <CardHeader>
            <div
              className={cn(
                "flex items-center gap-3 mb-2",
                isNotFound ? "text-amber-500" : "text-red-500",
              )}
            >
              <Shield className="w-6 h-6" />
              <CardTitle className="text-xl font-bold">
                {isNotFound ? "Mission Run Not Available" : "System Connection Failure"}
              </CardTitle>
            </div>
            <CardDescription className={isNotFound ? "text-amber-400/80" : "text-red-400/80"}>
              {isNotFound
                ? `Run #${runId} could not be found. It may have been deleted, or it belongs to a different organization.`
                : error}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {isNotFound ? (
              <Button
                onClick={() => setLocation(`/missions/${missionId}`)}
                variant="outline"
                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back to Mission
              </Button>
            ) : (
              <Button
                onClick={() => loadData()}
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Re-establish Connection
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">NOMINAL</Badge>;
      case "running": 
      case "active": return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 animate-pulse">ACTIVE</Badge>;
      case "failed": return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">FAILURE</Badge>;
      case "paused": 
        if ((run?.missionContext as any)?.forgeStatus?.status === 'awaiting wave approval') {
          return <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 animate-pulse">WAVE REVIEW</Badge>;
        }
        return <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">INTERRUPTED</Badge>;
      default: return <Badge variant="outline">{status?.toUpperCase()}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-3 pb-28 sm:p-4 sm:pb-4 space-y-4 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className={`absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b ${styles.gradient} opacity-20 pointer-events-none`} />
      
      {/* Header Section */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => window.history.back()}
            className="rounded-full hover:bg-foreground/10"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1 sm:gap-3">
              <h1 className="min-w-0 break-words text-xl font-black tracking-normal text-foreground sm:text-2xl sm:tracking-tighter">
                {viewMode === "business" ? (mission?.name || `Mission ${missionId}`) : `RUN_0${runId}`}
              </h1>
              {getStatusBadge(run?.status)}
              <Badge variant="outline" className="bg-foreground/5 border-foreground/10 text-[10px] font-mono opacity-60">
                {mission?.executionStrategy?.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
            <p className="flex items-start gap-2 text-sm font-medium text-muted-foreground sm:items-center sm:text-base">
              <Target className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
              {viewMode === "business" ? (mission?.goal || "Review run health, outputs, and next decisions.") : mission?.name}
            </p>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="hidden md:flex flex-col items-end mr-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Started</p>
            <p className="text-xs font-mono text-foreground">
              {run?.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "--:--:--"}
            </p>
          </div>
          <Button
            onClick={() => handleExportAudit("json")}
            disabled={exportingAudit || !runId}
            variant="outline"
            className="w-full border-foreground/10 hover:bg-foreground/5 hover:text-foreground font-bold rounded-xl shadow-lg transition-all sm:w-auto"
          >
            {exportingAudit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4 text-emerald-500" />}
            Export Audit
          </Button>
          <Button
            onClick={() => handleExportAudit("html")}
            disabled={exportingAudit || !runId}
            variant="outline"
            className="w-full border-foreground/10 hover:bg-foreground/5 hover:text-foreground font-bold rounded-xl shadow-lg transition-all sm:w-auto"
          >
            {exportingAudit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4 text-cyan-500" />}
            Audit Report
          </Button>
          <Button 
            onClick={toggleViewMode} 
            variant="outline" 
            className="w-full border-foreground/10 hover:bg-foreground/5 hover:text-foreground font-bold rounded-xl shadow-lg transition-all sm:w-auto"
          >
            {viewMode === "business" ? (
              <>
                <Briefcase className="w-4 h-4 mr-2 text-amber-500" />
                Business Mode
              </>
            ) : (
              <>
                <Code className="w-4 h-4 mr-2 text-blue-400" />
                Developer Mode
              </>
            )}
          </Button>
          {hasAppSlug && (
            <Button 
              className="w-full bg-foreground text-background hover:bg-muted font-bold rounded-xl shadow-lg shadow-foreground/5 sm:w-auto"
              asChild
            >
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <Monitor className="w-4 h-4 mr-2" />
                {viewMode === "business" ? "Open Live View" : "Live Monitor"}
              </a>
            </Button>
          )}
        </div>
      </div>

      {viewMode === "business" ? (
        <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="xl:col-span-5 bg-foreground/5 backdrop-blur-xl border-foreground/10 overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-black tracking-tight text-foreground">Business Summary</CardTitle>
              <CardDescription className="text-muted-foreground">
                The key facts, current risk, and the next decision in one place.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {businessSummaryCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-foreground/10 bg-background/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">{card.label}</p>
                      <p className="mt-2 text-xl font-black text-foreground">{card.value}</p>
                    </div>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${card.tone}`}>
                      <card.icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{card.helper}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="xl:col-span-4 bg-foreground/5 backdrop-blur-xl border-foreground/10 overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-black tracking-tight text-foreground">Current Focus</CardTitle>
              <CardDescription className="text-muted-foreground">
                What this run is working on right now.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-foreground/10 bg-background/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Mission objective</p>
                <p className="mt-2 text-base font-semibold text-foreground">{mission?.goal || mission?.name || "Mission objective not provided."}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-foreground/10 bg-background/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Cycles</p>
                  <p className="mt-2 text-2xl font-black text-foreground">{cycleCount}</p>
                </div>
                <div className="rounded-2xl border border-foreground/10 bg-background/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Team assigned</p>
                  <p className="mt-2 text-2xl font-black text-foreground">{mission?.members?.length || 1}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-background/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Latest checkpoint</p>
                <p className="mt-2 text-sm text-foreground">{latestCheckpoint}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-3 bg-foreground/5 backdrop-blur-xl border-foreground/10 overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-black tracking-tight text-foreground">Recommended Action</CardTitle>
              <CardDescription className="text-muted-foreground">
                The most useful next step for a business reviewer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {diagnosis ? (
                <>
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-rose-700 dark:text-rose-300 font-bold">What went wrong</p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{diagnosis.problem}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300 font-bold">Recommended fix</p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{diagnosis.recommendation}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleRecover(diagnosis.suggestedStrategy)}
                        disabled={recovering}
                        className="gap-1.5 bg-amber-500/90 text-background hover:bg-amber-400"
                      >
                        <RotateCcw className={cn("h-3.5 w-3.5", recovering && "animate-spin")} />
                        {diagnosis.suggestedStrategy === "reset" ? "Reset & retry"
                          : diagnosis.suggestedStrategy === "replan" ? "Replan"
                          : "Retry"}
                      </Button>
                      {diagnosis.suggestedStrategy !== "retry" && (
                        <Button size="sm" variant="outline" onClick={() => handleRecover("retry")} disabled={recovering} className="border-foreground/15">
                          Retry as-is
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300 font-bold">Do next</p>
                  <p className="mt-2 text-base font-semibold text-foreground">
                    {missionContext?.forgeStatus?.status === "awaiting_wave_approval"
                      ? "Review the latest phase and choose whether to approve or request changes."
                      : "Use the updates and outputs tabs to confirm progress against the objective."}
                  </p>
                </div>
              )}
              <div className="rounded-2xl border border-foreground/10 bg-background/20 p-4 text-sm text-muted-foreground">
                {budgetLimit > 0
                  ? `${formatCurrency(runCost)} spent of ${formatCurrency(budgetLimit)} planned.`
                  : "No budget limit is configured for this mission."}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Hero Stats */}
      {viewMode === "business" && (
        <div className="relative z-10 w-full">
          <BusinessImpactWidget mission={mission} run={run} />
        </div>
      )}
      {viewMode !== "business" && (
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              {
                label: "Execution Health",
                value: run?.status === "failed"
                  ? "Critical"
                  : missionContext?.admissionControl?.state === "queued"
                    ? "Queued"
                    : run?.status === "waiting_on_human" || run?.status === "waiting_on_file"
                      ? "Waiting"
                      : run?.status === "paused"
                        ? "Paused"
                        : Array.isArray(run?.dynamicTrace) && run.dynamicTrace.length <= 1
                          ? "Starting"
                          : "Nominal",
                icon: Shield,
                color: "emerald",
              },
              { label: "Active Cycles", value: cycleCount, icon: RotateCcw, color: "blue" },
              { label: "Budget Remaining", value: formatCurrency(budgetRemaining), icon: Activity, color: "amber" },
              { label: "Agent Population", value: mission?.members?.length || 1, icon: Zap, color: "purple" },
            ].map((stat, i) => (
              <Card key={i} className="bg-foreground/5 backdrop-blur-xl border-foreground/10 overflow-hidden group">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl bg-${stat.color}-500/10 border border-${stat.color}-500/20 flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <stat.icon className={`w-6 h-6 text-${stat.color}-500`} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{stat.label}</p>
                    <p className="text-xl font-black text-foreground">{stat.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
      )}

      {/* Main Content Area */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-12 space-y-6">
          {/* Wave Governance Gateway */}
          {(run?.missionContext as any)?.forgeStatus?.status === 'awaiting_wave_approval' && (
            <WaveGovernancePanel 
              jobId={(run?.missionContext as any)?.forgeStatus?.jobId} 
              run={run}
              onActionComplete={() => loadData()}
            />
          )}

          <StrategyAwareTabs mission={mission} run={run} viewMode={viewMode} />
        </div>
      </div>

      {/* Global Terminal Overlay Toggle (Optional) */}
      <div className="fixed bottom-24 right-4 z-40 sm:bottom-6 sm:right-6 sm:z-50">
        <Button size="lg" className="rounded-full w-14 h-14 p-0 bg-primary shadow-2xl shadow-primary/20 hover:scale-110 transition-all">
          <Activity className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}
