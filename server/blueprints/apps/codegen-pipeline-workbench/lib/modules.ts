// Single source of truth for the Codegen Pipeline Workbench surfaces.
// Consumed by both the landing grid (app/page.tsx) and the persistent top nav
// (app/components/NavBar.tsx) so the two never drift. Mirrors the
// workbench_modules declared for the Autonomous Code Generation Pipeline cycle.

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
    icon: "PS",
    label: "Pipeline Session Dashboard",
    short: "Sessions",
    tagline:
      "Live view of autonomous code-generation sessions — objective, current phase, per-phase status across context-load → change-plan → apply-edits → test-loop → quality-gate → pr-generation, and one-click run creation.",
    accent: "border-blue-500/30 hover:bg-blue-500/5",
    badge: "Sessions",
    badgeColor: "bg-blue-500/10 text-blue-400",
  },
  {
    href: "/metrics",
    icon: "QM",
    label: "Quality Metrics & Reporting",
    short: "Metrics",
    tagline:
      "Aggregate success analytics for the pipeline: quality-gate pass rate, self-heal fix attempts, mutation score, verification depth, and PR throughput across recent sessions.",
    accent: "border-emerald-500/30 hover:bg-emerald-500/5",
    badge: "Reporting",
    badgeColor: "bg-emerald-500/10 text-emerald-400",
  },
];
