/**
 * The six-piece contract for a crew rail surface.
 *
 * A tool that renders something into a room has to be registered in three
 * places, and none of them fails loudly when it is missed:
 *
 *   - ARTIFACT_TOOLS, or the call does not survive the turn's second pass;
 *   - UNIVERSAL_PRESENTATION_TOOLS, or agents are never offered it;
 *   - RICH_PAYLOAD_TYPES, or detectArtifact returns null and the JSON envelope
 *     reaches the room as prose instead of a rendered surface.
 *
 * The three rail tools shipped with all three missing and a complete set of
 * client renderers, which is the shape this exact mistake takes: everything
 * looks built, and the room shows raw JSON. Deriving the expectations from the
 * tools themselves rather than a hardcoded list means a fourth rail tool is
 * covered the day it is added.
 */

import { describe, expect, it } from "vitest";
import { CREW_RAIL_TOOLS } from "../../tools/v1/capabilities/crew-rail-tools.js";
import {
    ARTIFACT_TOOLS,
    RICH_PAYLOAD_TYPES,
    UNIVERSAL_PRESENTATION_TOOLS,
    detectArtifact,
} from "../core/crew-tools.service.js";

const RAIL_CONTEXT = { organizationId: 1, userId: "test", named: {}, positional: {} } as any;

/** Minimal arguments that get each tool as far as emitting its envelope. */
const SAMPLE_ARGS: Record<string, any> = {
    propose_decision_matrix: {
        topic: "Datastore",
        candidates: [{ id: "pg", name: "PostgreSQL", scores: { cost: 8 } }],
        // The schema declares `key`, and the scorer reads scores[crit.key].
        // Passing `id` here scores every criterion as the 5 default, which a
        // payload-shape assertion would never notice.
        criteria: [{ key: "cost", label: "Cost", weight: 1 }],
    },
    request_governance_approval: {
        actionTitle: "Ship the migration",
        riskTier: "medium",
        requestedBy: "Analyst",
    },
    dispatch_spatial_squad: {
        targetH3Index: "8828308281fffff",
        squadId: "squad-4",
        missionObjective: "Inspect the substation",
        assetRiskClass: "high",
    },
    pin_forensic_event: {
        eventTimestamp: new Date().toISOString(),
        source: "worker",
        severity: "high",
        summary: "Queue backed up",
    },
    ratify_decision: {
        statement: "Adopt BullMQ for asynchronous queue workers",
        rationale: "Proven Redis persistence and concurrency handling",
        alternatives: ["pg-boss", "RabbitMQ"],
        confidence: 90,
    },
    record_commitment: {
        title: "Scaffold schema migration 0086",
        detail: "Implement table definitions and test migrations",
        ownerType: "agent",
        ownerId: "@DatabaseSpecialist",
    },
    verify_claim: {
        claim: "P99 API latency decreased by 42% after pooling",
        confidence: 88,
        agreementLevel: 80,
    },
};

const toolNames = Object.keys(CREW_RAIL_TOOLS);

describe("crew rail tools are registered end to end", () => {
    it("has a sample for every rail tool, so none escapes this file", () => {
        expect(toolNames.sort()).toEqual(Object.keys(SAMPLE_ARGS).sort());
    });

    it.each(toolNames)("%s is offered to agents and treated as an artifact", (name) => {
        expect(ARTIFACT_TOOLS.has(name), `${name} missing from ARTIFACT_TOOLS`).toBe(true);
        expect(UNIVERSAL_PRESENTATION_TOOLS, `${name} missing from UNIVERSAL_PRESENTATION_TOOLS`).toContain(name);
    });

    it.each(toolNames)("%s emits a payload the room can render", async (name) => {
        const output = await (CREW_RAIL_TOOLS as any)[name].execute(SAMPLE_ARGS[name], RAIL_CONTEXT);
        const parsed = JSON.parse(output);

        expect(typeof parsed.type, `${name} emitted no type`).toBe("string");
        expect(
            RICH_PAYLOAD_TYPES.has(parsed.type),
            `${name} emits "${parsed.type}", which is not in RICH_PAYLOAD_TYPES — its envelope would reach the room as prose`,
        ).toBe(true);

        // The whole point of the registration: detectArtifact must claim it.
        const artifact = detectArtifact(name, output);
        if (name === "propose_decision_matrix") {
            // Guards the sample as much as the tool: scores[crit.key] silently
            // falls back to 5 when the criterion key does not match.
            expect(parsed.candidates[0].overallScore).toBe(8);
        }
        expect(artifact, `${name}'s output was not detected as an artifact`).not.toBeNull();
        expect(artifact!.payload.type).toBe(parsed.type);
        expect(artifact!.tool).toBe(name);
    });
});
