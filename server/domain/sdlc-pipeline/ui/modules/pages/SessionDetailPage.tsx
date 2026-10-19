import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Spinner } from "@domain-ui/core/ui/components/ui/spinner";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useSessionDetail } from "../hooks/useSessionDetail.js";
import { useSessionMetrics } from "../hooks/useSessionMetrics.js";
import { useSessionArtifacts } from "../hooks/useSessionArtifacts.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { PhaseProgressStepper } from "../components/PhaseProgressStepper.js";
import { VerificationTimeline } from "../components/VerificationTimeline.js";
import { QualityGatePanel } from "../components/QualityGatePanel.js";
import { DeliverablePanel } from "../components/DeliverablePanel.js";
import { CostMetricsPanel } from "../components/CostMetricsPanel.js";
import { SessionActionBar } from "../components/SessionActionBar.js";
import { DesignTab } from "../components/DesignTab.js";
import { TasksTab } from "../components/TasksTab.js";
import { TestsTab } from "../components/TestsTab.js";
import { ArtifactsTab } from "../components/ArtifactsTab.js";
import { ProcessFlowDiagram } from "../components/ProcessFlowDiagram.js";
import { DecisionGatesPanel } from "../components/DecisionGatesPanel.js";
import { useSessionActions } from "../hooks/useSessionActions.js";
import type {
  ArtifactLineage, EditPlan, VerificationReport, QualityGateResult, PRResult,
  TestLoopResult, TaskEntry, TestResult, AutonomousMetrics,
} from "../types/index.js";

/** Best-effort extraction of the latest artifact whose name matches one of `nameIncludes`. */
function latestArtifact(lineage: ArtifactLineage | undefined, nameIncludes: string[]): unknown | undefined {
  if (!lineage) return undefined;
  for (const phase of lineage.phases) {
    const matches = phase.artifacts.filter((a) =>
      nameIncludes.some((n) => a.name.toLowerCase().includes(n)),
    );
    if (matches.length) return [...matches].sort((x, y) => y.version - x.version)[0].content;
  }
  return undefined;
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const detail = useSessionDetail(id);
  const session = detail.data;
  const metrics = useSessionMetrics(id, session?.status);
  const artifacts = useSessionArtifacts(id);
  const actions = useSessionActions(id ?? "");

  // 404 → redirect to dashboard with a toast.
  useEffect(() => {
    if (detail.isError) {
      toast({ title: "Session not found", variant: "destructive" });
      setLocation("/pipeline/sessions");
    }
  }, [detail.isError, setLocation, toast]);

  if (detail.isLoading || !session) {
    return <div className="flex justify-center p-12" data-testid="session-detail-loading"><Spinner /></div>;
  }

  const lineage = artifacts.data;
  const editPlan = latestArtifact(lineage, ["edit_plan", "change_plan", "editplan"]) as EditPlan | undefined;
  const verification = latestArtifact(lineage, ["verification_report", "verification"]) as VerificationReport | undefined;
  const qualityGate = latestArtifact(lineage, ["quality_gate", "qualitygate", "gate"]) as QualityGateResult | undefined;
  const pr = latestArtifact(lineage, ["pr_result", "pull_request", "pr"]) as PRResult | undefined;
  const testLoop = latestArtifact(lineage, ["test_loop", "test_results", "tests"]) as TestLoopResult | undefined;
  const autonomous = (session.metadata as { metrics?: AutonomousMetrics } | undefined)?.metrics;

  const tasks: TaskEntry[] = (editPlan?.operations ?? []).map((op, i) => ({
    id: op.id,
    title: `${op.type} · ${op.filePath}`,
    status: "pending",
    order: i,
    rationale: op.rationale,
    affectedFiles: [op.filePath],
  }));

  const tests: TestResult[] = testLoop
    ? [
        ...testLoop.passingTests.map((name): TestResult => ({ name, filePath: name, outcome: "passed", category: "generated", durationMs: 0 })),
        ...testLoop.failingTests.map((name): TestResult => ({ name, filePath: name, outcome: "failed", category: "generated", durationMs: 0 })),
      ]
    : [];

  return (
    <div className="space-y-4 p-6" data-testid="session-detail-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold">{session.id.slice(0, 12)}</h1>
          <StatusBadge status={session.status} />
        </div>
        <SessionActionBar sessionId={session.id} status={session.status} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="process">Process</TabsTrigger>
          <TabsTrigger value="gates">Decision Gates</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Phase Progress</CardTitle></CardHeader>
            <CardContent>
              <PhaseProgressStepper phases={session.phases} onRetryPhase={() => actions.retryPhase.mutate(undefined)} />
            </CardContent>
          </Card>
          <CostMetricsPanel metrics={metrics.data} autonomous={autonomous} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Verification</CardTitle></CardHeader>
              <CardContent><VerificationTimeline events={verification?.timeline} /></CardContent>
            </Card>
            <QualityGatePanel result={qualityGate} prResult={pr} onRequestReview={() => actions.forceApproveGate.mutate()} />
          </div>
          <DeliverablePanel pr={pr} fileOperations={editPlan?.operations} />
        </TabsContent>

        <TabsContent value="design"><DesignTab editPlan={editPlan} /></TabsContent>
        <TabsContent value="tasks"><TasksTab tasks={tasks} /></TabsContent>
        <TabsContent value="tests"><TestsTab tests={tests} /></TabsContent>
        <TabsContent value="artifacts"><ArtifactsTab lineage={lineage} /></TabsContent>
        <TabsContent value="process"><ProcessFlowDiagram phases={session.phases} currentPhase={session.currentPhase} /></TabsContent>
        <TabsContent value="gates"><DecisionGatesPanel gates={[]} onApprove={() => actions.approveScope.mutate()} /></TabsContent>
      </Tabs>
    </div>
  );
}
