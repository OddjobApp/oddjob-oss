import "dotenv/config";

import { CodeToDocsPipeline } from "../server/domain/capabilities/core/code-to-docs.pipeline.js";
import { DocCompilerService } from "../server/domain/capabilities/core/doc-compiler.service.js";
import { ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS } from "../shared/product/oddjob-executable-capability-manifests.js";

function resolveOrganizationId(): number {
    const raw = process.argv[2] || process.env.ACDD_SYNC_ORG_ID;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error("Pass a positive organization id: npm run capabilities:sync-product -- <organizationId>");
    }
    return value;
}

async function main(): Promise<void> {
    const organizationId = resolveOrganizationId();
    // Product reference generation must be repeatable and complete even when an
    // AI provider is offline. The deterministic renderer includes every field.
    const compiler = new DocCompilerService({ generate: async () => null });
    const pipeline = new CodeToDocsPipeline({ compiler });

    const results = [];
    for (const manifest of ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS) {
        results.push(await pipeline.run(organizationId, manifest));
    }

    const applied = results.filter((result) => result.applied).length;
    console.log(JSON.stringify({ organizationId, total: results.length, applied, results }, null, 2));
    // Database/vector clients are process-wide singletons and intentionally stay
    // open in the server. This one-shot CLI has completed all awaited writes.
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
