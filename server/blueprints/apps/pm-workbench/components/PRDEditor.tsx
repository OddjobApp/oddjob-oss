/**
 * PRDEditor — Confluence Markdown viewer/editor with publish-back capability.
 */
import React, { useState } from "react";
import { FileText, Save, AlertCircle, CheckCircle2, Loader2, Clock } from "lucide-react";
import type { MissionStatus } from "../lib/hooks";

interface Props {
  confluencePageId: string | null;
  prdContent: string | null;
  prdDirty: boolean;
  pageTitle: string | null;
  spaceKey: string | null;
  lastPublishedAt: string | null;
  mission2Status: MissionStatus;
  onContentChange: (content: string) => void;
  onPublish: () => Promise<void>;
  publishLoading: boolean;
}

export function PRDEditor({
  confluencePageId,
  prdContent,
  prdDirty,
  pageTitle,
  spaceKey,
  lastPublishedAt,
  mission2Status,
  onContentChange,
  onPublish,
  publishLoading,
}: Props) {
  const [publishError, setPublishError] = useState<string | null>(null);

  async function handlePublish() {
    setPublishError(null);
    try {
      await onPublish();
    } catch (e: any) {
      setPublishError(e.message ?? "Publish failed");
    }
  }

  // No PRD yet — show placeholder with mission status
  if (!confluencePageId) {
    return (
      <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
        <AlertCircle className="w-10 h-10 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300 mb-1">PRD Not Yet Generated</h3>
        <p className="text-xs text-slate-500 max-w-sm mb-4">
          The Systems Analyst agent will generate the PRD during Mission-2 (Requirements & Design Analysis).
        </p>
        {mission2Status.runId && (
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-full font-semibold ${
              mission2Status.status === "active" ? "bg-blue-500/10 text-blue-400" :
              mission2Status.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
              mission2Status.status === "failed" ? "bg-rose-500/10 text-rose-400" :
              "bg-slate-500/10 text-slate-400"
            }`}>
              {mission2Status.status}
            </span>
            <span className="text-slate-500">Step: {mission2Status.logs[mission2Status.logs.length - 1]?.message ?? "—"}</span>
          </div>
        )}
        {!mission2Status.runId && (
          <p className="text-xs text-slate-600">Mission-2 has not been started for this ticket.</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-white/3">
        <div className="flex items-center gap-3">
          <FileText className="w-4 h-4 text-blue-400" />
          <div>
            <span className="text-sm font-semibold text-slate-200">{pageTitle ?? "PRD"}</span>
            {spaceKey && <span className="ml-2 text-[10px] text-slate-500 font-mono">{spaceKey}</span>}
          </div>
          {prdDirty && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastPublishedAt && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="w-3 h-3" />
              {new Date(lastPublishedAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={handlePublish}
            disabled={!prdDirty || publishLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {publishLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Publish to Confluence
          </button>
        </div>
      </div>

      {/* Publish error */}
      {publishError && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{publishError}</span>
        </div>
      )}

      {/* Editor */}
      <textarea
        value={prdContent ?? ""}
        onChange={(e) => onContentChange(e.target.value)}
        placeholder="PRD content will appear here once generated..."
        className="w-full min-h-[400px] bg-transparent p-4 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:outline-none placeholder:text-slate-600"
        aria-label="PRD Markdown editor"
      />
    </div>
  );
}
