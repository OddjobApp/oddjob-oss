import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GitDocWriterService, GitDocWriterError, type GitRunner } from "./git-doc-writer.service.js";

let repoRoot: string;

beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "acdd-git-"));
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
});

afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
});

/** Fake git runner that records invocations and returns canned output. */
function makeFakeGit(opts: { dirty?: boolean } = {}) {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
        calls.push(args);
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "feature/current\n";
        if (args[0] === "rev-parse" && args[1] === "--verify") {
            // Audit branches don't exist yet; the base branch does.
            if (args[3]?.includes("audit/")) throw new Error("unknown revision");
            return "";
        }
        if (args[0] === "status" && args[1] === "--porcelain") {
            return opts.dirty === false ? "" : " M docs/capabilities/x.md\n";
        }
        if (args[0] === "remote") return "origin\n";
        return "";
    };
    return { git, calls };
}

describe("path safety", () => {
    it("rejects a capability_id that could escape the docs directory", () => {
        const writer = new GitDocWriterService({ config: { repoRoot } });
        expect(() => writer.docPath("../../etc/passwd")).toThrow(GitDocWriterError);
        expect(() => writer.docPath("has spaces")).toThrow(GitDocWriterError);
    });
});

describe("write() with auto-commit disabled (safe default)", () => {
    it("writes the file to disk but does not commit", async () => {
        const { git, calls } = makeFakeGit();
        const writer = new GitDocWriterService({ config: { repoRoot, autoCommit: false }, git });

        const result = await writer.write("extract_invoice_rows", "# Doc\n", "Low");

        expect(result.written).toBe(true);
        expect(result.committed).toBe(false);
        expect(result.message).toMatch(/auto-commit disabled/);
        expect(calls).toHaveLength(0); // git never invoked

        const onDisk = await fs.readFile(
            path.join(repoRoot, "docs/capabilities/extract_invoice_rows.md"),
            "utf8",
        );
        expect(onDisk).toBe("# Doc\n");
    });
});

describe("write() with auto-commit, in-place (Low risk)", () => {
    it("stages ONLY the single file and commits on the current branch", async () => {
        const { git, calls } = makeFakeGit({ dirty: true });
        const writer = new GitDocWriterService({
            config: { repoRoot, autoCommit: true, manageBranches: false },
            git,
        });

        const result = await writer.write("extract_invoice_rows", "# Doc\n", "Low");

        expect(result.committed).toBe(true);
        expect(result.requiresReview).toBe(false);
        expect(result.branch).toBe("feature/current");

        const add = calls.find((c) => c[0] === "add");
        expect(add).toEqual(["add", "--", "docs/capabilities/extract_invoice_rows.md"]);
        // Critical safety property: never a broad "git add -A".
        expect(calls.every((c) => !c.includes("-A"))).toBe(true);
        // No branch switching in the safe default path.
        expect(calls.some((c) => c[0] === "checkout")).toBe(false);
    });

    it("reports no-op when the file is unchanged", async () => {
        const { git } = makeFakeGit({ dirty: false });
        const writer = new GitDocWriterService({ config: { repoRoot, autoCommit: true }, git });
        const result = await writer.write("extract_invoice_rows", "# Doc\n", "Low");
        expect(result.committed).toBe(false);
        expect(result.message).toMatch(/No changes to commit/);
    });
});

describe("write() with managed branches (High risk)", () => {
    it("isolates to an audit branch, flags review, and restores the original branch", async () => {
        const { git, calls } = makeFakeGit({ dirty: true });
        const reviewHook = vi.fn();
        const writer = new GitDocWriterService({
            config: { repoRoot, autoCommit: true, manageBranches: true },
            git,
            reviewHook,
        });

        const result = await writer.write("extract_invoice_rows", "# Doc\n", "Critical");

        expect(result.requiresReview).toBe(true);
        expect(result.branch).toBe("audit/capability-extract_invoice_rows");
        expect(result.committed).toBe(true);
        expect(reviewHook).toHaveBeenCalledWith(
            "extract_invoice_rows",
            "audit/capability-extract_invoice_rows",
        );

        // Created the audit branch then restored the original.
        expect(calls).toContainEqual(["checkout", "-b", "audit/capability-extract_invoice_rows"]);
        expect(calls).toContainEqual(["checkout", "feature/current"]);
    });
});
