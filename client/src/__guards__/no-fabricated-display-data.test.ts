import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

/**
 * Guard against presenting invented values as measurements.
 *
 * This is the defect that keeps coming back. In a single session the platform
 * was found rendering: a fabricated "$0.42" as money spent by a mission, an
 * "Intelligence Maturity LEVEL 0{random}" that re-rolled on every render, an
 * "Intelligence Density" percentage computed from the character codes of a pod's
 * own name (and written into generated architecture docs), a "90% Match"
 * confidence for nodes with no confidence, "Estimated Run Spend: ~$0.18" beside
 * "Soft-Cap: $2.50 · SMT Verified", a "Spend: ~$0.14 · 1.4k tokens" chip labelled
 * live, and a workflow history that seeded itself with three runs that never
 * happened. Two of those returned within hours of being removed, because nothing
 * stopped them.
 *
 * The rule is not "never use these constructs". It is that the count per file
 * may not grow. This is a ratchet: the existing violations are recorded below as
 * debt, and a new one — or a new file — fails the build. Clearing an entry is a
 * separate, deliberate act; lowering a number here is always safe and always
 * welcome.
 *
 * Two patterns are counted, both restricted to .tsx because this is about what
 * reaches a screen:
 *
 *   1. A hardcoded currency literal ("$0.42", "$84,500"). A number the user
 *      reads as money must come from data.
 *   2. Math.random() used for anything but identity. Random ids and layout
 *      jitter are fine; a random metric is a lie with a fresh value each render.
 *
 * Deliberately NOT counted, because they are legitimate: Math.random() feeding
 * an id (toString(36), randomUUID, crypto.*), regex replacement backreferences
 * ($1, $2), comments, test files, .example. files, and scaffolded blueprint apps
 * under server/blueprints.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCAN_ROOTS = ["client/src", "server/domain"];
const SKIP_DIRS = new Set(["node_modules", "blueprints", "dist", "build"]);

/** Currency written into the source: "$0.42", "$1,250.00", "$84,500". */
const CURRENCY_LITERAL = /\$\d[\d,]*\.\d{2}|\$\d[\d,]{2,}/;
/** Math.random() spent on identity rather than on a displayed value. */
const RANDOM_FOR_IDENTITY = /toString\(36\)|randomUUID|crypto\.|\$\{Math\.random\(\)\}/;

/**
 * Known violations, by file. THIS LIST MUST ONLY SHRINK.
 *
 * Roughly three groups:
 *
 *  - Legitimate, kept deliberately. sidebar.tsx randomises skeleton widths;
 *    AgentMeshVisualizer places graph nodes; MultiStepScreenContainer fills a form behind an
 *    explicit "auto-fill mock data" button; DeveloperEarnings labels the axis of
 *    a payout-threshold bar.
 *
 *  - Live fabrications: all cleared. StakeholderWorkbench's invented ROI,
 *    GovernanceDashboard's invented incident and HelperAcceptancePage's invented
 *    job offers were removed; BoardRoom.tsx, 992 unreferenced lines of
 *    mock-backed governance UI, was deleted.
 *
 *  - Synthetic pod datasets: cleared, except PlatformAgentSwarmBlock. That one
 *    keeps its simulated confidence, token counts and latency because removing
 *    them leaves no component; it now carries a "Simulated" badge and says
 *    "Sample output" in its header, so a viewer is told rather than left to
 *    assume. PlatformNLQBlock and IntegrationAnalytics no longer invent
 *    anything.
 *
 *  - CommandLaunchpadPage: the COMPUTER_USE_STEPS walkthrough is a disclosed
 *    scripted simulation — its pricing tiers and jitter are the fiction being
 *    demonstrated, not measurements presented as real. Same class as the
 *    swarm block above: the scenario tells the viewer it is simulated.
 */
const BASELINE: Record<string, number> = {
    "client/src/components/agent-chat/AgoraDeliberationBriefing.tsx": 1,
    "client/src/components/agent-chat/TokenizedAppSurface.tsx": 1,
    "client/src/components/ui/sidebar.tsx": 1,
    "client/src/modules/apps/components/MultiStepScreenContainer.tsx": 1,
    "server/domain/core/ui/components/packaged/PlatformAgentChatBlock.tsx": 1,
    "server/domain/core/ui/components/packaged/PlatformAgentSwarmBlock.tsx": 4,
    "server/domain/core/ui/components/packaged/PlatformMetricGaugeBlock.tsx": 1,
    "server/domain/core/ui/components/packaged/PlatformMissionLogBlock.tsx": 1,
    "server/domain/ecommerce/ui/modules/billing/pages/DeveloperEarnings.tsx": 3,
    "server/domain/rescue/ui/modules/rescue/components/TacticalDispatchDashboard.tsx": 1,
    "server/domain/apps/ui/modules/apps/pages/CommandLaunchpadPage.tsx": 12,
};

