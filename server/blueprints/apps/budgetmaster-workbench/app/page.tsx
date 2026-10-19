import { ProxyLink } from './components/ProxyLink'
import { MODULES } from '../lib/modules'
import { PlatformReadiness } from './components/PlatformReadiness'

export default function Home() {
  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#090d16] text-white p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">💰</span>
            <h1 className="text-3xl font-bold tracking-tight">BudgetMaster — Sovereign Algorithmic Wealth Matrix</h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            Autonomous personal-finance treasury. Ingest statements, categorize with AI, and let the
            automation engines watch your cash, subscriptions, and capital decisions — every money
            movement is advisory and human-approved.
          </p>
        </div>

        <PlatformReadiness />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(({ href, icon, label, tagline, accent, badge, badgeColor }) => (
            <ProxyLink
              key={href}
              href={href}
              className={`group p-5 border rounded-xl transition-all duration-150 bg-white/3 ${accent}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl leading-none">{icon}</span>
                  <h2 className="text-sm font-semibold text-white leading-tight">{label}</h2>
                </div>
                <span className={`shrink-0 ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
                  {badge}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{tagline}</p>
            </ProxyLink>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-white/5">
          <p className="text-[11px] text-slate-600 text-center">
            BudgetMaster · Advisory-only money movement · Powered by Google Gemini
          </p>
        </div>
      </div>
    </div>
  )
}
