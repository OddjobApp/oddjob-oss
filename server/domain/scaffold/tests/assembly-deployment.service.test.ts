import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

/**
 * FORGE_WORKSPACE is read once, at module load, into a module-level const — so
 * it has to be set before anything imports forge-paths.
 */
const WORKSPACE = path.join(os.tmpdir(), `oddjob-assembly-test-${process.pid}`);
process.env.FORGE_WORKSPACE = WORKSPACE;

const assembleMock = vi.fn();
const loadAllPacksMock = vi.fn();

vi.mock("../scaffold-assembly.service.js", () => ({
    scaffoldAssemblyService: { assemble: (...args: any[]) => assembleMock(...args) },
}));

vi.mock("../scaffold-registry.service.js", () => ({
    scaffoldRegistryService: { loadAllPacks: () => loadAllPacksMock() },
}));

const registerAppMock = vi.fn();
const installAppMock = vi.fn();
const findDeploymentBySlugMock = vi.fn();
const startAppMock = vi.fn();
const readinessMock = vi.fn();
const publishMock = vi.fn();

vi.mock("@domain/apps/app-registry.service.js", () => ({
    appRegistryService: {
        registerApp: (...args: any[]) => registerAppMock(...args),
        installApp: (...args: any[]) => installAppMock(...args),
        findDeploymentBySlug: (...args: any[]) => findDeploymentBySlugMock(...args),
        startApp: (...args: any[]) => startAppMock(...args),
    },
}));

vi.mock("@domain/apps/core/app-readiness.service.js", () => ({
    appReadinessService: { getAppReadiness: (...args: any[]) => readinessMock(...args) },
}));

vi.mock("@domain/apps/app-deployment.service.js", () => ({
    AppDeploymentService: { updateDeploymentPublishing: (...args: any[]) => publishMock(...args) },
}));

const { assemblyDeploymentService } = await import("../assembly-deployment.service.js");

describe("AssemblyDeploymentService", () => {
    beforeEach(() => {
        assembleMock.mockReset();
        loadAllPacksMock.mockReset();
        registerAppMock.mockReset();
        installAppMock.mockReset();
        findDeploymentBySlugMock.mockReset();
        startAppMock.mockReset();
        readinessMock.mockReset();
        publishMock.mockReset();
        registerAppMock.mockImplementation(async (data: any) => ({ id: 42, slug: data.slug }));
        installAppMock.mockResolvedValue({ deployment: { publicSlug: "tip-calculator" } });
        startAppMock.mockResolvedValue({ instanceId: 1, port: 4010 });
        readinessMock.mockResolvedValue({ ready: true, runtimeUrl: "http://127.0.0.1:4010", checks: [] });
        publishMock.mockResolvedValue({ isPublished: true });
        loadAllPacksMock.mockResolvedValue([
            { id: "core-node-express", category: "core" },
            { id: "data-postgres-drizzle", category: "data" },
        ]);
        assembleMock.mockImplementation(async (manifest: any) => ({
            success: true,
            appName: manifest.appName,
            targetDir: manifest.targetDir,
            executedPacks: manifest.packs,
        }));
    });

    afterAll(async () => {
        await fs.rm(WORKSPACE, { recursive: true, force: true }).catch(() => {});
    });

    it("scaffolds into the forge workspace and reports the packs it applied", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            displayName: "Tip Calculator",
            packs: ["core-node-express", "data-postgres-drizzle"],
            projectKey: "finance",
            organizationId: 7,
        });

        expect(outcome.success).toBe(true);
        expect(outcome.executedPacks).toEqual(["core-node-express", "data-postgres-drizzle"]);
        expect(assembleMock).toHaveBeenCalledTimes(1);

        const manifest = assembleMock.mock.calls[0][0];
        expect(manifest.targetDir).toBe(path.join(WORKSPACE, "tip-calculator"));
        expect(manifest.organizationId).toBe(7);
        // The room's Project Space has to reach the templates, or the scaffold
        // is built unscoped no matter which project raised it.
        expect(manifest.variables.projectKey).toBe("finance");

        // The dataset pack templates a SQL table name and a TypeScript export
        // from the app name, and "tip-calculator" is legal as neither. Deriving
        // them here is what keeps the generated schema compilable.
        expect(manifest.variables.datasetTable).toBe("tip_calculator_records");
        expect(manifest.variables.datasetIdent).toBe("tipCalculatorRecords");
        expect(startAppMock).toHaveBeenCalledWith(42, 7);
        expect(outcome.deployment).toEqual(expect.objectContaining({ status: "ready", published: false }));
        expect(publishMock).not.toHaveBeenCalled();
    });

    it("publishes only when the approved proposal explicitly requests it", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "public-calculator",
            displayName: "Public Calculator",
            packs: ["core-node-express"],
            organizationId: 7,
            publish: true,
            accessPolicy: "public",
        });

        expect(publishMock).toHaveBeenCalledWith(42, 7, {
            isPublished: true,
            publicSlug: "tip-calculator",
            accessPolicy: "public",
        });
        expect(outcome.deployment).toEqual(expect.objectContaining({
            status: "published",
            published: true,
            publicHref: "/app/tip-calculator",
        }));
    });

    it("derives a legal identifier from a single-word app name", async () => {
        await assemblyDeploymentService.execute({
            appName: "invoices",
            packs: ["core-node-express"],
        });

        const manifest = assembleMock.mock.calls[0][0];
        expect(manifest.variables.datasetTable).toBe("invoices_records");
        expect(manifest.variables.datasetIdent).toBe("invoicesRecords");
    });

    it("refuses an app name that is not a safe directory and DNS label", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "../../etc/passwd",
            packs: ["core-node-express"],
        });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toMatch(/not a valid app name/i);
        expect(assembleMock).not.toHaveBeenCalled();
    });

    it("refuses a proposal carrying no packs", async () => {
        const outcome = await assemblyDeploymentService.execute({ appName: "empty-app", packs: [] });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toMatch(/no scaffold packs/i);
        expect(assembleMock).not.toHaveBeenCalled();
    });

    it("refuses pack ids the registry does not have", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "ghost-app",
            packs: ["core-node-express", "pack-that-does-not-exist"],
        });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toMatch(/pack-that-does-not-exist/);
        expect(assembleMock).not.toHaveBeenCalled();
    });

    it("refuses to assemble over an app that already has content", async () => {
        const existing = path.join(WORKSPACE, "occupied-app");
        await fs.mkdir(existing, { recursive: true });
        await fs.writeFile(path.join(existing, "package.json"), "{}", "utf-8");

        const outcome = await assemblyDeploymentService.execute({
            appName: "occupied-app",
            packs: ["core-node-express"],
        });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toMatch(/already exists/i);
        // Pack rules inject into existing files, so running anyway would mutate
        // a live app rather than create a new one.
        expect(assembleMock).not.toHaveBeenCalled();
    });

    it("reports a failed assembly as failed instead of throwing", async () => {
        assembleMock.mockResolvedValue({
            success: false,
            appName: "broken-app",
            targetDir: path.join(WORKSPACE, "broken-app"),
            executedPacks: [],
            error: "template render failed",
        });

        const outcome = await assemblyDeploymentService.execute({
            appName: "broken-app",
            packs: ["core-node-express"],
        });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toBe("template render failed");
    });
});

