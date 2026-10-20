import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { assertOrgId } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";


function getCycleCoreRouteHref(cycleApp: any, orgId: number, embed = true): string | null {
    const sourceAppId = String(cycleApp?.sourceAppId ?? "").toLowerCase();
    const suffix = `${embed ? "embed=cycle&" : ""}orgId=${orgId}`;

    if (sourceAppId === "codegen-pipeline-dashboard") {
        return `/pipeline/sessions?${suffix}`;
    }

    if (sourceAppId === "codegen-quality-metrics") {
        return `/pipeline/metrics?${suffix}`;
    }

    return null;
}

function normalizeRouteSegment(value: unknown): string {
    return String(value ?? "")
        .trim()
        .replace(/^\/+|\/+$/g, "")
        .replace(/_/g, "-")
        .toLowerCase();
}

function getCycleAppMetadata(deployment: any, app: any) {
    return app?.runtimeMetadata?.cycleApp ?? app?.config?.cycleApp ?? deployment?.config?.cycleApp ?? null;
}

function getAppCycleLaunchPath(publicSlug: string, cycleApp: any): string {
    const basePath = `/app/${publicSlug}`;
    const blueprint = normalizeRouteSegment(cycleApp?.blueprint);
    const routePath = normalizeRouteSegment(cycleApp?.routePath);
    if (routePath) return `${basePath}/${routePath}`;
    if (!blueprint) return basePath;

    const normalizedPublicSlug = normalizeRouteSegment(publicSlug);
    const alreadyBlueprintScoped = normalizedPublicSlug === blueprint || normalizedPublicSlug.startsWith(`${blueprint}-`);
    return alreadyBlueprintScoped ? basePath : `${basePath}/${blueprint}`;
}

function getAppLaunchHref(deployment: any, app: any, orgId: number, projectKey?: string): string | null {
    const cycleApp = getCycleAppMetadata(deployment, app);
    const coreCycleHref = getCycleCoreRouteHref(cycleApp, orgId, true);
    if (coreCycleHref) return coreCycleHref;

    const slug = deployment?.publicSlug || app?.slug;
    if (slug) {
        const basePath = projectKey ? `/projects/${projectKey}/apps/${slug}` : `/app/${slug}`;
        const path = cycleApp ? getAppCycleLaunchPath(slug, cycleApp) : basePath;
        return cycleApp ? `${path}?embed=cycle` : path;
    }

    return null;
}

/** A launchable target in this org, as the catalog knows it. */
export interface OrgAppTarget {
    slug: string;
    title: string;
    href: string;
    source: "app" | "agent_ai";
    projectId?: number | null;
    /** Set for `app` targets — the deployment/app rows the room's App Studio canvas mounts. */
    appId?: number;
    deploymentId?: number;
    publicSlug?: string | null;
}

/** Loose comparison key: case, punctuation and word order noise removed. */
function matchKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Every app and agent deployment in an org, with the href that actually opens it.
 *
 * Shared with render_app_surface so a launch card can be validated against what
 * exists. Deliberately not the full list_installed_apps catalog — advertised
 * marketplace apps and blueprint templates are not launch targets, and including
 * them would let a hallucinated slug validate against a template it does not
 * mean.
 */
export async function listOrgAppTargets(orgId: number, projectKey?: string): Promise<OrgAppTarget[]> {
    const { pool } = await import("@server/database_service.js");

    const [appResult, agentResult] = await Promise.all([
        pool.query(
            `SELECT d.id AS "deploymentId", d.public_slug AS "publicSlug", d.config AS "deploymentConfig", d.project_id AS "projectId",
                    a.id AS "appId", a.name AS "name", a.slug AS "slug", a.config AS "appConfig",
                    a.runtime_metadata AS "runtimeMetadata"
               FROM app_deployments d
               INNER JOIN apps a ON d.app_id = a.id
              WHERE d.organization_id = $1`,
            [orgId],
        ),
        pool.query(
            `SELECT slug, title, project_id AS "projectId" FROM agent_deployments
              WHERE organization_id = $1 AND is_active = true`,
            [orgId],
        ),
    ]);

    const targets: OrgAppTarget[] = [];

    for (const row of appResult.rows as any[]) {
        const deployment = { publicSlug: row.publicSlug, config: row.deploymentConfig };
        const app = {
            name: row.name,
            slug: row.slug,
            config: row.appConfig,
            runtimeMetadata: row.runtimeMetadata,
        };
        const href = getAppLaunchHref(deployment, app, orgId, projectKey);
        if (!href) continue;
        targets.push({
            slug: row.publicSlug ?? row.slug,
            title: row.name ?? row.slug,
            href,
            source: "app",
            projectId: row.projectId,
            appId: row.appId,
            deploymentId: row.deploymentId,
            publicSlug: row.publicSlug ?? null,
        });
    }

    for (const row of agentResult.rows as any[]) {
        targets.push({
            slug: row.slug,
            title: row.title ?? row.slug,
            href: projectKey ? `/projects/${projectKey}/agents/${row.slug}` : `/a/${row.slug}`,
            source: "agent_ai",
            projectId: row.projectId,
        });
    }

    // Built-in Platform System Targets (Documentation, X-Ray Canvas, Signal Intelligence)
    targets.push({
        slug: "xray-canvas",
        title: "Component Dependency Flow & X-Ray Canvas",
        href: "/platform-maintenance/documentation?tab=xray&appId=chaos-drill",
        source: "app",
        projectId: 0,
    });
    targets.push({
        slug: "platform-documentation",
        title: "Platform Documentation & Change Register",
        href: "/platform-maintenance/documentation",
        source: "app",
        projectId: 0,
    });
    targets.push({
        slug: "signal-intelligence",
        title: "Signal Intelligence & Uber H3 Hexagonal Spatial Map",
        href: "/signal-intelligence",
        source: "app",
        projectId: 0,
    });

    return targets;
}

/**
 * The catalog entry an agent meant, given whatever it passed.
 *
 * Matching order is strongest evidence first: an exact slug, then an href, then
 * the display title. The title fallback is the one that matters in practice —
 * models slugify the title they just read ("Research & RFC Synthesis Portal
 * (Org 1)" → "research-rfc-synthesis-portal-org-1") instead of using the slug
 * the catalog returned, producing a card that 404s on click.
 *
 * Returns null when nothing matches, which the caller must treat as "do not
 * render a card" rather than "render it anyway".
 */
