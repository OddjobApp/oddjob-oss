import fs from "node:fs/promises";
import { scaffoldRegistryService } from "./scaffold-registry.service.js";
import { scaffoldAssemblyService } from "./scaffold-assembly.service.js";
import { FORGE_WORKSPACE_ROOT, getForgeWorkspacePath, isWithinDirectory } from "@domain/apps/core/forge-paths.js";
import { createLogger } from "@server/utils/logger.js";
import type { PackManifest } from "@shared/schema/scaffold.js";

const logger = createLogger("AssemblyDeploymentService");

/**
 * `tip-calculator` → `tipCalculatorRecords`.
 *
 * The dataset pack exports a Drizzle table under this name, so it has to be a
 * legal TypeScript identifier: hyphens out, camel-cased, and suffixed so the
 * export reads as the records it holds.
 */
function toIdentifier(appName: string): string {
    const camel = appName
        .split("-")
        .filter(Boolean)
        .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join("");
    return `${camel}Records`;
}

/**
 * `app.use('/api/dataset', datasetRouter);` → `/api/dataset`.
 *
 * The mount path a pack declares is the real one. X-Ray's file scanner infers
 * route names as `/api/{slug}/{basename}` from the filename, which for the
 * dataset pack would read `/api/tip-calculator/router` — a path that does not
 * exist. The manifest is the authority, so it is what gets recorded.
 */
