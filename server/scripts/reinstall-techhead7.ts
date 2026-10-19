import { db } from "../database_service.js";
import { orgs, apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

/**
 * Hand app startup to the long-running server (port 5000 by default) so the app
 * processes are owned by IT and survive this one-shot script exiting. Launching
 * apps during install would spawn them as children of this script, which die on
 * process.exit — leaving the registry pointing at dead ports. Falls back
 * gracefully if the server is down (its periodic reconcile sweep will recover them).
 */
async function startAppsViaLiveServer(orgId: number): Promise<void> {
    const base = process.env.PLATFORM_BASE_URL || "http://localhost:5000";
    const rows = await db.select({ slug: apps.slug, publicSlug: appDeployments.publicSlug })
        .from(appDeployments)
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(and(eq(appDeployments.organizationId, orgId), isNotNull(apps.dockerImage)));
    const workbenches = rows.filter(r => r.publicSlug && /workbench|sdlc|ai-workforce/i.test(r.slug));
    if (workbenches.length === 0) {
        console.log("No containerized workbench apps to start.");
        return;
    }
    console.log(`\nHanding ${workbenches.length} app(s) to the live server (${base}) so they outlive this script...`);
    for (const w of workbenches) {
        try {
            const res = await fetch(`${base}/api/public/apps/${w.publicSlug}/start`, { method: "POST" });
            const body: any = await res.json().catch(() => ({}));
            console.log(`  ${res.ok ? "✅" : "❌"} ${w.slug} → HTTP ${res.status}${body.port ? ` (port ${body.port})` : ""}`);
        } catch (e: any) {
            console.log(`  ⚠️  ${w.slug}: live server unreachable (${e.message}) — start it from the dashboard once the server is up`);
        }
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Kill whatever process is listening on `port`. The workbench apps run as
 * `next start` processes owned by the live server (port 5000); this script can't
 * stop them gracefully (localProcessService.stopProcess uses an in-process
 * registry that only the live server holds), so we terminate them by port. This
 * releases the Windows file locks on .next/node_modules that otherwise make the
 * workspace clean below silently no-op and compile STALE source.
 */
function killProcessOnPort(port: number): void {
    try {
        if (process.platform === "win32") {
            const out = execSync("netstat -ano -p tcp", { encoding: "utf-8" });
            const pids = new Set<string>();
            for (const line of out.split("\n")) {
                if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
                    const pid = line.trim().split(/\s+/).pop();
                    if (pid && pid !== "0") pids.add(pid);
                }
            }
            for (const pid of pids) {
                try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); console.log(`  ✅ stopped PID ${pid} on port ${port}`); } catch { /* already gone */ }
            }
        } else {
            const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf-8" }).trim();
            for (const pid of out.split("\n").filter(Boolean)) {
                try { execSync(`kill -9 ${pid}`); console.log(`  ✅ stopped PID ${pid} on port ${port}`); } catch { /* already gone */ }
            }
        }
    } catch { /* no listener / netstat unavailable — best-effort */ }
}

/**
 * Stop the org's running workbench app processes (those whose workspaces we're
 * about to clean) so the clean isn't blocked by open file handles.
 */
async function stopOrgWorkbenchProcesses(orgId: number, baseSlugs: string[]): Promise<void> {
    const rows = await db.select({ id: appInstances.id, port: appInstances.port, slug: apps.slug })
        .from(appInstances)
        .innerJoin(appDeployments, eq(appInstances.deploymentId, appDeployments.id))
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(and(eq(appDeployments.organizationId, orgId), eq(appInstances.status, "running")));
    const wanted = new Set(baseSlugs.map(s => `${s}-org${orgId}`));
    const targets = rows.filter(r => wanted.has(r.slug));
    if (targets.length === 0) {
        console.log("No running workbench app processes to stop.");
        return;
    }
    const ports = [...new Set(targets.map(r => r.port))];
    console.log(`Stopping ${ports.length} running workbench app process(es) so workspace files unlock...`);
    for (const port of ports) killProcessOnPort(port);
    // Mark these instance rows stopped. The embed reverse-proxy (previewProxy)
    // round-robins across status='running' instances, so leaving stale rows for
    // the now-dead ports would make it route requests to dead containers
    // (ECONNREFUSED → fall-through), which surfaces as flaky /api/oddjob lookups.
    await db.update(appInstances).set({ status: "stopped" }).where(inArray(appInstances.id, targets.map(r => r.id)));
    // Give the OS a moment to release file handles before we delete the workspaces.
    await new Promise(resolve => setTimeout(resolve, 1500));
}

async function reinstallTechHead7() {
    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) throw new Error("TECHHEAD7 not found");
        
        console.log(`Loading Cycle App YAML manifest for Org ${org.id}...`);
        const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        const workspaceRoot = path.resolve(__dirname, "../../storage/forge-workspace");
        const sdlcSlugs = ["sdlc-workbench", "pm-workbench", "scrum-master-workbench", "qa-workbench", "stakeholder-workbench", "ai-workforce-dashboard", "devops-workbench", "ops-workbench", "pm-workbench-standalone", "scrum-master-workbench-standalone", "qa-workbench-standalone", "agent-fleet-command-standalone", "stakeholder-workbench-standalone"];
        // Stop the running app processes first — otherwise their open file handles
        // make the workspace clean below a silent no-op (provisionInstance only
        // re-copies blueprint source when the workspace is absent, so a surviving
        // stale workspace gets recompiled and the reinstall ships old code).
        await stopOrgWorkbenchProcesses(org.id, sdlcSlugs);

        console.log("Cleaning up old workspace builds to force fresh compilation...");
        const failedCleanups: string[] = [];
        for (const slug of sdlcSlugs) {
            const workspacePath = path.join(workspaceRoot, `${slug}-org${org.id}`);
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
            } catch { /* verified below — don't swallow silently */ }
            // Verify the delete actually took. fs.rm can throw or partially succeed
            // when files are still locked; if anything survives, the build would
            // reuse stale source, so fail loudly instead of deploying old code.
            const stillExists = await fs.access(workspacePath).then(() => true).catch(() => false);
            if (stillExists) failedCleanups.push(workspacePath);
        }
        if (failedCleanups.length > 0) {
            throw new Error(
                `Workspace clean failed for ${failedCleanups.length} app(s) — files are still locked, ` +
                `so a reinstall would compile STALE source instead of the current blueprint:\n` +
                failedCleanups.map(p => `  - ${p}`).join("\n") +
                `\nStop the 'next start' process(es) holding these directories and re-run. ` +
                `(This script tries to stop them automatically; if this persists, kill the workbench ` +
                `node processes manually or restart the live server.)`
            );
        }

        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);
        // Defer app launch — see startAppsViaLiveServer (apps launched here would be
        // children of this script and die when it exits).
        const result = await orgForgeService.installCycleApp(org.id, yamlContent, { skipAppLaunch: true });

        console.log("==========================================");
        console.log("Reinstall Successful!");
        if (!('installedApp' in result)) {
            console.log("Result was validation-only or dry-run, no install data available.");
            process.exit(0);
        }
        console.log("Installed App:", result.installedApp);
        console.log("Agents Provisioned:", result.agentsProvisioned);
        console.log("Missions Provisioned:", result.missionsProvisioned);
        console.log("Apps Provisioned:", result.appsProvisioned);
        console.log("==========================================");

        await startAppsViaLiveServer(org.id);

        process.exit(0);
    } catch (e) {
        console.error("Reinstall failed:", e);
        process.exit(1);
    }
}

reinstallTechHead7();