function scanFiles(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            scanFiles(full, out);
        } else if (entry.endsWith(".tsx") && !entry.includes(".test.") && !entry.includes(".example.")) {
            out.push(full);
        }
    }
    return out;
}

const BLOCK_OPEN = "/" + "*";
const BLOCK_CLOSE = "*" + "/";

/**
 * Remove comments before counting.
 *
 * This tracks block-comment state rather than asking whether a line begins with
 * a comment marker. The comments that record these removals quote the constants
 * they removed — "$120.00", "$15.00" — on continuation lines that start with
 * ordinary prose, so a prefix test counts the explanation as a fresh violation.
 * Handles line comments and block comments, including JSX's braced form.
 * String literals that contain a comment marker are not modelled; none of the
 * scanned files rely on that.
 */
function stripComments(source: string): string[] {
    const out: string[] = [];
    let inBlock = false;

    for (const rawLine of source.split(/\r?\n/)) {
        let line = rawLine;

        if (inBlock) {
            const end = line.indexOf(BLOCK_CLOSE);
            if (end === -1) {
                out.push("");
                continue;
            }
            line = line.slice(end + 2);
            inBlock = false;
        }

        for (;;) {
            const block = line.indexOf(BLOCK_OPEN);
            const lineComment = line.indexOf("//");

            if (lineComment !== -1 && (block === -1 || lineComment < block)) {
                line = line.slice(0, lineComment);
                break;
            }
            if (block === -1) break;

            const end = line.indexOf(BLOCK_CLOSE, block + 2);
            if (end === -1) {
                line = line.slice(0, block);
                inBlock = true;
                break;
            }
            line = line.slice(0, block) + line.slice(end + 2);
        }

        out.push(line);
    }

    return out;
}

function countViolations(source: string): number {
    let count = 0;
    for (const line of stripComments(source)) {
        if (CURRENCY_LITERAL.test(line)) count++;
        else if (line.includes("Math.random()") && !RANDOM_FOR_IDENTITY.test(line)) count++;
    }
    return count;
}

function currentCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const root of SCAN_ROOTS) {
        for (const file of scanFiles(join(REPO_ROOT, root))) {
            const rel = file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
            const n = countViolations(readFileSync(file, "utf8"));
            if (n > 0) counts[rel] = n;
        }
    }
    return counts;
}

describe("no fabricated display data", () => {
    it("scans a plausible number of files", () => {
        // Guards the scanner: a path or extension change that silently matched
        // nothing would make every assertion below vacuously true.
        const scanned = SCAN_ROOTS.reduce((n, r) => n + scanFiles(join(REPO_ROOT, r)).length, 0);
        expect(scanned).toBeGreaterThan(200);
    });

    it("introduces no new file that fabricates displayed values", () => {
        const offenders = Object.keys(currentCounts()).filter(f => !(f in BASELINE));
        expect(offenders, [
            "These files render a hardcoded currency figure, or use Math.random() for",
            "something other than an id. A number a user reads as a measurement has to",
            "come from data — render nothing when there is none.",
        ].join(" ")).toEqual([]);
    });

    it("does not increase the count in any file that already has some", () => {
        const counts = currentCounts();
        const worse = Object.entries(counts)
            .filter(([file, n]) => file in BASELINE && n > BASELINE[file])
            .map(([file, n]) => `${file}: ${BASELINE[file]} -> ${n}`);
        expect(worse).toEqual([]);
    });

    it("keeps the baseline honest when violations are fixed", () => {
        // A file that has been cleaned must be removed from BASELINE, so the list
        // reflects real debt rather than accumulating stale entries that would
        // silently permit a regression.
        const counts = currentCounts();
        const stale = Object.entries(BASELINE)
            .filter(([file, n]) => (counts[file] ?? 0) < n)
            .map(([file, n]) => `${file}: baseline ${n}, actual ${counts[file] ?? 0} — lower or remove this entry`);
        expect(stale).toEqual([]);
    });

    it("still catches the specific constants that were removed once already", () => {
        const counts = currentCounts();
        // These two carried the fabricated ticker and forge figures. If either
        // grows past the comment-only mentions it retains, the fix regressed.
        expect(counts["server/domain/core/ui/components/layout/HeaderMissionTicker.tsx"] ?? 0).toBe(0);
        expect(counts["client/src/modules/apps/AppStudioPod.tsx"] ?? 0).toBeLessThanOrEqual(2);
    });
});
