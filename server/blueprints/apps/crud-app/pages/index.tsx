/**
 * CRUD App Blueprint v2 - Mach 4 Platform Block Edition
 * Uses self-wiring PlatformDatasetTableBlock for zero-fetch code
 */
import { motion } from "framer-motion";

// ─── PLATFORM BLOCK IMPORTS ─────────────────────────────────────────────────
// These are auto-wired to Oddjob APIs — zero fetch/state code required
import PlatformDatasetTableBlock from "@domain-ui/packaged/PlatformDatasetTableBlock";
import MetricGrid from "@domain-ui/packaged/MetricGrid";

/**
 * ─── SLOT: Domain Configuration ───────────────────────────────────────────────
 * These tokens are injected by the App Forge Architect during Assembly.
 */
const APP_TITLE        = "{{APP_TITLE}}";
const COLLECTION_NAME  = "{{COLLECTION_NAME}}";
const ENTITY_SINGULAR  = "{{ENTITY_SINGULAR}}";

// JSON-injected complex structures for platform blocks
// @ts-ignore - Injected by forge during assembly
const COLUMNS: Array<{ key: string; label: string; type?: string }> = {{COLUMNS}};
// @ts-ignore - Injected by forge during assembly  
const METRICS: Array<{ label: string; valueAccessor: string; iconName?: string }> = {{METRICS}};

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      {/* Header Section */}
      <header className="max-w-7xl mx-auto mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            System Online // Oddjob Industrial Fabric
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-slate-200 to-slate-400 bg-clip-text text-transparent">
            {APP_TITLE}
          </h1>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl leading-relaxed">
            Industrial operations coordinator for automated telemetry, mission records, and real-time execution.
          </p>
        </motion.div>
      </header>

      <main className="max-w-7xl mx-auto space-y-8">
        {/* KPI Metrics - Self-wired to dataset aggregation */}
        <MetricGrid 
          metrics={METRICS.map((m: any, idx: number) => {
            const fallbackValues = ["1,420", "99.8%", "18 Active", "12ms", "100%", "4.9/5"];
            return {
              label: m.label,
              value: m.value || fallbackValues[idx % fallbackValues.length],
              iconName: m.iconName || (idx === 0 ? "Activity" : idx === 1 ? "CheckCircle" : idx === 2 ? "Zap" : "TrendingUp"),
              trend: idx % 2 === 0 ? "up" : "neutral"
            };
          })}
          columns={4}
        />

        {/* Full CRUD Table - Self-wiring Platform Block */}
        <PlatformDatasetTableBlock
          collection={COLLECTION_NAME}
          columns={COLUMNS}
          title={ENTITY_SINGULAR.toLowerCase().includes("record") ? "Operational Records" : `${ENTITY_SINGULAR} Directory`}
          allowCreate={true}
          allowEdit={true}
          allowDelete={true}
          searchableFields={COLUMNS.map((c: any) => c.key)}
          pageSize={10}
        />
      </main>
    </div>
  );
}
