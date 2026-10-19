/**
 * Full (non-skip) install of it-service-desk into TECHHEAD7 — the end-to-end
 * proof that the two scaffolded workbench apps build and launch in-platform
 * (Docker image build + container start), not just under a standalone next build.
 *
 * Heavy: triggers a Docker build per app. Run with Docker daemon available.
 *
 * Usage: npx tsx server/scripts/full-install-it-service-desk-techhead7.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");
    console.log(`🏢 TECHHEAD7 = org #${org.id}`);

    const yamlContent = await fs.readFile(path.resolve(__dirname, "../cycles/it-service-desk.cycle.yaml"), "utf-8");
    console.log("📦 Full install of it-service-desk.cycle.yaml (skipAppLaunch=false — builds & launches apps)...\n");

    const t0 = Date.now();
    const result: any = await orgForgeService.installCycleApp(org.id, yamlContent, { skipAppLaunch: false });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);

    if (!result?.success) {
        console.error(`❌ Install returned success=false after ${secs}s:`, JSON.stringify(result).slice(0, 400));
        process.exit(1);
    }

    console.log(`── Install summary (took ${secs}s) ──`);
    console.log(`   apps provisioned : ${result.appsProvisioned ?? 0}`);
    console.log(`   apps RUNNING     : ${result.appsRunning ?? 0}`);
    console.log(`   apps queued      : ${result.appsQueued ?? 0}`);
    console.log(`   apps failed      : ${result.appsFailedToLaunch ?? 0}`);
    console.log(`\n── Per-app launch detail ──`);
    for (const d of (result.appLaunchDetails ?? [])) {
        const icon = d.status === "running" ? "✅" : d.status === "queued" ? "⏳" : "❌";
        console.log(`   ${icon} ${d.slug ?? "?"} → ${d.status}${d.error ? `  (${d.error})` : ""}`);
    }

    const appWarnings = (result.warnings ?? []).filter((w: string) => /app launch|build|docker|container/i.test(w));
    if (appWarnings.length) {
        console.log(`\n── App-related warnings (${appWarnings.length}) ──`);
        appWarnings.forEach((w: string) => console.log(`   - ${w}`));
    }

    const ok = (result.appsRunning ?? 0) >= 1 && (result.appsFailedToLaunch ?? 0) === 0;
    console.log(`\n${ok ? "✅ Apps built and launched in-platform." : "⚠️  Not all apps reached 'running' — see detail above."}`);
    process.exit(0);
}

main().catch((e) => { console.error("❌ threw:", e); process.exit(1); });
