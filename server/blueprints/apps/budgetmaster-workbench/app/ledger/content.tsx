"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  records,
  events,
  knowledge,
  telemetry,
  FinanceCollections,
  fmtCurrency,
  type Transaction,
  type FinanceAccount,
  type TxStatus,
} from "../../lib/platform-client";

const STATUS_STYLES: Record<TxStatus, string> = {
  UNRECONCILED: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  CLEARED: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  RECONCILED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const STATUS_CYCLE: TxStatus[] = ["UNRECONCILED", "CLEARED", "RECONCILED"];

function SkeletonRow() {
  return <div className="h-12 bg-white/5 rounded-lg animate-pulse mb-2" />;
}

export default function LedgerContent() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [text, setText] = useState("");

  // Natural-language semantic search (vectorized transactions)
  const [nlQuery, setNlQuery] = useState("");
  const [nlResults, setNlResults] = useState<string[] | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        records.list(FinanceCollections.transactions),
        records.list(FinanceCollections.accounts),
      ]);
      setTxns(t as Transaction[]);
      setAccounts(a as FinanceAccount[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "mission.status_changed", "dataset.updated"].includes(ev.type)) fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const accountName = useCallback(
    (id: string) => accounts.find((a) => a.account_id === id)?.name ?? id,
    [accounts],
  );

  const visible = useMemo(() => {
    return txns
      .filter((t) => !t.parent_tx_id) // hide split children at top level
      .filter((t) => (accountFilter === "ALL" ? true : t.account_id === accountFilter))
      .filter((t) => (statusFilter === "ALL" ? true : t.current_status === statusFilter))
      .filter((t) =>
        text.trim() === ""
          ? true
          : `${t.payee_raw} ${t.payee_clean ?? ""} ${t.category_id ?? ""}`
              .toLowerCase()
              .includes(text.toLowerCase()),
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [txns, accountFilter, statusFilter, text]);

  const cycleStatus = async (tx: Transaction) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(tx.current_status) + 1) % STATUS_CYCLE.length];
    // optimistic
    setTxns((prev) => prev.map((p) => (p.fitid === tx.fitid ? { ...p, current_status: next } : p)));
    try {
      await records.update(FinanceCollections.transactions, tx.fitid, { ...tx, current_status: next });
      telemetry.emit("transaction_reconciled", "info", { fitid: tx.fitid, status: next });
    } catch {
      fetchAll(); // revert from source of truth
    }
  };

  const runSemanticSearch = async () => {
    if (!nlQuery.trim()) return;
    setNlLoading(true);
    setNlResults(null);
    try {
      const { results } = await knowledge.query(nlQuery.trim(), 8);
      setNlResults(results.map((r) => r.content));
      telemetry.emit("ledger_semantic_search", "info", { q: nlQuery.trim() });
    } catch (e: unknown) {
      setNlResults([`Search unavailable: ${e instanceof Error ? e.message : "error"}`]);
    } finally {
      setNlLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📒</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Transaction Ledger</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {txns.length} transactions · {accounts.length} accounts · click status to reconcile.
              </p>
            </div>
          </div>
        </div>

        {/* Natural-language search */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">🔎 Natural-language search</h2>
          <div className="flex gap-2">
            <input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSemanticSearch(); }}
              placeholder='e.g. "coffee-ish spend last quarter"'
              className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={runSemanticSearch}
              disabled={nlLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shrink-0"
            >
              {nlLoading ? "Searching…" : "Search"}
            </button>
          </div>
          {nlResults && (
            <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
              {nlResults.map((r, i) => (
                <li key={i} className="bg-slate-950/50 border border-white/5 rounded px-3 py-1.5">{r}</li>
              ))}
              {nlResults.length === 0 && <li className="text-slate-600">No semantic matches.</li>}
            </ul>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            title="Filter by account"
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All accounts</option>
            {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="Filter by status"
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All statuses</option>
            {STATUS_CYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter payee / category…"
            className="flex-1 min-w-[180px] bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Register grid */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          {loading && [1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
          {error && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">{error}</div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <p className="text-sm">No transactions yet.</p>
              <p className="text-xs mt-1">Drop an OFX/QIF/CSV statement into a hot-folder to ingest.</p>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left font-semibold p-2 border-b border-white/10">Date</th>
                    <th className="text-left font-semibold p-2 border-b border-white/10">Payee</th>
                    <th className="text-left font-semibold p-2 border-b border-white/10">Account</th>
                    <th className="text-left font-semibold p-2 border-b border-white/10">Category</th>
                    <th className="text-right font-semibold p-2 border-b border-white/10">Amount</th>
                    <th className="text-center font-semibold p-2 border-b border-white/10">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr key={t.fitid} className="hover:bg-white/3 transition-colors">
                      <td className="p-2 text-slate-400 border-b border-white/5 whitespace-nowrap">
                        {new Date(t.timestamp).toLocaleDateString()}
                      </td>
                      <td className="p-2 border-b border-white/5">
                        <div className="font-medium text-slate-100">{t.payee_clean || t.payee_raw}</div>
                        {t.is_split && <span className="text-[10px] text-violet-400">⑂ split</span>}
                      </td>
                      <td className="p-2 text-slate-400 border-b border-white/5">{accountName(t.account_id)}</td>
                      <td className="p-2 text-slate-400 border-b border-white/5">{t.category_id ?? "—"}</td>
                      <td className={`p-2 text-right font-mono border-b border-white/5 ${t.amount < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                        {fmtCurrency(t.amount)}
                      </td>
                      <td className="p-2 text-center border-b border-white/5">
                        <button
                          onClick={() => cycleStatus(t)}
                          title="Click to advance reconcile status"
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[t.current_status]}`}
                        >
                          {t.current_status}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
