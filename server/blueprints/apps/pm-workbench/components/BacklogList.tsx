/**
 * BacklogList — Jira "Design Ready" ticket list with pagination and selection.
 */
import React, { useState } from "react";
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import type { JiraIssue } from "../lib/platform-client";

interface Props {
  tickets: JiraIssue[];
  loading: boolean;
  error: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRefresh: () => void;
}

const PAGE_SIZE = 25;

export function BacklogList({ tickets, loading, error, selectedKey, onSelect, onRefresh }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const pageTickets = tickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const priorityColor: Record<string, string> = {
    Highest: "text-rose-400",
    High: "text-rose-400",
    Medium: "text-amber-400",
    Low: "text-slate-400",
    Lowest: "text-slate-500",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-200">Design Ready</h2>
          <span className="text-xs text-slate-500 font-mono">{tickets.length}</span>
        </div>
        <button
          onClick={onRefresh}
          aria-label="Refresh backlog"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={onRefresh} className="underline shrink-0">Retry</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && tickets.length === 0 && (
        <div className="flex-1 p-3 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tickets.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <AlertCircle className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-500">No tickets in "Design Ready" status.</p>
          </div>
        </div>
      )}

      {/* Ticket list */}
      {tickets.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {pageTickets.map((ticket) => (
            <button
              key={ticket.key}
              onClick={() => onSelect(ticket.key)}
              aria-label={`Select ticket ${ticket.key}`}
              aria-pressed={selectedKey === ticket.key}
              className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors ${
                selectedKey === ticket.key
                  ? "bg-blue-500/10 border-l-2 border-l-blue-500"
                  : "hover:bg-white/5 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-bold text-blue-400">{ticket.key}</span>
                <span className={`text-[10px] font-semibold ${priorityColor[ticket.priority] ?? "text-slate-400"}`}>
                  {ticket.priority}
                </span>
              </div>
              <p className="text-sm text-white truncate">{ticket.summary}</p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                <span>{ticket.issueType}</span>
                {ticket.assignee && <span>{ticket.assignee}</span>}
                <span>{new Date(ticket.updated).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 text-xs text-slate-400">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
            className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span>{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            aria-label="Next page"
            className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
