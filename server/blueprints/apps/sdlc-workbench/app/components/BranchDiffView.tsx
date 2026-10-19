"use client";
import React, { useState } from "react";
import { GitBranch, GitCommit, FileCode, Split, Columns, CheckCircle2, ChevronRight, MessageSquare, AlertCircle } from "lucide-react";

export interface DiffFile {
  filename: string;
  originalContent: string;
  modifiedContent: string;
  additions: number;
  deletions: number;
}

interface BranchDiffViewProps {
  baseBranch?: string;
  compareBranch?: string;
  availableBranches?: string[];
  files?: DiffFile[];
  onApprove?: () => void;
  onReject?: () => void;
  className?: string;
}

export function BranchDiffView({
  baseBranch = "",
  compareBranch = "",
  availableBranches = [],
  files = [],
  onApprove,
  onReject,
  className = "",
}: BranchDiffViewProps) {
  const [selectedBase, setSelectedBase] = useState(baseBranch);
  const [selectedCompare, setSelectedCompare] = useState(compareBranch);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");
  const [approvedState, setApprovedState] = useState<boolean>(false);

  if (!files.length) return <div role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">No repository diff has been loaded. Bind a repository and revision before reviewing changes.</div>;

  const currentFile = files[activeFileIndex] || files[0];
  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  const origLines = (currentFile?.originalContent || "").split("\n");
  const modLines = (currentFile?.modifiedContent || "").split("\n");
  const maxLines = Math.max(origLines.length, modLines.length);

  return (
    <div className={`border border-white/10 rounded-xl overflow-hidden bg-slate-950/90 shadow-xl flex flex-col ${className}`}>
      {/* Branch Header & Comparison Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-white/10 bg-slate-900/90">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono">
            <GitBranch className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">base:</span>
            <select
              value={selectedBase}
              onChange={(e) => setSelectedBase(e.target.value)}
              className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
            >
              {availableBranches.map((b) => (
                <option key={b} value={b} className="bg-slate-900 text-white">
                  {b}
                </option>
              ))}
            </select>
          </div>

          <span className="text-slate-500 font-mono text-xs">←</span>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-mono">
            <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400">compare:</span>
            <select
              value={selectedCompare}
              onChange={(e) => setSelectedCompare(e.target.value)}
              className="bg-transparent text-cyan-200 font-bold focus:outline-none cursor-pointer"
            >
              {availableBranches.map((b) => (
                <option key={b} value={b} className="bg-slate-900 text-white">
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
              +{totalAdditions}
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
              -{totalDeletions}
            </span>
            <span className="text-slate-400">({files.length} changed files)</span>
          </div>
        </div>

        {/* View Mode & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                viewMode === "split" ? "bg-cyan-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Split
            </button>
            <button
              type="button"
              onClick={() => setViewMode("unified")}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                viewMode === "unified" ? "bg-cyan-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              Unified
            </button>
          </div>

          <button
            type="button"
            disabled={!onApprove}
            onClick={() => {
              setApprovedState(true);
              onApprove?.();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              approvedState
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {approvedState ? "Review requested" : "Request review"}
          </button>
        </div>
      </div>

      {/* Main Diff Body: File Navigator + Code Area */}
      <div className="grid grid-cols-1 md:grid-cols-12 min-h-[380px]">
        {/* File Tree Sidebar */}
        <div className="md:col-span-4 border-r border-white/10 bg-slate-900/40 p-3 flex flex-col gap-1.5 overflow-y-auto max-h-[500px]">
          <span className="text-[10px] uppercase font-mono text-slate-500 font-bold px-2 py-1">Changed Files</span>
          {files.map((file, idx) => {
            const isSelected = idx === activeFileIndex;
            return (
              <button
                key={file.filename}
                type="button"
                onClick={() => setActiveFileIndex(idx)}
                className={`flex items-center justify-between p-2 rounded-lg text-xs font-mono text-left transition-all ${
                  isSelected
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{file.filename}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-[10px]">
                  <span className="text-emerald-400 font-bold">+{file.additions}</span>
                  <span className="text-rose-400 font-bold">-{file.deletions}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Code Diff Display */}
        <div className="md:col-span-8 flex flex-col bg-slate-950 overflow-hidden">
          {/* File Tab Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10 text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-300 font-bold">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              <span>{currentFile.filename}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Comparing <span className="text-slate-300">{selectedBase}</span> ... <span className="text-cyan-300">{selectedCompare}</span>
            </div>
          </div>

          {/* Diff Grid */}
          <div className="flex-1 overflow-y-auto max-h-[460px] divide-y divide-white/5 text-xs font-mono">
            {viewMode === "split" ? (
              <div className="flex flex-col">
                <div className="grid grid-cols-2 border-b border-white/10 bg-slate-900/60 text-[10px] uppercase font-bold text-slate-400 px-3 py-1.5 font-mono">
                  <div>{selectedBase}</div>
                  <div className="border-l border-white/10 pl-3">{selectedCompare}</div>
                </div>
                {Array.from({ length: maxLines }).map((_, idx) => {
                  const orig = origLines[idx] ?? "";
                  const mod = modLines[idx] ?? "";
                  const isDifferent = orig !== mod;

                  return (
                    <div key={idx} className="grid grid-cols-2 select-all hover:bg-white/[0.02] transition-colors">
                      <div className={`p-1.5 leading-relaxed truncate ${isDifferent && orig ? "bg-rose-950/30 text-rose-400" : "text-slate-400"}`}>
                        <span className="inline-block w-6 text-right mr-2.5 select-none text-slate-600 font-mono text-[10px]">{orig ? idx + 1 : ""}</span>
                        {orig || " "}
                      </div>
                      <div className={`p-1.5 border-l border-white/10 leading-relaxed truncate ${isDifferent && mod ? "bg-emerald-950/30 text-emerald-300" : "text-slate-300"}`}>
                        <span className="inline-block w-6 text-right mr-2.5 select-none text-slate-600 font-mono text-[10px]">{mod ? idx + 1 : ""}</span>
                        {mod || " "}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col">
                {origLines.map((line, idx) => (
                  <div key={`orig-${idx}`} className="flex items-center p-1.5 leading-relaxed bg-rose-950/20 text-rose-400">
                    <span className="w-8 text-right mr-3 select-none text-slate-600 font-mono text-[10px]">- {idx + 1}</span>
                    <span className="truncate">{line}</span>
                  </div>
                ))}
                {modLines.map((line, idx) => (
                  <div key={`mod-${idx}`} className="flex items-center p-1.5 leading-relaxed bg-emerald-950/20 text-emerald-300">
                    <span className="w-8 text-right mr-3 select-none text-slate-600 font-mono text-[10px]">+ {idx + 1}</span>
                    <span className="truncate">{line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BranchDiffView;
