import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INJECTED_UI_LIBRARY_PATHS, forgeWorkspaceService } from "./forge-workspace.service.js";

describe("ForgeWorkspaceService.injectBuildConfig tsconfig", () => {
    let buildPath = "";
    afterEach(async () => {
        if (buildPath) await fs.rm(buildPath, { recursive: true, force: true });
    });

    it("keeps the injected platform UI out of the type-check roots", async () => {
        buildPath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-ws-"));
        await forgeWorkspaceService.injectBuildConfig("test-app", "nextjs", buildPath);

        const tsconfig = JSON.parse(await fs.readFile(path.join(buildPath, "tsconfig.json"), "utf8"));
        expect(tsconfig.exclude).toEqual(["node_modules", ...INJECTED_UI_LIBRARY_PATHS]);

        // The exclusions must name where the UI actually lands, or they exclude nothing.
        expect(await fs.readdir(path.join(buildPath, "src/components/ui"))).toContain("accordion.tsx");
        expect(await fs.readdir(path.join(buildPath, "src/domain/core/ui/components/ui"))).toContain("accordion.tsx");
        await expect(fs.access(path.join(buildPath, "src/lib/utils.ts"))).resolves.toBeUndefined();
    });
});
