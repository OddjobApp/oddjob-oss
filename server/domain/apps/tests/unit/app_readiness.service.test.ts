import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@server/database_service.js", () => ({
    db: {},
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

describe("AppReadinessService", () => {
    let workspaceRoot: string;

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oddjob-readiness-"));
    });

    afterEach(async () => {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    });

    it("passes a complete Next.js forge workspace", async () => {
        await fs.mkdir(path.join(workspaceRoot, "pages"), { recursive: true });
        await fs.mkdir(path.join(workspaceRoot, ".next"), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
            scripts: { build: "next build", start: "next start" },
            dependencies: { next: "14.0.0", react: "18.0.0" },
        }));
        await fs.writeFile(path.join(workspaceRoot, "next.config.js"), "module.exports = {};");
        await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), "{}");
        await fs.writeFile(path.join(workspaceRoot, "pages", "index.tsx"), "export default function Home() { return null; }");

        const { appReadinessService } = await import("../../core/app-readiness.service.js");
        const checks = await appReadinessService.checkWorkspaceReadiness("complete-app", workspaceRoot);

        expect(checks.find(check => check.id === "workspace_files")?.status).toBe("pass");
        expect(checks.find(check => check.id === "build_artifact")?.status).toBe("pass");
    });

    it("fails a Next.js workspace without package scripts and entrypoint", async () => {
        await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
            dependencies: { react: "18.0.0" },
        }));
        await fs.writeFile(path.join(workspaceRoot, "next.config.js"), "module.exports = {};");
        await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), "{}");

        const { appReadinessService } = await import("../../core/app-readiness.service.js");
        const checks = await appReadinessService.checkWorkspaceReadiness("broken-app", workspaceRoot);
        const workspaceCheck = checks.find(check => check.id === "workspace_files");

        expect(workspaceCheck?.status).toBe("fail");
        expect(workspaceCheck?.message).toMatch(/missing/i);
        expect(JSON.stringify(workspaceCheck?.detail)).toContain("scripts.build");
        expect(JSON.stringify(workspaceCheck?.detail)).toContain("Next.js entrypoint");
    });

    it("recognizes a built Express workspace as a ready plain Node app", async () => {
        await fs.mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
            scripts: { build: "tsc", start: "node dist/app.js" },
            dependencies: { express: "4.19.2" },
        }));
        await fs.writeFile(path.join(workspaceRoot, "dist", "app.js"), "console.log('ready');");

        const { appReadinessService } = await import("../../core/app-readiness.service.js");
        const checks = await appReadinessService.checkWorkspaceReadiness("express-app", workspaceRoot);

        expect(checks.find(check => check.id === "workspace_files")?.status).toBe("pass");
        expect(checks.find(check => check.id === "build_artifact")?.status).toBe("pass");
        expect(JSON.stringify(checks)).not.toContain("Next.js");
    });
});
