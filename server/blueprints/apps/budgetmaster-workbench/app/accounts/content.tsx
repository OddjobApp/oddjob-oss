"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  records,
  events,
  FinanceCollections,
  fmtCurrency,
  type FinanceAccount,
  type AccountType,
} from "../../lib/platform-client";

const LIABILITY: AccountType[] = ["CREDIT_CARD", "LOAN_LIABILITY"];

const TYPE_LABEL: Record<AccountType, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  BROKERAGE: "Brokerage",
  CREDIT_CARD: "Credit Card",
  LOAN_LIABILITY: "Loan / Liability",
};

const TYPE_ICON: Record<AccountType, string> = {
  CHECKING: "💳",
  SAVINGS: "🏦",
  BROKERAGE: "📈",
  CREDIT_CARD: "💸",
  LOAN_LIABILITY: "📉",
};

function SkeletonRow() {
  return <div className="h-16 bg-white/5 rounded-lg animate-pulse mb-2" />;
}

export default function AccountsContent() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const a = await records.list(FinanceCollections.accounts);
      setAccounts(a as FinanceAccount[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "dataset.updated"].includes(ev.type)) fetchAccounts();
    });
    return unsub;
  }, [fetchAccounts]);

  const grouped = useMemo(() => {
    const map = new Map<AccountType, FinanceAccount[]>();
    for (const a of accounts) {
      const t = a.account_type as AccountType;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(a);
    }
    return map;
  }, [accounts]);

  const { assets, liabilities } = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      if (LIABILITY.includes(a.account_type)) liabilities += Math.abs(a.current_balance || 0);
      else assets += a.current_balance || 0;
    }
    return { assets, liabilities };
  }, [accounts]);

  const netWorth = assets - liabilities;

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏦</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Accounts</h1>
              <p className="text-xs text-slate-500 mt-0.5">Your account tree and live balances.</p>
            </div>
          </div>
        </div>

        {/* Net worth summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-semibold">Assets</p>
            <p className="text-xl font-bold text-emerald-300 mt-1 font-mono">{fmtCurrency(assets)}</p>
          </div>
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-rose-400/80 font-semibold">Liabilities</p>
            <p className="text-xl font-bold text-rose-300 mt-1 font-mono">{fmtCurrency(liabilities)}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Net Worth</p>
            <p className={`text-xl font-bold mt-1 font-mono ${netWorth >= 0 ? "text-white" : "text-rose-300"}`}>
              {fmtCurrency(netWorth)}
            </p>
          </div>
        </div>

        {loading && [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
        {error && (
          <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">{error}</div>
        )}
        {!loading && !error && accounts.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <p className="text-sm">No accounts yet.</p>
          </div>
        )}

        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([type, accts]) => (
            <div key={type}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {TYPE_ICON[type]} {TYPE_LABEL[type]}
              </h2>
              <div className="space-y-2">
                {accts.map((a) => {
                  const isLiab = LIABILITY.includes(a.account_type);
                  return (
                    <div
                      key={a.account_id}
                      className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{a.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{a.account_id} · {a.base_currency}</p>
                      </div>
                      <p className={`text-lg font-bold font-mono ${isLiab ? "text-rose-300" : "text-emerald-300"}`}>
                        {fmtCurrency(a.current_balance)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
