import { describe, expect, it, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ScaffoldRegistryService } from "../scaffold-registry.service.js";
import { DAGResolver } from "../dag-resolver.js";
import { scaffoldAssemblyService } from "../scaffold-assembly.service.js";

/**
 * The dataset pack, assembled for real against the on-disk registry.
 *
 * Until this pack existed the registry held a host, an auth pack and a design
 * system — so "build a tip calculator that saves to a dataset" could scaffold
 * everything except the part the app was for, and `core-node-express` recommended
 * a `data-postgres-drizzle` that was not there. These tests run the actual
 * templates through the actual assembler rather than asserting on the manifest,
 * because the manifest being well-formed was never the risk.
 */

const REGISTRY = path.resolve(process.cwd(), "packages/scaffold-registry");
const OUT = path.join(os.tmpdir(), `oddjob-dataset-pack-${process.pid}`);

const registry = new ScaffoldRegistryService(REGISTRY);

const assemble = async (appName: string, targetDir: string) => {
    const packs = await registry.loadAllPacks(true);
    return scaffoldAssemblyService.assemble(
        {
            appName,
            targetDir,
            packs: ["core-node-express", "data-postgres-drizzle"],
            variables: {
                displayName: "Tip Calculator",
                projectKey: "finance",
                datasetTable: `${appName.replace(/-/g, "_")}_records`,
                datasetIdent: "tipCalculatorRecords",
            },
        },
        packs,
    );
};

