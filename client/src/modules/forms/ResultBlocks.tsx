import React from "react";
import DOMPurify from "dompurify";
import type { ResolvedResult } from "@shared/form-studio";
import { cn } from "@/lib/utils";

/**
 * A form's result blocks, resolved by the shared engine: scores against their
 * bands, breakdowns, the decision status, hard-stop gates, a grid placement and
 * narrative text. The same component shows results after a submission, in
 * Preview, and per response.
 */

const TONE: Record<string, string> = {
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function formatValue(value: unknown, format?: string): string {
  if (value === "" || value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (format === "currency") return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
    if (format === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 1 && value !== 0 ? 4 : 2 });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Authored HTML is sanitized before rendering; answers in it were already escaped. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone])}>{children}</span>;
}

const GATE_PILL = {
  tripped: { tone: "critical", label: "Stopped" },
  clear: { tone: "good", label: "Clear" },
  pending: { tone: "neutral", label: "Waiting" },
  error: { tone: "warning", label: "Cannot check" },
} as const;

function ResultBody({ result }: { result: ResolvedResult }) {
  switch (result.type) {
    case "score":
      return (
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="text-3xl font-semibold tabular-nums">{formatValue(result.value, result.format)}</p>
          {result.band && <Pill tone={result.band.tone as keyof typeof TONE}>{result.band.label}</Pill>}
        </div>
      );
    case "breakdown":
      return (
        <dl className="grid gap-2">
          {result.items.map((item) => {
            const bar = typeof item.value === "number" && item.value >= 0 && item.value <= 100 ? item.value : null;
            return (
              <div key={item.field} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <dt className="text-sm">
                  {item.label}
                  {item.weight !== undefined && <span className="ml-1 text-xs text-muted-foreground">{item.weight}%</span>}
                </dt>
                <dd className="text-sm font-medium tabular-nums">{formatValue(item.value)}</dd>
                {bar !== null && (
                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${bar}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </dl>
      );
    case "status":
      if (result.status) {
        return (
          <div>
            <p className="text-base font-semibold">{result.label}</p>
            {result.label !== result.status && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{result.status}</p>}
          </div>
        );
      }
      return (
        <p className="text-sm text-muted-foreground">
          {result.waitingOn.length ? `No decision yet: waiting on ${result.waitingOn.join(", ")}.` : "No decision yet."}
        </p>
      );
    case "gates":
      return (
        <ul className="grid gap-2">
          {result.items.map((item) => (
            <li key={item.label} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{item.label}</span>
              <span className="flex items-center gap-2">
                {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
                <Pill tone={GATE_PILL[item.state].tone}>{GATE_PILL[item.state].label}</Pill>
              </span>
            </li>
          ))}
        </ul>
      );
    case "grid":
      return <GridBody result={result} />;
    case "narrative":
      return <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.html) }} />;
    case "cohort":
      return <CohortBody result={result} />;
  }
}

const AGGREGATE_NOUN = { count: "Counted", sum: "Total", avg: "Average", min: "Lowest", max: "Highest" } as const;

/** This response's value beside a cohort metric, saying how many earlier responses the metric covers and when. */
function CohortBody({ result }: { result: Extract<ResolvedResult, { type: "cohort" }> }) {
  const { metric } = result;
  const rows = typeof metric.rows === "number" ? metric.rows : null;
  const hasMetric = metric.value !== "" && metric.value !== null && metric.value !== undefined;
  const difference = metric.aggregate !== "count" && typeof result.value === "number" && typeof metric.value === "number" ? result.value - metric.value : null;
  const asOf = metric.asOf ? new Date(metric.asOf).toLocaleString() : null;
  let coverage: string;
  if (rows === null) coverage = "The cohort has not been computed for this view.";
  else if (metric.aggregate === "count") coverage = `Counted over this form's completed responses${asOf ? `, as of ${asOf}` : ""}.`;
  else if (rows === 0) coverage = "No earlier responses to compare with yet.";
  else coverage = `${AGGREGATE_NOUN[metric.aggregate]} over ${rows} earlier ${rows === 1 ? "response" : "responses"}${asOf ? `, as of ${asOf}` : ""}.`;
  return (
    <div className="grid gap-2">
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">This response</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatValue(result.value, result.format)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{metric.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{hasMetric ? formatValue(metric.value, metric.aggregate === "count" ? "number" : result.format) : "—"}</dd>
        </div>
        {difference !== null && (
          <Pill tone="neutral">{difference >= 0 ? "+" : "−"}{formatValue(Math.abs(difference), result.format)}</Pill>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">{coverage}</p>
    </div>
  );
}

function GridBody({ result }: { result: Extract<ResolvedResult, { type: "grid" }> }) {
  if (!result.cell) return <p className="text-sm text-muted-foreground">Needs {result.xLabel} and {result.yLabel} to place.</p>;
  return <p className="text-sm">
    <span className="font-semibold">{result.cell.label || "Unlabelled cell"}</span>
    <span className="ml-2 text-xs text-muted-foreground">{result.yLabel} band {result.cell.row + 1}, {result.xLabel} band {result.cell.column + 1}</span>
  </p>;
}

export function ResultBlocks({ results, className, emptyMessage = "This form has no results to show." }: { results: ResolvedResult[]; className?: string; emptyMessage?: string }) {
  if (!results.length) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <div className={cn("grid gap-3", className)}>
      {results.map((result) => (
        <section key={result.id} aria-labelledby={`result-${result.id}`} data-testid={`result-${result.id}`} className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id={`result-${result.id}`} className="text-sm font-semibold">{result.title}</h3>
            {result.audience === "reviewer" && <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reviewers only</span>}
          </div>
          <ResultBody result={result} />
        </section>
      ))}
    </div>
  );
}
