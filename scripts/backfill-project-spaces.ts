/**
 * Project Spaces Phase 1 backfill: create one default project per org and derive
 * resource membership from the existing cycle_id / mission_id lineage columns.
 *
 * Idempotent — safe to re-run. The lineage columns it reads are never modified.
 *
 * Usage (via tsx):
 *   npx tsx scripts/backfill-project-spaces.ts --dry-run    # report only
 *   npx tsx scripts/backfill-project-spaces.ts --org=291    # one org
 *   npx tsx scripts/backfill-project-spaces.ts             # every org
 */
import "dotenv/config";
import { backfillAllOrgs } from "../server/domain/projects/core/project-backfill.service.js";

function argVal(flag: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`${flag}=`));
    return a ? a.split("=")[1] : undefined;
}

(async () => {
    const org = argVal("--org");
    const dryRun = process.argv.includes("--dry-run");

    const reports = await backfillAllOrgs({
        organizationIds: org ? [Number(org)] : undefined,
        dryRun,
        userId: "backfill-script",
    });

    for (const r of reports) {
        const total = Object.values(r.attached).reduce((a, b) => a + b, 0);
        console.log(
            `org ${r.organizationId}: default project ${r.defaultProjectId}, ` +
            `${r.cyclesLinked} cycle(s) linked, ${total} resource(s) attached ` +
            `${JSON.stringify(r.attached)}`,
        );
    }
    console.log(`Done. ${reports.length} org(s) processed${dryRun ? " (dry run)" : ""}.`);
    process.exit(0);
})().catch((e) => {
    console.error("Project Spaces backfill error:", e?.message ?? e);
    process.exit(1);
});