/**
 * Registration is what makes a scaffold reachable. Before it, assembly wrote a
 * directory into the forge workspace that nothing in the product could find:
 * the catalogue reads `apps` joined to `app_deployments`, so an app with neither
 * row does not appear, and "Open Live App Surface" had nothing to open.
 */
describe("AssemblyDeploymentService catalogue registration", () => {
    beforeEach(() => {
        assembleMock.mockReset();
        loadAllPacksMock.mockReset();
        registerAppMock.mockReset();
        installAppMock.mockReset();
        findDeploymentBySlugMock.mockReset();
        loadAllPacksMock.mockResolvedValue([{ id: "core-node-express", category: "core" }]);
        assembleMock.mockImplementation(async (manifest: any) => ({
            success: true,
            appName: manifest.appName,
            targetDir: manifest.targetDir,
            executedPacks: manifest.packs,
        }));
        registerAppMock.mockImplementation(async (data: any) => ({ id: 42, slug: data.slug }));
        installAppMock.mockResolvedValue({ deployment: { publicSlug: "tip-calculator" } });
    });

    it("registers the app and installs a deployment so the catalogue can see it", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            displayName: "Tip Calculator",
            packs: ["core-node-express"],
            organizationId: 7,
            createdBy: "admin@oddjob.app",
        });

        expect(outcome.success).toBe(true);
        expect(registerAppMock).toHaveBeenCalledTimes(1);

        const registered = registerAppMock.mock.calls[0][0];
        expect(registered.slug).toBe("tip-calculator");
        expect(registered.name).toBe("Tip Calculator");
        expect(registered.organizationId).toBe(7);
        expect(registered.createdBy).toBe("admin@oddjob.app");
        // Source exists; nothing has been installed, built or started. Marking
        // it active would be the same overstatement the fake provisioning card
        // used to make.
        expect(registered.status).toBe("draft");

        // The app row alone is invisible — the catalogue joins to deployments.
        expect(installAppMock).toHaveBeenCalledWith(42, 7);
        expect(outcome.catalogue).toEqual({ appId: 42, slug: "tip-calculator", href: "/app/tip-calculator" });
    });

    it("opens inside the project space when the room had one", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs: ["core-node-express"],
            organizationId: 7,
            projectKey: "finance",
            projectId: 3,
        });

        expect(outcome.catalogue?.href).toBe("/projects/finance/apps/tip-calculator");
        expect(registerAppMock.mock.calls[0][0].projectId).toBe(3);
    });

    it("uses the deployment's reserved public slug, not the app slug", async () => {
        // public_slug is unique across every org, so installApp may hand back a
        // different slug than the app's. Building the href from the app slug
        // would link to another org's deployment.
        installAppMock.mockResolvedValue({ deployment: { publicSlug: "tip-calculator-2" } });

        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs: ["core-node-express"],
            organizationId: 9,
        });

        expect(outcome.catalogue?.href).toBe("/app/tip-calculator-2");
    });

    it("treats an already-installed app as catalogued rather than failed", async () => {
        installAppMock.mockRejectedValue(new Error('App "Tip Calculator" is already installed in this organization'));
        findDeploymentBySlugMock.mockResolvedValue({ deployment: { publicSlug: "tip-calculator" } });

        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs: ["core-node-express"],
            organizationId: 7,
        });

        expect(outcome.success).toBe(true);
        expect(outcome.catalogueError).toBeUndefined();
        expect(outcome.catalogue?.slug).toBe("tip-calculator");
    });

    it("still reports the scaffold as successful when registration fails", async () => {
        registerAppMock.mockRejectedValue(new Error("registry unavailable"));

        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs: ["core-node-express"],
            organizationId: 7,
        });

        // The files are on disk either way. Calling the whole deployment failed
        // would send someone looking for a directory that is actually there.
        expect(outcome.success).toBe(true);
        expect(outcome.catalogue).toBeUndefined();
        expect(outcome.catalogueError).toContain("registry unavailable");
    });

    it("says so plainly when there is no org to catalogue into", async () => {
        const outcome = await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs: ["core-node-express"],
            organizationId: null,
        });

        expect(outcome.success).toBe(true);
        expect(registerAppMock).not.toHaveBeenCalled();
        expect(outcome.catalogueError).toMatch(/no organization/i);
    });
});

