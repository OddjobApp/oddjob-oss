import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import Layout from "../components/Layout";
import type { QueueItem, QueueStage } from "./api/queue";
import { queueService } from "../lib/platform-client";

const STAGES: QueueStage[] = ["Triage", "In Progress", "Awaiting Approval"];

const SLA_STYLES: Record<string, string> = {
  "On Track": "text-emerald-300",
  "At Risk": "text-amber-300",
  "Breached": "text-rose-300",
};

function confidenceColor(c: number): string {
  if (c >= 0.85) return "bg-emerald-400";
  if (c >= 0.65) return "bg-amber-400";
  return "bg-rose-400";
}

export default function Queue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queueService.list();
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  async function moveStage(item: QueueItem, nextStage: QueueStage) {
    setUpdatingId(item.id);
    setError(null);
    try {
      const updated = await queueService.updateItem(item, { stage: nextStage });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move ticket stage");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Layout title="Queue Manager" subtitle="Tickets by stage, with AI confidence, SLA status, and persisted stage transitions">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/50">
            Move tickets across stages to update the organization queue.
          </p>
          <button
            onClick={loadQueue}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh Queue
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {STAGES.map((stage, stageIdx) => {
            const col = items.filter((i) => i.stage === stage);
            const prevStage = stageIdx > 0 ? STAGES[stageIdx - 1] : null;
            const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

            return (
              <div key={stage} className="bg-white/[0.03] border border-white/10 rounded-2xl p-3 flex flex-col">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-white/60">{stage}</h2>
                  <span className="text-xs font-semibold text-white/30 tabular-nums">{loading ? "—" : col.length}</span>
                </div>
                <div className="space-y-2">
                  {loading ? (
                    <div className="h-24 animate-pulse bg-white/5 rounded-xl" />
                  ) : col.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-white/25">Nothing here.</p>
                  ) : (
                    col.map((item) => (
                      <div key={item.recordId || item.id} className="bg-white/5 border border-white/10 hover:border-white/20 rounded-xl p-3 transition-colors space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] text-white/40">{item.id}</span>
                          <span className={`text-[11px] font-semibold ${SLA_STYLES[item.sla]}`}>{item.sla}</span>
                        </div>
                        <p className="text-sm font-medium leading-snug">{item.subject}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-white/40">{item.assignee}</span>
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50" title="AI confidence">
                            <span className={`w-2 h-2 rounded-full ${confidenceColor(item.aiConfidence)}`} />
                            {Math.round(item.aiConfidence * 100)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/5 gap-2">
                          {prevStage ? (
                            <button
                              onClick={() => moveStage(item, prevStage)}
                              disabled={updatingId === item.id}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-white/60 disabled:opacity-40"
                            >
                              <ArrowLeft size={11} /> {prevStage}
                            </button>
                          ) : <span />}
                          {nextStage && (
                            <button
                              onClick={() => moveStage(item, nextStage)}
                              disabled={updatingId === item.id}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-[11px] text-blue-300 disabled:opacity-40 ml-auto"
                            >
                              {nextStage} <ArrowRight size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </Layout>
  );
}
