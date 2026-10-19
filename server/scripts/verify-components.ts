/**
 * Component Verification Harness
 *
 * Smoke-renders every component in `component_index` and records the outcome,
 * turning `effectiveness_score` / `verification_success_rate` from seeded
 * defaults into actual measurements. Components that have never been verified
 * show as "Unrated" in the Component Gallery until this runs.
 *
 *   npm run components:verify              # record outcomes
 *   npm run components:verify -- --dry-run # report only, write nothing
 *   npm run components:verify -- --filter Blueprint
 *
 * Recording is deliberately opt-out rather than opt-in: a harness whose results
 * are not written back produces no data, which is how the scores got stale in
 * the first place.
 */
import "dotenv/config";
import { db } from "../database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { checkComponents, type ComponentDescriptor } from "../domain/learning/core/component-render-check.js";
import { componentLookupService } from "../domain/sdlc-pipeline/autonomous/component-lookup.service.js";

function parseArgs() {
  const argv = process.argv.slice(2);
  const filterIdx = argv.indexOf("--filter");
  return {
    dryRun: argv.includes("--dry-run"),
    filter: filterIdx >= 0 ? argv[filterIdx + 1] : undefined,
  };
}

async function main() {
  const { dryRun, filter } = parseArgs();

  const rows = await db.select().from(componentIndex);
  const selected = filter
    ? rows.filter(r => r.componentName.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  if (selected.length === 0) {
    console.log(filter ? `No components matched "${filter}".` : "Component index is empty.");
    process.exit(0);
  }

  console.log(
    `🧪 Verifying ${selected.length} component(s)${filter ? ` matching "${filter}"` : ""}` +
    `${dryRun ? " (dry run — nothing will be written)" : ""}...\n`,
  );

  const descriptors: ComponentDescriptor[] = selected.map(r => ({
    componentName: r.componentName,
    importPath: r.importPath,
    exportType: r.exportType,
    propSchema: r.propSchema as Record<string, unknown> | null,
  }));

  const results = await checkComponents(descriptors);

  const skipped = results.filter(r => r.skipped);
  const measured = results.filter(r => !r.skipped);
  const passed = measured.filter(r => r.ok);
  const failed = measured.filter(r => !r.ok);

  for (const r of failed) {
    console.log(`  ✗ ${r.componentName}  [${r.stage}]  ${r.error}`);
  }
  for (const r of skipped) {
    console.log(`  — ${r.componentName}  [skipped: not measurable here]  ${r.error}`);
  }

  if (!dryRun) {
    // Only measured components are recorded. Writing an outcome for something
    // the harness could not evaluate would corrupt the score in the opposite
    // direction from the seeded defaults this replaces.
    for (const r of measured) {
      await componentLookupService
        .recordAssemblyFeedback(r.componentName, r.ok)
        .catch(err => console.warn(`  ! could not record ${r.componentName}: ${err.message}`));
    }
  }

  const rate = measured.length > 0
    ? ((passed.length / measured.length) * 100).toFixed(1)
    : "n/a";
  console.log(
    `\n${failed.length === 0 ? "✅" : "⚠️ "} ${passed.length}/${measured.length} rendered (${rate}%)` +
    `${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}` +
    `${dryRun ? " — dry run, no outcomes recorded" : " — outcomes recorded"}`,
  );

  // Non-zero exit on genuine failures so this can gate CI. Skips do not fail.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("❌ Component verification failed to run:", err);
  process.exit(1);
});
