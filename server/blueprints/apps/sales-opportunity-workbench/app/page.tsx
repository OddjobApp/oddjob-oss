import { MODULES } from '../lib/modules'
import { CycleStepBanner } from './components/CycleStepBanner'
import { ProxyLink } from './components/ProxyLink'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold rounded bg-blue-500/10 text-blue-300 px-2 py-1">PB</span>
            <h1 className="text-3xl font-bold tracking-tight">Sales Opportunity Pipeline</h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            A narrowing-window revenue cockpit. Every opportunity carries a decaying win-probability
            ceiling (90% to 60% to 30% to 0%); buyer engagement re-arms it, silence steps it down, and
            every transition is snapshotted. Advisory only; deals close on a human gate, never automatically.
          </p>
        </div>

        <CycleStepBanner />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MODULES.map(({ href, icon, label, tagline, accent, badge, badgeColor }) => (
            <ProxyLink
              key={href}
              href={href}
              className={`group p-5 border rounded-xl transition-all duration-150 bg-white/[0.03] ${accent}`}
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
            Sales Opportunity Pipeline - Advisory-only deal closure - Powered by Google Gemini
          </p>
        </div>
      </div>
    </div>
  )
}
