import React, { useState } from "react";
import { BarChart3, Blocks, Check, Database, GitBranch, LayoutDashboard, Map, Network, PanelsTopLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type CatalogEntry = { layout: string; surfaces: readonly string[]; builder: string };
type ArchitecturePlan = {
  appName: string;
  archetype: string;
  layout: string;
  surfaces: readonly string[];
  capabilities: readonly string[];
  integrations: readonly string[];
  recommendedTool: string;
  requiresForgeGeneration: boolean;
};

export interface AppArchitecturePlanPodProps {
  plan: ArchitecturePlan;
  catalog: Record<string, CatalogEntry>;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  workflow_wizard: GitBranch,
  analytics_dashboard: BarChart3,
  operations_console: LayoutDashboard,
  case_management: PanelsTopLeft,
  knowledge_portal: Blocks,
  spatial_workspace: Map,
  collaboration_hub: Network,
  data_studio: Database,
  custom: Blocks,
};

const label = (value?: string) => (value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AppArchitecturePlanPod({ plan, catalog }: AppArchitecturePlanPodProps) {
  const safePlan = plan || { appName: "Application", archetype: "operations_console" };
  const safeCatalog = catalog || {};
  const [selected, setSelected] = useState(safePlan.archetype);
  const selection = safeCatalog[selected] || safeCatalog[safePlan.archetype] || {
    layout: "Console",
    builder: "StandardBuilder",
    surfaces: [] as string[],
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl" data-testid="app-architecture-plan">
      <header className="border-b border-border/60 bg-gradient-to-r from-violet-500/10 via-cyan-500/5 to-transparent p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500">CREW application planner</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">{safePlan.appName}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Choose an archetype before CREW assembles the application.</p>
          </div>
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            Plan persisted
          </span>
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Application archetypes</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(safeCatalog).map(([key, item]) => {
              const Icon = ICONS[key] || Blocks;
              const active = key === selected;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active ? "border-violet-500/50 bg-violet-500/10" : "border-border/60 bg-background/40 hover:border-violet-500/30 hover:bg-muted/50",
                  )}
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Icon className={cn("h-4 w-4", active ? "text-violet-500" : "text-muted-foreground")} />
                    {active && <Check className="h-3.5 w-3.5 text-violet-500" />}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-foreground">{label(key)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{label(item.layout)}</p>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-border/60 bg-background/50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Selected architecture</p>
          <h4 className="mt-2 text-sm font-semibold text-foreground">{label(selected)}</h4>
          <dl className="mt-4 space-y-3 text-xs">
            <div><dt className="text-muted-foreground">Layout</dt><dd className="mt-1 font-medium text-foreground">{label(selection.layout)}</dd></div>
            <div><dt className="text-muted-foreground">Builder</dt><dd className="mt-1 font-mono text-[11px] text-foreground">{selection.builder}</dd></div>
            <div>
              <dt className="text-muted-foreground">Surfaces</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {(selection.surfaces || []).map((surface) => <span key={surface} className="rounded-md bg-muted px-2 py-1 text-[10px] text-foreground">{label(surface)}</span>)}
              </dd>
            </div>
          </dl>
          {selected !== safePlan.archetype && (
            <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
              Preview selection only. Ask CREW to “use {label(selected)}” to revise the persisted plan.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
