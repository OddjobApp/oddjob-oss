import { useState } from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { TestResult, TestOutcome, TestCategory } from "../types/index.js";

const OUTCOME_VARIANT: Record<TestOutcome, "success" | "destructive" | "warning" | "secondary"> = {
  passed: "success",
  failed: "destructive",
  fixed: "warning",
  skipped: "secondary",
};

const CATEGORY_LABEL: Record<TestCategory, string> = {
  pre_existing: "Pre-existing",
  generated: "Generated",
  regression: "Regression",
};

export interface TestsTabProps {
  tests: TestResult[];
}

export function TestsTab({ tests }: TestsTabProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (tests.length === 0) {
    return <p className="text-sm text-muted-foreground">No test results recorded.</p>;
  }

  const total = tests.length;
  const passedFirstTry = tests.filter((t) => t.outcome === "passed" && !t.fixIterations).length;
  const passedAfterFixes = tests.filter((t) => t.outcome === "fixed").length;
  const remainingFailures = tests.filter((t) => t.outcome === "failed").length;
  const passPct = Math.round(((passedFirstTry + passedAfterFixes) / total) * 100);

  const categories: TestCategory[] = ["pre_existing", "generated", "regression"];
  const key = (t: TestResult) => `${t.filePath}::${t.name}`;
  const toggle = (k: string) => setOpen((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="space-y-4" data-testid="tests-tab">
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <div><span className="text-muted-foreground">Total</span><p className="font-semibold">{total}</p></div>
        <div><span className="text-muted-foreground">First try</span><p className="font-semibold">{passedFirstTry}</p></div>
        <div><span className="text-muted-foreground">After fixes</span><p className="font-semibold">{passedAfterFixes}</p></div>
        <div><span className="text-muted-foreground">Failing</span><p className="font-semibold text-red-600">{remainingFailures}</p></div>
        <div><span className="text-muted-foreground">Pass %</span><p className="font-semibold">{passPct}%</p></div>
      </div>

      {categories.map((cat) => {
        const group = tests.filter((t) => t.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat}>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{CATEGORY_LABEL[cat]} ({group.length})</p>
            <ul className="space-y-1">
              {group.map((t) => {
                const k = key(t);
                const isOpen = open.has(k);
                const hasDetail = !!(t.assertionOutput || t.stackTrace || t.rootCause || t.appliedFix);
                return (
                  <li key={k} className={cn("rounded-md border p-2", t.exhausted && "border-amber-400")}>
                    <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => hasDetail && toggle(k)} disabled={!hasDetail}>
                      {t.exhausted && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                      <span className="text-sm">{t.name}</span>
                      <code className="text-[10px] text-muted-foreground">{t.filePath}</code>
                      {t.fixIterations ? <Badge variant="warning" className="text-[10px]">×{t.fixIterations} fixes</Badge> : null}
                      <Badge variant={OUTCOME_VARIANT[t.outcome]} className="ml-auto text-[10px]">{t.outcome}</Badge>
                      <span className="text-[10px] text-muted-foreground">{t.durationMs}ms</span>
                      {hasDetail && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                    </button>
                    {isOpen && (
                      <div className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground">
                        {t.rootCause && <p><strong>Root cause:</strong> {t.rootCause}</p>}
                        {t.appliedFix && <p><strong>Fix:</strong> {t.appliedFix.description}</p>}
                        {t.assertionOutput && <pre className="overflow-x-auto rounded bg-muted p-2">{t.assertionOutput}</pre>}
                        {t.stackTrace && <pre className="overflow-x-auto rounded bg-muted p-2">{t.stackTrace}</pre>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
