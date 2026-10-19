import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appDeployments, appInstances, apps, type App, type AppDeployment, type AppInstance } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { resolveForgeWorkspacePath } from "./forge-paths.js";
import { detectLaunchProfile, resolveNodeEntry } from "../infrastructure/node-launch-profile.js";

const logger = createLogger("AppReadinessService");

export type ReadinessStatus = "pass" | "fail" | "warn" | "skip";
export type ReadinessSeverity = "blocker" | "warning" | "info";

export interface ReadinessCheck {
    id: string;
    label: string;
    status: ReadinessStatus;
    severity: ReadinessSeverity;
    message: string;
    detail?: Record<string, unknown>;
}

export interface AppReadinessReport {
    ready: boolean;
    appId?: number;
    slug: string;
    organizationId?: number | null;
    runtimeUrl?: string;
    checkedAt: string;
    checks: ReadinessCheck[];
    summary: {
        pass: number;
        fail: number;
        warn: number;
        skip: number;
    };
}

export interface ReadinessInput {
    app?: App | null;
    deployment?: AppDeployment | null;
    instance?: AppInstance | null;
    organizationId?: number | null;
    workspacePath?: string;
    probeRuntime?: boolean;
}

function countChecks(checks: ReadinessCheck[]): AppReadinessReport["summary"] {
    return checks.reduce(
        (acc, check) => {
            acc[check.status]++;
            return acc;
        },
        { pass: 0, fail: 0, warn: 0, skip: 0 }
    );
}

function check(
    id: string,
    label: string,
    status: ReadinessStatus,
    severity: ReadinessSeverity,
    message: string,
    detail?: Record<string, unknown>
): ReadinessCheck {
    return { id, label, status, severity, message, ...(detail ? { detail } : {}) };
}

async function exists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath: string): Promise<any | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function deriveRuntimeUrl(app?: App | null, deployment?: AppDeployment | null, instance?: AppInstance | null): string | undefined {
    if (deployment?.url) return deployment.url;
    if (instance?.port) return `http://localhost:${instance.port}`;
    const meta = (app?.runtimeMetadata ?? {}) as any;
    if (meta.url) return String(meta.url);
    if (meta.assignedPort) return `http://localhost:${meta.assignedPort}`;
    return undefined;
}

