import { execSync } from "child_process";

/**
 * Git-commit change detector (Phase 1 prototype for the documentation change register).
 *
 * The documentation service already scans CODE (routes, API surface, interfaces,
 * diffs) but never ties changes to git history. This detector fills that gap: it
 * reads recent commits, classifies each by its conventional-commit type into a
 * documentation SEVERITY, and maps the changed files to affected features — the
 * raw material for auto-populating the change register / drafting release notes.
 *
 * It reuses the register's vocabulary: the `features` field already exists on
 * DocumentationChange; `severity` is the one genuinely new axis.
 */

export type ChangeSeverity = "breaking" | "feature" | "fix" | "chore";

export interface DetectedGitChange {
    sha: string;
    shortSha: string;
    date: string;
    type: string;          // conventional-commit type (feat, fix, chore, …) or "unknown"
    scope: string | null;
    breaking: boolean;
    severity: ChangeSeverity;
    subject: string;       // the human description (header minus the type/scope prefix)
    files: string[];
    features: string[];    // affected features derived from the changed paths
}

export interface GitDetectionOptions {
    /** Detect commits after this ref (e.g. a tag). Overrides `limit` when set. */
    since?: string;
    /** Max commits to inspect when `since` is not given. Default 50. */
    limit?: number;
    /** Ignore merge commits. Default true. */
    noMerges?: boolean;
    cwd?: string;
}

const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/i;

/** conventional-commit type → documentation severity. */
function severityFor(type: string, breaking: boolean): ChangeSeverity {
    if (breaking) return "breaking";
    switch (type.toLowerCase()) {
        case "feat": return "feature";
        case "fix": return "fix";
        case "perf": return "fix";
        default: return "chore"; // chore, docs, refactor, test, style, ci, build, revert, unknown
    }
}

/** Top-level paths that are not product features (build/rewrite/test noise). */
const NOISE_PREFIXES = [".git-rewrite", "playwright-test-repo", "external", "node_modules", "dist", "scratch", ".github"];

/** Map a changed file path to the feature that owns it. */
export function featureForPath(path: string): string | null {
    const p = path.replace(/\\/g, "/");
    if (NOISE_PREFIXES.some((n) => p === n || p.startsWith(n + "/"))) return null;
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^server\/domain\/([^/]+)\//))) return m[1];
    if ((m = p.match(/^client\/src\/modules\/([^/]+)\//))) return m[1];
    if ((m = p.match(/^server\/blueprints\/apps\/([^/]+)\//))) return m[1];
    if ((m = p.match(/^shared\/schema\/([^/]+)\//))) return `schema:${m[1]}`;
    if (p.startsWith("docs/")) return "documentation";
    if (p.startsWith("server/routes/")) return "routes";
    if ((m = p.match(/^([^/]+)\//))) return m[1]; // top-level dir fallback
    return null;
}

function git(args: string, cwd?: string): string {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8", maxBuffer: 1024 * 1024 * 64 });
}

export function detectChangesFromGit(opts: GitDetectionOptions = {}): DetectedGitChange[] {
    const { since, limit = 50, noMerges = true, cwd } = opts;
    const range = since ? `${since}..HEAD` : `-n ${limit}`;
    const merges = noMerges ? "--no-merges" : "";

    // NUL-delimited fields, RS-delimited records → robust against newlines in bodies.
    const FMT = "%H%x1f%cI%x1f%s%x1f%b%x1e";
    let raw = "";
    try {
        raw = git(`log ${merges} ${range} --pretty=format:${FMT}`, cwd);
    } catch (e: any) {
        throw new Error(`git log failed: ${e.message}`);
    }

    const records = raw.split("\x1e").map((r) => r.trim()).filter(Boolean);
    const out: DetectedGitChange[] = [];

    for (const rec of records) {
        const [sha, date, subject, body = ""] = rec.split("\x1f");
        if (!sha) continue;

        const m = subject.match(CONVENTIONAL_RE);
        const type = m?.groups?.type?.toLowerCase() ?? "unknown";
        const scope = m?.groups?.scope ?? null;
        const desc = m?.groups?.desc ?? subject;
        const breaking = Boolean(m?.groups?.bang) || /BREAKING[ -]CHANGE/.test(body);

        let files: string[] = [];
        try {
            files = git(`show --name-only --pretty=format: ${sha}`, cwd)
                .split("\n").map((f) => f.trim()).filter(Boolean);
        } catch { /* file list is best-effort */ }

        const features = [...new Set(files.map(featureForPath).filter((f): f is string => Boolean(f)))].sort();

        out.push({
            sha,
            shortSha: sha.slice(0, 9),
            date,
            type,
            scope,
            breaking,
            severity: severityFor(type, breaking),
            subject: desc,
            files,
            features,
        });
    }
    return out;
}

/** Summarize a detection run for a release-note draft header. */
export function summarizeDetection(changes: DetectedGitChange[]) {
    const bySeverity: Record<ChangeSeverity, number> = { breaking: 0, feature: 0, fix: 0, chore: 0 };
    const features = new Set<string>();
    for (const c of changes) {
        bySeverity[c.severity]++;
        c.features.forEach((f) => features.add(f));
    }
    return { total: changes.length, bySeverity, features: [...features].sort() };
}

// CLI: `tsx server/domain/admin/infrastructure/documentation-git-detector.ts [--since <ref>] [--limit N]`
if (process.argv[1] && process.argv[1].endsWith("documentation-git-detector.ts")) {
    const args = process.argv.slice(2);
    const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
    const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 20;
    const changes = detectChangesFromGit({ since, limit });
    const summary = summarizeDetection(changes);
    console.log(`Detected ${summary.total} changes | severity:`, summary.bySeverity);
    console.log(`Features touched (${summary.features.length}):`, summary.features.join(", "));
    console.log("");
    for (const c of changes) {
        console.log(`  [${c.severity.toUpperCase().padEnd(8)}] ${c.shortSha} ${c.type}${c.scope ? `(${c.scope})` : ""}${c.breaking ? "!" : ""}: ${c.subject}`);
        if (c.features.length) console.log(`             features: ${c.features.join(", ")}`);
    }
    process.exit(0);
}
