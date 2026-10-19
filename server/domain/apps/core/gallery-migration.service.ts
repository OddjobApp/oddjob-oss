import { blankStringsAndComments } from "./forge-validator.service.js";

/**
 * Deterministic mapping of raw HTML controls onto Oddjob gallery components.
 *
 * Deterministic on purpose. Sending a working application back through a model
 * to "restyle" it is how business logic quietly changes during what the author
 * asked to be a styling pass — so the mechanical part is done mechanically, and
 * anything requiring judgement is reported rather than guessed at.
 *
 * The boundary is drawn tightly and stated out loud. Only three controls are
 * drop-in replacements whose props and children survive the swap unchanged:
 *
 *   <button>   → <Button>
 *   <input>    → <Input>
 *   <textarea> → <Textarea>
 *
 * <select> is NOT one of them, however tempting: the gallery's Select is a
 * composed Radix component whose children are SelectItem, not <option>, so a
 * textual swap produces markup that renders nothing. The same is true of table,
 * dialog and form. Those are reported as needing a person, which is the
 * difference between a migration and a silent replacement.
 */

export interface MigrationNote {
    kind: "mapped" | "needs-review";
    detail: string;
}

export interface FileMigration {
    path: string;
    before: string;
    after: string;
    changed: boolean;
    notes: MigrationNote[];
}

/** Controls whose props and children survive a textual swap. */
const DROP_IN: { tag: string; component: string; importPath: string }[] = [
    { tag: "button", component: "Button", importPath: "@/components/ui/button" },
    { tag: "input", component: "Input", importPath: "@/components/ui/input" },
    { tag: "textarea", component: "Textarea", importPath: "@/components/ui/textarea" },
];

/** Controls that need restructuring, not renaming. */
const NEEDS_REVIEW: Record<string, string> = {
    select: "Select is a composed component whose children are SelectItem, not <option>; renaming the tag would render an empty control.",
    table: "Table is composed of TableHeader, TableBody, TableRow and TableCell; the existing markup has to be restructured.",
    dialog: "Dialog needs a trigger and a content region, which cannot be inferred from a <dialog> element.",
    form: "Form binds to a resolver and field context; wiring it requires knowing how the existing form submits.",
};

/**
 * Rewrite one file's drop-in controls, leaving everything else alone.
 *
 * Matching runs against a copy with strings and comments blanked, and the
 * replacements are spliced into the ORIGINAL at those offsets — so a `<button>`
 * written inside a string literal or described in a comment is never rewritten,
 * while the real markup around it is.
 */
export function migrateFileToGallery(path: string, content: string): FileMigration {
    const notes: MigrationNote[] = [];
    const code = blankStringsAndComments(content);

    // Collect every edit first, then apply right-to-left so earlier offsets stay
    // valid as the string changes length.
    const edits: { start: number; end: number; text: string }[] = [];
    const usedComponents = new Set<string>();

    for (const { tag, component } of DROP_IN) {
        const open = new RegExp(`<${tag}(?=[\\s/>])`, "g");
        const close = new RegExp(`</${tag}\\s*>`, "g");

        let m: RegExpExecArray | null;
        while ((m = open.exec(code)) !== null) {
            edits.push({ start: m.index, end: m.index + tag.length + 1, text: `<${component}` });
            usedComponents.add(component);
        }
        while ((m = close.exec(code)) !== null) {
            edits.push({ start: m.index, end: m.index + m[0].length, text: `</${component}>` });
            usedComponents.add(component);
        }
    }

    for (const [tag, why] of Object.entries(NEEDS_REVIEW)) {
        if (new RegExp(`<${tag}(?=[\\s/>])`).test(code)) {
            notes.push({ kind: "needs-review", detail: `<${tag}>: ${why}` });
        }
    }

    // A colour literal is a decision about intent — which semantic token did the
    // author mean? Reported, never guessed.
    if (/(?:className|class)\s*=\s*["'`][^"'`]*\[#[0-9a-fA-F]{3,8}\]/.test(content)) {
        notes.push({
            kind: "needs-review",
            detail: "Hardcoded colour literal: replace with a semantic token (bg-background, text-foreground, border-border).",
        });
    }

    if (edits.length === 0) {
        return { path, before: content, after: content, changed: false, notes };
    }

    let after = content;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
    }

    after = ensureImports(after, usedComponents);

    for (const component of usedComponents) {
        notes.push({ kind: "mapped", detail: `Mapped raw controls to ${component}.` });
    }

    return { path, before: content, after, changed: after !== content, notes };
}