async function probeUrl(url: string, retries = 8, delayMs = 600): Promise<{ ok: boolean; status?: number; error?: string }> {
    let lastError: string | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(3500) });
            return { ok: res.ok || res.status < 500, status: res.status };
        } catch (err: any) {
            lastError = err.message;
            if (attempt < retries - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    return { ok: false, error: lastError };
}

export const appReadinessService = {
    async getAppReadiness(appId: number, organizationId?: number | null, options?: { probeRuntime?: boolean }): Promise<AppReadinessReport> {
        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) {
            return this.evaluateReadiness({
                app: null,
                organizationId,
                probeRuntime: options?.probeRuntime,
            });
        }

        const ownerOrgId = (app as any).developerOrgId ?? (app as any).organizationId ?? null;
        const targetOrgId = organizationId ?? ownerOrgId;

        const [deployment] = targetOrgId
            ? await db
                .select()
                .from(appDeployments)
                .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, targetOrgId)))
                .limit(1)
            : [null];

        const [instance] = deployment
            ? await db
                .select()
                .from(appInstances)
                .where(eq(appInstances.deploymentId, deployment.id))
                .orderBy(desc(appInstances.updatedAt))
                .limit(1)
            : [null];

        return this.evaluateReadiness({
            app,
            deployment: deployment ?? null,
            instance: instance ?? null,
            organizationId: targetOrgId,
            probeRuntime: options?.probeRuntime,
        });
    },

    async getOrgLifecycleDashboard(organizationId: number): Promise<{ organizationId: number; apps: AppReadinessReport[] }> {
        const rows = await db
            .select({ app: apps, deployment: appDeployments })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(appDeployments.organizationId, organizationId));

        const reports = await Promise.all(rows.map(async row => {
            const [instance] = await db
                .select()
                .from(appInstances)
                .where(eq(appInstances.deploymentId, row.deployment.id))
                .orderBy(desc(appInstances.updatedAt))
                .limit(1);

            return this.evaluateReadiness({
                app: row.app,
                deployment: row.deployment,
                instance: instance ?? null,
                organizationId,
            });
        }));

        return { organizationId, apps: reports };
    },

    async evaluateReadiness(input: ReadinessInput): Promise<AppReadinessReport> {
        const checks: ReadinessCheck[] = [];
        const app = input.app ?? null;
        const deployment = input.deployment ?? null;
        const instance = input.instance ?? null;
        const slug = app?.slug ?? "unknown";
        const ownerOrgId = app ? ((app as any).developerOrgId ?? (app as any).organizationId ?? null) : null;
        const runtimeUrl = deriveRuntimeUrl(app, deployment, instance);

        checks.push(app
            ? check("app_registry", "App registry", "pass", "blocker", `App ${app.slug} is registered.`, { appId: app.id, status: app.status })
            : check("app_registry", "App registry", "fail", "blocker", "App is not registered."));

        if (app && input.organizationId) {
            const ownsApp = ownerOrgId == null || ownerOrgId === input.organizationId;
            const deploymentMatches = !deployment || deployment.organizationId === input.organizationId;
            checks.push(ownsApp && deploymentMatches
                ? check("org_isolation", "Org isolation", "pass", "blocker", "App ownership and deployment are scoped to the requested organization.", { organizationId: input.organizationId })
                : check("org_isolation", "Org isolation", "fail", "blocker", "App ownership or deployment does not match the requested organization.", { requestedOrgId: input.organizationId, ownerOrgId, deploymentOrgId: deployment?.organizationId }));
        } else {
            checks.push(check("org_isolation", "Org isolation", "warn", "warning", "No organization context was supplied; readiness cannot prove org isolation."));
        }

        checks.push(deployment
            ? check("org_deployment", "Org deployment", "pass", "blocker", `Deployment ${deployment.id} exists for the organization.`, { status: deployment.status, published: deployment.isPublished })
            : check("org_deployment", "Org deployment", app ? "fail" : "skip", "blocker", app ? "No deployment record exists for this app in the organization." : "Skipped because the app is missing."));

        const workspacePath = input.workspacePath ?? (app ? await resolveForgeWorkspacePath(app.slug).catch(err => {
            logger.warn(`Workspace resolver failed for ${app.slug}: ${err.message}`);
            return "";
        }) : "");

        const workspaceExists = Boolean(workspacePath) && await exists(workspacePath);
        checks.push(workspaceExists
            ? check("workspace_exists", "Workspace", "pass", "blocker", "Forge workspace exists.", { workspacePath })
            : check("workspace_exists", "Workspace", app ? "fail" : "skip", "blocker", app ? "Forge workspace is missing." : "Skipped because the app is missing.", { workspacePath }));

        if (workspaceExists) {
            checks.push(...await this.checkWorkspaceReadiness(slug, workspacePath));
        } else {
            checks.push(check("workspace_files", "Workspace files", "skip", "blocker", "Skipped because the workspace is missing."));
            checks.push(check("build_artifact", "Build artifact", "skip", "warning", "Skipped because the workspace is missing."));
        }

        const running = instance?.status === "running" || ((app?.runtimeMetadata as any)?.status === "running");
        if (running) {
            checks.push(check("active_instance", "Runtime instance", "pass", "blocker", "A running runtime instance is recorded.", { instanceId: instance?.id, port: instance?.port }));
        } else if (deployment) {
            checks.push(check("active_instance", "Runtime instance", "warn", "warning", "Deployment exists, but no running runtime instance is recorded.", { instanceStatus: instance?.status, appRuntimeStatus: (app?.runtimeMetadata as any)?.status }));
        } else {
            checks.push(check("active_instance", "Runtime instance", "skip", "warning", "Skipped because there is no deployment."));
        }

        checks.push(runtimeUrl
            ? check("runtime_url", "Runtime URL", "pass", "warning", "A runtime URL can be derived for the app.", { runtimeUrl })
            : check("runtime_url", "Runtime URL", deployment ? "warn" : "skip", "warning", deployment ? "No runtime URL or assigned port is recorded." : "Skipped because there is no deployment."));

        if (deployment) {
            const capabilities = Array.isArray(deployment.appTokenCapabilities) ? deployment.appTokenCapabilities : [];
            checks.push(deployment.appTokenHash
                ? check("platform_token", "Platform token", "pass", "blocker", "Deployment has a scoped platform token.", { capabilities })
                : check("platform_token", "Platform token", "warn", "warning", "Deployment has no scoped platform token; platform blocks may not work.", { capabilities }));
        } else {
            checks.push(check("platform_token", "Platform token", "skip", "warning", "Skipped because there is no deployment."));
        }

        if (input.probeRuntime && runtimeUrl) {
            const probe = await probeUrl(runtimeUrl);
            checks.push(probe.ok
                ? check("runtime_probe", "Runtime probe", "pass", "blocker", "Runtime responded to HTTP probe.", { status: probe.status })
                : check("runtime_probe", "Runtime probe", "fail", "blocker", "Runtime did not respond successfully to HTTP probe.", probe));
        } else {
            checks.push(check("runtime_probe", "Runtime probe", "skip", "warning", runtimeUrl ? "Runtime probe was not requested." : "Skipped because no runtime URL is available."));
        }

        const summary = countChecks(checks);
        const ready = checks.every(c => c.status !== "fail" || c.severity !== "blocker");
        return {
            ready,
            appId: app?.id,
            slug,
            organizationId: input.organizationId ?? deployment?.organizationId ?? ownerOrgId,
            runtimeUrl,
            checkedAt: new Date().toISOString(),
            checks,
            summary,
        };
    },

    async checkWorkspaceReadiness(slug: string, workspacePath: string): Promise<ReadinessCheck[]> {
        const checks: ReadinessCheck[] = [];
        const manifest = await readJson(path.join(workspacePath, "oddjob.manifest.json"));
        const pkg = await readJson(path.join(workspacePath, "package.json"));
        const blueprint = String(manifest?.blueprint ?? "");
        const hasDockerfile = await exists(path.join(workspacePath, "Dockerfile"));
        const backendStack = blueprint === "go-backend" || blueprint === "java-backend" || blueprint === "python-backend";

        if (backendStack) {
            const required = blueprint === "go-backend"
                ? ["go.mod", "main.go", "Dockerfile"]
                : blueprint === "java-backend"
                    ? ["pom.xml", "Dockerfile"]
                    : ["requirements.txt", "main.py", "Dockerfile"];
            const missing = [];
            for (const file of required) {
                if (!await exists(path.join(workspacePath, file))) missing.push(file);
            }
            checks.push(missing.length === 0
                ? check("workspace_files", "Workspace files", "pass", "blocker", "Required backend workspace files are present.", { blueprint })
                : check("workspace_files", "Workspace files", "fail", "blocker", "Required backend workspace files are missing.", { blueprint, missing }));
            checks.push(hasDockerfile
                ? check("build_artifact", "Build artifact", "pass", "warning", "Dockerfile is present for backend build.")
                : check("build_artifact", "Build artifact", "warn", "warning", "No Dockerfile is present for backend build."));
            return checks;
        }

        const launchProfile = await detectLaunchProfile(workspacePath);
        if (launchProfile === "node") {
            const entry = resolveNodeEntry(pkg ?? {});
            const missing: string[] = [];
            if (!pkg) missing.push("package.json");
            if (!pkg?.scripts?.start) missing.push("package.json scripts.start");
            if (!entry) missing.push("Node entry point");

            checks.push(missing.length === 0
                ? check("workspace_files", "Workspace files", "pass", "blocker", "Required Node workspace files and launch configuration are present.", { entry })
                : check("workspace_files", "Workspace files", "fail", "blocker", "Required Node workspace files or launch configuration are missing.", { missing, entry }));

            const hasEntry = !!entry && await exists(path.join(workspacePath, entry));
            checks.push(hasEntry
                ? check("build_artifact", "Build artifact", "pass", "warning", `Node entry point exists at ${entry}.`)
                : pkg?.scripts?.build
                    ? check("build_artifact", "Build artifact", "warn", "warning", "Node build output is not present yet; deploy will run the build.", { entry })
                    : check("build_artifact", "Build artifact", "fail", "blocker", "Node entry point is missing and no build script is available.", { entry }));
            return checks;
        }

        const entrypoints = ["pages/index.tsx", "app/page.tsx", "src/app/page.tsx", "src/pages/index.tsx"];
        const presentEntrypoints = [];
        for (const file of entrypoints) {
            if (await exists(path.join(workspacePath, file))) presentEntrypoints.push(file);
        }

        const missing = [];
        for (const file of ["package.json", "next.config.js", "tsconfig.json"]) {
            if (!await exists(path.join(workspacePath, file))) missing.push(file);
        }
        if (presentEntrypoints.length === 0) missing.push("Next.js entrypoint");
        if (!pkg?.scripts?.build) missing.push("package.json scripts.build");
        if (!pkg?.scripts?.start) missing.push("package.json scripts.start");
        if (!pkg?.dependencies?.next) missing.push("dependency next");
        if (!pkg?.dependencies?.react) missing.push("dependency react");

        checks.push(missing.length === 0
            ? check("workspace_files", "Workspace files", "pass", "blocker", "Required Next.js workspace files and scripts are present.", { entrypoints: presentEntrypoints })
            : check("workspace_files", "Workspace files", "fail", "blocker", "Required Next.js workspace files or scripts are missing.", { missing, entrypoints: presentEntrypoints }));

        const hasNextBuild = await exists(path.join(workspacePath, ".next"));
        checks.push(hasNextBuild || hasDockerfile
            ? check("build_artifact", "Build artifact", "pass", "warning", hasNextBuild ? "Next.js build artifact exists." : "Dockerfile exists for container build.")
            : check("build_artifact", "Build artifact", "warn", "warning", "No .next build artifact or Dockerfile was found; app may need a rebuild.", { slug }));

        return checks;
    },
};
