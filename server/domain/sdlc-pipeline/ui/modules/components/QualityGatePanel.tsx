import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { CheckCircle2, XCircle, ShieldAlert, ExternalLink } from "lucide-react";
import type { QualityGateResult, PRResult } from "../types/index.js";

export interface QualityGatePanelProps {
  result?: QualityGateResult;
  prResult?: PRResult;
  onRequestReview?: () => void;
}

export function QualityGatePanel({ result, prResult, onRequestReview }: QualityGatePanelProps) {
  if (!result) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Quality Gate</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Quality gate has not been evaluated.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="quality-gate-panel">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Quality Gate</CardTitle>
        <Badge variant={result.passed ? "success" : "destructive"} className="inline-flex items-center gap-1">
          {result.passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {result.passed ? "Passed" : "Failed"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1">
          {result.checks.map((check, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {check.passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-red-600" />
              )}
              <span>
                <span className="font-medium">{check.name}</span>
                {check.details && <span className="text-muted-foreground"> — {check.details}</span>}
              </span>
            </li>
          ))}
        </ul>

        {result.blockingFailures.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400">
              <ShieldAlert className="h-3 w-3" /> Blocking failures
            </p>
            <ul className="list-inside list-disc text-xs text-red-700 dark:text-red-400">
              {result.blockingFailures.map((f, i) => (
                <li key={i}>{f.check}: {f.reason}</li>
              ))}
            </ul>
            {onRequestReview && (
              <Button size="sm" variant="outline" className="mt-2" onClick={onRequestReview} data-testid="request-review">
                Request Human Review
              </Button>
            )}
          </div>
        )}

        {result.passed && prResult && (
          <div className="rounded-md border p-2 text-sm">
            <p className="mb-1 font-medium">Pull Request</p>
            <p className="text-xs text-muted-foreground">Branch: <code>{prResult.branchName}</code></p>
            <p className="text-xs text-muted-foreground">SHA: <code>{prResult.commitSha.slice(0, 12)}</code></p>
            <a href={prResult.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              PR #{prResult.prNumber} <ExternalLink className="h-3 w-3" />
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              {prResult.testEvidence.passingTests}/{prResult.testEvidence.totalTests} tests passing
              {prResult.testEvidence.fixAttempts > 0 && ` · ${prResult.testEvidence.fixAttempts} fix attempt(s)`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
