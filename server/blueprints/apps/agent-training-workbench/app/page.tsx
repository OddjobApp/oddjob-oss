import Link from 'next/link';
import { WorkbenchShell } from './components/WorkbenchShell';

const PORTALS = [
  {
    href: "/eval-dashboard",
    icon: "🎯",
    label: "Eval Dashboard",
    tagline: "Run evaluations and track agent performance metrics",
    accent: "hover:border-orange-500/50 hover:shadow-orange-500/[0.03]",
    badge: "Evals",
    badgeColor: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
  },
  {
    href: "/failure-analysis",
    icon: "🔍",
    label: "Failure Analysis",
    tagline: "Identify systematic failure patterns and annotate root causes",
    accent: "hover:border-rose-500/50 hover:shadow-rose-500/[0.03]",
    badge: "Failures",
    badgeColor: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
  },
  {
    href: "/training-sign-off",
    icon: "✍️",
    label: "Training Sign-off",
    tagline: "Review and approve training directions and prompt changes",
    accent: "hover:border-amber-500/50 hover:shadow-amber-500/[0.03]",
    badge: "Approval",
    badgeColor: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  },
  {
    href: "/training-corpus",
    icon: "📚",
    label: "Training Corpus",
    tagline: "Manage synthetic training pairs and prompt version history",
    accent: "hover:border-violet-500/50 hover:shadow-violet-500/[0.03]",
    badge: "Corpus",
    badgeColor: "bg-violet-500/10 text-violet-400 border border-violet-500/20",
  },
  {
    href: "/promotion-gate",
    icon: "🚀",
    label: "Promotion Gate",
    tagline: "Deploy approved improvements and monitor rollout health",
    accent: "hover:border-emerald-500/50 hover:shadow-emerald-500/[0.03]",
    badge: "Deploy",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  },
  {
    href: "/simulation-arena",
    icon: "⚔️",
    label: "Simulation Arena",
    tagline: "Stress-test agents against adversarial inputs and edge cases",
    accent: "hover:border-red-500/50 hover:shadow-red-500/[0.03]",
    badge: "Arena",
    badgeColor: "bg-red-500/10 text-red-400 border border-red-500/20",
  },
];

export default function Home() {
  return (
    <WorkbenchShell
      title="Agent Training Workbench"
      tagline="Evaluate, analyze, and iteratively improve AI agents through data-driven training cycles"
      badge="Ops"
    >
      <div className="max-w-5xl mx-auto w-full px-6 py-10">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🤖</span>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              Agent Performance & Training Platform
            </h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
            Manage your AI model configurations, execute performance eval suites, trace root-cause failures, and govern promotion cycles across workspaces.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PORTALS.map(({ href, icon, label, tagline, accent, badge, badgeColor }) => (
            <Link
              key={href}
              href={href}
              className={`group p-6 border border-slate-800/60 rounded-2xl bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg ${accent}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none filter drop-shadow-md">{icon}</span>
                  <h2 className="text-sm font-bold text-slate-200 leading-tight group-hover:text-white transition-colors duration-200">
                    {label}
                  </h2>
                </div>
                <span className={`shrink-0 ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
                  {badge}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors duration-200">
                {tagline}
              </p>
            </Link>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800/40">
          <p className="text-[11px] text-slate-600 text-center tracking-wider">
            ODDJOB AGENT PERFORMANCE & TRAINING PLATFORM · DATA-DRIVEN ARCHITECTURE
          </p>
        </div>
      </div>
    </WorkbenchShell>
  );
}

