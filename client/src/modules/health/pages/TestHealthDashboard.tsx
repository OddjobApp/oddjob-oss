import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  GitCommit,
  GitPullRequest,
  History,
  LoaderCircle,
  Network,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Wand2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

type TestBlock = {
  id: string;
  filePath: string;
  testName: string;
  suiteId?: string;
  behaviorIds?: string[];
  tags?: string[];
  startLine?: number;
  endLine?: number;
};

type TestSuite = {
  id: string;
  name: string;
  domain: string;
  feature: string;
  tier: "smoke" | "feature" | "workflow" | "accessibility" | "generated";
  owner: string;
  routes: string[];
  tags: string[];
  schedule: "on-change" | "per-commit" | "nightly" | "weekly" | "manual";
  testCount: number;
  behaviorCount: number;
  files: string[];
};

type E2EManifestV2 = {
  schemaVersion: 2;
  generatedAt: string;
  suites: TestSuite[];
  tests: TestBlock[];
  summary: {
    suiteCount: number;
    populatedSuiteCount: number;
    testCount: number;
    behaviorCount: number;
  };
};

type IncidentItem = {
  id: number;
  datasetId?: number;
  data?: {
    bug_summary?: string;
    description?: string;
    reproduction_steps?: string;
    environment?: string;
    browser_or_device?: string;
    error_logs?: string;
    severity_suggestion?: string;
    metadata?: IncidentMetadata;
  };
  // Compatibility with older normalized responses.
  summary?: string;
  textContent?: string;
  createdAt: string;
  metadata?: IncidentMetadata;
};

type IncidentMetadata = {
  source?: string;
  projectName?: string;
  testFile?: string;
  testName?: string;
  errorMessage?: string;
  stackTrace?: string;
  durationMs?: number;
  screenshotPath?: string;
  videoPath?: string;
  suggestedApproach?: string;
  appliedFix?: {
    filePath: string;
    changes: Array<{
      originalCode: string;
      newCode: string;
    }>;
  };
  outcome?: string;
};

type ScheduledJob = {
  id?: number;
  scheduledJobId?: number;
  name?: string;
  jobName?: string;
  scheduleName?: string;
  isActive?: boolean;
  nextRunTime?: string | null;
};

type ExecutionHistoryItem = {
  id: number;
  scheduledJobId: number;
  scheduledJobName?: string;
  status: "running" | "completed" | "failed" | "retrying" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
};

type DocumentationSpec = {
  featureId: string;
  title: string;
  status: string;
  generatedAt: string | null;
  persisted: boolean;
};

type DocumentationChange = {
  id: number;
  documentKey: string;
  documentTitle: string;
  kind: "addition" | "change" | "deletion";
  explanation: string;
  occurredAt: string;
  hidden: boolean;
  features?: string[];
};

type RunFeedback = {
  tone: "success" | "error";
  message: string;
};

type StatItem = {
  label: string;
  value: string | number;
  helper: string;
  icon: LucideIcon;
  tone: string;
};

const passingOutcomes = new Set(["all_passed", "passed", "pass", "resolved", "success", "healed"]);

function isPassingOutcome(outcome?: string) {
  return passingOutcomes.has(String(outcome || "").toLowerCase());
}

