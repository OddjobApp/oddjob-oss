import { describe, it, expect, vi } from "vitest";

import { ensureDocsCheckout, type DocsCheckoutConfig, type CheckoutDeps } from "./docs-checkout.js";

function makeConfig(overrides: Partial<DocsCheckoutConfig> = {}): DocsCheckoutConfig {
    return {
        path: "/srv/acdd-docs",
        mode: "worktree",
        source: "/srv/oddjob",
        branch: "docs/capabilities",
        remote: "origin",
        ...overrides,
    };
}

/** Fake git that records calls; branch existence driven by `existingBranches`. */
function makeGit(opts: { currentBranch?: string; existingBranches?: string[] } = {}) {
    const calls: string[][] = [];
    const existing = new Set(opts.existingBranches ?? []);
    const git = async (args: string[]) => {
        calls.push(args);
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return `${opts.currentBranch ?? "main"}\n`;
        if (args[0] === "rev-parse" && args[1] === "--verify") {
            const ref = args[3] ?? "";
            const branch = ref.replace("refs/heads/", "");
            if (!existing.has(branch)) throw new Error("unknown revision");
            return "";
        }
        return "";
    };
    return { git, calls };
}

describe("ensureDocsCheckout", () => {
    it("reports not-ready when no path is configured", async () => {
        const res = await ensureDocsCheckout(makeConfig({ path: null }), { isGitRepo: async () => false });
        expect(res.ready).toBe(false);
        expect(res.reason).toMatch(/not set/);
    });

    it("checks out the target branch when the checkout already exists on another branch", async () => {
        const { git, calls } = makeGit({ currentBranch: "main", existingBranches: ["docs/capabilities"] });
        const deps: CheckoutDeps = { git, isGitRepo: async () => true };

        const res = await ensureDocsCheckout(makeConfig(), deps);

        expect(res.ready).toBe(true);
        expect(res.created).toBe(false);
        expect(calls).toContainEqual(["checkout", "docs/capabilities"]);
    });

    it("does nothing when the existing checkout is already on the target branch", async () => {
        const { git, calls } = makeGit({ currentBranch: "docs/capabilities" });
        const res = await ensureDocsCheckout(makeConfig(), { git, isGitRepo: async () => true });

        expect(res.ready).toBe(true);
        expect(calls.some((c) => c[0] === "checkout")).toBe(false);
    });

    it("provisions a worktree for an existing branch", async () => {
        const { git, calls } = makeGit({ existingBranches: ["docs/capabilities"] });
        const res = await ensureDocsCheckout(makeConfig({ mode: "worktree" }), { git, isGitRepo: async () => false });

        expect(res.ready).toBe(true);
        expect(res.created).toBe(true);
        expect(calls).toContainEqual(["worktree", "add", "/srv/acdd-docs", "docs/capabilities"]);
    });

    it("provisions a worktree AND creates the branch when it doesn't exist yet", async () => {
        const { git, calls } = makeGit({ existingBranches: [] });
        const res = await ensureDocsCheckout(makeConfig({ mode: "worktree" }), { git, isGitRepo: async () => false });

        expect(res.created).toBe(true);
        expect(calls).toContainEqual(["worktree", "add", "-b", "docs/capabilities", "/srv/acdd-docs"]);
    });

    it("provisions via clone when configured", async () => {
        const { git, calls } = makeGit();
        const res = await ensureDocsCheckout(
            makeConfig({ mode: "clone", source: "git@host:org/repo.git" }),
            { git, isGitRepo: async () => false },
        );

        expect(res.ready).toBe(true);
        expect(calls).toContainEqual(["clone", "--branch", "docs/capabilities", "git@host:org/repo.git", "/srv/acdd-docs"]);
    });

    it("refuses to provision when mode is none", async () => {
        const { git, calls } = makeGit();
        const res = await ensureDocsCheckout(makeConfig({ mode: "none" }), { git, isGitRepo: async () => false });

        expect(res.ready).toBe(false);
        expect(res.reason).toMatch(/no provisioning/);
        expect(calls.some((c) => c[0] === "worktree" || c[0] === "clone")).toBe(false);
    });
});
