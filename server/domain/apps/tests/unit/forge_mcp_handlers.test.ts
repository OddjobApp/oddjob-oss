import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("Forge MCP handlers", () => {
    let workspaceRoot: string;

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oddjob-forge-workspace-"));
        process.env.FORGE_WORKSPACE = workspaceRoot;
        vi.resetModules();
    });

    afterEach(async () => {
        delete process.env.FORGE_WORKSPACE;
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    });

    it("lists files from the configured Forge workspace resolver", async () => {
        const appDir = path.join(workspaceRoot, "resolver-app");
        await fs.mkdir(path.join(appDir, "pages"), { recursive: true });
        await fs.writeFile(path.join(appDir, "pages", "index.tsx"), "export default function Home() { return null; }");

        const { handleStudioListFiles } = await import("../../../../mcp/handlers/forge.js");
        const result = await handleStudioListFiles({ slug: "resolver-app" });

        if (!("success" in result)) throw new Error(`expected success result, got ${JSON.stringify(result)}`);
        expect(result.success).toBe(true);
        expect(JSON.stringify(result.tree)).toContain("index.tsx");
    });

    it("reads files through the configured Forge workspace resolver", async () => {
        const appDir = path.join(workspaceRoot, "read-app");
        await fs.mkdir(path.join(appDir, "pages"), { recursive: true });
        await fs.writeFile(path.join(appDir, "pages", "index.tsx"), "hello from configured workspace");

        const { handleStudioReadFile } = await import("../../../../mcp/handlers/forge.js");
        const result = await handleStudioReadFile({ slug: "read-app", filePath: "pages/index.tsx" });

        if (!("success" in result)) throw new Error(`expected success result, got ${JSON.stringify(result)}`);
        expect(result.success).toBe(true);
        expect(result.content).toBe("hello from configured workspace");
    });

    it("rejects traversal attempts when reading files", async () => {
        const appDir = path.join(workspaceRoot, "safe-app");
        await fs.mkdir(appDir, { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, "secret.txt"), "secret");

        const { handleStudioReadFile } = await import("../../../../mcp/handlers/forge.js");
        const result = await handleStudioReadFile({ slug: "safe-app", filePath: "../secret.txt" });

        if (!("isError" in result)) throw new Error(`expected error result, got ${JSON.stringify(result)}`);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Invalid path/);
    });

    it("allows intentional empty file writes", async () => {
        const appDir = path.join(workspaceRoot, "empty-file-app");
        await fs.mkdir(appDir, { recursive: true });

        const { handleForgeEditFile } = await import("../../../../mcp/handlers/forge.js");
        const result = await handleForgeEditFile({
            slug: "empty-file-app",
            filePath: "pages/empty.tsx",
            content: "",
        });

        expect(result.success).toBe(true);
        const written = await fs.readFile(path.join(appDir, "pages", "empty.tsx"), "utf-8");
        expect(written).toBe("");
    });
});
