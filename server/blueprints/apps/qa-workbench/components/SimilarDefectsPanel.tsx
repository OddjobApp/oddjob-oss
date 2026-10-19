/**
 * SimilarDefectsPanel — queries Knowledge Graph for similar historical defects.
 */
import React, { useState, useEffect } from "react";
import { Brain, Loader2, CheckCircle2 } from "lucide-react";
import { knowledge, platformDatasets, telemetry } from "../lib/platform-client";

interface Props {
  defectTitle: string | null;
  defectDescription: string | null;
  defectId: string | null;
  visible: boolean;
}

interface SimilarDefect {
  title: string;
  severity: string;
  resolution: string;
  relevance: number;
}

export function SimilarDefectsPanel({ defectTitle, defectDescription, defectId, visible }: Props) {
  const [results, setResults] = useState<SimilarDefect[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !defectTitle) return;
    setLoading(true);
    const query = `${defectTitle} ${(defectDescription ?? "").slice(0, 100)}`;

    Promise.all([
      knowledge.query(query, 5).catch(() => ({ nodes: [] })),
      platformDatasets.query(1, { keyword: defectTitle }, 5).catch(() => []),
    ]).then(([kgResult, dsResult]) => {
      const combined: SimilarDefect[] = [];
      for (const node of (kgResult.nodes ?? []).slice(0, 3)) {
        combined.push({
          title: node.title ?? node.summary ?? "Similar defect",
          severity: node.severity ?? "Unknown",
          resolution: node.resolution ?? "No resolution recorded",
          relevance: node.score ?? 0.7,
        });
      }
      const dsItems = Array.isArray(dsResult) ? dsResult : dsResult?.items ?? [];
      for (const item of dsItems.slice(0, 2)) {
        combined.push({
          title: item.summary ?? item.title ?? "Historical issue",
          severity: item.severity ?? "Unknown",
          resolution: item.resolution ?? "Resolved",
          relevance: item.score ?? 0.5,
        });
      }
      setResults(combined);
      if (defectId) telemetry.emit("similar_defects_queried", "info", { defectId, resultCount: combined.length });
    }).finally(() => setLoading(false));
  }, [defectTitle, defectDescription, defectId, visible]);

  if (!visible) return null;

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-4">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-purple-400" /> Similar Defects
      </h4>
      {loading && <div className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Searching...</div>}
      {!loading && results.length === 0 && <p className="text-xs text-slate-500">No similar defects found — this may be a new issue pattern.</p>}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-white/3 border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-white font-medium truncate flex-1">{r.title}</span>
                <span className="text-[9px] text-slate-500">{Math.round(r.relevance * 100)}%</span>
              </div>
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500">Resolution:</span> {r.resolution}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
