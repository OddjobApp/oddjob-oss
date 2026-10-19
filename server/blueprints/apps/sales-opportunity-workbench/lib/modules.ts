// Single source of truth for the Sales Opportunity Workbench surfaces.
// Consumed by both the landing grid (app/page.tsx) and the persistent top nav
// (app/components/NavBar.tsx) so the two never drift. Routes mirror the
// workbench_modules declared in sales-opportunity-pipeline.cycle.yaml.

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
    href: "/pipeline",
    icon: "PB",
    label: "Pipeline Board",
    short: "Pipeline",
    tagline:
      "Kanban of opportunities by stage. Each card shows a live win-probability ceiling badge and a shrinking window bar; advancing a stage re-baselines the window.",
    accent: "border-blue-500/30 hover:bg-blue-500/5",
    badge: "Board",
    badgeColor: "bg-blue-500/10 text-blue-400",
  },
  {
    href: "/opportunities",
    icon: "OR",
    label: "Opportunity Register",
    short: "Opportunities",
    tagline:
      "Tabular deal register with natural-language search, the engagement feed per deal, the decay-curve history, and the lead-intake to qualification handoff.",
    accent: "border-sky-500/30 hover:bg-sky-500/5",
    badge: "Register",
    badgeColor: "bg-sky-500/10 text-sky-400",
  },
  {
    href: "/forecast",
    icon: "FC",
    label: "Forecast & Calibration",
    short: "Forecast",
    tagline:
      "Weighted pipeline from live window ceilings, committed/best-case rollups, quota attainment, and the gate-calibration chart (stated vs realized win-rate).",
    accent: "border-indigo-500/30 hover:bg-indigo-500/5",
    badge: "Forecast",
    badgeColor: "bg-indigo-500/10 text-indigo-400",
  },
  {
    href: "/alerts",
    icon: "DR",
    label: "Deal Risk Center",
    short: "Risk",
    tagline:
      "Slip-risk, stalled, and aging flags from the deal-risk scan, plus pending Deal Window Decision gates. Advisory nudges only; the app never auto-moves a deal.",
    accent: "border-amber-500/30 hover:bg-amber-500/5",
    badge: "HIL",
    badgeColor: "bg-amber-500/10 text-amber-400",
  },
  {
    href: "/advisor",
    icon: "AI",
    label: "AI Sales Advisor",
    short: "Advisor",
    tagline:
      "Conversational AI guidance grounded in your real pipeline data. Ask about weighted pipeline, deal risks, forecasts, and get strategic recommendations.",
    accent: "border-purple-500/30 hover:bg-purple-500/5",
    badge: "AI",
    badgeColor: "bg-purple-500/10 text-purple-400",
  },
  {
    href: "/deal-coach",
    icon: "🎯",
    label: "Autonomous Deal Coach",
    short: "Deal Coach",
    tagline:
      "Analyzes recent email threads and meeting transcripts, extracts key objections, and drafts tailored negotiation emails to close the deal.",
    accent: "border-emerald-500/30 hover:bg-emerald-500/5",
    badge: "Agentic AI",
    badgeColor: "bg-emerald-500/10 text-emerald-400",
  },
];