describe("dataset scaffold pack", () => {
    afterAll(async () => {
        await fs.rm(OUT, { recursive: true, force: true }).catch(() => {});
    });

    it("is discoverable in the registry", async () => {
        const pack = await registry.getPack("data-postgres-drizzle");

        expect(pack, "the pack core-node-express recommends must exist").toBeDefined();
        expect(pack!.category).toBe("data");
        expect(pack!.provides).toContain("dataset-store");
    });

    it("resolves after the host it extends", async () => {
        const packs = await registry.loadAllPacks(true);
        const order = new DAGResolver(packs)
            .resolveExecutionOrder(["data-postgres-drizzle", "core-node-express"])
            .map((p) => p.id);

        // The dataset pack injects into src/app.ts, which the host pack writes.
        // Running it first would inject into a file that does not exist yet.
        expect(order.indexOf("core-node-express")).toBeLessThan(order.indexOf("data-postgres-drizzle"));
    });

    /**
     * A recommendation naming a pack nobody wrote is how an agent comes to
     * propose `data-postgres-drizzle` and have the id rejected — the registry
     * advertises a pack that does not exist.
     *
     * `observability-otel` is still in that state: recommended by the host and
     * auth packs, never written. Pinning the exact set means a NEW dangling
     * reference fails here, and so does writing observability-otel without
     * removing it from this list — which is the point at which the allowance
     * should go.
     */
    it("adds no new recommendation pointing at a pack that does not exist", async () => {
        const packs = await registry.loadAllPacks(true);
        const ids = new Set(packs.map((p) => p.id));

        const dangling = packs
            .flatMap((p) => (p.recommends ?? []).filter((r) => !ids.has(r)).map((r) => `${p.id} → ${r}`))
            .sort();

        expect(dangling).toEqual([
            "auth-jwt → observability-otel",
            "auth-oauth2-bearer → observability-otel",
            "core-node-express → observability-otel",
        ]);

        // Whatever else is outstanding, the dataset pack must not add to it.
        expect(dangling.filter((d) => d.startsWith("data-postgres-drizzle"))).toEqual([]);
    });

    it("writes a dataset layer whose identifiers are legal", async () => {
        const target = path.join(OUT, "tip-calculator");
        const result = await assemble("tip-calculator", target);

        expect(result.success, result.error).toBe(true);

        const schema = await fs.readFile(path.join(target, "src/dataset/schema.ts"), "utf-8");
        const router = await fs.readFile(path.join(target, "src/dataset/router.ts"), "utf-8");
        await fs.access(path.join(target, "src/dataset/client.ts"));
        await fs.access(path.join(target, "drizzle.config.ts"));
        await fs.access(path.join(target, ".env.example"));

        // The app name is not a legal SQL or JS identifier; both have to be
        // derived, and an unrendered placeholder would leave `{{...}}` in source.
        expect(schema).toContain('pgTable(\n  "tip_calculator_records"');
        expect(schema).toContain("export const tipCalculatorRecords");
        expect(router).toContain("tipCalculatorRecords");
        for (const file of [schema, router]) {
            expect(file).not.toMatch(/\{\{/);
        }
    });

    it("produces a workspace the runtime can classify and start", async () => {
        const target = path.join(OUT, "runnable-app");
        const result = await assemble("runnable-app", target);
        expect(result.success, result.error).toBe(true);

        const { detectLaunchProfile, resolveNodeEntry } = await import(
            "../../apps/infrastructure/node-launch-profile.js"
        );

        // Not "next" — which is what the runtime assumed of everything, and why
        // an Express scaffold used to be treated as unbuilt and overwritten with
        // the chat-assistant blueprint.
        expect(await detectLaunchProfile(target)).toBe("node");

        const pkg = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf-8"));
        expect(resolveNodeEntry(pkg)).toBe("dist/app.js");

        // The host pack declares `build: tsc` and depends on typescript, but
        // shipped no tsconfig — so `tsc` printed its help text and exited
        // non-zero, and the app could never be built. Found by running the
        // scaffold for real; asserted here so it cannot regress.
        const tsconfig = JSON.parse(await fs.readFile(path.join(target, "tsconfig.json"), "utf-8"));
        expect(tsconfig.compilerOptions.outDir).toBe("dist");
        expect(tsconfig.compilerOptions.rootDir).toBe("src");
        // The generated source imports with explicit .js specifiers.
        expect(tsconfig.compilerOptions.moduleResolution).toBe("NodeNext");

        // prepareNodeWorkspace is intentionally NOT called here: with npm now
        // spawning correctly it would run a real install over the network.
    });

    it("ships a schema path that does not need a human at a terminal", async () => {
        const target = path.join(OUT, "migratable-app");
        const result = await assemble("migratable-app", target);
        expect(result.success, result.error).toBe(true);

        const pkg = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf-8"));

        // `drizzle-kit push` asks the operator what to do whenever a change is
        // ambiguous or destructive, and 0.21.4 has no flag to suppress it — only
        // `--strict`, which asks MORE. It therefore hangs forever anywhere
        // without a terminal, which is every automated deploy. generate decides
        // the change offline; migrate applies what was already decided.
        expect(pkg.scripts["dataset:generate"]).toBe("drizzle-kit generate");
        expect(pkg.scripts["dataset:migrate"]).toBe("node dist/dataset/migrate.js");

        const migrate = await fs.readFile(path.join(target, "src/dataset/migrate.ts"), "utf-8");
        expect(migrate).toContain("drizzle-orm/node-postgres/migrator");
        // The folder the migrator reads has to be the one drizzle.config writes.
        expect(migrate).toContain('migrationsFolder: "drizzle"');
        const config = await fs.readFile(path.join(target, "drizzle.config.ts"), "utf-8");
        expect(config).toContain('out: "./drizzle"');
        // A pooled connection left open keeps the migration step alive forever.
        expect(migrate).toContain("pool.end()");
    });

    it("mounts itself on the host app and declares its dependencies", async () => {
        const target = path.join(OUT, "mounted-app");
        const result = await assemble("mounted-app", target);
        expect(result.success, result.error).toBe(true);

        const app = await fs.readFile(path.join(target, "src/app.ts"), "utf-8");
        // Injected, not merely templated alongside: an unmounted router is dead
        // code and the dataset would be unreachable over HTTP.
        expect(app).toContain("datasetRouter");
        expect(app).toContain("app.use('/api/dataset', datasetRouter);");

        const pkg = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf-8"));
        expect(pkg.dependencies).toHaveProperty("drizzle-orm");
        expect(pkg.dependencies).toHaveProperty("pg");
        expect(pkg.scripts).toHaveProperty("dataset:push");
        // The host pack's own entries must survive the merge.
        expect(pkg.dependencies).toHaveProperty("express");
    });
});
