'use client';

import React, { useEffect, useState } from 'react';
import { Wallet, TrendingUp, ShieldCheck } from 'lucide-react';
import { AgentChat } from './components/AgentChat';
import { WorkbenchShell } from './components/WorkbenchShell';
import {
  records,
  FinanceCollections,
  fmtCurrency,
  type FinanceAccount,
} from '../lib/platform-client';

const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN_LIABILITY']);

const GREETING = `Hi — I'm your Personal Financial Advisor. I answer using your actual ledger: transactions, accounts, balance snapshots, and open recommendations. I never invent figures.

Try asking:
• "What did I spend on dining last month?"
• "What's my current net worth and runway?"
• "Which subscriptions should I cancel?"
• "Can I afford a $32,000 car at 6.9% over 60 months?"`;

interface NetWorth {
  assets: number;
  liabilities: number;
  net: number;
  currency: string;
}

export default function AdvisorContent() {
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [txnCount, setTxnCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accounts, txns] = await Promise.all([
          records.list<FinanceAccount>(FinanceCollections.financeAccounts),
          records.list(FinanceCollections.transactions),
        ]);
        if (cancelled) return;

        let assets = 0;
        let liabilities = 0;
        let currency = 'USD';
        for (const a of accounts) {
          const bal = Number(a.current_balance ?? 0);
          if (a.base_currency) currency = a.base_currency;
          if (LIABILITY_TYPES.has(String(a.account_type))) liabilities += Math.abs(bal);
          else assets += bal;
        }
        setNetWorth({ assets, liabilities, net: assets - liabilities, currency });
        setAccountCount(accounts.length);
        setTxnCount(txns.length);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isNetWorthLoading = netWorth === null && !loadError;
  const isAccountCountLoading = accountCount === null && !loadError;
  const isTxnCountLoading = txnCount === null && !loadError;

  return (
    <WorkbenchShell
      title="BudgetMaster Financial Advisor"
      tagline="Conversational guidance grounded in your real ledger — powered by Gemini"
      badge="Advisor"
    >
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Context rail */}
        <aside className="space-y-4">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-bold px-1">Your Snapshot</h2>

          <SnapshotCard
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            label="Net Worth"
            value={netWorth ? fmtCurrency(netWorth.net, netWorth.currency) : '—'}
            loading={isNetWorthLoading}
            sub={netWorth ? `${fmtCurrency(netWorth.assets, netWorth.currency)} assets − ${fmtCurrency(netWorth.liabilities, netWorth.currency)} liabilities` : undefined}
          />
          <SnapshotCard
            icon={<Wallet className="w-4 h-4 text-teal-400" />}
            label="Accounts Tracked"
            loading={isAccountCountLoading}
            value={accountCount !== null ? String(accountCount) : '—'}
          />
          <SnapshotCard
            icon={<ShieldCheck className="w-4 h-4 text-sky-400" />}
            label="Transactions on File"
            loading={isTxnCountLoading}
            value={txnCount !== null ? txnCount.toLocaleString() : '—'}
          />

          <div className="mt-6 p-4 rounded-xl bg-slate-900/40 border border-slate-800/40 text-[11px] leading-relaxed text-slate-400 backdrop-blur-sm">
            <p className="font-semibold text-slate-300 mb-1.5">Advisory only</p>
            BudgetMaster never moves money. Sweep, lock, and cancellation suggestions are routed
            to you as approvals in the Workbench — the advisor just explains the "why".
          </div>
        </aside>

        {/* Chat - Set dynamic padding and touch targets for input */}
        <section className="flex flex-col bg-slate-950/40 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm">
          <AgentChat
            agentName="Personal Financial Advisor"
            agentRole="Prudent Strategist · Gemini"
            defaultGreeting={GREETING}
          />
        </section>
      </div>
    </WorkbenchShell>
  );
}

function SnapshotCard({
  icon,
  label,
  value,
  sub,
  loading = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/40 backdrop-blur-sm hover:border-indigo-500/20 transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/[0.02]">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">{label}</span>
      </div>
      {loading ? (
        <div className="space-y-2 mt-2">
          <div className="h-6 bg-slate-800/60 rounded-lg animate-pulse w-3/4" />
          {sub && <div className="h-3 bg-slate-800/40 rounded animate-pulse w-5/6" />}
        </div>
      ) : (
        <>
          <div className="text-2xl font-bold tracking-tight tabular-nums text-slate-200">{value}</div>
          {sub && <div className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{sub}</div>}
        </>
      )}
    </div>
  );
}

