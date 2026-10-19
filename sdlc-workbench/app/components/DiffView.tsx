"use client";
import React, { useState } from "react";
import { Columns, Split } from "lucide-react";

interface Props {
  original: string;
  modified: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

export function DiffView({
  original,
  modified,
  originalLabel = "Agent Proposal",
  modifiedLabel = "Human Revisions",
}: Props) {
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const maxLines = Math.max(origLines.length, modLines.length);

  const additions = modLines.filter((l, i) => l !== origLines[i]).length;
  const deletions = origLines.filter((l, i) => l !== modLines[i]).length;

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-slate-950 shadow-md">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold font-mono">
        <div className="flex items-center gap-3">
          <span>Diff Comparison</span>
          <span className="text-emerald-400">+{additions}</span>
          <span className="text-rose-400">-{deletions}</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-white/10">
          <button
            type="button"
            onClick={() => setViewMode("split")}
            className={`px-2 py-0.5 rounded text-[10px] ${viewMode === "split" ? "bg-cyan-600 text-white font-bold" : "text-slate-400"}`}
          >
            Split
          </button>
          <button
            type="button"
            onClick={() => setViewMode("unified")}
            className={`px-2 py-0.5 rounded text-[10px] ${viewMode === "unified" ? "bg-cyan-600 text-white font-bold" : "text-slate-400"}`}
          >
            Unified
          </button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-white/5 text-xs font-mono">
        {viewMode === "split" ? (
          <div>
            <div className="grid grid-cols-2 border-b border-white/10 bg-white/[0.02] text-[10px] uppercase text-slate-500 font-bold px-4 py-1">
              <div>{originalLabel}</div>
              <div className="border-l border-white/10 pl-4">{modifiedLabel}</div>
            </div>
            {Array.from({ length: maxLines }).map((_, idx) => {
              const orig = origLines[idx] ?? "";
              const mod = modLines[idx] ?? "";
              const isDifferent = orig !== mod;

              return (
                <div key={idx} className="grid grid-cols-2 select-all hover:bg-white/[0.02] transition-colors">
                  <div className={`p-2 leading-relaxed ${isDifferent && orig ? "bg-rose-950/30 text-rose-400 line-through" : "text-slate-400"}`}>
                    <span className="inline-block w-6 text-right mr-3 select-none text-slate-600">{idx + 1}</span>
                    {orig || " "}
                  </div>
                  <div className={`p-2 border-l border-white/10 leading-relaxed ${isDifferent && mod ? "bg-emerald-950/30 text-emerald-400" : "text-slate-300"}`}>
                    <span className="inline-block w-6 text-right mr-3 select-none text-slate-600">{idx + 1}</span>
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
                <span className="w-6 text-right mr-3 select-none text-slate-600">- {idx + 1}</span>
                <span>{line}</span>
              </div>
            ))}
            {modLines.map((line, idx) => (
              <div key={`mod-${idx}`} className="p-2 bg-emerald-950/20 text-emerald-300 flex items-center">
                <span className="w-6 text-right mr-3 select-none text-slate-600">+ {idx + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DiffView;
