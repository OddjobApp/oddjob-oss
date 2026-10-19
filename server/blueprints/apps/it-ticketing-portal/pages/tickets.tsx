import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Search } from "lucide-react";
import Layout from "../components/Layout";
import type { Ticket, TicketStatus } from "./api/tickets";
import { ticketService } from "../lib/platform-client";

const STATUS_STYLES: Record<TicketStatus, string> = {
  "Open": "bg-amber-500/10 text-amber-300 border-amber-500/20",
  "In Progress": "bg-sky-500/10 text-sky-300 border-sky-500/20",
  "Resolved": "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
};

const NEXT_STATUS: Record<TicketStatus, TicketStatus> = {
  "Open": "In Progress",
  "In Progress": "Resolved",
  "Resolved": "Open",
};

const PRIORITY_DOT: Record<string, string> = {
  High: "bg-rose-400",
  Medium: "bg-amber-400",
  Low: "bg-white/30",
};

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | TicketStatus>("All");
  const [search, setSearch] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ticketService.list();
      setTickets(result.tickets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  async function handleAdvanceStatus(ticket: Ticket) {
    const next = NEXT_STATUS[ticket.status] ?? "In Progress";
    setUpdatingId(ticket.id);
    setError(null);
    try {
      const updated = await ticketService.updateStatus(ticket, next);
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ticket status");
    } finally {
      setUpdatingId(null);
    }
  }

  const shown = tickets.filter((t) => {
    if (filter !== "All" && t.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.requester.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <Layout title="My Tickets" subtitle="Active and recent IT support requests">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(["All", "Open", "In Progress", "Resolved"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filter === f ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/20" : "text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID, subject, requester…"
                className="bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none transition-colors w-56"
              />
            </div>
            <button
              onClick={loadTickets}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs uppercase tracking-widest border-b border-white/5">
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Requester</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-white/30">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-white/30">No tickets match this filter.</td></tr>
              ) : (
                shown.map((t) => (
                  <tr key={t.recordId || t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-white/60">{t.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.subject}</div>
                      {t.details && <div className="text-xs text-white/40 mt-0.5 line-clamp-1">{t.details}</div>}
                    </td>
                    <td className="px-4 py-3 text-white/60">{t.category}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/50">{t.requester}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_STYLES[t.status]}`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleAdvanceStatus(t)}
                        disabled={updatingId === t.id}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 disabled:opacity-50 transition-colors"
                      >
                        {updatingId === t.id ? "Saving…" : `Mark ${NEXT_STATUS[t.status]}`}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </Layout>
  );
}
