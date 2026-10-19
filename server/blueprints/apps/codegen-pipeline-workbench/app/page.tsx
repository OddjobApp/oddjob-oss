import { MODULES } from "../lib/modules";
import { CycleStepBanner } from "./components/CycleStepBanner";
import { ProxyLink } from "./components/ProxyLink";

export default function HomePage() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <section className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80">
          Autonomous Code Generation Pipeline
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Codegen Pipeline Workbench
        </h1>
        <p className="mt-3 max-w-2xl text-sm sm:text-base text-slate-400">
          The operator cockpit for the autonomous SDLC codegen pipeline — watch
          generation sessions move through context-load, change-plan, apply-edits,
          test-loop, quality-gate and PR-generation, and review the quality
          analytics behind every merged change.
        </p>
      </section>

      <CycleStepBanner />

      <section className="grid gap-4 sm:grid-cols-2">
        {MODULES.map((m) => (
          <ProxyLink
            key={m.href}
            href={m.href}
            className={`group flex flex-col rounded-2xl border bg-white/[0.02] p-6 transition-colors ${m.accent}`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-sm font-bold text-white">
                {m.icon}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${m.badgeColor}`}>
                {m.badge}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white group-hover:text-white">
              {m.label}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{m.tagline}</p>
            <span className="mt-4 text-xs font-medium text-slate-500 group-hover:text-slate-300">
              Open →
            </span>
          </ProxyLink>
        ))}
      </section>
    </main>
  );
}