export function resolveOrgAppTarget(
    targets: OrgAppTarget[],
    hint: { slug?: string; href?: string; title?: string },
): OrgAppTarget | null {
    const bySlug = hint.slug ? matchKey(hint.slug) : null;
    if (bySlug) {
        const hit = targets.find((t) => matchKey(t.slug) === bySlug);
        if (hit) return hit;
    }

    if (hint.href) {
        const hrefKey = hint.href.split(/[?#]/)[0].replace(/\/+$/, "");
        const hit = targets.find((t) => t.href.split(/[?#]/)[0].replace(/\/+$/, "") === hrefKey);
        if (hit) return hit;
    }

    // A slugified title matches the title, not the slug — compare on the same
    // normalised key so "research-rfc-synthesis-portal-org-1" finds
    // "Research & RFC Synthesis Portal (Org 1)".
    for (const candidate of [hint.title, hint.slug].filter(Boolean) as string[]) {
        const key = matchKey(candidate);
        const hit = targets.find((t) => matchKey(t.title) === key);
        if (hit) return hit;
    }

    return null;
}

function getAppRelationshipMetadata(deployment: any, app: any) {
    const cycleApp = getCycleAppMetadata(deployment, app);
    return {
        blueprint: cycleApp?.blueprint ?? app?.blueprintSlug ?? app?.blueprint ?? null,
        cycleSlug: cycleApp?.sourceCycleSlug ?? null,
        cycleName: cycleApp?.sourceCycleName ?? null,
        routePath: cycleApp?.routePath ?? null,
        sourceAppId: cycleApp?.sourceAppId ?? null,
        sourceAppName: cycleApp?.sourceAppName ?? null,
    };
}

export const APP_FORGE_TOOLS: Record<string, ToolDefinition> = {
    scaffold_mini_app: {
        name: "scaffold_mini_app",

        idempotency: "none",
        label: "Scaffold Mini App",
        group: "App Forge",
        description: "Creates a new mini-app from a blueprint template and registers it in the app registry.",
        parameters: z.object({
            blueprint: z.string().describe("Blueprint slug (e.g. 'chat-assistant', 'copilotkit-starter')"),
            name: z.string().describe("Display name for the app"),
            slug: z.string().describe("URL-safe slug for the app"),
            description: z.string().optional().describe("Short description of the app"),
            theme: z.string().optional().describe("Visual theme name"),
            oddjobMissionId: z.number().optional().describe("Mission ID to link with this app"),
        }),
        execute: async ({ blueprint, name, slug, description, theme, oddjobMissionId }, context) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            const result = await appForgeService.forgeApp(blueprint, {
                name,
                slug,
                description: description || "",
                theme,
                oddjobMissionId: oddjobMissionId || (context?.missionId ? Number(context.missionId) : 0),
                missionRunId: context?.missionRunId ? Number(context.missionRunId) : undefined,
                organizationId: context?.organizationId ?? undefined
            });
            return result;
        }
    },

    search_hil_context: {
        name: "search_hil_context",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search HIL Context",
        group: "App Forge",
        description: "Searches past Human-in-the-Loop decisions for relevant context.",
        parameters: z.object({
            query: z.string().describe("Search query for HIL decisions"),
            limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
        }),
        execute: async ({ query, limit = 10 }, context) => {
            const { db } = await import("@server/database_service.js");
            const { approvalRequests } = await import("@shared/schema/hil.js");
            const { sql, eq } = await import("drizzle-orm");

            const conditions: any[] = [
                sql`${approvalRequests.comments} ilike ${'%' + query + '%'}`
            ];

            if (context?.organizationId) {
                conditions.push(eq(approvalRequests.organizationId, context.organizationId));
            }

            const { and } = await import("drizzle-orm");
            const rows = await db.select({
                id: approvalRequests.id,
                status: approvalRequests.status,
                comments: approvalRequests.comments,
                decisionAt: approvalRequests.decisionAt,
                modifiedOutput: approvalRequests.modifiedOutput,
            })
                .from(approvalRequests)
                .where(and(...conditions))
                .limit(limit);

            return { results: rows, count: rows.length };
        }
    },

    forge_edit_file: {
        name: "forge_edit_file",

        idempotency: "none",
        label: "Forge: Edit File",
        group: "App Forge",
        description: "Edits or creates a file in the forge workspace.",
        parameters: z.object({
            slug: z.string().describe("The app slug/folder name"),
            filePath: z.string().describe("Relative path within the app folder"),
            content: z.string().describe("Full content of the file")
        }),
        execute: async ({ slug, filePath, content }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            return await appForgeService.editFile(slug, filePath, content);
        }
    },

    forge_npm_command: {
        name: "forge_npm_command",

        idempotency: "none",
        riskLevel: "high",
        label: "Forge: NPM Command",
        group: "App Forge",
        description: "Runs an NPM command (install, build, test) in the forge workspace.",
        parameters: z.object({
            slug: z.string().describe("The app slug/folder name"),
            command: z.string().describe("The npm subcommand (e.g. 'install', 'run build')"),
        }),
        execute: async ({ slug, command }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            const parts = command.split(' ');
            return await appForgeService.runCommand(slug, "npm", parts);
        }
    },

    // ─── Build Hardening Skills ───────────────────────────────────────────────

    forge_sanitize_deps: {
        name: "forge_sanitize_deps",

        idempotency: "idempotent",
        label: "Forge: Sanitize Dependencies",
        group: "App Forge",
        description: "Strips AI-hallucinated or internal packages from a forge workspace's package.json. Uses the blueprint as the source-of-truth allowlist, supplemented by known-safe library versions. Call this after AI codegen and before Docker build.",
        parameters: z.object({
            slug: z.string().describe("The app slug/folder name in the forge workspace"),
            blueprintSlug: z.string().describe("The blueprint slug used to scaffold this app"),
        }),
        execute: async ({ slug, blueprintSlug }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            return await appForgeService.sanitizeDependencies(slug, blueprintSlug);
        }
    },

    forge_inject_build_config: {
        name: "forge_inject_build_config",

        idempotency: "idempotent",
        label: "Forge: Inject Build Config",
        group: "App Forge",
        description: "Injects required build configuration into a forge workspace: next.config.js (with ignoreBuildErrors), tsconfig.json (with path aliases), src/lib/utils.ts (cn helper), and copies domain UI components/hooks. Call this before Docker build.",
        parameters: z.object({
            slug: z.string().describe("The app slug/folder name in the forge workspace"),
            blueprintSlug: z.string().optional().describe("Blueprint to use for injecting config (e.g. 'chat-assistant')")
        }),
        execute: async ({ slug, blueprintSlug }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            return await appForgeService.injectBuildConfig(slug, blueprintSlug || "default");
        }
    },

    forge_validate_workspace: {
        name: "forge_validate_workspace",

        idempotency: "read-safe",
        label: "Forge: Validate Workspace",
        group: "App Forge",
        description: "Pre-flight validation of a forge workspace before Docker build. Checks for required files (package.json, Dockerfile, next.config.js, tsconfig.json, src/lib/utils.ts, pages/index.tsx), build scripts, core dependencies, and ignoreBuildErrors config. Returns a list of issues if any are found.",
        parameters: z.object({
            slug: z.string().describe("The app slug/folder name in the forge workspace"),
        }),
        execute: async ({ slug }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            return await appForgeService.validateWorkspace(slug);
        }
    },

    // ─── App Studio Tools ─────────────────────────────────────────────────────

    mount_app_studio: {
        name: "mount_app_studio",

        idempotency: "read-safe",
        label: "Mount App Studio (Forge / Builder)",
        group: "App Forge",
        description:
            "Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for " +
            "inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the " +
            "build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is " +
            "read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns " +
            "an app that already exists, because regenerating a working app discards the author's work. " +
            // A room asked to "open form studio" got App Studio's Forge launchpad titled "Form Studio".
            "Not for forms: App Studio builds applications. Forms, with their scoring, decisions and results, open in " +
            "Form Studio through mount_form_studio.",
        parameters: z.object({
            mode: z.enum(["forge", "builder"]).describe("'forge' creates a new app; 'builder' evolves an existing one"),
            appId: z.number().int().optional().describe("Numeric id of the app to open in builder mode"),
            appName: z.string().optional().describe("Name or slug of the app, when the id is unknown"),
            view: z.enum(["preview", "api", "diagnostics", "publish"]).optional().default("preview")
                .describe("Which studio view to open on"),
            title: z.string().optional().describe("Working title for a new app in forge mode"),
            requirements: z.string().optional().describe("What the new app must do, in forge mode"),
            jobId: z.string().optional().describe("Forge job to attach to; discovered automatically when omitted"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                // No `|| 1`. A missing org here would mount another tenant's app
                // into this room, so an absent context has to fail loudly.
                const orgId = assertOrgId(context?.organizationId);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");

                if (params.mode === "builder") {
                    /*
                     * Resolution is scoped to the org's own deployments rather
                     * than going through appRegistryService.getApp, which looks
                     * an app up by id or slug across every tenant. Passing an id
                     * straight to it would open an app this org does not have.
                     */
                    const rows = await appRegistryService.listOrgDeployments(orgId);
                    const wanted = String(params.appName ?? "").trim().toLowerCase();
                    const match = rows.find((r: any) => {
                        if (params.appId && r.app?.id === params.appId) return true;
                        if (!wanted) return false;
                        return (
                            String(r.app?.name ?? "").toLowerCase() === wanted ||
                            String(r.app?.slug ?? "").toLowerCase() === wanted ||
                            String(r.deployment?.publicSlug ?? "").toLowerCase() === wanted
                        );
                    });

                    if (!match) {
                        // Naming what IS available beats "app not found": the
                        // model's next move is otherwise to invent another name.
                        const available = rows.map((r: any) => r.app?.name).filter(Boolean).slice(0, 15);
                        return (
                            `No app in this organization matches ${params.appId ?? params.appName ?? "that reference"}. ` +
                            (available.length
                                ? `Available apps: ${available.join(", ")}.`
                                : `This organization has no installed apps yet — use mode 'forge' to create one.`)
                        );
                    }

                    return JSON.stringify({
                        type: "app_studio_pod",
                        module: "AppStudioPod",
                        component: "AppStudioPod",
                        mode: "builder",
                        view: params.view ?? "preview",
                        appId: match.app.id,
                        appName: match.app.name,
                        appSlug: match.app.slug,
                        publicSlug: match.deployment?.publicSlug ?? null,
                        status: match.deployment?.status ?? match.app?.status ?? null,
                        props: {
                            mode: "builder",
                            view: params.view ?? "preview",
                            appId: match.app.id,
                            appName: match.app.name,
                            appSlug: match.app.slug,
                            publicSlug: match.deployment?.publicSlug ?? null,
                            status: match.deployment?.status ?? match.app?.status ?? null,
                        },
                    });
                }

                /*
                 * Forge mode. Attaching to a job the org already has running is
                 * what makes "continue the build" work after a refresh or a
                 * hand-off into the room — the same three-tier recovery the App
                 * Forge page does, minus the browser-local tiers, which are not
                 * visible from here.
                 */
                let jobId: string | null = params.jobId ?? null;
                let jobStatus: string | null = null;
                let jobName: string | null = null;
                const isNewAppRequest = Boolean(params.title || params.requirements);
                if (!jobId && !isNewAppRequest) {
                    try {
                        const { forgeDraftService } = await import("../../../apps/core/forge-draft.service.js");
                        const activeStatuses = new Set([
                            "queued", "running", "building",
                            "awaiting_strategy_approval", "awaiting_architecture_approval", "awaiting_wave_approval",
                        ]);
                        const drafts = await forgeDraftService.listDrafts(orgId, 25);
                        const active = drafts.find((d: any) => activeStatuses.has(d.status));
                        if (active) {
                            jobId = active.jobId;
                            jobStatus = active.status;
                            jobName = active.name ?? null;
                        }
                    } catch {
                        // A studio that mounts without a job is still useful —
                        // it shows the request and waits. Failing the mount
                        // because recovery failed would be worse.
                    }
                }

                return JSON.stringify({
                    type: "app_studio_pod",
                    module: "AppStudioPod",
                    component: "AppStudioPod",
                    mode: "forge",
                    view: params.view ?? "preview",
                    title: params.title ?? jobName ?? "New Application",
                    requirements: params.requirements ?? null,
                    jobId,
                    jobStatus,
                    props: {
                        mode: "forge",
                        view: params.view ?? "preview",
                        title: params.title ?? jobName ?? "New Application",
                        requirements: params.requirements ?? null,
                        jobId,
                        jobStatus,
                    },
                });
            } catch (err: any) {
                return `Error mounting App Studio: ${err.message}`;
            }
        }
    },

    inspect_app_scaffold: {
        name: "inspect_app_scaffold",

        idempotency: "read-safe",
        label: "Inspect an app's scaffold",
        group: "App Forge",
        description:
            "Reads an existing app's workspace and classifies it as gallery-native, gallery-compatible, legacy, " +
            "custom or unhealthy, with the files a migration could touch and the bespoke files it must not.",
        parameters: z.object({
            appId: z.number().int().describe("Numeric id of the app to inspect"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = assertOrgId(context?.organizationId);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const rows = await appRegistryService.listOrgDeployments(orgId);
                const match = rows.find((r: any) => r.app?.id === params.appId);
                if (!match) {
                    return `App ${params.appId} is not installed in this organization.`;
                }

                const { inspectScaffold, classifyScaffold } = await import("../../../apps/core/scaffold-inspector.service.js");
                const inspection = await inspectScaffold(match.app.slug);
                const verdict = classifyScaffold(inspection);

                return JSON.stringify({
                    appId: match.app.id,
                    appName: match.app.name,
                    classification: verdict.classification,
                    reasons: verdict.reasons,
                    migratableFiles: verdict.migratableFiles,
                    preserveFiles: verdict.preserveFiles,
                    uiFiles: inspection.uiFiles.length,
                    pages: inspection.pages.length,
                    apiRoutes: inspection.apiRoutes.length,
                    hasSemanticTokens: inspection.hasSemanticTokens,
                    truncated: inspection.truncated,
                });
            } catch (err: any) {
                return `Error inspecting the scaffold: ${err.message}`;
            }
        }
    },

    propose_gallery_migration: {
        name: "propose_gallery_migration",

        idempotency: "read-safe",
        label: "Propose a Component Gallery migration",
        group: "App Forge",
        description:
            "Inspects an app, snapshots the files a migration would touch, and returns the proposed change as a diff. " +
            "Applies nothing — the author reviews first.",
        parameters: z.object({
            appId: z.number().int().describe("Numeric id of the app to migrate"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireToolOrgId(context);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const rows = await appRegistryService.listOrgDeployments(orgId);
                const match = rows.find((r: any) => r.app?.id === params.appId);
                if (!match) return `App ${params.appId} is not installed in this organization.`;

                const { inspectScaffold, classifyScaffold } = await import("../../../apps/core/scaffold-inspector.service.js");
                const verdict = classifyScaffold(await inspectScaffold(match.app.slug));

                if (verdict.classification === "unhealthy") {
                    return `${match.app.name} does not currently run: ${verdict.reasons.join(" ")} Migrating it would produce a broken app with different code in it, so nothing was proposed.`;
                }
                if (verdict.migratableFiles.length === 0) {
                    return verdict.classification === "custom"
                        ? `${match.app.name} is bespoke UI. Nothing was proposed — say explicitly which files you want changed.`
                        : `${match.app.name} is already drawing from the gallery; there is nothing to migrate.`;
                }

                const { proposeGalleryMigration, renderMigrationDiff } = await import("../../../apps/core/gallery-migration.service.js");
                const proposal = await proposeGalleryMigration(
                    match.app.slug,
                    verdict.migratableFiles,
                    verdict.preserveFiles,
                );

                /*
                 * The snapshot is taken now, before anything is applied, and
                 * covers exactly the files the proposal would rewrite. Taking it
                 * at apply time would be too late if the apply is what fails.
                 */
                const { captureSnapshot } = await import("../../../apps/core/workspace-snapshot.service.js");
                const snapshot = await captureSnapshot(
                    match.app.slug,
                    proposal.files.filter((f) => f.changed).map((f) => f.path),
                    `Before gallery migration of ${match.app.name}`,
                );

                return JSON.stringify({
                    appId: match.app.id,
                    appName: match.app.name,
                    classification: verdict.classification,
                    snapshotId: snapshot?.id ?? null,
                    filesChanged: proposal.filesChanged,
                    needsReview: proposal.needsReview,
                    preserved: proposal.skipped,
                    diffs: proposal.files
                        .filter((f) => f.changed)
                        .map((f) => ({ path: f.path, diff: renderMigrationDiff(f) })),
                    reviewNotes: proposal.files.flatMap((f) =>
                        f.notes.filter((n) => n.kind === "needs-review").map((n) => ({ path: f.path, detail: n.detail })),
                    ),
                });
            } catch (err: any) {
                return `Error proposing the migration: ${err.message}`;
            }
        }
    },

    apply_gallery_migration: {
        name: "apply_gallery_migration",

        idempotency: "none",
        label: "Apply an approved gallery migration",
        group: "App Forge",
        description:
            "Applies a migration previously proposed for this app, verifies the result, and rolls the whole thing " +
            "back if verification fails. Requires the snapshot id returned by propose_gallery_migration.",
        parameters: z.object({
            appId: z.number().int().describe("Numeric id of the app to migrate"),
            snapshotId: z.string().min(1).describe("Snapshot id from propose_gallery_migration"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireToolOrgId(context);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const rows = await appRegistryService.listOrgDeployments(orgId);
                const match = rows.find((r: any) => r.app?.id === params.appId);
                if (!match) return `App ${params.appId} is not installed in this organization.`;

                const { readSnapshot, restoreSnapshot } = await import("../../../apps/core/workspace-snapshot.service.js");
                const snapshot = await readSnapshot(match.app.slug, params.snapshotId);
                if (!snapshot) {
                    return `No snapshot ${params.snapshotId} for ${match.app.name}. Propose the migration again to get a fresh one.`;
                }

                const { applyGalleryMigration, verifyMigration } = await import("../../../apps/core/gallery-migration.service.js");
                const application = await applyGalleryMigration(match.app.slug, snapshot.files);

                /*
                 * Verify, then roll the WHOLE migration back if it did not hold.
                 * A partial migration is the worst outcome available: half the
                 * app moved onto the gallery and the author cannot tell which
                 * half, so a failure restores everything the snapshot covers.
                 */
                let rolledBack = false;
                const verification = await verifyMigration(match.app.slug, application.applied);
                if (!verification.ok) {
                    await restoreSnapshot(match.app.slug, params.snapshotId);
                    rolledBack = true;
                }

                const summary = rolledBack
                    ? `Migration rolled back — verification failed: ${verification.blocking.join(" ")}`
                    : application.applied.length === 0
                      ? "Nothing was migrated."
                      : `Migrated ${application.applied.length} file(s) onto the gallery. ` +
                        `${verification.filesWithFindings} of ${verification.scanned} UI files still have findings, ` +
                        `which is expected where controls need restructuring rather than renaming.` +
                        (application.stale.length > 0
                            ? ` ${application.stale.length} file(s) changed since the proposal and were left alone.`
                            : "");

                return JSON.stringify({
                    type: "app_studio_pod",
                    module: "AppStudioPod",
                    component: "AppStudioPod",
                    mode: "builder",
                    view: "preview",
                    appId: match.app.id,
                    appName: match.app.name,
                    appSlug: match.app.slug,
                    publicSlug: match.deployment?.publicSlug ?? null,
                    status: match.deployment?.status ?? null,
                    lastChange: {
                        status: rolledBack ? "failed" : application.applied.length === 0 ? "no_changes" : "applied",
                        summary,
                        filesWritten: rolledBack ? 0 : application.applied.length,
                        // The snapshot outlives a successful apply, so the whole
                        // migration stays reversible after the fact.
                        canRevert: !rolledBack && application.applied.length > 0,
                        snapshotId: params.snapshotId,
                        // Changing this reloads the preview without resetting the
                        // studio around it.
                        appliedAt: new Date().toISOString(),
                        stale: application.stale,
                        failed: application.failed,
                    },
                });
            } catch (err: any) {
                return `Error applying the migration: ${err.message}`;
            }
        }
    },

    start_app_forge: {
        name: "start_app_forge",

        idempotency: "none",
        label: "Start an App Forge build",
        group: "App Forge",
        description:
            "Begins a forge run for a new application and returns the studio attached to it. " +
            "Provisions a container and runs the full generation pipeline, so it is dispatched only after the author confirms.",
        parameters: z.object({
            name: z.string().min(1).describe("Display name for the new application"),
            description: z.string().min(1).describe("What the application must do"),
            blueprint: z.string().optional().describe("Blueprint slug; the pipeline selects one when omitted"),
            slug: z.string().optional().describe("URL-safe slug; derived from the name when omitted"),
            projectId: z.number().int().optional(),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = assertOrgId(context?.organizationId);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const { startForgeRun, deriveForgeSlug } = await import("../../../apps/core/forge-start.service.js");

                // A room has no wizard to pick a slug, so derive one and step
                // around the names this org already uses rather than colliding
                // with a live app and being refused by the concurrency guard.
                let slug = typeof params.slug === "string" && params.slug.trim() ? params.slug.trim() : "";
                if (!slug) {
                    const rows = await appRegistryService.listOrgDeployments(orgId);
                    const taken = new Set<string>(
                        rows.flatMap((r: any) => [r.app?.slug, r.deployment?.publicSlug].filter(Boolean)),
                    );
                    slug = deriveForgeSlug(params.name, taken);
                }

                const result = await startForgeRun({
                    name: params.name,
                    slug,
                    description: params.description,
                    blueprint: params.blueprint,
                    organizationId: orgId,
                    projectId: params.projectId ?? null,
                });

                if (!result.started) {
                    // No executor is a different answer from a clash, and the
                    // author can act on only one of them.
                    if (result.reason === "no_executor") {
                        return `I could not start the build: ${result.detail}`;
                    }
                    return (
                        `A forge run is already building "${result.slug}"` +
                        `${result.existingJobId ? ` (job ${result.existingJobId})` : ""}. ` +
                        `Wait for it to finish or cancel it before starting another.`
                    );
                }

                return JSON.stringify({
                    type: "app_studio_pod",
                    module: "AppStudioPod",
                    component: "AppStudioPod",
                    mode: "forge",
                    view: "preview",
                    title: params.name,
                    requirements: params.description,
                    jobId: result.jobId,
                    jobStatus: "queued",
                    props: {
                        mode: "forge",
                        view: "preview",
                        title: params.name,
                        requirements: params.description,
                        jobId: result.jobId,
                        jobStatus: "queued",
                    },
                });
            } catch (err: any) {
                return `Error starting the build: ${err.message}`;
            }
        }
    },

    apply_app_change: {
        name: "apply_app_change",

        idempotency: "none",
        label: "Apply a change to a mounted app",
        group: "App Forge",
        description:
            "Applies a described change to an app already open in the App Studio, then rebuilds it. " +
            "Returns the studio surface with the outcome attached, so the mounted pod reflects the result.",
        parameters: z.object({
            appId: z.number().int().describe("Numeric id of the app to change"),
            instruction: z.string().min(1).describe("What to change, in the author's own words"),
            view: z.enum(["preview", "api", "diagnostics", "publish"]).optional().default("preview"),
            galleryMigration: z.boolean().optional()
                .describe("This change is a Component Gallery migration; measure conformance before and after"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = assertOrgId(context?.organizationId);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");

                // Same org-scoped resolution as mount_app_studio, and for the same
                // reason: getApp finds an app by id across every tenant, and this
                // one WRITES to the workspace it resolves.
                const rows = await appRegistryService.listOrgDeployments(orgId);
                const match = rows.find((r: any) => r.app?.id === params.appId);
                if (!match) {
                    return `App ${params.appId} is not installed in this organization, so nothing was changed.`;
                }

                const { appBuilderService } = await import("../../../apps/app-builder.service.js");
                const { auditWorkspaceGallery, describeGalleryAudit } = await import("../../../apps/core/gallery-audit.service.js");

                /*
                 * A migration is the one case where the starting point matters:
                 * "conformance improved" is only a claim worth making against a
                 * measured before. Every other change is measured after only.
                 */
                const before = params.galleryMigration ? await auditWorkspaceGallery(match.app.slug) : null;

                const result = await appBuilderService.enhanceApp(
                    params.appId,
                    match.app.slug,
                    params.instruction,
                    orgId,
                );

                /*
                 * Four outcomes, reported as four different things rather than as
                 * `success: true/false`. "Wrote nothing" and "wrote three files"
                 * are both successes to enhanceApp, and collapsing them is how an
                 * author ends up believing a change landed when it did not.
                 */
                const filesWritten = result.filesWritten ?? 0;
                let status: string;
                let summary: string;
                if (result.conversational) {
                    status = "answered";
                    summary = result.message || "Answered without changing any files.";
                } else if (result.buildFailed || result.recoverable) {
                    status = "build_failed";
                    summary = `Changes were written to ${filesWritten} file(s), but the rebuild failed: ${result.error || "unknown error"}.`;
                } else if (!result.success) {
                    status = "failed";
                    summary = result.error || "The change could not be applied.";
                } else if (filesWritten === 0) {
                    status = "no_changes";
                    summary = "Nothing was changed — no file matched that request.";
                } else {
                    status = "applied";
                    summary = `Applied to ${filesWritten} file(s). The app is restarting.`;
                }

                /*
                 * Measure what the change actually did to gallery conformance.
                 *
                 * Only when files moved: an answered question or a refusal wrote
                 * nothing, and re-reporting conformance there would attach a
                 * number to a change that never happened. A migration is also
                 * the only case with a `before` to compare against — see
                 * describeGalleryAudit, which will not state a delta without one.
                 */
                let gallery: Record<string, unknown> | null = null;
                if (filesWritten > 0) {
                    const after = await auditWorkspaceGallery(match.app.slug);
                    const note = describeGalleryAudit(after, before);
                    if (note) summary = `${summary} ${note}`;
                    gallery = {
                        scanned: after.scanned,
                        filesWithFindings: after.filesWithFindings,
                        filesOutsideGallery: after.filesOutsideGallery,
                        truncated: after.truncated,
                        ...(before ? { before: { filesWithFindings: before.filesWithFindings, scanned: before.scanned } } : {}),
                    };
                }

                return JSON.stringify({
                    type: "app_studio_pod",
                    module: "AppStudioPod",
                    component: "AppStudioPod",
                    mode: "builder",
                    view: params.view ?? "preview",
                    appId: match.app.id,
                    appName: match.app.name,
                    appSlug: match.app.slug,
                    publicSlug: match.deployment?.publicSlug ?? null,
                    status: match.deployment?.status ?? null,
                    lastChange: {
                        status,
                        summary,
                        instruction: params.instruction,
                        filesWritten,
                        // Identifies THIS dispatch. The pod keys the builder off
                        // it to reload the workspace it just changed; without a
                        // per-dispatch value, asking for the same change twice
                        // would leave stale files on screen the second time.
                        appliedAt: new Date().toISOString(),
                        // Only claim an undo when a backup actually exists. An
                        // offer the room cannot honour is worse than no offer.
                        canRevert: Boolean(result.backupAvailable) || (status === "applied" && filesWritten > 0),
                        ...(gallery ? { gallery } : {}),
                    },
                });
            } catch (err: any) {
                return `Error applying the change: ${err.message}`;
            }
        }
    },

    revert_app_change: {
        name: "revert_app_change",

        idempotency: "none",
        label: "Revert the last app change",
        group: "App Forge",
        description:
            "Restores the workspace backup taken before the last applied change. Use when the author asks to undo.",
        parameters: z.object({
            appId: z.number().int().describe("Numeric id of the app to revert"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = assertOrgId(context?.organizationId);
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                const rows = await appRegistryService.listOrgDeployments(orgId);
                const match = rows.find((r: any) => r.app?.id === params.appId);
                if (!match) {
                    return `App ${params.appId} is not installed in this organization, so nothing was reverted.`;
                }

                const { appBuilderService } = await import("../../../apps/app-builder.service.js");
                const result = await appBuilderService.revertLast(params.appId, match.app.slug);

                return JSON.stringify({
                    type: "app_studio_pod",
                    module: "AppStudioPod",
                    component: "AppStudioPod",
                    mode: "builder",
                    view: "preview",
                    appId: match.app.id,
                    appName: match.app.name,
                    appSlug: match.app.slug,
                    publicSlug: match.deployment?.publicSlug ?? null,
                    status: match.deployment?.status ?? null,
                    lastChange: {
                        status: result.success ? "reverted" : "failed",
                        summary: result.success
                            ? `Reverted ${result.filesRestored ?? 0} file(s) to the state before the last change.`
                            : result.error || "Revert failed.",
                        filesWritten: result.filesRestored ?? 0,
                        appliedAt: new Date().toISOString(),
                        // One backup deep. After a revert there is nothing further
                        // to undo, and saying otherwise invites a second attempt
                        // that would fail.
                        canRevert: false,
                    },
                });
            } catch (err: any) {
                return `Error reverting the change: ${err.message}`;
            }
        }
    },

    studio_list_files: {
        name: "studio_list_files",

        idempotency: "read-safe",
        label: "Studio: List App Files",
        group: "App Forge",
        description: "Lists the file tree of a forged app's workspace. Skips node_modules, .next, dist, and .git. Returns a nested tree of files and directories with sizes and extensions. Useful for understanding an app's scaffold before making targeted edits.",
        parameters: z.object({
            slug: z.string().describe("The app slug (e.g. 'my-dashboard')"),
        }),
        execute: async ({ slug }) => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            const workspacePath = path.default.resolve("storage/forge-workspace", slug);
            const SKIP = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache"]);

            async function walk(dir: string, rel: string): Promise<any[]> {
                let entries: any[];
                try { entries = await fs.default.readdir(dir, { withFileTypes: true }); } catch { return []; }
                const nodes: any[] = [];
                for (const e of entries) {
                    if (SKIP.has(e.name)) continue;
                    const full = path.default.join(dir, e.name);
                    const relPath = (rel ? rel + "/" : "") + e.name;
                    if (e.isDirectory()) {
                        nodes.push({ name: e.name, path: relPath, type: "dir", children: await walk(full, relPath) });
                    } else {
                        const stat = await fs.default.stat(full).catch(() => ({ size: 0 }));
                        nodes.push({ name: e.name, path: relPath, type: "file", ext: path.default.extname(e.name).slice(1), size: (stat as any).size });
                    }
                }
                return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
            }

            try {
                await fs.default.access(workspacePath);
                const tree = await walk(workspacePath, "");
                return JSON.stringify({ slug, tree });
            } catch {
                return JSON.stringify({ error: `Workspace not found for slug: ${slug}` });
            }
        }
    },

    studio_read_file: {
        name: "studio_read_file",

        idempotency: "read-safe",
        label: "Studio: Read App File",
        group: "App Forge",
        description: "Reads the content of a specific file from a forged app's workspace. Use studio_list_files first to discover available paths. Returns raw file content as a string.",
        parameters: z.object({
            slug: z.string().describe("The app slug"),
            filePath: z.string().describe("Relative file path within the workspace (e.g. 'pages/index.tsx')"),
        }),
        execute: async ({ slug, filePath }) => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            const workspacePath = path.default.resolve("storage/forge-workspace", slug);
            const fullPath = path.default.join(workspacePath, filePath);
            if (!fullPath.startsWith(workspacePath)) return JSON.stringify({ error: "Invalid path" });
            try {
                const content = await fs.default.readFile(fullPath, "utf-8");
                return JSON.stringify({ slug, path: filePath, content });
            } catch {
                return JSON.stringify({ error: `File not found: ${filePath}` });
            }
        }
    },

    studio_enhance_app: {
        name: "studio_enhance_app",

        idempotency: "none",
        label: "Studio: Enhance App",
        group: "App Forge",
        description: "Applies AI-generated code changes to a forged app, then rebuilds and restarts its container. Provide a natural language instruction describing the desired change. Returns the number of files written and success status.",
        parameters: z.object({
            appId: z.number().int().describe("The numeric app ID"),
            instruction: z.string().describe("Natural language description of the change to apply (e.g. 'Add a dark mode toggle to the header')"),
        }),
        execute: async ({ appId, instruction }, context) => {
            const { appBuilderService } = await import("../../../apps/app-builder.service.js");
            const { appRegistryService } = await import("../../../apps/app-registry.service.js");
            const app = await appRegistryService.getApp(appId);
            const result = await appBuilderService.enhanceApp(appId, (app as any).slug, instruction, context?.organizationId ?? undefined);
            return JSON.stringify(result);
        }
    },

    diagnose_forge_job: {
        name: "diagnose_forge_job",

        idempotency: "read-safe",
        label: "Diagnose Forge Job",
        group: "App Forge",
        description: "Performs a forensic diagnostic of an App Forge job using its ID. Correlates Redis state, database records, and event logs to identify hangs, desyncs, or silent failures.",
        parameters: z.object({
            jobId: z.string().describe("The UUID of the forge job to diagnose"),
        }),
        execute: async ({ jobId }) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            const report = await appForgeService.diagnoseJob(jobId);
            return JSON.stringify(report, null, 2);
        }
    },

    forge_trigger: {
        name: "forge_trigger",

        idempotency: "none",
        label: "Forge Trigger (Recursive Spawn)",
        group: "App Forge",
        description: "Recursively spawns a sub-app to handle a specific feature gap or sub-task. Increments the forge depth to prevent infinite loops. Use this when a larger app requires a specialized micro-service or sub-module that doesn't yet exist.",
        parameters: z.object({
            blueprint: z.string().describe("Blueprint slug (e.g. 'chat-assistant', 'react-native')"),
            name: z.string().describe("Display name for the sub-app"),
            slug: z.string().describe("URL-safe slug for the sub-app"),
            description: z.string().describe("Detailed description of the sub-task for the sub-app"),
            missionId: z.number().describe("Parent mission ID to link with"),
            blackboard: z.record(z.any()).optional().describe("Shared context to pass to the sub-app (blackboard pattern)"),
        }),
        execute: async ({ blueprint, name, slug, description, missionId, blackboard = {} }, context) => {
            const { appForgeService } = await import("../../../apps/app-forge.service.js");
            
            // Increment forge depth to enforce MAX_RECURSIVE_DEPTH = 3
            const currentDepth = (blackboard as any).forge_depth || 0;
            const updatedBlackboard = {
                ...blackboard,
                forge_depth: currentDepth + 1,
                parent_app_slug: context?.appSlug || "unknown",
                trigger_timestamp: new Date().toISOString()
            };

            const result = await appForgeService.forgeApp(blueprint, {
                name,
                slug,
                description,
                oddjobMissionId: missionId,
                organizationId: context?.organizationId ?? undefined,
                // @ts-ignore
                blackboard: updatedBlackboard
            });
            return result;
        }
    },

    forge_marketplace_publish: {
        name: "forge_marketplace_publish",

        idempotency: "idempotent",
        label: "Forge: Publish to Marketplace",
        group: "App Forge",
        description: "Finalizes a forged app and publishes it to the marketplace. This triggers the final deployment and sends a notification to the user with the live link.",
        parameters: z.object({
            slug: z.string().describe("The app slug to publish"),
            name: z.string().describe("Display name for the published app"),
            description: z.string().describe("Short description for the marketplace"),
            missionRunId: z.number().optional().describe("Mission run ID for notification chaining")
        }),
        execute: async ({ slug, name, description, missionRunId }, context) => {
            const { appRegistryService } = await import("../../../apps/app-registry.service.js");
            const { AppDeploymentService } = await import("../../../apps/app-deployment.service.js");
            const { missionEventBus, MissionEvent } = await import("../../../mission/core/mission-event-bus.js");
            const { db } = await import("@server/database_service.js");
            const { apps } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            // 1. Register/Update app in registry
            const [existing] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
            let appId;
            if (existing) {
                appId = existing.id;
            } else {
                const app = await appRegistryService.registerApp({
                    name,
                    slug,
                    description,
                    isPublic: true,
                    status: "active"
                } as any);
                appId = app.id;
            }

            // 2. Ensure deployment exists and is published
            const orgId = assertOrgId(context?.organizationId);
            let deployment = await AppDeploymentService.getByAppAndOrg(appId, orgId);
            if (!deployment) {
                const { appDeployments } = await import("@shared/schema/index.js");
                [deployment] = await db.insert(appDeployments).values({
                    appId,
                    organizationId: orgId,
                    publicSlug: slug,
                    isPublished: true,
                    status: "active",
                    updatedAt: new Date()
                }).returning();
            } else {
                await AppDeploymentService.updateDeploymentPublishing(appId, orgId, { isPublished: true });
            }

            // 3. Emit APP_FORGED event if we have a missionRunId
            const runId = missionRunId || context?.missionRunId;
            if (runId) {
                missionEventBus.emit(MissionEvent.APP_FORGED, {
                    missionRunId: runId,
                    appId,
                    name,
                    slug
                });
            }

            return { 
                success: true, 
                appId, 
                url: `${process.env.APP_URL || 'http://localhost:5000'}/a/${slug}`,
                message: "App successfully published and notification sent."
            };
        }
    },

    list_blueprints: {
        name: "list_blueprints",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Forge: List Blueprints",
        group: "App Forge",
        description: "Lists available application architectures (blueprints) that can be used to scaffold a new app, each with its maturity (stable, beta or experimental). Prefer a stable or beta blueprint, and tell the user when the one you pick is experimental. Blueprints include 'analytics-dashboard', 'chat-assistant', 'crud-app', etc.",
        parameters: z.object({
            category: z.string().optional().describe("Filter by category (e.g., 'Analytics', 'Communication')")
        }),
        execute: async ({ category }, context) => {
            const { blueprintRegistryService } = await import("../../../apps/blueprint-registry.service.js");
            const { blueprintMaturity } = await import("@shared/blueprint-maturity.js");
            const orgId = context?.organizationId ? Number(context.organizationId) : undefined;
            const all = await blueprintRegistryService.listAll(orgId);
            
            let filtered = all;
            if (category) {
                filtered = all.filter(b => b.category.toLowerCase() === category.toLowerCase());
            }

            return filtered.map(b => ({
                slug: b.slug,
                name: b.name,
                description: b.description,
                capabilities: b.capabilities.join(", "),
                category: b.category,
                // stable | beta | experimental — see shared/blueprint-maturity.ts.
                maturity: blueprintMaturity(b.slug),
            }));
        }
    },

    query_code_graph: {
        name: "query_code_graph",

        idempotency: "read-safe",
        label: "Forge: Query Code Graph",
        description: "Queries the code graph for a specific app to understand its structure.",
        group: "App Forge",
        parameters: z.object({
            slug: z.string().describe("The app slug to query"),
            kind: z.string().optional().describe("Filter by node kind (e.g., 'code_function', 'code_class')"),
            mode: z.enum(["local", "global"]).default("local").describe("Local returns the raw graph nodes; Global returns architectural insights and community summaries.")
        }),
        execute: async ({ slug, kind, mode }, context) => {
            if (mode === "global") {
                const { globalXRayService } = await import("../../../xray/core/global-xray.service.js");
                return await globalXRayService.generateGlobalMap(slug, context?.organizationId ?? undefined);
            }

            const { podRegistry } = await import("../../../core/infrastructure/pod-registry.service.js");
            const xray = await podRegistry.getPod<any>('xray');
            const graph = await xray.queryGraph(slug);
            
            if (kind) {
                graph.nodes = graph.nodes.filter((n: any) => n.kind === kind);
            }
            
            return graph;
        }
    },

    get_code_metrics: {
        name: "get_code_metrics",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Forge: Get Code Metrics",
        group: "App Forge",
        description: "Returns health metrics for an app's codebase, including parse errors, function counts, and export density.",
        parameters: z.object({
            slug: z.string().describe("The app slug to check")
        }),
        execute: async ({ slug }, _context) => {
            const { podRegistry } = await import("../../../core/infrastructure/pod-registry.service.js");
            const xray = await podRegistry.getPod<any>('xray');
            const metrics = await xray.getMetrics(slug);
            return metrics;
        }
    },

    list_installed_apps: {
        name: "list_installed_apps",

        idempotency: "read-safe",
        label: "List Org Apps",
        group: "App Forge",
        description:
            "Returns the app catalog for the current organization: installed/live App Forge deployments, active Agent AI deployments, " +
            "advertised marketplace apps that can be installed, and blueprint templates that can scaffold a new app. " +
            "Each item includes: slug, title, description, source ('app' | 'agent_ai' | 'blueprint'), " +
            "availability ('installed' | 'advertised' | 'template'), href (the correct URL to open, install, or create the app), " +
            "and any blueprint/cycle relationship metadata. " +
            "ALWAYS call this before render_app_surface or render_app_catalog when recommending or opening an app, so you have the right source, slug, availability, href, blueprint, and cycle. " +
            "CRITICAL: When this returns 2 or more items that match what the user asked for, you MUST call render_app_catalog immediately with all matching items — do NOT list them in prose or ask for clarification in text. " +
            "The render_app_catalog tool shows them as a visual catalog grid where the user can click the one they want.",
        parameters: z.object({}),
        execute: async (_args: Record<string, unknown>, context: any) => {
            const orgId = requireToolOrgId(context);
            const cacheKey = `oddjob:installed_apps:org:${orgId}`;
            try {
                const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
                const redis = getRedisClient();
                const cached = await redis.get(cacheKey).catch(() => null);
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
                            return cached;
                        }
                    } catch {}
                }
            } catch {}

            // Inline query so the tool has no HTTP dep — mirrors the fleet-for-copilot route logic.
            const { pool } = await import("@server/database_service.js");
            const { appRegistryService } = await import("../../../apps/app-registry.service.js");

            // Annotated rather than inferred: an empty-array initialiser infers
            // `never[]`, so assigning a real QueryResult below is a type error.
            let appResult: { rows: any[] } = { rows: [] };
            let agentResult: { rows: any[] } = { rows: [] };
            let marketApps: any[] = [];

            try {
                const [appsRes, agentsRes, mApps] = await Promise.all([
                    pool.query(`
                        SELECT
                            d.app_id AS "appId",
                            d.public_slug AS "publicSlug",
                            d.config AS "deploymentConfig",
                            a.id AS "id",
                            a.name AS "name",
                            a.slug AS "slug",
                            a.description AS "description",
                            a.config AS "appConfig",
                            a.runtime_metadata AS "runtimeMetadata"
                        FROM app_deployments d
                        INNER JOIN apps a ON d.app_id = a.id
                        WHERE d.organization_id = $1
                    `, [orgId]).catch(() => ({ rows: [] })),
                    pool.query(`
                        SELECT slug, title, description, is_active AS "isActive"
                        FROM agent_deployments
                        WHERE organization_id = $1
                    `, [orgId]).catch(() => ({ rows: [] })),
                    appRegistryService.listAvailableApps(true).catch(() => []),
                ]);
                appResult = appsRes;
                agentResult = agentsRes;
                marketApps = mApps;
            } catch (err: any) {
                console.warn("[list_installed_apps] Ingestion query warning:", err?.message);
            }

            const appRows = appResult.rows.map((row: any) => ({
                deployment: {
                    appId: row.appId,
                    publicSlug: row.publicSlug,
                    config: row.deploymentConfig,
                },
                app: {
                    id: row.id,
                    name: row.name,
                    slug: row.slug,
                    description: row.description,
                    config: row.appConfig,
                    runtimeMetadata: row.runtimeMetadata,
                },
            }));
            const agentRows = agentResult.rows;

            const items: Array<{
                slug: string;
                title: string;
                description: string | null;
                source: "app" | "agent_ai" | "blueprint";
                href: string;
                availability: "installed" | "advertised" | "template";
                actionLabel: string;
                blueprint?: string | null;
                cycleSlug?: string | null;
                cycleName?: string | null;
                routePath?: string | null;
                sourceAppId?: string | null;
                sourceAppName?: string | null;
            }> = [];
            const installedAppIds = new Set<number>();
            /** Blueprint slugs already covered by an installed App Forge app (via blueprintSlug field). */
            const coveredBlueprintSlugs = new Set<string>();

            for (const { deployment, app } of appRows as any[]) {
                installedAppIds.add(deployment.appId);
                const href = getAppLaunchHref(deployment, app, orgId);
                if (!href) continue;
                const slug = deployment.publicSlug ?? (app as any).slug;
                const rel = getAppRelationshipMetadata(deployment, app);
                // Track which blueprint this installed app is built from so we don't duplicate it.
                if (rel.blueprint) coveredBlueprintSlugs.add(rel.blueprint);
                if ((app as any).blueprintSlug) coveredBlueprintSlugs.add((app as any).blueprintSlug);
                items.push({
                    slug,
                    title: (app as any).name ?? slug,
                    description: (app as any).description ?? null,
                    source: "app",
                    href,
                    availability: "installed",
                    actionLabel: `Open ${(app as any).name ?? "app"}`,
                    ...rel,
                });
            }

            for (const d of agentRows as any[]) {
                if (!d.isActive) continue;
                items.push({
                    slug: d.slug,
                    title: d.title ?? d.slug,
                    description: d.description ?? null,
                    source: "agent_ai",
                    href: `/a/${d.slug}`,
                    availability: "installed",
                    actionLabel: `Open ${d.title ?? "agent"}`,
                });
            }

            for (const app of marketApps as any[]) {
                if (installedAppIds.has(app.id)) continue;
                items.push({
                    slug: app.slug,
                    title: app.name ?? app.slug,
                    description: app.description ?? null,
                    source: "app",
                    href: `/armory/apps/${app.id}`,
                    availability: "advertised",
                    actionLabel: `View ${app.name ?? "app"}`,
                    blueprint: app.blueprintSlug ?? app.blueprint ?? app.slug ?? null,
                    cycleSlug: null,
                    cycleName: null,
                    routePath: null,
                    sourceAppId: null,
                    sourceAppName: null,
                });
            }

            // ── Blueprint templates ──────────────────────────────────────────────────────
            // Blueprints are app scaffolding templates loaded from the filesystem and
            // registered in the `blueprints` DB table by seed-blueprints.ts.
            // We expose them as launchable so users can say "open the analytics dashboard"
            // and copilot can offer to create one even when no installed copy exists.
            try {
                const blueprintResult = await pool.query(
                    `SELECT slug, name, description FROM blueprints WHERE is_public = true ORDER BY name`,
                    []
                );
                // Slugs already covered by a market-app entry (app.slug / app.blueprintSlug).
                for (const row of (marketApps as any[])) {
                    if (row.slug) coveredBlueprintSlugs.add(row.slug);
                    if (row.blueprintSlug) coveredBlueprintSlugs.add(row.blueprintSlug);
                }
                for (const bp of blueprintResult.rows) {
                    if (coveredBlueprintSlugs.has(bp.slug)) continue;
                    const humanName = bp.name ?? bp.slug
                        .split('-')
                        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
                        .join(' ');
                    items.push({
                        slug: bp.slug,
                        title: humanName,
                        description: bp.description ?? `Blueprint template: ${humanName}`,
                        source: "blueprint",
                        href: `/armory/new?blueprint=${encodeURIComponent(bp.slug)}`,
                        availability: "template",
                        actionLabel: `Create ${humanName}`,
                        blueprint: bp.slug,
                        cycleSlug: null,
                        cycleName: null,
                        routePath: null,
                        sourceAppId: null,
                        sourceAppName: null,
                    });
                }
            } catch (blueprintErr: any) {
                // Non-fatal: blueprint table may not be seeded yet.
                console.warn("[list_installed_apps] Could not load blueprints:", blueprintErr?.message);
            }

            // ── Disambiguation hint ──────────────────────────────────────────────────────
            // When ≥2 items share a normalized title stem the LLM must present a
            // selection form instead of silently picking one.
            function normalizeTitle(t: string): string {
                return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            }
            const titleGroups = new Map<string, string[]>();
            for (const item of items) {
                const key = normalizeTitle(item.title);
                if (!titleGroups.has(key)) titleGroups.set(key, []);
                titleGroups.get(key)!.push(item.slug);
            }
            // Check for prefix overlaps too (e.g. "analytics dashboard" vs "analytics dashboard workbench").
            const titleKeys = [...titleGroups.keys()];
            const ambiguousSlugs = new Set<string>();
            for (let i = 0; i < titleKeys.length; i++) {
                for (let j = i + 1; j < titleKeys.length; j++) {
                    const a = titleKeys[i], b = titleKeys[j];
                    if (a.startsWith(b) || b.startsWith(a) || a === b) {
                        for (const s of titleGroups.get(a)!) ambiguousSlugs.add(s);
                        for (const s of titleGroups.get(b)!) ambiguousSlugs.add(s);
                    }
                }
            }

            if (items.length === 0) {
                return "No installed apps, active agent deployments, advertised marketplace apps, or blueprint templates found for this organization.";
            }

            const result: any = { items };
            if (ambiguousSlugs.size > 0) {
                result._disambiguationHint = (
                    `The following app slugs have similar or overlapping names: ${[...ambiguousSlugs].join(', ')}. ` +
                    `IMPORTANT: Do NOT ask the user to clarify in prose. ` +
                    `Instead, immediately call render_app_catalog with ALL of these apps as items ` +
                    `so the user can visually pick the one they want from a product card grid.`
                );
            }

            // If the query returned multiple results, also add a top-level hint
            // so the model knows to show a catalog regardless of title overlap.
            if (items.length >= 2) {
                result._multipleResultsHint = (
                    `Found ${items.length} apps. ` +
                    `Do NOT describe them in prose or ask which one the user wants. ` +
                    `Call render_app_catalog immediately with all ${items.length} items so they appear as a visual grid.`
                );
            }

            const jsonResult = JSON.stringify(result, null, 2);
            try {
                const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
                const redis = getRedisClient();
                await redis.set(cacheKey, jsonResult, "EX", 900).catch(() => {});
            } catch {}

            return jsonResult;
        },
    },
};


