/**
 * KnowledgeContextPanel — auto-queries Knowledge Graph when a source page is loaded.
 */
import React, { useState, useEffect } from "react";
import { Brain, Loader2, AlertCircle } from "lucide-react";
import { knowledge, platformDatasets } from "../lib/platform-client";

interface Props {
  sourcePageTitle: string | null;
  ticketSummary: string | null;
  visible: boolean;
}

interface ContextItem {
  type: string;
  title: string;
  excerpt: string;
  relevance: number;
}

export function KnowledgeContextPanel({ sourcePageTitle, ticketSummary, visible }: Props) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || (!sourcePageTitle && !ticketSummary)) return;
    const query = sourcePageTitle ?? ticketSummary ?? "";
    if (query.length < 3) return;

    setLoading(true);
    setError(null);

    Promise.all([
      knowledge.query(query, 5).catch(() => ({ nodes: [] })),
      platformDatasets.query(1, { keyword: query }, 5).catch(() => []),
    ]).then(([kgResult, dsResult]) => {
      const combined: ContextItem[] = [];

      for (const node of (kgResult.nodes ?? []).slice(0, 3)) {
        combined.push({
          type: "Knowledge",
          title: node.title ?? node.name ?? "Related item",
          excerpt: node.content?.slice(0, 150) ?? node.description ?? "",
          relevance: node.score ?? 0.7,
        });
      }

      const dsItems = Array.isArray(dsResult) ? dsResult : dsResult?.items ?? [];
      for (const item of dsItems.slice(0, 3)) {
        combined.push({
          type: "Historical",
          title: item.summary ?? item.title ?? "Past issue",
          excerpt: item.resolution ?? item.description ?? "",
          relevance: item.score ?? 0.5,
        });
      }

      setItems(combined);
    }).catch((e) => {
      setError(e.message);
    }).finally(() => {
      setLoading(false);
    });
  }, [sourcePageTitle, ticketSummary, visible]);

  if (!visible) return null;

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-purple-400" /> Related Context
      </h4>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Querying knowledge graph...
        </div>
      )}

      {error && (
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> Unable to load context
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="text-xs text-slate-500">No related context found.</p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-white/3 border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  item.type === "Knowledge" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                }`}>{item.type}</span>
                <span className="text-xs text-white font-medium truncate flex-1">{item.title}</span>
                <span className="text-[9px] text-slate-500">{Math.round(item.relevance * 100)}%</span>
              </div>
              <p className="text-[10px] text-slate-400 line-clamp-2">{item.excerpt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
