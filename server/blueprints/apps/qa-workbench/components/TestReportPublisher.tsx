/**
 * TestReportPublisher — compile and publish a full QA test report to Confluence.
 */
import React, { useState } from "react";
import { FileText, Loader2, CheckCircle2, ExternalLink, AlertCircle } from "lucide-react";
import { confluence, records, telemetry } from "../lib/platform-client";
import { buildTestReportHtml } from "../lib/report-builder";
import { COLLECTIONS } from "../lib/collections";
import type { TestSuiteRecord, DefectRecord, FixtureRecord, QualityGateRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  suites: TestSuiteRecord[];
  defects: DefectRecord[];
  fixtures: FixtureRecord[];
  latestGate: QualityGateRecord | null;
  confluenceSpace?: string;
}

export function TestReportPublisher({ sprintNumber, suites, defects, fixtures, latestGate, confluenceSpace }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ pageId: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const date = new Date().toISOString().split("T")[0];
      const html = buildTestReportHtml({ sprintNumber, date, suites, defects, fixtures, latestGate });

      const publishResult = await confluence.publish({
        title: `QA Test Report: Sprint ${sprintNumber} — ${date}`,
        content: html,
        space: confluenceSpace,
      });

      if (!publishResult.success) throw new Error(publishResult.error ?? "Publish failed");

      await records.create(COLLECTIONS.TEST_REPORTS, {
        reportId: crypto.randomUUID(),
        sprintNumber,
        confluencePageId: publishResult.pageId,
        confluenceUrl: publishResult.url,
        content: html.slice(0, 500),
        publishedAt: new Date().toISOString(),
      });

      setResult({ pageId: publishResult.pageId ?? "", url: publishResult.url });
      telemetry.emit("test_report_published", "info", {
        confluencePageId: publishResult.pageId,
        suiteCount: suites.length,
        defectCount: defects.length,
        gateStatus: latestGate?.overallStatus,
      });
    } catch (e: any) {
      setError(e.message ?? "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  if (result) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Report published</span>
        {result.url && (
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
            View <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <div className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}
      <button onClick={handlePublish} disabled={publishing}
        className="flex items-center gap-2 px-3 py-2 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors">
        {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        Publish Test Report to Confluence
      </button>
    </div>
  );
}
