/**
 * Static, deterministic gates for self-improvement proposals.
 *
 * These replace the previous "does the diff text contain a keyword (anywhere,
 * including comments) + Math.random()" checks. They are NOT a runtime chaos
 * simulation — they are a reproducible static gate that a proposal must clear:
 *   1. the proposed change is non-empty and syntactically valid code, and
 *   2. the relevant construct appears in real code, not a comment or string.
 * Anything that cannot be validated fails closed.
 */
import ts from "typescript";

export interface ProposalCheck {
    ok: boolean;
    reason?: { code: string; message: string };
}

/**
 * Replace comments and string/template literals with empty placeholders so that
 * construct detection sees only real code. A keyword sitting in a comment or a
 * string literal can therefore no longer satisfy a validation gate.
 * (Order matters: block comments, then literals, then line comments — so a `//`
 * inside a string is removed as part of the string, not mistaken for a comment.)
 */
export function stripCommentsAndStrings(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, " ")        // block comments
        .replace(/`(?:\\.|[^`\\])*`/g, "``")       // template literals
        .replace(/"(?:\\.|[^"\\])*"/g, '""')       // double-quoted strings
        .replace(/'(?:\\.|[^'\\])*'/g, "''")       // single-quoted strings
        .replace(/\/\/[^\n]*/g, " ");              // line comments
}

/**
 * True when `code` is non-empty and free of TypeScript SYNTAX errors. A per-file
 * transpile has no project context, so semantic diagnostics (codes >= 2000, e.g.
 * "cannot find module") are ignored and only parse/syntax errors (1xxx) count —
 * a genuine, non-gameable signal that the change is at least well-formed code.
 */
export function isSyntacticallyValid(code: string): boolean {
    if (!code.trim()) return false;
    const { diagnostics } = ts.transpileModule(code, {
        reportDiagnostics: true,
        compilerOptions: {
            noEmit: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.Preserve,
        },
    });
    const syntaxErrors = (diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error && d.code >= 1000 && d.code < 2000,
    );
    return syntaxErrors.length === 0;
}

/**
 * True when at least one pattern matches the code AFTER comments and string
 * literals are stripped — i.e. the construct appears in real code.
 */
export function containsConstructInCode(code: string, patterns: RegExp[]): boolean {
    const stripped = stripCommentsAndStrings(code);
    return patterns.some((p) => p.test(stripped));
}

/**
 * Gate a proposed change: it must be syntactically valid AND introduce at least
 * one of `patterns` in real code.
 */
export function evaluateProposalConstructs(
    newContent: string,
    patterns: RegExp[],
    fail: { code: string; message: string },
): ProposalCheck {
    if (!isSyntacticallyValid(newContent)) {
        return {
            ok: false,
            reason: { code: "SIM_INVALID_CHANGE", message: "Proposed change is empty or not syntactically valid TypeScript." },
        };
    }
    if (!containsConstructInCode(newContent, patterns)) {
        return { ok: false, reason: fail };
    }
    return { ok: true };
}

/**
 * Resolve and validate the change behind a `PROPOSED-<id>` harness version.
 * Baseline (established) versions are the deterministic reference point and pass.
 * Fails closed: a missing/unparseable proposal or any lookup error never passes.
 */
export async function validateProposalChange(
    harnessVersion: string,
    patterns: RegExp[],
    fail: { code: string; message: string },
): Promise<ProposalCheck> {
    if (!harnessVersion.startsWith("PROPOSED-")) {
        return { ok: true };
    }
    const proposalId = parseInt(harnessVersion.split("-")[1] ?? "", 10);
    if (Number.isNaN(proposalId)) {
        return { ok: false, reason: { code: "SIM_INVALID_CHANGE", message: `Unparseable proposal id in version '${harnessVersion}'.` } };
    }
    try {
        const { db } = await import("@server/database_service.js");
        const { harnessProposals } = await import("@shared/schema/index.js");
        const { eq } = await import("drizzle-orm");
        const [proposal] = await db.select().from(harnessProposals).where(eq(harnessProposals.id, proposalId));
        if (!proposal) {
            return { ok: false, reason: { code: "SIM_NO_PROPOSAL", message: `Proposal ${proposalId} not found; cannot validate.` } };
        }
        return evaluateProposalConstructs(proposal.proposedChange.newContent ?? "", patterns, fail);
    } catch (err: any) {
        return { ok: false, reason: { code: "SIM_ERROR", message: `Could not validate proposal: ${err?.message ?? err}` } };
    }
}