function formatOutcome(outcome?: string) {
  const normalized = String(outcome || "failed").replaceAll("_", " ");
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getIncidentMetadata(incident: IncidentItem) {
  return incident.data?.metadata || incident.metadata || {};
}

function getIncidentTitle(incident: IncidentItem) {
  const metadata = getIncidentMetadata(incident);
  return metadata.testName || incident.data?.bug_summary || incident.summary || `Incident #${incident.id}`;
}

function getIncidentLog(incident: IncidentItem) {
  const metadata = getIncidentMetadata(incident);
  return metadata.errorMessage || incident.data?.error_logs || incident.data?.description || incident.textContent;
}

export default function TestHealthDashboard() {
  const queryClient = useQueryClient();
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [runningHealingId, setRunningHealingId] = useState<string | null>(null);
  const [runningSuite, setRunningSuite] = useState(false);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const testsQuery = useQuery<E2EManifestV2>({
    queryKey: ["/api/health/e2e-tests"],
    queryFn: () => fetchJson("/api/health/e2e-tests"),
    refetchInterval: 30000,
  });

  const historyQuery = useQuery<{ items: IncidentItem[] }>({
    queryKey: ["/api/datasets/71/items"],
    queryFn: () => fetchJson("/api/datasets/71/items?limit=25"),
    refetchInterval: 15000,
  });

  const scheduledJobsQuery = useQuery<ScheduledJob[]>({
    queryKey: ["/api/scheduled-jobs", "e2e-health"],
    queryFn: () => fetchJson("/api/scheduled-jobs"),
    refetchInterval: 30000,
  });

  const documentationQuery = useQuery<DocumentationSpec>({
    queryKey: ["/api/documentation/features", "e2e-testing", "spec"],
    queryFn: () => fetchJson("/api/documentation/features/e2e-testing/spec"),
    staleTime: 60000,
  });

  const changesQuery = useQuery<{ changes: DocumentationChange[] }>({
    queryKey: ["/api/documentation/changes", "e2e-health"],
    queryFn: () => fetchJson("/api/documentation/changes"),
    staleTime: 60000,
  });

  const testList = testsQuery.data?.tests || [];
  const suiteList = testsQuery.data?.suites || [];
  const suiteById = new Map(suiteList.map((suite) => [suite.id, suite]));

  const queryLower = searchQuery.trim().toLowerCase();
  const filteredSuiteList = suiteList.filter((suite) => {
    if (!queryLower) return true;
    return (
      suite.name.toLowerCase().includes(queryLower) ||
      suite.domain.toLowerCase().includes(queryLower) ||
      suite.feature.toLowerCase().includes(queryLower) ||
      suite.owner.toLowerCase().includes(queryLower)
    );
  });

  const filteredTestList = testList.filter((test) => {
    if (!queryLower) return true;
    return (
      test.testName.toLowerCase().includes(queryLower) ||
      test.filePath.toLowerCase().includes(queryLower) ||
      (test.suiteId && test.suiteId.toLowerCase().includes(queryLower)) ||
      (test.behaviorIds && test.behaviorIds.some((b) => b.toLowerCase().includes(queryLower)))
    );
  });
  const incidentList = historyQuery.data?.items || [];
  const scheduledJobs = Array.isArray(scheduledJobsQuery.data) ? scheduledJobsQuery.data : [];
  const e2eScheduledJob = scheduledJobs.find((job) =>
    `${job.name || ""} ${job.jobName || ""}`.toLowerCase().match(/playwright|e2e/),
  );
  const e2eScheduledJobId = e2eScheduledJob?.scheduledJobId || e2eScheduledJob?.id;

  const executionHistoryQuery = useQuery<{ data: ExecutionHistoryItem[] }>({
    queryKey: ["/api/scheduled-jobs", e2eScheduledJobId, "history", "e2e-health"],
    queryFn: () => fetchJson(`/api/scheduled-jobs/${e2eScheduledJobId}/history?limit=20`),
    enabled: Boolean(e2eScheduledJobId),
    refetchInterval: 15000,
  });

  const executionHistory = executionHistoryQuery.data?.data || [];
  const e2eChanges = (changesQuery.data?.changes || []).filter((change) => {
    const searchable = [change.documentKey, change.documentTitle, ...(change.features || [])].join(" ").toLowerCase();
    return searchable.includes("e2e") || searchable.includes("playwright");
  });

  const runTestMutation = useMutation({
    mutationFn: async (params: {
      testId: string;
      filePath: string;
      testName: string;
      runSelfHealing: boolean;
    }) => {
      const res = await fetch("/api/health/e2e-tests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testFiles: [params.filePath],
          testName: params.testName,
          runSelfHealing: params.runSelfHealing,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to trigger E2E execution");
      return res.json() as Promise<{ message?: string }>;
    },
    onSuccess: (data) => {
      setRunFeedback({
        tone: "success",
        message: data.message || "Execution started. Results will appear in the incident timeline.",
      });
      setTimeout(() => {
        setRunningTestId(null);
        setRunningHealingId(null);
        queryClient.invalidateQueries({ queryKey: ["/api/datasets/71/items"] });
      }, 5000);
    },
    onError: () => {
      setRunningTestId(null);
      setRunningHealingId(null);
      setRunFeedback({
        tone: "error",
        message: "The execution could not be started. Refresh the page and try again.",
      });
    },
  });

  const runSuiteMutation = useMutation({
    mutationFn: async () => {
      if (e2eScheduledJobId) {
        const res = await fetch(`/api/scheduled-jobs/${e2eScheduledJobId}/run`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to start the scheduled E2E suite");
        return res.json() as Promise<{ message?: string }>;
      }

      const testFiles = Array.from(new Set(testList.map((test) => test.filePath)));
      const res = await fetch("/api/health/e2e-tests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testFiles, runSelfHealing: false }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to start the E2E suite");
      return res.json() as Promise<{ message?: string }>;
    },
    onSuccess: (data) => {
      setRunFeedback({
        tone: "success",
        message: data.message || "The complete E2E suite started in the background.",
      });
      setTimeout(() => {
        setRunningSuite(false);
        executionHistoryQuery.refetch();
        historyQuery.refetch();
      }, 5000);
    },
    onError: () => {
      setRunningSuite(false);
      setRunFeedback({
        tone: "error",
        message: "The complete E2E suite could not be started. Refresh the page and try again.",
      });
    },
  });

  const handleRunTest = (test: TestBlock) => {
    setRunFeedback(null);
    setRunningTestId(test.id);
    runTestMutation.mutate({
      testId: test.id,
      filePath: test.filePath,
      testName: test.testName,
      runSelfHealing: false,
    });
  };

  const handleRunSelfHealing = (test: TestBlock) => {
    setRunFeedback(null);
    setRunningHealingId(test.id);
    runTestMutation.mutate({
      testId: test.id,
      filePath: test.filePath,
      testName: test.testName,
      runSelfHealing: true,
    });
  };

  const handleRunSuite = () => {
    setRunFeedback(null);
    setRunningSuite(true);
    runSuiteMutation.mutate();
  };

  const totalTests = testList.length;
  const populatedSuites = suiteList.filter((suite) => suite.testCount > 0).length;
  const openFailures = incidentList.filter((incident) => !isPassingOutcome(getIncidentMetadata(incident).outcome)).length;
  const latestRun = executionHistory[0];
  const activeRun = Boolean(
    runningTestId ||
      runningHealingId ||
      runningSuite ||
      latestRun?.status === "running" ||
      latestRun?.status === "retrying",
  );
  const isRefreshing =
    testsQuery.isFetching ||
    historyQuery.isFetching ||
    scheduledJobsQuery.isFetching ||
    executionHistoryQuery.isFetching ||
    documentationQuery.isFetching ||
    changesQuery.isFetching;
  const hasLoadError = testsQuery.isError || historyQuery.isError;

  const completedExecutions = executionHistory.filter((run) => run.status === "completed" || run.status === "failed");
  const passRate = completedExecutions.length
    ? Math.round((completedExecutions.filter((run) => run.status === "completed").length / completedExecutions.length) * 100)
    : null;

  const lastUpdated = Math.max(testsQuery.dataUpdatedAt || 0, historyQuery.dataUpdatedAt || 0);
  const stats: StatItem[] = [
    {
      label: "Indexed suites",
      value: suiteList.length,
      helper: `${populatedSuites} populated / ${totalTests} tests`,
      icon: Activity,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "Latest pass rate",
      value: passRate === null ? "—" : `${passRate}%`,
      helper: passRate === null ? "connect execution history" : `${completedExecutions.length} recent suite runs`,
      icon: CheckCircle2,
      tone:
        passRate === null
          ? "border-border/20 bg-muted/10 text-foreground"
          : passRate === 100
            ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Open failures",
      value: openFailures,
      helper: openFailures === 1 ? "incident needs review" : "incidents need review",
      icon: XCircle,
      tone:
        openFailures > 0
          ? "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Runner state",
      value: activeRun ? "Running" : "Ready",
      helper: activeRun ? "execution in progress" : "available for a new run",
      icon: activeRun ? LoaderCircle : Play,
      tone: activeRun
        ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  ];

  const documentationStatus = documentationQuery.data?.status || "missing";
  const latestE2eChange = e2eChanges[0];
  const pipelineStages = [
    {
      label: "Change registered",
      helper: "version.commit publishes changed files",
      icon: GitCommit,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Impact scoped",
      helper: "affected atomic tests are selected",
      icon: Network,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "Tests executed",
      helper: e2eScheduledJobId ? "scheduled history connected" : "direct runner available",
      icon: Play,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Block assembled",
      helper: "one failing test is patched surgically",
      icon: GitPullRequest,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      label: "Bug triaged",
      helper: "code defects route through Dataset 71",
      icon: Rocket,
      tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
  ];

  const refreshAll = () => {
    setRunFeedback(null);
    testsQuery.refetch();
    historyQuery.refetch();
    scheduledJobsQuery.refetch();
    if (e2eScheduledJobId) executionHistoryQuery.refetch();
    documentationQuery.refetch();
    changesQuery.refetch();
  };

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                Health / E2E testing
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                E2E Test Health
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-muted-foreground">
                Run Playwright checks, review failures, and route broken journeys through the self-healing loop.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col items-start gap-1 xl:items-end">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground" aria-live="polite">
                {lastUpdated ? `Updated ${formatTimestamp(new Date(lastUpdated).toISOString())}` : "Waiting for results"}
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {e2eScheduledJob
                  ? `${e2eScheduledJob.name || "E2E schedule"}${e2eScheduledJob.nextRunTime ? ` / next ${e2eScheduledJob.nextRunTime}` : ""}`
                  : "No E2E schedule connected"}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={refreshAll}
              disabled={isRefreshing}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4 text-cyan-700 dark:text-cyan-300", isRefreshing && "animate-spin")} />
              {isRefreshing ? "Refreshing" : "Refresh status"}
            </Button>
            <Button
              onClick={handleRunSuite}
              disabled={activeRun || totalTests === 0}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              {runningSuite ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {runningSuite ? "Starting suite" : "Run suite now"}
            </Button>
          </div>
        </div>

        {hasLoadError && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-foreground">Some health data could not be loaded</p>
              <p className="mt-1 text-xs font-medium text-rose-700 dark:text-rose-200/70">Refresh the dashboard to retry the failed request.</p>
            </div>
          </div>
        )}

        {runFeedback && (
          <div
            role={runFeedback.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4",
              runFeedback.tone === "error"
                ? "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-200"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
            )}
          >
            {runFeedback.tone === "error" ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <p className="text-sm font-semibold">{runFeedback.message}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="min-w-0 border-foreground/10 bg-foreground/[0.04]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    {testsQuery.isLoading || historyQuery.isLoading ? (
                      <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                    ) : (
                      <p className="mt-1 truncate text-3xl font-black text-foreground">{stat.value}</p>
                    )}
                    <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{stat.helper}</p>
                  </div>
                  <div className={cn("shrink-0 rounded-xl border p-3", stat.tone)}>
                    <Icon className={cn("h-5 w-5", activeRun && stat.label === "Runner state" && "animate-spin")} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="min-w-0 border-cyan-400/20 bg-cyan-500/[0.05]">
          <CardHeader className="border-b border-foreground/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                  <Network className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                  Automated validation path
                </CardTitle>
                <CardDescription className="mt-1 max-w-3xl text-xs text-muted-foreground">
                  Change registration drives impact-scoped Playwright runs; UI drift can be repaired as an atomic test block, while product defects move into governed bug triage.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/platform-maintenance/documentation?tab=modules&feature=e2e-testing"
                  className="inline-flex h-9 items-center rounded-xl border border-foreground/10 bg-foreground/[0.03] px-3 text-[10px] font-black uppercase text-foreground transition-colors hover:bg-foreground/[0.08]"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  Documentation
                  <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/platform-maintenance/documentation?tab=changes"
                  className="inline-flex h-9 items-center rounded-xl border border-foreground/10 bg-foreground/[0.03] px-3 text-[10px] font-black uppercase text-foreground transition-colors hover:bg-foreground/[0.08]"
                >
                  <GitCommit className="mr-2 h-4 w-4" />
                  Change register
                  <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {pipelineStages.map((stage, index) => {
                const Icon = stage.icon;
                return (
                  <div key={stage.label} className="relative rounded-xl border border-foreground/10 bg-background/20 p-3">
                    <div className="flex items-start gap-3">
                      <div className={cn("shrink-0 rounded-xl border p-2.5", stage.tone)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-tight text-foreground">{index + 1}. {stage.label}</p>
                        <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{stage.helper}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-foreground/10 bg-background/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn(
                  "shrink-0 rounded-xl border p-2.5",
                  documentationStatus === "up-to-date" || documentationStatus === "completed"
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}>
                  <BookOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight text-foreground">
                    E2E documentation {formatOutcome(documentationStatus)}
                  </p>
                  <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                    {latestE2eChange
                      ? `Latest register entry: ${latestE2eChange.explanation}`
                      : documentationStatus === "up-to-date" || documentationStatus === "completed"
                        ? "No change register entries for E2E testing yet."
                        : "No change register entries for E2E testing yet. Generate the documentation to start the record."}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="w-fit shrink-0 border-cyan-400/30 text-[10px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                {e2eChanges.length} relevant {e2eChanges.length === 1 ? "change" : "changes"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <Card className="min-w-0 border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                    <Activity className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                    Indexed test suites
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs text-muted-foreground">
                    Run a focused check or start a self-healing investigation.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="w-fit border-cyan-400/30 text-[10px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                  {totalTests} {totalTests === 1 ? "test" : "tests"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search test suites or specs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filter test suites or specs"
                  className="h-9 rounded-xl border-foreground/10 bg-background/20 pl-9 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-cyan-300"
                />
              </div>
              {testsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-28 rounded-xl bg-foreground/10" />
                  ))}
                </div>
              ) : suiteList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-foreground/10 bg-background/20 p-8 text-center">
                  <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 text-sm font-bold text-foreground">No E2E suites registered</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">Add suite metadata to tests/suites.json, then refresh this page.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {filteredSuiteList.map((suite) => (
                      <div key={suite.id} className="rounded-xl border border-foreground/10 bg-background/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black uppercase tracking-wide text-foreground">{suite.name}</p>
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              {suite.domain} / {suite.tier}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 border-foreground/10 text-[9px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                            {suite.testCount} {suite.testCount === 1 ? "test" : "tests"}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300/70">{suite.schedule}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">/ {suite.owner}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">/ {suite.behaviorCount} behaviors</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {testList.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-foreground/10 bg-background/20 p-6 text-center text-xs font-medium text-muted-foreground">
                      Suites are registered; add atomic specs to populate them.
                    </div>
                  ) : (
                  <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                  {filteredTestList.map((test) => {
                    const isTestRunning = runningTestId === test.id;
                    const isHealingRunning = runningHealingId === test.id;
                    const suite = test.suiteId ? suiteById.get(test.suiteId) : undefined;
                    return (
                      <div
                        key={test.id}
                        className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border border-foreground/10 bg-background/20 p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.05] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-start gap-2">
                            <Badge variant="outline" className="mt-0.5 shrink-0 border-foreground/10 text-[9px] font-black uppercase text-muted-foreground">
                              {suite?.name || test.suiteId || "Unassigned"}
                            </Badge>
                            <p className="min-w-0 text-sm font-bold leading-5 text-foreground">{test.testName}</p>
                          </div>
                          <div className="mt-2 flex min-w-0 items-start gap-2 text-xs font-medium text-muted-foreground">
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <div className="min-w-0">
                              <span className="block min-w-0 break-all font-mono">{test.filePath}</span>
                              <span className="mt-1 block text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300/70">
                                Atomic block / {test.id}
                                {test.startLine && test.endLine ? ` / lines ${test.startLine}-${test.endLine}` : ""}
                              </span>
                              {test.behaviorIds && test.behaviorIds.length > 0 && (
                                <span className="mt-1 block break-all text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300/70">
                                  Verifies / {test.behaviorIds.join(", ")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-10 flex-1 rounded-xl border-foreground/10 bg-foreground/[0.03] px-4 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08] sm:flex-none"
                            onClick={() => handleRunTest(test)}
                            disabled={activeRun}
                            aria-label={`Run ${test.testName}`}
                          >
                            {isTestRunning ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                            {isTestRunning ? "Running" : "Run test"}
                          </Button>
                          <Button
                            size="sm"
                            className="h-10 flex-1 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 sm:flex-none"
                            onClick={() => handleRunSelfHealing(test)}
                            disabled={activeRun}
                            aria-label={`Self-heal ${test.testName}`}
                          >
                            {isHealingRunning ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                            {isHealingRunning ? "Healing" : "Self-heal"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                    <History className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                    Incident timeline
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs text-muted-foreground">
                    Review failures and outcomes from autonomous triage runs.
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit text-[10px] font-black uppercase",
                    openFailures > 0 ? "border-rose-400/30 text-rose-700 dark:text-rose-300" : "border-emerald-400/30 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {openFailures > 0 ? `${openFailures} open` : "Clear"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {historyQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 rounded-xl bg-foreground/10" />
                  ))}
                </div>
              ) : incidentList.length === 0 ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                  <p className="mt-3 text-sm font-bold text-foreground">No incidents recorded</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">New execution results will appear here.</p>
                </div>
              ) : (
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {incidentList.map((incident) => {
                    const metadata = getIncidentMetadata(incident);
                    const status = metadata.outcome || "failed";
                    const isResolved = isPassingOutcome(status);
                    const title = getIncidentTitle(incident);
                    return (
                      <button
                        key={incident.id}
                        type="button"
                        className={cn(
                          "group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                          selectedIncident?.id === incident.id
                            ? "border-violet-400/40 bg-violet-500/10"
                            : "border-foreground/10 bg-background/20 hover:border-foreground/20 hover:bg-foreground/[0.05]",
                        )}
                        onClick={() => setSelectedIncident(incident)}
                        aria-label={`Open ${title}`}
                        aria-pressed={selectedIncident?.id === incident.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{title}</p>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
                            <span className="max-w-full truncate font-mono">{metadata.testFile || "Spec unavailable"}</span>
                            <span aria-hidden="true">/</span>
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatTimestamp(incident.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "hidden text-[9px] font-black uppercase sm:inline-flex",
                              isResolved ? "border-emerald-400/30 text-emerald-700 dark:text-emerald-300" : "border-rose-400/30 text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {formatOutcome(status)}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {selectedIncident && (
          <Card className="min-w-0 border-violet-400/20 bg-violet-500/[0.05]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                    <AlertTriangle className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                    Incident #{selectedIncident.id}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs text-muted-foreground">
                    Diagnosis, failure evidence, and any patch produced by the self-healing pipeline.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-fit rounded-xl border-foreground/10 bg-foreground/[0.03] px-4 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
                  onClick={() => setSelectedIncident(null)}
                >
                  Close details
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-4">
              <div className="space-y-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Failure log</h2>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-rose-400/20 bg-background/30 p-4 font-mono text-xs leading-5 text-rose-700 dark:text-rose-200">
                  {getIncidentLog(selectedIncident) || "No failure log was captured for this incident."}
                </pre>
              </div>

              {getIncidentMetadata(selectedIncident).suggestedApproach && (
                <div className="space-y-2">
                  <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">AI triage diagnosis</h2>
                  <div className="rounded-xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm font-medium leading-6 text-foreground">
                    {getIncidentMetadata(selectedIncident).suggestedApproach}
                  </div>
                </div>
              )}

              {getIncidentMetadata(selectedIncident).appliedFix?.changes?.map((change, index) => (
                <div key={index} className="space-y-2">
                  <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Patch applied / {getIncidentMetadata(selectedIncident).appliedFix?.filePath}
                  </h2>
                  <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-300">Before</span>
                      <pre className="overflow-auto rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 font-mono text-xs text-rose-700 dark:text-rose-200">
                        {change.originalCode}
                      </pre>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">After</span>
                      <pre className="overflow-auto rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 font-mono text-xs text-emerald-700 dark:text-emerald-200">
                        {change.newCode}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