/**
 * Add the gallery imports a rewritten file now needs.
 *
 * Only for components not already imported from anywhere — re-importing a name
 * the file already has produces a duplicate-identifier error, which would turn
 * a styling migration into a build failure.
 */
function ensureImports(content: string, components: Set<string>): string {
    const missing = [...components].filter(
        (component) => !new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}`).test(content),
    );
    if (missing.length === 0) return content;

    const lines = missing.map((component) => {
        const entry = DROP_IN.find((d) => d.component === component)!;
        return `import { ${component} } from "${entry.importPath}";`;
    });

    // After the last existing import, so directives like "use client" and any
    // license header stay at the top where they have to be.
    const code = blankStringsAndComments(content);
    const importPattern = /^import\s[^\n]*$/gm;
    let lastEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = importPattern.exec(code)) !== null) lastEnd = m.index + m[0].length;

    if (lastEnd === -1) return `${lines.join("\n")}\n${content}`;
    return `${content.slice(0, lastEnd)}\n${lines.join("\n")}${content.slice(lastEnd)}`;
}

export interface MigrationProposal {
    slug: string;
    files: FileMigration[];
    /** Files deliberately left alone, and why. */
    skipped: { path: string; reason: string }[];
    filesChanged: number;
    needsReview: number;
}

/**
 * Propose a migration without applying any of it.
 *
 * Takes the classification's own split rather than re-deriving it, so the files
 * it refuses to touch are exactly the ones classifyScaffold marked as bespoke.
 * "Never silently replace unsupported custom components" is a property of this
 * function taking `preserveFiles` seriously, not of the caller remembering to.
 */
export async function proposeGalleryMigration(
    slug: string,
    migratableFiles: string[],
    preserveFiles: string[] = [],
): Promise<MigrationProposal> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");

    const proposal: MigrationProposal = { slug, files: [], skipped: [], filesChanged: 0, needsReview: 0 };
    const preserved = new Set(preserveFiles);

    let root: string;
    try {
        root = await resolveForgeWorkspacePath(slug);
    } catch {
        return proposal;
    }

    for (const rel of migratableFiles) {
        if (preserved.has(rel)) {
            proposal.skipped.push({ path: rel, reason: "Bespoke UI, preserved rather than migrated." });
            continue;
        }

        let content: string;
        try {
            content = await fs.readFile(path.join(root, rel), "utf-8");
        } catch {
            proposal.skipped.push({ path: rel, reason: "File could not be read." });
            continue;
        }

        const migration = migrateFileToGallery(rel, content);
        proposal.files.push(migration);
        if (migration.changed) proposal.filesChanged++;
        proposal.needsReview += migration.notes.filter((n) => n.kind === "needs-review").length;
    }

    return proposal;
}

export interface MigrationApplication {
    applied: string[];
    /** Files whose content moved since the proposal, so the reviewed diff no longer describes them. */
    stale: string[];
    failed: { path: string; error: string }[];
}

/**
 * Write an approved migration, but only over the files it was proposed against.
 *
 * The snapshot is the record of what the author reviewed. Before writing each
 * file this compares what is on disk now with what the snapshot captured — if
 * they differ, something changed after the proposal was rendered and the diff
 * the author approved no longer describes that file, so it is reported stale
 * and skipped rather than overwritten.
 *
 * That check is why the mapper being deterministic matters: identical input
 * gives identical output, so re-deriving here reproduces exactly the `after` the
 * author saw rather than something merely similar.
 */
export async function applyGalleryMigration(
    slug: string,
    snapshotFiles: Record<string, string | null>,
): Promise<MigrationApplication> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath, isWithinDirectory } = await import("./forge-paths.js");

    const result: MigrationApplication = { applied: [], stale: [], failed: [] };
    const root = await resolveForgeWorkspacePath(slug);

    for (const [rel, reviewed] of Object.entries(snapshotFiles)) {
        const full = path.resolve(root, rel);
        if (!isWithinDirectory(root, full)) {
            result.failed.push({ path: rel, error: "Path escapes the workspace." });
            continue;
        }

        let current: string;
        try {
            current = await fs.readFile(full, "utf-8");
        } catch (err: any) {
            result.failed.push({ path: rel, error: `Could not read: ${err?.message ?? err}` });
            continue;
        }

        if (reviewed !== null && current !== reviewed) {
            result.stale.push(rel);
            continue;
        }

        const migration = migrateFileToGallery(rel, current);
        if (!migration.changed) continue;

        try {
            await fs.writeFile(full, migration.after, "utf-8");
            result.applied.push(rel);
        } catch (err: any) {
            result.failed.push({ path: rel, error: `Could not write: ${err?.message ?? err}` });
        }
    }

    return result;
}

export interface MigrationVerification {
    ok: boolean;
    /** Security findings the migration introduced. Never acceptable. */
    blocking: string[];
    /** Gallery conformance after the change, for the report. */
    filesWithFindings: number;
    scanned: number;
}

/**
 * Check that a written migration left the app better rather than broken.
 *
 * Two questions, and only one of them can fail the migration. A new security
 * finding is blocking, because a styling pass has no business introducing one.
 * Remaining gallery findings are not: the mapper deliberately leaves select,
 * table, dialog and form alone, so an app that still has findings afterwards is
 * the expected outcome, not a failure.
 */
export async function verifyMigration(slug: string, changedPaths: string[]): Promise<MigrationVerification> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");
    const { forgeValidatorService } = await import("./forge-validator.service.js");
    const { auditWorkspaceGallery } = await import("./gallery-audit.service.js");

    const blocking: string[] = [];
    const root = await resolveForgeWorkspacePath(slug);

    const files: Record<string, string> = {};
    for (const rel of changedPaths) {
        try {
            files[rel] = await fs.readFile(path.join(root, rel), "utf-8");
        } catch {
            blocking.push(`${rel} could not be read back after being written.`);
        }
    }

    if (Object.keys(files).length > 0) {
        const validation = await forgeValidatorService.validateCode(files);
        for (const issue of validation.issues) {
            if (issue.type === "GALLERY_CONFORMANCE") continue;
            if (issue.severity === "critical" || issue.severity === "high") {
                blocking.push(`${issue.file}: ${issue.message}`);
            }
        }
    }

    const audit = await auditWorkspaceGallery(slug);
    return {
        ok: blocking.length === 0,
        blocking,
        filesWithFindings: audit.filesWithFindings,
        scanned: audit.scanned,
    };
}

/** A unified-diff-ish rendering of one file's migration, for review before applying. */
export function renderMigrationDiff(migration: FileMigration, contextLines = 2): string {
    if (!migration.changed) return "";

    const before = migration.before.split("\n");
    const after = migration.after.split("\n");
    const out: string[] = [`--- ${migration.path}`, `+++ ${migration.path}`];

    let i = 0;
    let j = 0;
    while (i < before.length || j < after.length) {
        if (before[i] === after[j]) {
            i++;
            j++;
            continue;
        }
        // A changed region: emit a little context, then the change itself.
        const start = Math.max(0, i - contextLines);
        for (let k = start; k < i; k++) out.push(`  ${before[k]}`);
        if (i < before.length) out.push(`- ${before[i]}`);
        if (j < after.length) out.push(`+ ${after[j]}`);
        i++;
        j++;
    }

    return out.join("\n");
}
