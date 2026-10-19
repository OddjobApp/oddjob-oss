/**
 * Incrementally AST-index the Oddjob repository into the system graph.
 *
 * Unlike scripts/sync-system-graph.ts (which clears and re-ingests everything
 * through the regex scanners), this only re-parses files whose content hash has
 * changed, so it is cheap to run repeatedly — e.g. from a post-checkout hook.
 *
 *   npx tsx scripts/index-system-graph.ts
 */
import "dotenv/config";
import { codeGraphService } from "../server/domain/xray/core/code-graph.service.js";

async function main() {
    console.log("🔍 Indexing Oddjob repository into the system graph...");
    const result = await codeGraphService.indexRepo({ repoRoot: process.cwd() });

    console.log(
        `✅ Done in ${result.durationMs}ms — ` +
        `${result.changed} changed, ${result.skipped} unchanged, ` +
        `${result.failed} failed of ${result.scanned} scanned`,
    );

    if (result.failed > 0) {
        console.warn(`⚠️  ${result.failed} file(s) failed to index; see logs above.`);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Repository index failed:", err);
    process.exit(1);
});
