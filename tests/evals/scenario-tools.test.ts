/**
 * Capability scenarios have to name capabilities that exist.
 *
 * Two of the five named tools the platform has never had. cap_write_file asked
 * for "write_file" (the registered name is file_write) and cap_save_to_dataset
 * asked for "save_to_dataset", which is a job type rather than a capability and
 * so is not something an agent can emit at all.
 *
 * Neither failed anything. A tool_used criterion that can never be satisfied
 * just scores zero, so both subjects returned a flat 0.25 with no variance on
 * every repeat, and the baseline recorded that as their expected performance.
 * The nightly job spent real LLM calls measuring a typo.
 *
 * Both scenario files carried a "_note" asking for the tool name to be
 * confirmed. Nobody could confirm it by reading, which is the argument for
 * checking it here: a scaffold with an unverified name should fail in a second,
 * not survive a month of nightly runs looking like a capability gap.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SCENARIO_DIR = path.resolve(__dirname, "scenarios");
const CAPABILITY_DIR = path.resolve(__dirname, "../../server/domain/tools/v1/capabilities");

/**
 * Every statically registered capability name.
 *
 * Read from source rather than imported: the capability modules pull in the
 * database, the AI clients and most of the server, which is far too much to
 * stand up for a name check.
 */
function registeredCapabilities(): Set<string> {
    const names = new Set<string>();
    for (const file of fs.readdirSync(CAPABILITY_DIR)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const src = fs.readFileSync(path.join(CAPABILITY_DIR, file), "utf8");
        // The object key a capability is registered under...
        for (const m of src.matchAll(/^\s{4}([a-z][a-z0-9_]*):\s*\{/gm)) names.add(m[1]);
        // ...and the name it declares, which should agree but is what the
        // registry actually exposes.
        for (const m of src.matchAll(/^\s*name:\s*"([a-z][a-z0-9_]*)"/gm)) names.add(m[1]);
    }
    return names;
}

interface Scenario {
    id: string;
    /** Absent on mission-type scenarios, where the runner keys on the id. */
    subject?: { kind: string; ref: string };
    criteria: Array<{ type: string; value: string; weight?: number }>;
}

const scenarios: Array<[string, Scenario]> = fs
    .readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, f), "utf8")) as Scenario]);

const capabilityScenarios = scenarios
    .filter(([, s]) => s.subject?.kind === "capability")
    .map(([f, s]) => [f, s as Scenario & { subject: { kind: string; ref: string } }] as const);

describe("eval scenarios", () => {
    const registered = registeredCapabilities();

    it("finds the capability registry", () => {
        // If this ever reads zero the checks below would pass vacuously.
        expect(registered.size).toBeGreaterThan(100);
        expect(registered.has("file_write")).toBe(true);
    });

    it("has capability scenarios to check", () => {
        expect(capabilityScenarios.length).toBeGreaterThan(0);
    });

    it.each(capabilityScenarios)("%s names a capability that exists", (_file, scenario) => {
        expect({ subject: scenario.subject.ref, registered: registered.has(scenario.subject.ref) })
            .toEqual({ subject: scenario.subject.ref, registered: true });
    });

    it.each(capabilityScenarios)("%s asserts tool_used against a real tool", (_file, scenario) => {
        const named = scenario.criteria.filter((c) => c.type === "tool_used").map((c) => c.value);
        const missing = named.filter((t) => !registered.has(t));

        // A tool_used criterion naming a tool that cannot be called is not a
        // failing measurement, it is no measurement.
        expect(missing).toEqual([]);
    });

    it.each(capabilityScenarios)("%s scores on the tool it is named for", (_file, scenario) => {
        // A capability subject whose criteria never mention its own tool is
        // measuring something else.
        const named = scenario.criteria.filter((c) => c.type === "tool_used").map((c) => c.value);
        expect(named).toContain(scenario.subject.ref);
    });
});
