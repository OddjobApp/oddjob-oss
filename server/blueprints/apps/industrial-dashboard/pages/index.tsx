import React from 'react';
import { 
  IndustrialDashboardHero, 
  MetricGrid, 
  StatusTimeline, 
  MissionControlTable 
} from '../../../../domain/core/ui/components/packaged/index.js';

/**
 * ─── INDUSTRIAL ASSEMBLY SLOTS ────────────────────────────────────────────────
 * These tokens are injected by the App Forge Assembly Engine.
 */
// @ts-ignore
const APP_TITLE       = "{{APP_TITLE}}";
// @ts-ignore
const APP_SUBTITLE    = "{{APP_SUBTITLE}}";

// Industrial Block Configurations (JSON-injected)
// @ts-ignore
const HERO_STATS      = {{HERO_STATS}};
// @ts-ignore
const HERO_CHART_DATA = {{HERO_CHART_DATA}};
// @ts-ignore
const GRID_METRICS     = {{GRID_METRICS}};
// @ts-ignore
const TIMELINE_EVENTS = {{TIMELINE_EVENTS}};
// @ts-ignore
const TABLE_CONFIG    = {{TABLE_CONFIG}};

/**
 * Glassmorphism surface: translucent fill, blurred backdrop, and a hairline
 * edge, so each layer reads as a pane above the ambient field rather than an
 * opaque card. Shared by every layer to keep the treatment consistent.
 */
const GLASSMORPHISM_SURFACE =
  "bg-white/[0.05] backdrop-blur-2xl backdrop-saturate-150 " +
  "border border-white/10 ring-1 ring-inset ring-white/5 " +
  "shadow-[0_8px_40px_rgba(0,0,0,0.45)] rounded-3xl";

export default function IndustrialDashboard() {
  return (
    <div className="relative min-h-screen bg-[#0a0a0f] text-white p-6 md:p-12 space-y-12 overflow-hidden">
      {/* Ambient field behind the glass. Without something to refract, a
          blurred translucent panel is indistinguishable from a solid one. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/4 h-[34rem] w-[34rem] rounded-full bg-cyan-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-24 h-[36rem] w-[36rem] rounded-full bg-indigo-500/20 blur-3xl"
      />

      {/* Layer 1: Hero & Real-time Flux */}
      <div className={`relative p-4 md:p-6 ${GLASSMORPHISM_SURFACE}`}>
        <IndustrialDashboardHero
          title={APP_TITLE}
          subtitle={APP_SUBTITLE}
          stats={HERO_STATS}
          data={HERO_CHART_DATA}
        />
      </div>

      {/* Layer 2: High-Density Metric Grid */}
      <section className={`relative space-y-4 p-4 md:p-6 ${GLASSMORPHISM_SURFACE}`}>
        <h2 className="text-xl font-bold tracking-tight text-white/40 uppercase ml-1">Critical Metrics</h2>
        <MetricGrid
          metrics={GRID_METRICS}
          columns={4}
        />
      </section>

      {/* Layer 3: Split View - Table & Timeline */}
      <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className={`lg:col-span-2 p-4 md:p-6 ${GLASSMORPHISM_SURFACE}`}>
          <MissionControlTable
            title={TABLE_CONFIG.title}
            collection={TABLE_CONFIG.collection}
            columns={TABLE_CONFIG.columns}
          />
        </div>
        <div className={`p-4 md:p-6 ${GLASSMORPHISM_SURFACE}`}>
          <StatusTimeline
            title="Operational Log"
            events={TIMELINE_EVENTS}
          />
        </div>
      </div>
    </div>
  );
}
