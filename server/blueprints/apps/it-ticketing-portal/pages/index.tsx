import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Inbox, PlusCircle, AlertTriangle, CheckCircle2, RefreshCw, Bot, Database } from "lucide-react";
import Layout from "../components/Layout";
import type { Ticket } from "./api/tickets";
import { ticketService } from "../lib/platform-client";

export default function Overview() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [source, setSource] = useState<"platform" | "local" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ticketService.list();
      setTickets(result.tickets);
      setSource(result.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const open = tickets.filter((t) => t.status !== "Resolved").length;
  const highPriority = tickets.filter((t) => t.priority === "High" && t.status !== "Resolved").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;

  const STATS = [
    { label: "Open Tickets", value: open, icon: Inbox, color: "text-emerald-400" },
    { label: "High Priority", value: highPriority, icon: AlertTriangle, color: "text-amber-400" },
    { label: "Resolved", value: resolved, icon: CheckCircle2, color: "text-sky-400" },
  ];

  return (
    <Layout title="IT Ticketing Portal" subtitle="Submit and track your IT support requests">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Database size={13} className={source === "platform" ? "text-emerald-400" : "text-amber-400"} />
            <span>
              Storage:{" "}
              <strong className="text-white/80">
                {source === "platform"
                  ? "Organization AppRecords (it_service_desk_tickets)"
                  : source === "local"
                    ? "Standalone Fallback Store"
                    : "Connecting…"}
              </strong>
            </span>
          </div>
          <button
            onClick={loadTickets}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error && (
          <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATS.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="p-2 rounded-xl bg-white/5 border border-white/10 w-fit mb-3">
                <Icon size={16} className={color} />
              </div>
              <p className="text-xs font-medium uppercase tracking-widest text-white/40 mb-1">{label}</p>
              {loading ? (
                <div className="h-7 w-10 animate-pulse bg-white/10 rounded" />
              ) : (
                <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/submit" className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-semibold transition-colors">
            <PlusCircle size={16} /> Submit a Ticket
          </Link>
          <Link href="/tickets" className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold transition-colors">
            <Inbox size={16} /> View My Tickets ({tickets.length})
          </Link>
          <Link href="/agent-triage" className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-xl text-sm font-semibold transition-colors">
            <Bot size={16} /> Agentic Triage Dashboard
          </Link>
        </div>
      </motion.div>
    </Layout>
  );
}
