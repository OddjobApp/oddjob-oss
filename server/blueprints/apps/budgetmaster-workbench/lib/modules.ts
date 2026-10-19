// Single source of truth for BudgetMaster screens.
// Consumed by both the landing grid (app/page.tsx) and the persistent
// top nav (app/components/NavBar.tsx) so the two never drift.

export interface Module {
  href: string;
  icon: string;
  label: string;
  /** Short label for the compact nav tab strip. */
  short: string;
  tagline: string;
  /** Tailwind classes for the landing-grid card border/hover. */
  accent: string;
  badge: string;
  badgeColor: string;
}

export const MODULES: Module[] = [
  {
    href: "/ledger",
    icon: "📒",
    label: "Transaction Ledger",
    short: "Ledger",
    tagline:
      "Dual-row register with AI categorization, split-ledger, reconcile status, and natural-language search across your transactions.",
    accent: "border-emerald-500/30 hover:bg-emerald-500/5",
    badge: "Ledger",
    badgeColor: "bg-emerald-500/10 text-emerald-400",
  },
  {
    href: "/dashboard",
    icon: "📊",
    label: "Wealth Dashboard",
    short: "Dashboard",
    tagline: "Net worth, cashflow, and spend-by-category KPIs with budget-vs-actual comparison.",
    accent: "border-teal-500/30 hover:bg-teal-500/5",
    badge: "Metrics",
    badgeColor: "bg-teal-500/10 text-teal-400",
  },
  {
    href: "/forecast",
    icon: "📈",
    label: "Net Worth Forecast",
    short: "Forecast",
    tagline: "40-year nominal vs inflation-adjusted projection with a volatility band.",
    accent: "border-cyan-500/30 hover:bg-cyan-500/5",
    badge: "Forecast",
    badgeColor: "bg-cyan-500/10 text-cyan-400",
  },
  {
    href: "/sandboxes",
    icon: "🧮",
    label: "Capital Purchase Sandbox",
    short: "Sandbox",
    tagline:
      "Model a financed purchase: amortization schedule, total interest, and the opportunity cost of your down payment.",
    accent: "border-violet-500/30 hover:bg-violet-500/5",
    badge: "Sandbox",
    badgeColor: "bg-violet-500/10 text-violet-400",
  },
  {
    href: "/taxes",
    icon: "🧾",
    label: "Tax Center",
    short: "Taxes",
    tagline: "Advisory estimated-tax, sales-tax, and information-return preparation with explicit human authorization gates.",
    accent: "border-blue-500/30 hover:bg-blue-500/5",
    badge: "Advisory",
    badgeColor: "bg-blue-500/10 text-blue-400",
  },
  {
    href: "/alerts",
    icon: "🛡️",
    label: "Alerts & Recommendations",
    short: "Alerts",
    tagline:
      "Dead Man's Switch faults, idle-cash sweeps, and subscription quarantines — approve or dismiss each HIL recommendation.",
    accent: "border-amber-500/30 hover:bg-amber-500/5",
    badge: "HIL",
    badgeColor: "bg-amber-500/10 text-amber-400",
  },
  {
    href: "/accounts",
    icon: "🏦",
    label: "Accounts",
    short: "Accounts",
    tagline: "Your account tree and live balances across checking, savings, brokerage, and liabilities.",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Accounts",
    badgeColor: "bg-slate-700 text-slate-400",
  },
  {
    href: "/waste-remediation",
    icon: "♻️",
    label: "Cloud Waste Remediation",
    short: "Waste Remediation",
    tagline: "Agentic infrastructure cleanup. Identifies idle dev instances, predicts cost spikes, and generates automated teardown PRs.",
    accent: "border-rose-500/30 hover:bg-rose-500/5",
    badge: "Agentic AI",
    badgeColor: "bg-rose-500/10 text-rose-400",
  }
];
