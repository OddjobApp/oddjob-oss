import Link from 'next/link'

const PORTALS = [
  {
    href: "/ingestion-hub",
    icon: "🔬",
    label: "Ingestion & Synthesis Hub",
    tagline: "Aggregate raw sources, compare options in a dynamic matrix, and explore indexed research across any domain.",
    accent: "border-blue-500/30 hover:bg-blue-500/5",
    badge: "Sources",
    badgeColor: "bg-blue-500/10 text-blue-400",
  },
  {
    href: "/decision-panel",
    icon: "⚖️",
    label: "Decision Control Panel",
    tagline: "Render dynamic HIL approval forms, track SLA countdowns, and maintain a full audit trail of every decision.",
    accent: "border-violet-500/30 hover:bg-violet-500/5",
    badge: "HIL",
    badgeColor: "bg-violet-500/10 text-violet-400",
  },
  {
    href: "/draft-sandbox",
    icon: "✍️",
    label: "Draft & Review Sandbox",
    tagline: "Compose RFC documents and structured drafts with AI assistance and inline peer review annotations.",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Drafting",
    badgeColor: "bg-slate-700 text-slate-400",
  },
  {
    href: "/memory-library",
    icon: "🗄️",
    label: "Shared Memory Library",
    tagline: "Browse, query, and tag the knowledge graph — surface relevant precedents and prior art instantly.",
    accent: "border-teal-500/20 hover:bg-teal-500/5",
    badge: "Knowledge",
    badgeColor: "bg-teal-500/10 text-teal-400",
  },
  {
    href: "/knowledge-graph",
    icon: "🕸️",
    label: "Visual Knowledge Graph Explorer",
    tagline: "Interactive map of concepts, documents, and entities extracted by Research Agents.",
    accent: "border-emerald-500/20 hover:bg-emerald-500/5",
    badge: "Graph View",
    badgeColor: "bg-emerald-500/10 text-emerald-400",
  },
  {
    href: "/backlog-provisioner",
    icon: "📋",
    label: "Action & Backlog Provisioner",
    tagline: "Convert research findings into actionable tickets, Jira issues, and mission triggers with one click.",
    accent: "border-amber-500/20 hover:bg-amber-500/5",
    badge: "Actions",
    badgeColor: "bg-amber-500/10 text-amber-400",
  },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-[#090d16] text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🔭</span>
            <h1 className="text-3xl font-bold tracking-tight">Research & RFC Synthesis Platform</h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            Domain-agnostic workflow portals for any research discipline. Ingest sources, synthesize findings,
            reach decisions, and provision actions — all from a single unified workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PORTALS.map(({ href, icon, label, tagline, accent, badge, badgeColor }) => (
            <Link
              key={href}
              href={href}
              className={`group p-5 border rounded-xl transition-all duration-150 bg-white/3 ${accent}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl leading-none">{icon}</span>
                  <h2 className="text-sm font-semibold text-white leading-tight group-hover:text-white">
                    {label}
                  </h2>
                </div>
                <span className={`shrink-0 ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
                  {badge}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{tagline}</p>
            </Link>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-white/5">
          <p className="text-[11px] text-slate-600 text-center">
            Oddjob Research & RFC Synthesis Platform · Domain-agnostic · Powered by Hybrid AI
          </p>
        </div>
      </div>
    </div>
  )
}
