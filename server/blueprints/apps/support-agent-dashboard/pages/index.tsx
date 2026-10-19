import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { KanbanSquare, FileEdit, AlertTriangle, Bot, RefreshCw, Database } from "lucide-react";
import Layout from "../components/Layout";
import type { QueueItem } from "./api/queue";
import type { KbArticle } from "./api/kb";
import { queueService, kbService } from "../lib/platform-client";

export default function Overview() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [source, setSource] = useState<"platform" | "local" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qRes, kbRes] = await Promise.all([queueService.list(), kbService.list()]);
      setQueue(qRes.items);
      setArticles(kbRes.articles);
      setSource(qRes.source === "platform" || kbRes.source === "platform" ? "platform" : "local");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const atRisk = queue.filter((q) => q.sla !== "On Track").length;
  const awaitingApproval = queue.filter((q) => q.stage === "Awaiting Approval").length;
  const draftArticles = articles.filter((a) => a.status !== "Published").length;

  const STATS = [
    { label: "SLA At Risk / Breached", value: atRisk, icon: AlertTriangle, color: "text-amber-400" },
    { label: "Awaiting Approval", value: awaitingApproval, icon: KanbanSquare, color: "text-blue-400" },
    { label: "KB Drafts to Review", value: draftArticles, icon: Bot, color: "text-violet-400" },
  ];

  return (
    <Layout title="Support Agent Dashboard" subtitle="Manage the queue, curate the knowledge base, and handle escalations">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Database size={13} className={source === "platform" ? "text-emerald-400" : "text-amber-400"} />
            <span>
              Storage:{" "}
              <strong className="text-white/80">
                {source === "platform"
                  ? "Organization AppRecords + IT Portal Cross-Read"
                  : source === "local"
                    ? "Standalone Fallback Store"
                    : "Connecting…"}
              </strong>
            </span>
          </div>
          <button
            onClick={loadAll}
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
          <Link href="/queue" className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors">
            <KanbanSquare size={16} /> Open Queue Manager ({queue.length})
          </Link>
          <Link href="/kb-editor" className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold transition-colors">
            <FileEdit size={16} /> Review KB Drafts ({draftArticles})
          </Link>
          <Link href="/escalations" className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 rounded-xl text-sm font-semibold transition-colors">
            <AlertTriangle size={16} /> Sentiment & Escalation Predictor
          </Link>
        </div>
      </motion.div>
    </Layout>
  );
}
