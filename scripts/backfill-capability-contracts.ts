/**
 * Backfill structured capability contracts onto missions (Gemini-first) so the
 * assistant's `discover_capabilities` tool can match user requests to missions.
 *
 * Usage (via tsx):
 *   npx tsx scripts/backfill-capability-contracts.ts --limit=3     # small test batch, only-missing
 *   npx tsx scripts/backfill-capability-contracts.ts --org=291     # one org, only-missing
 *   npx tsx scripts/backfill-capability-contracts.ts --all         # re-generate even if present
 */
import "dotenv/config";
import { capabilityContractService } from "../server/domain/mission/core/capability-contract.service.js";

function argVal(flag: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`${flag}=`));
    return a ? a.split("=")[1] : undefined;
}

(async () => {
    const org = argVal("--org");
    const limit = argVal("--limit");
    const all = process.argv.includes("--all");

    const res = await capabilityContractService.backfill({
        organizationId: org ? Number(org) : undefined,
        onlyMissing: !all,
        limit: limit ? Number(limit) : undefined,
    });

    console.log("Backfill result:", JSON.stringify(res));
    process.exit(res.ok === 0 && res.failed > 0 ? 1 : 0);
})().catch((e) => {
    console.error("Backfill error:", e?.message ?? e);
    process.exit(1);
});
