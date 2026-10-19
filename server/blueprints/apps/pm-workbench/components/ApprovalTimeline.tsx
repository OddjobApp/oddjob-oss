/**
 * ApprovalTimeline — chronological list of sign-off decisions with Confluence packet links.
 */
import React from "react";
import { CheckCircle2, XCircle, ExternalLink, Clock } from "lucide-react";
import { buildConfluencePageUrl } from "../lib/confluence-utils";
import type { SignoffRecord } from "../lib/collections";

interface Props {
  signoffs: SignoffRecord[];
  confluenceBaseUrl: string;
}

export function ApprovalTimeline({ signoffs, confluenceBaseUrl }: Props) {
  if (signoffs.length === 0) {
    return (
      <div className="px-4 py-3 rounded-lg bg-white/3 border border-white/5 text-xs text-slate-500">
        No approval history for this ticket.
      </div>
    );
  }

  const sorted = [...signoffs].sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Approval History</h4>
      <div className="space-y-3">
        {sorted.map((s, i) => {
          const approved = s.prdStatus === "Approved" && s.uxMockupStatus === "Approved";
          return (
            <div key={s.id ?? i} className="flex items-start gap-3">
              {approved ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${approved ? "text-emerald-400" : "text-amber-400"}`}>
                    {approved ? "Approved" : "Changes Requested"}
                  </span>
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(s.submittedAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {s.reviewedStoryPoints} SP · PRD: {s.prdStatus} · UX: {s.uxMockupStatus}
                </div>
                {s.approvalPacketPageId && (
                  <a
                    href={buildConfluencePageUrl(confluenceBaseUrl, s.approvalPacketPageId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-400 hover:underline"
                  >
                    View Approval Packet <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
