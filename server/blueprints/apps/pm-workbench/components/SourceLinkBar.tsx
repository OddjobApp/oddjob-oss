/**
 * SourceLinkBar — displays cross-reference links to Source, PRD, and Approval Packet.
 */
import React from "react";
import { ExternalLink, FileText, CheckSquare, BookOpen } from "lucide-react";
import { buildConfluencePageUrl } from "../lib/confluence-utils";

interface Props {
  sourcePageId: string | null;
  sourceTitle: string | null;
  prdPageId: string | null;
  prdTitle: string | null;
  approvalPacketPageId: string | null;
  confluenceBaseUrl: string;
}

export function SourceLinkBar({ sourcePageId, sourceTitle, prdPageId, prdTitle, approvalPacketPageId, confluenceBaseUrl }: Props) {
  const links = [
    { id: sourcePageId, title: sourceTitle ?? "Source Document", icon: BookOpen, label: "Source" },
    { id: prdPageId, title: prdTitle ?? "Generated PRD", icon: FileText, label: "PRD" },
    { id: approvalPacketPageId, title: "Approval Packet", icon: CheckSquare, label: "Packet" },
  ].filter((l) => l.id);

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-white/3 border border-white/5 text-xs">
      <span className="text-slate-500 font-semibold uppercase tracking-wider">Related:</span>
      {links.map(({ id, title, icon: Icon, label }) => (
        <a
          key={id}
          href={buildConfluencePageUrl(confluenceBaseUrl, id!)}
          target="_blank"
          rel="noopener noreferrer"
          title={title ?? label}
          className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/5 border border-blue-500/10 text-blue-400 hover:bg-blue-500/10 transition-colors"
        >
          <Icon className="w-3 h-3" />
          <span>{label}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-50" />
        </a>
      ))}
    </div>
  );
}
