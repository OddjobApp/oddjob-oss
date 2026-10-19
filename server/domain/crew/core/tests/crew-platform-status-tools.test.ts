/**
 * Every tool the crew is granted universally must actually survive the
 * classifier, against the REAL registry.
 *
 * A name in a universal list is only a nomination: resolveForCard drops anything
 * classifyReadOnly rejects (adminOnly, high risk, a disqualifying side effect, a
 * write verb in the name) and the rejection is a debug log, not an error. So a
 * tool can be "granted" and silently absent from every agent's toolset, which is
 * indistinguishable from the platform not having the capability at all — the
 * failure this suite exists to make loud.
 */
import { describe, it, expect } from "vitest";
import {
    COMPUTER_OBSERVATION_TOOLS,
    PLATFORM_STATUS_TOOLS,
    RESEARCH_TOOLS,
    classifyReadOnly,
} from "../crew-tools.service.js";
import { getAgentTools } from "@domain/tools/v1/capabilities/index.js";

const registry = getAgentTools();

describe("universal crew tool grants resolve against the real registry", () => {
    describe.each([
        ["PLATFORM_STATUS_TOOLS", PLATFORM_STATUS_TOOLS],
        ["RESEARCH_TOOLS", RESEARCH_TOOLS],
        ["COMPUTER_OBSERVATION_TOOLS", COMPUTER_OBSERVATION_TOOLS],
    ])("%s", (_label, names) => {
        it.each([...names])("%s is implemented", (name) => {
            expect(registry[name]).toBeDefined();
        });

        it.each([...names])("%s survives classifyReadOnly", (name) => {
            const def = registry[name];
            expect(def, `${name} is not in the registry`).toBeDefined();
            // null means "withheld" — the tool would never reach an agent.
            expect(classifyReadOnly(def)).not.toBeNull();
        });
    });

    it("grants no tool that writes", () => {
        for (const name of [...PLATFORM_STATUS_TOOLS, ...COMPUTER_OBSERVATION_TOOLS]) {
            const def = registry[name];
            if (!def) continue;
            expect(def.adminOnly ?? false, `${name} is adminOnly`).toBe(false);
            expect(def.idempotency === "none", `${name} declares idempotency "none"`).toBe(false);
        }
    });
});
