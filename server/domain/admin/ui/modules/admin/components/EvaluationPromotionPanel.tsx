import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowUpCircle, CheckCircle2, ShieldAlert, TestTube2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type {
  EvaluationLifecycleRun,
  EvaluationPromotionAssessment,
} from "@shared/evaluation-promotion";

interface EvaluationLifecycleResponse {
  activePromotion: {
    id: number;
    candidateRunId: number;
    promotedAt: string;
    promotedBy: string;
    reason: string | null;
  } | null;
  runs: EvaluationLifecycleRun[];
}

export function EvaluationPromotionPanel({ testSetId }: { testSetId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [candidateRunId, setCandidateRunId] = useState<number | null>(null);
  const [assessment, setAssessment] = useState<EvaluationPromotionAssessment | null>(null);
  const [reason, setReason] = useState("");

  const lifecycleQuery = useQuery<EvaluationLifecycleResponse>({
    queryKey: ["/api/evaluation-studio/test-sets", testSetId, "lifecycle"],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/evaluation-studio/test-sets/${testSetId}/lifecycle`);
      return response.json();
    },
  });

  useEffect(() => {
    const newestCandidate = lifecycleQuery.data?.runs.find(
      (run) => run.status === "completed" && !run.isActiveBaseline,
    );
    setCandidateRunId(newestCandidate?.runId ?? null);
    setAssessment(null);
  }, [testSetId, lifecycleQuery.data?.activePromotion?.id, lifecycleQuery.data?.runs.length]);

  const assessmentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/evaluation-studio/test-sets/${testSetId}/promotion-assessment`,
        { candidateRunId },
      );
      return response.json() as Promise<EvaluationPromotionAssessment>;
    },
    onSuccess: setAssessment,
    onError: (error: Error) => toast({
      title: "Assessment failed",
      description: error.message,
      variant: "destructive",
    }),
  });

  const promoteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/evaluation-studio/test-sets/${testSetId}/promote`,
        { candidateRunId, reason },
      );
      return response.json();
    },
    onSuccess: () => {
      setAssessment(null);
      setReason("");
      queryClient.invalidateQueries({
        queryKey: ["/api/evaluation-studio/test-sets", testSetId, "lifecycle"],
      });
      toast({
        title: "Evaluation baseline promoted",
        description: `Run #${candidateRunId} is now the comparison baseline.`,
      });
    },
    onError: (error: Error) => toast({
      title: "Promotion blocked",
      description: error.message,
      variant: "destructive",
    }),
  });

  if (lifecycleQuery.isLoading) {
    return (
      <Card className="border-foreground/10">
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 animate-spin" /> Loading evaluation lifecycle…
        </CardContent>
      </Card>
    );
  }

  const lifecycle = lifecycleQuery.data;
  const completedRuns = lifecycle?.runs.filter((run) => run.status === "completed") ?? [];

  return (
    <Card className="border-foreground/10 bg-card/70">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowUpCircle className="h-5 w-5 text-primary" />
            Evaluation promotion
          </CardTitle>
          {lifecycle?.activePromotion ? (
            <Badge variant="outline">
              Baseline run #{lifecycle.activePromotion.candidateRunId}
            </Badge>
          ) : (
            <Badge variant="secondary">No baseline established</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Compare a completed candidate against the active baseline before making it the new regression standard.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {completedRuns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-foreground/10 p-5 text-sm text-muted-foreground">
            Run this test set to create a promotion candidate.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="space-y-2 text-sm font-medium">
                Candidate run
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={candidateRunId ?? ""}
                  onChange={(event) => {
                    setCandidateRunId(Number(event.target.value));
                    setAssessment(null);
                  }}
                >
                  <option value="" disabled>Select a completed run</option>
                  {completedRuns.map((run) => (
                    <option key={run.runId} value={run.runId} disabled={run.isActiveBaseline}>
                      Run #{run.runId} — {run.passRate}% ({run.passed}/{run.total})
                      {run.isActiveBaseline ? " — active baseline" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="self-end"
                variant="outline"
                disabled={!candidateRunId || assessmentMutation.isPending}
                onClick={() => assessmentMutation.mutate()}
              >
                {assessmentMutation.isPending
                  ? <Activity className="mr-2 h-4 w-4 animate-spin" />
                  : <TestTube2 className="mr-2 h-4 w-4" />}
                Assess candidate
              </Button>
            </div>

            {assessment && (
              <div className="space-y-4 rounded-xl border border-foreground/10 bg-background/40 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {assessment.ready ? "Ready to promote" : "Promotion blocked"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {assessment.passRateDelta == null
                        ? "This candidate will establish the first baseline."
                        : `${assessment.passRateDelta >= 0 ? "+" : ""}${assessment.passRateDelta} pass-rate points versus baseline.`}
                    </p>
                  </div>
                  <Badge variant={assessment.ready ? "default" : "destructive"}>
                    {assessment.candidate.passRate}% pass
                  </Badge>
                </div>

                <div className="grid gap-2">
                  {assessment.checks.map((check) => (
                    <div key={check.id} className="flex gap-3 rounded-lg border border-foreground/5 p-3">
                      {check.status === "pass"
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        : <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${check.status === "block" ? "text-destructive" : "text-amber-500"}`} />}
                      <div>
                        <p className="text-sm font-medium">{check.label}</p>
                        <p className="text-xs text-muted-foreground">{check.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {assessment.ready && (
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Optional promotion rationale"
                    />
                    <Button
                      disabled={promoteMutation.isPending}
                      onClick={() => promoteMutation.mutate()}
                    >
                      {promoteMutation.isPending && <Activity className="mr-2 h-4 w-4 animate-spin" />}
                      Promote baseline
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              {completedRuns.slice(0, 5).map((run) => (
                <div key={run.runId} className="flex items-center justify-between rounded-lg border border-foreground/5 px-4 py-3 text-sm">
                  <span>
                    Run #{run.runId}
                    {run.isActiveBaseline && <span className="ml-2 text-xs text-primary">active baseline</span>}
                  </span>
                  <span className="text-muted-foreground">
                    {run.passed}/{run.total} passed · {run.passRate}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