/**
 * X-Ray builds a scaffolded app's graph from `developmentPlan` plus a scan of
 * the app's workspace. The scan finds routes and components in the generated
 * source, so the plan carries what it cannot infer: which dataset the app
 * writes to (nothing on disk says so), the real mount paths, and which packs
 * composed the app.
 */
describe("AssemblyDeploymentService living blueprint", () => {
    const datasetPack = {
        id: "data-postgres-drizzle",
        name: "Dataset Persistence Pack",
        category: "data",
        provides: ["dataset-store"],
        inject: [
            {
                target: "src/app.ts",
                action: "AST_ADD_MIDDLEWARE",
                use: "app.use('/api/dataset', datasetRouter);",
            },
            { target: "package.json", action: "MERGE_JSON", content: {} },
        ],
    };
    const corePack = { id: "core-node-express", name: "Node Express Core Host Pack", category: "core", provides: ["web-host"], inject: [] };

    beforeEach(() => {
        assembleMock.mockReset();
        loadAllPacksMock.mockReset();
        registerAppMock.mockReset();
        installAppMock.mockReset();
        findDeploymentBySlugMock.mockReset();
        loadAllPacksMock.mockResolvedValue([corePack, datasetPack]);
        assembleMock.mockImplementation(async (manifest: any) => ({
            success: true,
            appName: manifest.appName,
            targetDir: manifest.targetDir,
            executedPacks: manifest.packs,
        }));
        registerAppMock.mockImplementation(async (data: any) => ({ id: 42, slug: data.slug }));
        installAppMock.mockResolvedValue({ deployment: { publicSlug: "tip-calculator" } });
    });

    const planFor = async (packs: string[]) => {
        await assemblyDeploymentService.execute({
            appName: "tip-calculator",
            packs,
            organizationId: 7,
        });
        return registerAppMock.mock.calls[0][0].developmentPlan as any;
    };

    it("records the dataset the app writes to", async () => {
        const plan = await planFor(["core-node-express", "data-postgres-drizzle"]);

        // Datasets come from nowhere else — the workspace scan reads files, and
        // no file states which dataset is the app's.
        expect(plan.datasets).toEqual([{ name: "tip_calculator_records" }]);
        expect(plan.scaffoldedFrom).toEqual(["core-node-express", "data-postgres-drizzle"]);
    });

    it("claims no dataset when the dataset pack was not applied", async () => {
        const plan = await planFor(["core-node-express"]);

        // An app without the pack has no dataset, and saying otherwise would put
        // a node in the graph for something that does not exist.
        expect(plan.datasets).toEqual([]);
    });

    it("records the mount path the pack declares, not one inferred from a filename", async () => {
        const plan = await planFor(["core-node-express", "data-postgres-drizzle"]);

        expect(plan.endpoints).toContainEqual({
            path: "/api/dataset",
            method: "ALL",
            providedBy: "data-postgres-drizzle",
        });
        // The scanner would have derived "/api/tip-calculator/router" from the
        // file name, which is not a route the app serves.
        expect(JSON.stringify(plan.endpoints)).not.toContain("router");
    });

    it("lists the packs as modules so the graph shows what composed the app", async () => {
        const plan = await planFor(["core-node-express", "data-postgres-drizzle"]);

        expect(plan.modules).toContainEqual({
            name: "Dataset Persistence Pack",
            id: "data-postgres-drizzle",
            provides: ["dataset-store"],
        });
    });
});
