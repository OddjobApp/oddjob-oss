/**
 * StandupReportGenerator — compiles daily summary and publishes to Confluence.
 */
import React, { useState } from "react";
import { FileText, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { confluence, records, telemetry } from "../lib/platform-client";
import { buildStandupReportHtml } from "../lib/jira-sprint-utils";
import { COLLECTIONS } from "../lib/collections";
import type { BacklogRecord, BlockerRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  committedRecords: BacklogRecord[];
  blockers: BlockerRecord[];
  totalCommittedPoints: number;
  agentRecommendations?: string;
  confluenceSpace?: string;
}

export function StandupReportGenerator({
  sprintNumber, committedRecords, blockers, totalCommittedPoints, agentRecommendations, confluenceSpace,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ pageId: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const today = new Date().toISOString().split("T")[0];

      // Compute report data from current state
      const ticketsCompleted = committedRecords
        .filter((r) => r.mission3RunId)
        .map((r) => `${r.jiraKey}: ${r.summary}`);
      const ticketsInProgress = committedRecords
        .filter((r) => !r.mission3RunId)
        .map((r) => `${r.jiraKey}: ${r.summary}`);
      const openBlockers = blockers
        .filter((b) => !b.resolvedAt && b.sprintNumber === sprintNumber)
        .map((b) => ({ jiraKey: b.jiraKey, description: b.description, severity: b.severity }));
      const completedPoints = committedRecords
        .filter((r) => r.mission3RunId)
        .reduce((s, r) => s + r.storyPoints, 0);

      const html = buildStandupReportHtml({
        sprintNumber,
        date: today,
        ticketsCompleted,
        ticketsInProgress,
        openBlockers,
        velocityBurn: {
          committed: totalCommittedPoints,
          completed: completedPoints,
          remaining: totalCommittedPoints - completedPoints,
        },
        agentRecommendations,
      });

      // Publish to Confluence
      const publishResult = await confluence.publish({
        title: `Standup Report: Sprint ${sprintNumber} — ${today}`,
        content: html,
        space: confluenceSpace,
      });

      if (!publishResult.success) throw new Error(publishResult.error ?? "Publish failed");

      // Store record
      const reportId = crypto.randomUUID();
      await records.create(COLLECTIONS.STANDUP_REPORTS, {
        reportId,
        sprintNumber,
        date: today,
        confluencePageId: publishResult.pageId,
        confluenceUrl: publishResult.url,
        content: html.slice(0, 500),
        publishedAt: new Date().toISOString(),
      });

      setResult({ pageId: publishResult.pageId ?? "", url: publishResult.url });

      telemetry.emit("standup_report_published", "info", {
        sprintNumber, confluencePageId: publishResult.pageId,
      });
    } catch (e: any) {
      setError(e.message ?? "Failed to generate standup report");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Standup published</span>
          {result.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
              View <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
          <button onClick={handleGenerate} className="underline ml-1">Retry</button>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Generate Standup Report
        </button>
      )}
    </div>
  );
}