function mountPathOf(useStatement: string): string | null {
    const match = useStatement.match(/app\.use\(\s*['"`]([^'"`]+)['"`]/);
    return match ? match[1] : null;
}

/**
 * The Living Blueprint for a scaffolded app, derived from the packs that were
 * actually applied.
 *
 * X-Ray reads `developmentPlan` to build an app's graph and finds its source
 * files itself, so this deliberately records only what the scan cannot infer:
 * datasets, which come from nowhere else, the true mount paths, and which packs
 * composed the app. Everything here is read off resolved manifests rather than
 * assumed — an app that did not get the dataset pack does not claim a dataset.
 */
function buildDevelopmentPlan(
    packs: PackManifest[],
    datasetTable: string | null,
): Record<string, unknown> {
    const endpoints = packs.flatMap((pack) =>
        (pack.inject ?? [])
            .filter((rule) => rule.action === "AST_ADD_MIDDLEWARE" && rule.use)
            .map((rule) => mountPathOf(rule.use as string))
            .filter((path): path is string => !!path)
            .map((path) => ({ path, method: "ALL", providedBy: pack.id })),
    );

    const providesDataset = packs.some((pack) => (pack.provides ?? []).includes("dataset-store"));

    return {
        scaffoldedFrom: packs.map((pack) => pack.id),
        generatedAt: new Date().toISOString(),
        endpoints,
        modules: packs.map((pack) => ({ name: pack.name, id: pack.id, provides: pack.provides ?? [] })),
        datasets: providesDataset && datasetTable ? [{ name: datasetTable }] : [],
    };
}

/**
 * What an approved `propose_assembly_deployment` actually did.
 *
 * Carries the failure text rather than throwing, because the caller is the
 * approval decision path: the decision itself is already persisted by the time
 * we run, and a scaffold failure must not roll that back or 500 the request the
 * user is waiting on. The surface renders whichever of these it gets.
 */
export interface AssemblyDeploymentOutcome {
    success: boolean;
    appName: string;
    displayName?: string;
    targetDir?: string;
    executedPacks: string[];
    error?: string;
    /** Where the app can be opened, once it is in the org's catalogue. */
    catalogue?: { appId: number; slug: string; href: string };
    /**
     * Why cataloguing failed, when the scaffold itself succeeded. Kept separate
     * from `error`: the source is on disk either way, and reporting the whole
     * deployment as failed because a registry write did not land would send
     * someone looking for files that are actually there.
     */
    catalogueError?: string;
    deployment?: {
        status: "ready" | "published";
        runtimeUrl?: string;
        published: boolean;
        publicHref?: string;
    };
    deploymentError?: string;
    design?: { styleId: string; applied: boolean };
    designError?: string;
}

/**
 * Executes the scaffold an approved assembly proposal describes.
 *
 * `propose_assembly_deployment` only ever *described* the work: it wrote an
 * approvalRequests row and returned a card. Nothing on the approval path
 * reached `scaffoldAssemblyService.assemble`, whose only caller in the repo is
 * the MCP tool — so "Approve & Execute" marked the row approved and stopped,
 * while the UI reported a completed provisioning run. This is the missing half.
 */
export class AssemblyDeploymentService {
    /**
     * @param meta The proposal envelope stored on the approval request
     *             (`{ appName, displayName, packs, executionOrder, projectKey }`).
     */
    async execute(meta: {
        appName?: string;
        displayName?: string;
        packs?: string[];
        projectKey?: string | null;
        projectId?: number | null;
        organizationId?: number | null;
        createdBy?: string | null;
        publish?: boolean;
        accessPolicy?: "public" | "internal_only";
        designStyleId?: string | null;
        aiEmbellishment?: string | null;
    }): Promise<AssemblyDeploymentOutcome> {
        const appName = (meta?.appName || "").trim();
        const packs = Array.isArray(meta?.packs) ? meta.packs : [];

        if (!appName || !/^[a-z0-9-]+$/.test(appName)) {
            return {
                success: false,
                appName,
                executedPacks: [],
                error: `Refusing to scaffold: "${appName}" is not a valid app name (lowercase, digits and hyphens only).`,
            };
        }
        if (packs.length === 0) {
            return { success: false, appName, executedPacks: [], error: "Refusing to scaffold: no scaffold packs on the proposal." };
        }

        // The app name reaches the filesystem. The regex above already excludes
        // separators and `..`, but the containment check is what actually keeps
        // an assembly inside the forge workspace, so it is enforced rather than
        // assumed — a future caller may relax the name rule.
        const targetDir = getForgeWorkspacePath(appName);
        if (!isWithinDirectory(FORGE_WORKSPACE_ROOT, targetDir)) {
            return {
                success: false,
                appName,
                executedPacks: [],
                error: `Refusing to scaffold: resolved target ${targetDir} is outside the forge workspace.`,
            };
        }

        // Never assemble over an app that already has content. The pack rules
        // inject into existing files, so re-running against a populated
        // directory silently mutates a live app instead of creating a new one.
        const existing = await fs.readdir(targetDir).catch(() => null);
        if (existing && existing.length > 0) {
            return {
                success: false,
                appName,
                targetDir,
                executedPacks: [],
                error: `Refusing to scaffold: ${appName} already exists at ${targetDir} with ${existing.length} entr${existing.length === 1 ? "y" : "ies"}. Choose a different app name.`,
            };
        }

        const availablePacks = await scaffoldRegistryService.loadAllPacks();
        const known = new Set(availablePacks.map((p) => p.id));
        const unknown = packs.filter((p) => !known.has(p));
        if (unknown.length > 0) {
            return {
                success: false,
                appName,
                targetDir,
                executedPacks: [],
                error: `Refusing to scaffold: unknown scaffold pack(s) ${unknown.join(", ")}.`,
            };
        }

        logger.info(`Assembling approved app '${appName}' from ${packs.length} pack(s) into ${targetDir}`);

        // Named rather than inlined: the dataset's table name is both a template
        // variable and the one thing X-Ray cannot discover by scanning the
        // generated source, so the Living Blueprint records it too.
        const datasetTable = `${appName.replace(/-/g, "_")}_records`;

        const result = await scaffoldAssemblyService.assemble(
            {
                appName,
                targetDir,
                packs,
                variables: {
                    displayName: meta.displayName || appName,
                    projectKey: meta.projectKey ?? "default",
                    // The dataset pack templates a table name and a TypeScript
                    // identifier from the app name. Handlebars has no string
                    // helpers registered, so both are derived here rather than
                    // in the template — and both must be valid in their own
                    // right: `tip-calculator` is neither a legal SQL identifier
                    // nor a legal JS one.
                    datasetTable,
                    datasetIdent: toIdentifier(appName),
                },
                ...(meta.organizationId != null ? { organizationId: meta.organizationId } : {}),
            },
            availablePacks,
        );

        if (!result.success) {
            logger.error(`Assembly for '${appName}' failed: ${result.error}`);
            return {
                success: false,
                appName: result.appName,
                displayName: meta.displayName,
                targetDir: result.targetDir,
                executedPacks: result.executedPacks,
                error: result.error,
            };
        }

        // Put it in the org's catalogue. Without this the scaffold produced a
        // directory nobody could reach: the catalogue reads `apps` joined to
        // `app_deployments`, so an app with neither row is invisible, and
        // "Open Live App Surface" had nothing to open.
        // Resolved manifests, not just ids: the Living Blueprint is derived from
        // what each applied pack declares it mounts and provides.
        const appliedPacks = availablePacks.filter((p) => result.executedPacks.includes(p.id));

        const catalogue = await this.registerInCatalogue({
            appName: result.appName,
            displayName: meta.displayName,
            executedPacks: result.executedPacks,
            appliedPacks,
            datasetTable,
            organizationId: meta.organizationId ?? null,
            projectId: meta.projectId ?? null,
            projectKey: meta.projectKey ?? null,
            createdBy: meta.createdBy ?? null,
        });

        if ("error" in catalogue) {
            return {
                success: true,
                appName: result.appName,
                displayName: meta.displayName,
                targetDir: result.targetDir,
                executedPacks: result.executedPacks,
                catalogueError: catalogue.error,
            };
        }

        const designed = meta.designStyleId
            ? await this.applyRequestedTheme({
                appId: catalogue.appId,
                appName: result.appName,
                organizationId: meta.organizationId!,
                designStyleId: meta.designStyleId,
                aiEmbellishment: meta.aiEmbellishment ?? null,
            })
            : null;

        const deployed = await this.deployRegisteredApp({
            appId: catalogue.appId,
            organizationId: meta.organizationId!,
            publicSlug: catalogue.slug,
            publish: meta.publish === true,
            accessPolicy: meta.accessPolicy ?? "internal_only",
        });

        return {
            success: true,
            appName: result.appName,
            displayName: meta.displayName,
            targetDir: result.targetDir,
            executedPacks: result.executedPacks,
            catalogue,
            ...(designed?.error
                ? { designError: designed.error }
                : designed ? { design: { styleId: meta.designStyleId!, applied: true } } : {}),
            ...(deployed.error ? { deploymentError: deployed.error } : { deployment: deployed.deployment }),
        };
    }

    private async applyRequestedTheme(input: {
        appId: number;
        appName: string;
        organizationId: number;
        designStyleId: string;
        aiEmbellishment: string | null;
    }): Promise<{ error?: string }> {
        try {
            const { forgeDesignCatalogService } = await import("@domain/apps/core/forge-design-catalog.service.js");
            const { appBuilderService } = await import("@domain/apps/app-builder.service.js");
            const style = await forgeDesignCatalogService.getStyleById(input.designStyleId);
            if (!style) return { error: `Design style "${input.designStyleId}" was not found.` };

            const prompt = `Apply a visual-only theme pass to the newly assembled ${input.appName} app.
Preserve its purpose, content, controls, calculations, routes, APIs, datasets, and accessibility behavior. Keep the generated framework and file structure. Do not replace it with a generic shell, chat, or dashboard.

${forgeDesignCatalogService.toPromptContext(style)}

AI embellishment: ${input.aiEmbellishment?.trim() || "restrained polish only; do not invent features"}`;
            const result = await appBuilderService.enhanceApp(input.appId, input.appName, prompt, input.organizationId);
            return result.success ? {} : { error: result.error || "The App Builder could not apply the selected theme." };
        } catch (err: any) {
            return { error: err?.message || String(err) };
        }
    }

    private async deployRegisteredApp(input: {
        appId: number;
        organizationId: number;
        publicSlug: string;
        publish: boolean;
        accessPolicy: "public" | "internal_only";
    }): Promise<{
        deployment?: AssemblyDeploymentOutcome["deployment"];
        error?: string;
    }> {
        try {
            const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
            const { appReadinessService } = await import("@domain/apps/core/app-readiness.service.js");
            const { AppDeploymentService } = await import("@domain/apps/app-deployment.service.js");

            await appRegistryService.startApp(input.appId, input.organizationId);
            const readiness = await appReadinessService.getAppReadiness(input.appId, input.organizationId, { probeRuntime: true });
            if (!readiness.ready) {
                const blockers = readiness.checks
                    .filter((item) => item.status === "fail" && item.severity === "blocker")
                    .map((item) => item.message)
                    .join(" ");
                return { error: blockers || "The generated app did not pass deployment readiness checks." };
            }

            if (input.publish) {
                await AppDeploymentService.updateDeploymentPublishing(input.appId, input.organizationId, {
                    isPublished: true,
                    publicSlug: input.publicSlug,
                    accessPolicy: input.accessPolicy,
                });
            }

            return {
                deployment: {
                    status: input.publish ? "published" : "ready",
                    runtimeUrl: readiness.runtimeUrl,
                    published: input.publish,
                    ...(input.publish ? { publicHref: `/app/${input.publicSlug}` } : {}),
                },
            };
        } catch (err: any) {
            const message = err?.message || String(err);
            logger.warn(`Scaffolded app ${input.appId} could not be deployed: ${message}`);
            return { error: message };
        }
    }

    /**
     * Registers a freshly scaffolded app so the org can find and open it.
     *
     * Registration is deliberately non-fatal: the files exist by the time this
     * runs, so a failed registry write is reported alongside a successful
     * assembly rather than turning it into a failure.
     *
     * Registration begins as a draft. The lifecycle step after this method
     * prepares and starts it, and appRegistryService promotes both app and
     * deployment to active only after provisioning succeeds.
     */
    private async registerInCatalogue(input: {
        appName: string;
        displayName?: string;
        executedPacks: string[];
        appliedPacks: PackManifest[];
        datasetTable: string | null;
        organizationId: number | null;
        projectId: number | null;
        projectKey: string | null;
        createdBy: string | null;
    }): Promise<{ appId: number; slug: string; href: string } | { error: string }> {
        if (input.organizationId == null) {
            return { error: "No organization on the proposal, so the app was not added to a catalogue." };
        }

        try {
            const { appRegistryService } = await import("@domain/apps/app-registry.service.js");

            const app = await appRegistryService.registerApp({
                name: input.displayName || input.appName,
                slug: input.appName,
                description: `Scaffolded from ${input.executedPacks.join(", ")}.`,
                organizationId: input.organizationId,
                status: "draft",
                blueprintSlug: "scaffold-assembly",
                createdBy: input.createdBy ?? undefined,
                config: {},
                // X-Ray builds an app's graph from this. Without it a scaffolded
                // app's dataset is invisible — the file scan finds routes and
                // components in the workspace, but nothing on disk tells it which
                // dataset the app writes to.
                developmentPlan: buildDevelopmentPlan(input.appliedPacks, input.datasetTable),
                ...(input.projectId != null ? { projectId: input.projectId } : {}),
            } as any);

            // The catalogue joins apps to deployments, so the app row alone is
            // not enough to make it appear. installApp also reserves a unique
            // public slug, which matters because that column is unique across
            // every org, not per app.
            let publicSlug = app.slug;
            try {
                const installed = await appRegistryService.installApp(app.id, input.organizationId);
                publicSlug = installed?.deployment?.publicSlug || publicSlug;
            } catch (installErr: any) {
                // Re-scaffolding an app that is already installed is not a
                // failure — the app is in the catalogue either way.
                if (!/already installed/i.test(installErr?.message ?? "")) throw installErr;
                const existing = await appRegistryService
                    .findDeploymentBySlug(app.slug, input.organizationId)
                    .catch(() => null);
                publicSlug = existing?.deployment?.publicSlug || publicSlug;
            }

            const href = input.projectKey
                ? `/projects/${input.projectKey}/apps/${publicSlug}`
                : `/app/${publicSlug}`;

            logger.info(`Registered scaffolded app '${app.slug}' (id ${app.id}) in org ${input.organizationId}`);
            return { appId: app.id, slug: publicSlug, href };
        } catch (err: any) {
            const message = err?.message || String(err);
            logger.warn(`Scaffolded app '${input.appName}' could not be catalogued: ${message}`);
            return { error: message };
        }
    }
}

export const assemblyDeploymentService = new AssemblyDeploymentService();
