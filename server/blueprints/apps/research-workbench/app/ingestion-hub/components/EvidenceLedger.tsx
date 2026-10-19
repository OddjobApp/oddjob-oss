"use client";

import { useMemo, useState } from "react";
import type {
  EvidenceStrength,
  ResearchClaim,
  ResearchSource,
  SourceQualityAssessment,
} from "../../../lib/platform-client";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown source";
  }
}

export function assessSourceQuality(
  source: ResearchSource,
): SourceQualityAssessment {
  if (source.quality) return source.quality;

  const issues: string[] = [];
  let score =
    source.status === "indexed" ? 45 : source.status === "pending" ? 20 : 5;
  const hostname = host(source.url);
  const academic =
    source.type === "paper" ||
    /\.edu$/.test(hostname) ||
    hostname.includes("arxiv.org");
  const firstParty =
    source.type === "api" ||
    source.type === "legal" ||
    hostname.endsWith(".gov") ||
    hostname.includes("github.com");

  if (academic) score += 30;
  if (firstParty) score += 25;
  if (source.publishedAt) score += 5;
  else issues.push("Publication date unavailable");
  if (!source.publisher) issues.push("Publisher metadata unavailable");
  if (!source.summary) issues.push("No indexed summary");
  if (source.status !== "indexed") issues.push(`Source is ${source.status}`);

  score = Math.min(100, score);
  return {
    score,
    strength: score >= 75 ? "high" : score >= 45 ? "medium" : "low",
    primarySource: firstParty,
    recency: source.publishedAt ? "current" : "unknown",
    authority: academic
      ? "peer-reviewed"
      : firstParty
        ? "first-party"
        : "unknown",
    issues,
  };
}

function StrengthBadge({ strength }: { strength: EvidenceStrength }) {
  const style =
    strength === "high"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
      : strength === "medium"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/20"
        : "bg-rose-500/15 text-rose-300 border-rose-500/20";
  return (
    <span
      className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${style}`}
    >
      {strength}
    </span>
  );
}

export default function EvidenceLedger({
  claims,
  sources,
  loading,
  error,
}: {
  claims: ResearchClaim[];
  sources: ResearchSource[];
  loading: boolean;
  error: string | null;
}) {
  const [filter, setFilter] = useState<"all" | ResearchClaim["disposition"]>(
    "all",
  );
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const visible =
    filter === "all"
      ? claims
      : claims.filter((claim) => claim.disposition === filter);

  if (loading)
    return <div className="h-32 animate-pulse rounded-xl bg-white/5" />;
  if (error)
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
        {error}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Claim-level evidence ledger
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {claims.length} claims mapped to {sources.length} sources.
            Unsupported claims remain visible.
          </p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
          aria-label="Filter claims by disposition"
          className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All claims</option>
          <option value="verified">Verified</option>
          <option value="inferred">Inferred</option>
          <option value="proposed">Proposed</option>
          <option value="disputed">Disputed</option>
        </select>
      </div>

      {visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
          <p className="text-sm text-slate-400">
            No claims have been recorded for this view.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Research synthesis should write records to the{" "}
            <code>research_claims</code> collection.
          </p>
        </div>
      )}

      {visible.map((claim) => {
        const linked = claim.sourceIds
          .map((id) => sourceById.get(id))
          .filter(Boolean) as ResearchSource[];
        const qualities = linked.map(assessSourceQuality);
        const strength: EvidenceStrength = qualities.some(
          (quality) => quality.strength === "high",
        )
          ? "high"
          : qualities.some((quality) => quality.strength === "medium")
            ? "medium"
            : "low";
        return (
          <article
            key={claim.id}
            className="rounded-xl border border-white/10 bg-white/5 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-300">
                    {claim.disposition}
                  </span>
                  <StrengthBadge strength={strength} />
                  <span className="text-[10px] text-slate-500">
                    {Math.round(claim.confidence * 100)}% confidence
                  </span>
                  {claim.contradictingSourceIds?.length ? (
                    <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      {claim.contradictingSourceIds.length} contradiction(s)
                    </span>
                  ) : null}
                </div>
                <h3 className="text-sm font-medium leading-relaxed text-white">
                  {claim.statement}
                </h3>
                {claim.rationale && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {claim.rationale}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-slate-600">
                Run {claim.runId ?? "unlinked"}
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              {linked.length === 0 && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  Unsupported claim: no resolvable source records.
                </div>
              )}
              {linked.map((source) => {
                const quality = assessSourceQuality(source);
                return (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-white/5 bg-black/20 p-3 transition-colors hover:border-blue-500/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-blue-300">
                          {source.title}
                        </p>
                        <p className="truncate text-[10px] text-slate-600">
                          {host(source.url)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] text-slate-500">
                          {quality.score}/100
                        </span>
                        <StrengthBadge strength={quality.strength} />
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
