import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The evolution self-healing handler writes source files and commits them.
 *
 * Until now nothing sat between the write and the commit: both apply paths ran
 * fs.writeFileSync -> git add -> git commit with no check of any kind, so a
 * generated patch that did not compile was committed regardless — and
 * autonomousApplyFix commits onto whatever branch happens to be checked out. A
 * single session saw 119 type errors land in a tree that had been at zero.
 *
 * These tests drive the handler with execSync and fs mocked, so no git command
 * runs and no file is touched.
 */

const execSync = vi.fn();
const writeFileSync = vi.fn();
const unlinkSync = vi.fn();

vi.mock("child_process", () => {
    const api = { execSync: (...a: any[]) => execSync(...a) };
    return { ...api, default: api };
});
vi.mock("fs", () => {
    const api = {
        writeFileSync: (...a: any[]) => writeFileSync(...a),
        unlinkSync: (...a: any[]) => unlinkSync(...a),
        existsSync: () => true,
        mkdirSync: vi.fn(),
    };
    return { ...api, default: api };
});

/** Was `git commit` invoked at all? */
const committed = () =>
    execSync.mock.calls.some(([cmd]) => typeof cmd === "string" && cmd.startsWith("git commit"));

/** Simulate tsc: pass unless the caller asks for a failure. */
function wireExecSync({ typecheckFails }: { typecheckFails: boolean }) {
    execSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("tsc --noEmit")) {
            if (typecheckFails) {
                const err: any = new Error("Command failed");
                err.stdout = "src/thing.ts(3,1): error TS2304: Cannot find name 'oops'.";
                throw err;
            }
            return "";
        }
        if (typeof cmd === "string" && cmd.startsWith("git rev-parse")) {
            return Buffer.from("refactor/crew-round-context");
        }
        return "";
    });
}

async function handler() {
    const mod = await import("./self-healing.handler.js");
    return mod.SelfHealingHandler as any;
}

beforeEach(() => {
    execSync.mockReset();
    writeFileSync.mockReset();
    unlinkSync.mockReset();
    delete process.env.EVOLUTION_SKIP_VERIFY;
    vi.resetModules();
});

afterEach(() => {
    delete process.env.EVOLUTION_SKIP_VERIFY;
});

describe("SelfHealingHandler — verification gate", () => {
    it("commits a patch that type-checks", async () => {
        wireExecSync({ typecheckFails: false });
        const H = await handler();

        await H.applyEvolutionFix("ISSUE-1", "server/domain/x/thing.ts", "export const a = 1;");

        expect(writeFileSync).toHaveBeenCalled();
        expect(committed()).toBe(true);
    });

    it("refuses to commit a patch that does not type-check", async () => {
        wireExecSync({ typecheckFails: true });
        const H = await handler();

        await expect(
            H.applyEvolutionFix("ISSUE-2", "server/domain/x/thing.ts", "export const a: number = 'oops';")
        ).rejects.toThrow(/does not type-check/);

        expect(writeFileSync).toHaveBeenCalled();
        expect(committed()).toBe(false);
    });

    it("rolls the file back when verification fails", async () => {
        wireExecSync({ typecheckFails: true });
        const H = await handler();

        await H.applyEvolutionFix("ISSUE-3", "server/domain/x/thing.ts", "broken").catch(() => undefined);

        const restored = execSync.mock.calls.some(
            ([cmd]) => typeof cmd === "string" && cmd.startsWith("git checkout --")
        );
        expect(restored).toBe(true);
    });

    it("gates the autonomous path too, which commits onto the current branch", async () => {
        wireExecSync({ typecheckFails: true });
        const H = await handler();

        await expect(
            H.autonomousApplyFix("ISSUE-4", "server/domain/x/thing.ts", "broken")
        ).rejects.toThrow(/does not type-check/);

        expect(committed()).toBe(false);
    });

    it("skips the typecheck for non-TypeScript patches", async () => {
        wireExecSync({ typecheckFails: true }); // would fail if it ran
        const H = await handler();

        await H.applyEvolutionFix("ISSUE-5", "docs/architecture.md", "# notes");

        const ranTsc = execSync.mock.calls.some(
            ([cmd]) => typeof cmd === "string" && cmd.includes("tsc --noEmit")
        );
        expect(ranTsc).toBe(false);
        expect(committed()).toBe(true);
    });

    it("honours EVOLUTION_SKIP_VERIFY as an explicit escape hatch", async () => {
        process.env.EVOLUTION_SKIP_VERIFY = "true";
        wireExecSync({ typecheckFails: true });
        const H = await handler();

        await H.applyEvolutionFix("ISSUE-6", "server/domain/x/thing.ts", "broken");

        const ranTsc = execSync.mock.calls.some(
            ([cmd]) => typeof cmd === "string" && cmd.includes("tsc --noEmit")
        );
        expect(ranTsc).toBe(false);
        expect(committed()).toBe(true);
    });
});
