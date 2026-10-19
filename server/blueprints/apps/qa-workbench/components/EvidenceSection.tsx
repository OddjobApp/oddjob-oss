/**
 * EvidenceSection — displays all Investigation_Records linked to a defect.
 */
import React, { useState, useEffect } from "react";
import { FileSearch, ChevronDown, ChevronRight, Play, Globe, Database, FileText, Monitor } from "lucide-react";
import { records } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";
import type { InvestigationRecord } from "../lib/collections";

interface Props {
  defectId: string;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  playwright_test: Play,
  browser_autopilot: Globe,
  sql_query: Database,
  log_reader: FileText,
  console_capture: Monitor,
  verification_pipeline: FileSearch,
};

const TYPE_COLORS: Record<string, string> = {
  playwright_test: "bg-emerald-500/10 text-emerald-400",
  browser_autopilot: "bg-blue-500/10 text-blue-400",
  sql_query: "bg-purple-500/10 text-purple-400",
  log_reader: "bg-amber-500/10 text-amber-400",
  console_capture: "bg-rose-500/10 text-rose-400",
  verification_pipeline: "bg-teal-500/10 text-teal-400",
};

export function EvidenceSection({ defectId }: Props) {
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    records.list(COLLECTIONS.INVESTIGATIONS).then((rows) => {
      const typed = rows as unknown as InvestigationRecord[];
      setInvestigations(typed.filter((r) => r.defectId === defectId));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [defectId]);

  if (loading) return <div className="h-12 bg-white/5 rounded-lg animate-pulse" />;
  if (investigations.length === 0) return null;

  return (
    <div className="space-y-2">
      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
        <FileSearch className="w-3 h-3" /> Evidence ({investigations.length})
      </h5>
      {investigations.map((inv) => {
        const Icon = TYPE_ICONS[inv.type] ?? FileSearch;
        const color = TYPE_COLORS[inv.type] ?? "bg-slate-700 text-slate-400";
        const expanded = expandedId === inv.investigationId;
        return (
          <div key={inv.investigationId} className="rounded-lg border border-white/5 overflow-hidden">
            <button onClick={() => setExpandedId(expanded ? null : inv.investigationId)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/3 transition-colors text-left">
              {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${color}`}>
                <Icon className="w-3 h-3 inline mr-0.5" />{inv.type.replace(/_/g, " ")}
              </span>
              <span className="text-[10px] text-slate-500 flex-1">{new Date(inv.startedAt).toLocaleString()}</span>
              <span className={`text-[9px] font-bold ${inv.status === "completed" ? "text-emerald-400" : inv.status === "failed" ? "text-rose-400" : "text-blue-400"}`}>
                {inv.status}
              </span>
            </button>
            {expanded && (
              <div className="px-3 pb-3 border-t border-white/5">
                <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-all mt-2 max-h-40 overflow-y-auto">
                  {JSON.stringify(inv.results, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
