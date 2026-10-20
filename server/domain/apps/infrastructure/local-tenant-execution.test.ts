import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    const mocked = { ...actual, spawn: vi.fn(), exec: vi.fn(), execFile: vi.fn() };
    return { ...mocked, default: mocked };
});

import { spawn, exec, execFile } from "node:child_process";
import { assertLocalTenantExecutionAllowed } from "@server/utils/local-tenant-execution.js";
import { localProcessService } from "./local-process.service.js";
import { prepareNodeWorkspace, runNpm } from "./node-launch-profile.js";
import { forgeWorkspaceService } from "../core/forge-workspace.service.js";

const blocked = /disabled in production/;

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe("local generated-app execution boundary", () => {
    it.each(["development", "test"])("preserves local execution in %s", (mode) => {
        vi.stubEnv("NODE_ENV", mode);
        expect(() => assertLocalTenantExecutionAllowed()).not.toThrow();
    });

    it("refuses production even if a child requests a development environment", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(localProcessService.startProcess(
            "/unused", 5001, { NODE_ENV: "development" }, "test-app", "app.js",
        )).rejects.toThrow(blocked);
        expect(spawn).not.toHaveBeenCalled();
    });

    it("blocks npm install and build before invoking a lifecycle script", async () => {
        vi.stubEnv("NODE_ENV", "production");
        for (const args of [["install"], ["run", "build"]]) {
            await expect(runNpm(args, "/unused")).rejects.toThrow(blocked);
        }
        expect(execFile).not.toHaveBeenCalled();
    });

    it("rejects workspace preparation before inspecting or installing dependencies", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(prepareNodeWorkspace("/unused", "test-app")).rejects.toThrow(blocked);
        expect(execFile).not.toHaveBeenCalled();
    });

    it.each(["go-backend", "java-backend", "python-backend", "next"])(
        "blocks local compiler and plugin execution for %s", async (blueprint) => {
            vi.stubEnv("NODE_ENV", "production");
            await expect(forgeWorkspaceService.checkCompilation("test-app", blueprint, "/unused"))
                .rejects.toThrow(blocked);
            expect(exec).not.toHaveBeenCalled();
        },
    );

    it("blocks arbitrary workspace commands before starting a shell", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(forgeWorkspaceService.runCommand("test-app", "npm", ["run", "build"], "/unused"))
            .rejects.toThrow(blocked);
        expect(exec).not.toHaveBeenCalled();
    });
});
