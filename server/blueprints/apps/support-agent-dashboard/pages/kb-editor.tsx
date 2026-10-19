import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bot, Check, ExternalLink, Save } from "lucide-react";
import Layout from "../components/Layout";
import type { KbArticle, KbStatus } from "./api/kb";
import { kbService } from "../lib/platform-client";

const STATUS_STYLES: Record<KbStatus, string> = {
  "Draft": "bg-white/10 text-white/60 border-white/15",
  "In Review": "bg-amber-500/10 text-amber-300 border-amber-500/20",
  "Published": "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
};

export default function KbEditor() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<"Draft" | "In Review" | "Published" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { articles: list } = await kbService.list();
      setArticles(list);
      if (list.length > 0) {
        setSelectedId((prev) => {
          const match = prev ? list.find((a) => a.id === prev) : null;
          const target = match ?? list[0];
          setDraft(target.body);
          return target.id;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KB articles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const selected = articles.find((a) => a.id === selectedId) ?? null;

  function select(a: KbArticle) {
    setSelectedId(a.id);
    setDraft(a.body);
    setNotice(null);
    setError(null);
  }

  async function saveArticleStatus(status: KbStatus) {
    if (!selected) return;
    setSavingAction(status);
    setNotice(null);
    setError(null);
    try {
      const updated = await kbService.save(selected, { body: draft, status });
      setArticles((prev) => prev.map((a) => (a.id === selected.id ? updated : a)));
      setNotice(`Saved article "${updated.title}" as ${updated.status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save article");
    } finally {
      setSavingAction(null);
    }
  }

  async function publishToConfluence() {
    if (!selected) return;
    setSavingAction("Published");
    setNotice(null);
    setError(null);
    try {
      const { article: published, confluenceUrl } = await kbService.publishToConfluence(selected, draft);
      setArticles((prev) => prev.map((a) => (a.id === selected.id ? published : a)));
      setNotice(
        confluenceUrl
          ? `Published "${published.title}" to Confluence (${confluenceUrl}).`
          : `Published "${published.title}" to Confluence and updated KB status.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Confluence publish failed: ${err.message}. Article remains ${selected.status}.`
          : "Confluence publish failed."
      );
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <Layout title="KB Editor" subtitle="Review AI-drafted articles, persist edits, and publish to Confluence">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Article list */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-2 space-y-1 h-fit">
          {loading ? (
            <div className="h-24 animate-pulse bg-white/5 rounded-xl" />
          ) : (
            articles.map((a) => (
              <button
                key={a.recordId || a.id}
                onClick={() => select(a)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  a.id === selectedId ? "bg-blue-600/15 border border-blue-500/20" : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[11px] text-white/40">{a.id}</span>
                  {a.aiDrafted && <Bot size={12} className="text-violet-400" />}
                </div>
                <p className="text-sm font-medium leading-snug mb-1.5">{a.title}</p>
                <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${STATUS_STYLES[a.status]}`}>{a.status}</span>
              </button>
            ))
          )}
        </div>

        {/* Editor */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div>
                  <h2 className="text-base font-bold">{selected.title}</h2>
                  {selected.confluenceUrl && (
                    <a
                      href={selected.confluenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline mt-0.5"
                    >
                      View in Confluence <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_STYLES[selected.status]}`}>{selected.status}</span>
              </div>

              {notice && (
                <div className="mb-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                  {notice}
                </div>
              )}
              {error && (
                <div role="alert" className="mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  {error}
                </div>
              )}

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={16}
                className="w-full flex-1 bg-black/30 border border-white/10 focus:border-blue-500/40 rounded-xl px-4 py-3 text-sm font-mono leading-relaxed outline-none transition-colors resize-none"
              />
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={() => saveArticleStatus(selected.status)}
                  disabled={savingAction !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Save size={14} /> {savingAction === selected.status ? "Saving…" : "Save Draft"}
                </button>
                <button
                  onClick={() => saveArticleStatus("In Review")}
                  disabled={savingAction !== null}
                  className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                >
                  {savingAction === "In Review" ? "Saving…" : "Mark In Review"}
                </button>
                <button
                  onClick={publishToConfluence}
                  disabled={savingAction !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Check size={15} /> {savingAction === "Published" ? "Publishing…" : "Publish to Confluence"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-white/30 m-auto">Select an article to review.</p>
          )}
        </div>
      </motion.div>
    </Layout>
  );
}
