/**
 * The three lists that decide whether a builder pod can ever be mounted.
 *
 * Mounting a pod from chat passes through three independently-maintained lists,
 * and every one of them can silently disagree with the others:
 *
 *   1. BUILDER_POD_RULES            — which pod a message routes to
 *   2. the assembly directive's     — which pods the model is told exist
 *      "Available podComponent values"
 *   3. mount_builder_pod's enum     — which pods the tool will accept
 *
 * and behind all three, the packaged registry — which pods actually resolve to
 * a component.
 *
 * They had drifted. "I want to plan a project" mounted nothing because the
 * planning pod was absent from (1) and (2) while present in (3), and earlier the
 * same pod was advertised in (3) while missing from the registry's explicit
 * bindings. Each gap is invisible: the tool call succeeds, or the round simply
 * says nothing, and no test failed.
 *
 * A source assertion, following improvement.routes.mounted.test.ts: these are
 * properties of the files, and the failure mode is silence.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIRECTIVES = fs.readFileSync(
    path.resolve(ROOT, "server/domain/crew/core/crew-assembly-directives.ts"),
    "utf8",
);
const ASSEMBLY_TOOLS = fs.readFileSync(
    path.resolve(ROOT, "server/domain/tools/v1/capabilities/assembly-tools.ts"),
    "utf8",
);
const PACKAGED_DIR = path.resolve(ROOT, "server/domain/core/ui/components/packaged");

/** Pods mount_builder_pod says it accepts, from its podComponent description. */
function podsAcceptedByTool(): string[] {
    const line = ASSEMBLY_TOOLS.split(/\r?\n/).find(
        (l) => l.includes("podComponent") && l.includes("packaged registry"),
    );
    expect(line, "mount_builder_pod's podComponent description not found").toBeTruthy();
    return [...new Set((line!.match(/'([A-Za-z]+Pod)'/g) ?? []).map((s) => s.replace(/'/g, "")))];
}

/** Pods the directive advertises to the model. */
function podsAdvertisedToModel(): string[] {
    const line = DIRECTIVES.split(/\r?\n/).find((l) => l.includes("Available podComponent values"));
    expect(line, "the directive's advertised pod list not found").toBeTruthy();
    return [...new Set((line!.match(/"([A-Za-z]+Pod)"/g) ?? []).map((s) => s.replace(/"/g, "")))];
}

/** Pods BUILDER_POD_RULES can route a message to, plus the fallback. */
function podsRoutable(): string[] {
    const block = DIRECTIVES.slice(
        DIRECTIVES.indexOf("const BUILDER_POD_RULES"),
        DIRECTIVES.indexOf("];", DIRECTIVES.indexOf("const BUILDER_POD_RULES")),
    );
    const fromRules = (block.match(/pod:\s*"([A-Za-z]+Pod)"/g) ?? []).map((s) =>
        s.replace(/.*"([A-Za-z]+Pod)".*/, "$1"),
    );
    const fallback = DIRECTIVES.match(/\?\?\s*"([A-Za-z]+Pod)"/)?.[1];
    return [...new Set([...fromRules, ...(fallback ? [fallback] : [])])];
}

describe("builder pod registry invariant", () => {
    it("finds all three lists, so the assertions cannot pass vacuously", () => {
        expect(podsAcceptedByTool().length).toBeGreaterThan(5);
        expect(podsAdvertisedToModel().length).toBeGreaterThan(5);
        expect(podsRoutable().length).toBeGreaterThan(3);
    });

    it("every pod the tool accepts has a component to resolve to", () => {
        // The registry resolves by module name via import.meta.glob("./*.tsx"),
        // so a missing file means the mount renders a failure notice.
        const missing = podsAcceptedByTool().filter(
            (p) => !fs.existsSync(path.join(PACKAGED_DIR, `${p}.tsx`)),
        );
        expect(missing, `advertised by mount_builder_pod with no component: ${missing.join(", ")}`).toEqual([]);
    });

    it("never advertises a pod to the model that the tool would reject", () => {
        const accepted = new Set(podsAcceptedByTool());
        const orphaned = podsAdvertisedToModel().filter((p) => !accepted.has(p));
        expect(orphaned, `named in the directive but not in mount_builder_pod: ${orphaned.join(", ")}`).toEqual([]);
    });

    it("never routes a message to a pod the tool would reject", () => {
        const accepted = new Set(podsAcceptedByTool());
        const orphaned = podsRoutable().filter((p) => !accepted.has(p));
        expect(orphaned, `routable by BUILDER_POD_RULES but not in mount_builder_pod: ${orphaned.join(", ")}`).toEqual([]);
    });

    it("advertises every pod it can route to, so a routed pod is nameable", () => {
        // This is the gap that broke "I want to plan a project": a rule can
        // select a pod the model was never told about.
        const advertised = new Set(podsAdvertisedToModel());
        const unnameable = podsRoutable().filter((p) => !advertised.has(p));
        expect(unnameable, `routable but absent from the directive's list: ${unnameable.join(", ")}`).toEqual([]);
    });
});
