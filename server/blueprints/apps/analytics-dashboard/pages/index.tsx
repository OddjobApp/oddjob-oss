/**
 * Analytics Dashboard Blueprint v2 - Mach 4 Platform Block Edition
 * Uses self-wiring PlatformDatasetChartBlock and MetricGrid — zero fetch/code
 */
import { motion } from "framer-motion";

// ─── PLATFORM BLOCK IMPORTS ─────────────────────────────────────────────────
// These are auto-wired to Oddjob APIs — zero fetch/state code required
import PlatformDatasetChartBlock from "@domain-ui/packaged/PlatformDatasetChartBlock";
import MetricGrid from "@domain-ui/packaged/MetricGrid";
import PlatformDatasetTableBlock from "@domain-ui/packaged/PlatformDatasetTableBlock";

/**
 * ─── SLOT: Domain Configuration ───────────────────────────────────────────────
 * These tokens are injected by the App Forge Architect during Assembly.
 */
const APP_TITLE       = "{{APP_TITLE}}";
const COLLECTION_NAME = "{{COLLECTION_NAME}}";

// JSON-injected configurations for platform blocks
// @ts-ignore - Injected by forge during assembly
const KPI_METRICS: Array<{ label: string; accessor: string; icon: string; trend: string }> = {{KPI_METRICS}};
// @ts-ignore - Injected by forge during assembly
const CHART_CONFIG: { xField: string; yField: string; chartType: 'line' | 'bar' | 'area' | 'pie'; title?: string } = {{CHART_CONFIG}};
// @ts-ignore - Injected by forge during assembly
const TABLE_COLUMNS: Array<{ key: string; label: string; type?: string }> = {{TABLE_COLUMNS}};

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      {/* Header Section */}
      <header className="max-w-7xl mx-auto mb-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2 bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
            {APP_TITLE}
          </h1>
          <p className="text-[var(--text-secondary)] text-lg">
            Industrial analytical intelligence for {COLLECTION_NAME.toLowerCase()}.
          </p>
        </motion.div>
      </header>

      <main className="max-w-7xl mx-auto space-y-8">
        {/* KPI Metrics - Self-wired via MetricGrid */}
        <MetricGrid 
          metrics={KPI_METRICS.map((m: any) => ({
            label: m.label,
            value: `{{METRIC_VALUE:${m.accessor}}}`,
            iconName: m.icon,
            trend: m.trend || "neutral"
          }))}
          columns={4}
        />

        {/* Main Chart - Self-wiring PlatformDatasetChartBlock */}
        <PlatformDatasetChartBlock
          collection={COLLECTION_NAME}
          xField={CHART_CONFIG.xField || "createdAt"}
          yField={CHART_CONFIG.yField || "value"}
          chartType={CHART_CONFIG.chartType || "area"}
          title={CHART_CONFIG.title || "Trend Analysis"}
          dateRangeFilter={true}
          height="400px"
        />

        {/* Data Table - Self-wiring PlatformDatasetTableBlock */}
        <PlatformDatasetTableBlock
          collection={COLLECTION_NAME}
          columns={TABLE_COLUMNS}
          title="Detailed Records"
          allowCreate={false}
          allowEdit={true}
          allowDelete={false}
          searchableFields={TABLE_COLUMNS.map((c: any) => c.key)}
          pageSize={10}
        />
      </main>
    </div>
  );
}
