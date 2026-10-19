import { useNavigate } from "react-router-dom";

const pillars = [
  {
    name: "Missions",
    headline: "Long-running autonomous work that keeps its state.",
    detail:
      "Generative Mission Synthesis scores, synthesizes, validates, executes, and evolves enterprise workflows instead of dropping fragile prompt chains into production.",
  },
  {
    name: "Forge",
    headline: "Internal apps for every recurring operation.",
    detail:
      "App Forge turns active missions into operator boards with tables, charts, controls, version history, and automated browser QA before publishing.",
  },
  {
    name: "Knowledge",
    headline: "A governed garden for enterprise memory.",
    detail:
      "Semantic search, a native knowledge graph, and human verification keep proprietary data grounded, curated, and isolated from public model training.",
  },
  {
    name: "Control",
    headline: "Policy gates, budgets, and replayable decisions.",
    detail:
      "Every tool call, computer-use session, credential touch, and high-risk action can be paused, redacted, approved, replayed, and audited.",
  },
];

const proofPoints = [
  "Human-in-the-loop approvals for risky actions",
  "Agent salaries and token budgets by department",
  "Redacted Trycua replays for legacy software sessions",
  "Git-like rollback for generated apps",
];

const personas = [
  {
    role: "Technical Operations",
    concern: "Integration debt, repetitive scripts, overloaded support queues.",
    value:
      "Oddjob converts goals into durable missions, builds the dashboard, and keeps the operator in control.",
  },
  {
    role: "Security",
    concern: "Shadow AI, audit gaps, policy drift, and data leakage.",
    value:
      "Every agent decision is logged, risk-scored, redacted, and routed through the right approval gate.",
  },
  {
    role: "Finance",
    concern: "Unbounded token spend and unclear ROI from agent projects.",
    value:
      "Agents become economic units with salaries, cost ceilings, run histories, and department-level ROI.",
  },
];

function MarketingPage() {
  const navigate = useNavigate();

  return (
    <>

      <main className="min-h-screen overflow-hidden bg-[#f4f1ea] text-[#14120f]">
        <section className="relative min-h-[86vh] border-b border-black/15 bg-[#f4f1ea]">
          <div className="audit-grid absolute inset-0 opacity-70" />
          <img
            src="/assets/branding/bowler-hat.png"
            alt=""
            className="hat-mask pointer-events-none absolute bottom-10 right-[-12vw] w-[82vw] max-w-[980px] opacity-[0.26] mix-blend-multiply sm:bottom-[-3vw] sm:right-[-8vw]"
          />
          <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
            <a
              href="#"
              className="flex items-center gap-3"
              aria-label="Oddjob home"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-black/20 bg-[#fffaf2]">
                <img
                  src="/assets/branding/bowler-hat.png"
                  alt=""
                  className="h-7 w-8 object-cover object-center"
                />
              </span>
              <span className="text-base font-semibold">Oddjob</span>
            </a>
            <nav className="hidden items-center gap-6 text-sm font-medium text-black/65 md:flex">
              <a href="#platform" className="hover:text-black">
                Platform
              </a>
              <a href="#governance" className="hover:text-black">
                Governance
              </a>
              <a href="#buyers" className="hover:text-black">
                Buyers
              </a>
              <a href="#proof" className="hover:text-black">
                Proof
              </a>
            </nav>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/login")}
                className="hidden rounded-lg border border-black/20 bg-[#fffaf2] px-4 py-2 text-sm font-semibold text-[#14120f] shadow-sm transition hover:border-black/35 sm:inline-flex"
              >
                Log in
              </button>
              <button
                onClick={() => navigate("/login")}
                className="rounded-lg border border-black/20 bg-[#14120f] px-4 py-2 text-sm font-semibold text-[#fffaf2] shadow-sm transition hover:bg-[#2a241d]"
              >
                Sign up
              </button>
            </div>
          </header>

          <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-5 pb-12 pt-12 sm:px-8 sm:pt-20 lg:pt-24">
            <p className="mb-5 max-w-max border-l-4 border-[#d64b2a] bg-[#fffaf2]/80 py-2 pl-4 pr-5 text-xs font-bold uppercase text-black/70">
              Governed Agentic Operations Engine
            </p>
            <h1 className="hero-text-shadow max-w-5xl text-6xl font-black leading-[0.88] sm:text-7xl lg:text-9xl">
              Oddjob
            </h1>
            <p className="mt-8 max-w-3xl text-xl leading-8 text-black/76 sm:text-2xl sm:leading-10">
              The enterprise system of record for autonomous work. Oddjob plans,
              executes, governs, replays, and improves missions across agents,
              tools, generated apps, and computer-use sessions.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <button
                onClick={() => navigate("/login")}
                className="rounded-lg bg-[#d64b2a] px-5 py-3 text-sm font-bold text-foreground shadow-sm transition hover:bg-[#b63f25]"
              >
                Create account
              </button>
              <button
                onClick={() => navigate("/login")}
                className="rounded-lg border border-black/20 bg-[#fffaf2] px-5 py-3 text-sm font-bold text-[#14120f] shadow-sm transition hover:border-black/35"
              >
                Log in
              </button>
              <a
                href="#platform"
                className="rounded-lg border border-black/20 bg-[#f4f1ea]/80 px-5 py-3 text-sm font-bold text-[#14120f] shadow-sm transition hover:border-black/35"
              >
                Explore platform
              </a>
            </div>

            <dl className="mt-12 grid max-w-4xl grid-cols-1 border-y border-black/15 bg-[#f4f1ea]/75 text-sm sm:grid-cols-3">
              <div className="border-b border-black/15 p-4 sm:border-b-0 sm:border-r">
                <dt className="font-mono text-xs uppercase text-black/50">
                  Mission state
                </dt>
                <dd className="mt-2 font-semibold">Durable by default</dd>
              </div>
              <div className="border-b border-black/15 p-4 sm:border-b-0 sm:border-r">
                <dt className="font-mono text-xs uppercase text-black/50">
                  Risk actions
                </dt>
                <dd className="mt-2 font-semibold">Human gated</dd>
              </div>
              <div className="p-4">
                <dt className="font-mono text-xs uppercase text-black/50">
                  Spend
                </dt>
                <dd className="mt-2 font-semibold">Budget enforced</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="border-b border-black/15 bg-[#14120f] text-[#fffaf2]">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-foreground/15 px-0 sm:grid-cols-4">
            {pillars.map((pillar) => (
              <a
                key={pillar.name}
                href="#platform"
                className="bg-[#14120f] p-5 transition hover:bg-[#1f1a15]"
              >
                <p className="font-mono text-xs uppercase text-[#d39b32]">
                  {pillar.name}
                </p>
                <p className="mt-3 text-base font-semibold leading-6">
                  {pillar.headline}
                </p>
              </a>
            ))}
          </div>
        </section>

        <section id="platform" className="bg-[#fffaf2] px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase text-[#d64b2a]">
                From goal to governed outcome
              </p>
              <h2 className="mt-4 text-4xl font-black leading-tight sm:text-6xl">
                A complete operations stack for agents that actually do work.
              </h2>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2">
              {pillars.map((pillar) => (
                <article
                  key={pillar.name}
                  className="rounded-lg border border-black/15 bg-[#f4f1ea] p-6"
                >
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <h3 className="text-2xl font-bold">{pillar.name}</h3>
                      <p className="mt-2 text-black/70">{pillar.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default MarketingPage;
