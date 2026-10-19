"use client";
import React, { useState } from "react";
import { Split, Columns, CheckCircle2, FileText } from "lucide-react";

interface CollateralDiffViewProps {
  originalContent: string;
  modifiedContent: string;
  assetTitle?: string;
  assetType?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  onApprove?: () => void;
  className?: string;
}

export function CollateralDiffView({
  originalContent,
  modifiedContent,
  assetTitle = "Product Launch Press Release",
  assetType = "Press Release",
  originalLabel = "AI Draft Copy",
  modifiedLabel = "Human Revisions & Polish",
  onApprove,
  className = "",
}: CollateralDiffViewProps) {
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");
  const [approved, setApproved] = useState(false);

  const origLines = originalContent.split("\n");
  const modLines = modifiedContent.split("\n");
  const maxLines = Math.max(origLines.length, modLines.length);

  const additions = modLines.filter((l, i) => l !== origLines[i]).length;
  const deletions = origLines.filter((l, i) => l !== modLines[i]).length;

  return (
    <div className={`border border-white/10 rounded-xl overflow-hidden bg-slate-950 shadow-xl flex flex-col ${className}`}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 border-b border-white/10 bg-slate-900/90">
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-bold text-white">{assetTitle}</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet-500/10 text-violet-300 border border-violet-500/20">
            {assetType}
          </span>
          <div className="flex items-center gap-1.5 text-xs font-mono ml-2">
            <span className="text-emerald-400 font-bold">+{additions}</span>
            <span className="text-rose-400 font-bold">-{deletions}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                viewMode === "split" ? "bg-violet-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Split
            </button>
            <button
              type="button"
              onClick={() => setViewMode("unified")}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                viewMode === "unified" ? "bg-violet-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              Unified
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setApproved(true);
              onApprove?.();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              approved
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {approved ? "Approved & Signed-Off" : "Sign-Off & Publish"}
          </button>
        </div>
      </div>

      {/* Main Diff Content */}
      <div className="max-h-[460px] overflow-y-auto divide-y divide-white/5 text-xs font-mono">
        {viewMode === "split" ? (
          <div>
            <div className="grid grid-cols-2 border-b border-white/10 bg-slate-900/60 text-[10px] uppercase font-bold text-slate-400 px-4 py-1.5">
              <div>{originalLabel}</div>
              <div className="border-l border-white/10 pl-4">{modifiedLabel}</div>
            </div>
            {Array.from({ length: maxLines }).map((_, idx) => {
              const orig = origLines[idx] ?? "";
              const mod = modLines[idx] ?? "";
              const isDifferent = orig !== mod;

              return (
                <div key={idx} className="grid grid-cols-2 select-all hover:bg-white/[0.02] transition-colors">
                  <div className={`p-2 leading-relaxed truncate ${isDifferent && orig ? "bg-rose-950/30 text-rose-400" : "text-slate-400"}`}>
                    <span className="inline-block w-6 text-right mr-3 select-none text-slate-600 text-[10px]">{orig ? idx + 1 : ""}</span>
                    {orig || " "}
                  </div>
                  <div className={`p-2 border-l border-white/10 leading-relaxed truncate ${isDifferent && mod ? "bg-emerald-950/30 text-emerald-300" : "text-slate-300"}`}>
                    <span className="inline-block w-6 text-right mr-3 select-none text-slate-600 text-[10px]">{mod ? idx + 1 : ""}</span>
                    {mod || " "}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {origLines.map((line, idx) => (
              <div key={`orig-${idx}`} className="p-2 bg-rose-950/20 text-rose-400 flex items-center">
                <span className="w-8 text-right mr-3 select-none text-slate-600 font-mono text-[10px]">- {idx + 1}</span>
                <span className="truncate">{line}</span>
              </div>
            ))}
            {modLines.map((line, idx) => (
              <div key={`mod-${idx}`} className="p-2 bg-emerald-950/20 text-emerald-300 flex items-center">
                <span className="w-8 text-right mr-3 select-none text-slate-600 font-mono text-[10px]">+ {idx + 1}</span>
                <span className="truncate">{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CollateralDiffView;
