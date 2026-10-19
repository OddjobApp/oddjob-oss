import { describe, expect, it } from "vitest";
import { resolveJob } from "../flow-studio-tools.js";
import { RICH_PAYLOAD_TYPES } from "@domain/crew/core/crew-tools.service.js";
import { FLOW_CREATED, FLOW_CREATE_PROPOSAL } from "@shared/flow-studio-crew.js";

const jobs = [
    { id: 4, name: "Score lead" },
    { id: 9, name: "Email owner" },
    { id: 12, name: "Email owner (weekly digest)" },
    { id: 20, name: "score lead" },
];

describe("resolveJob", () => {
    it("takes a numeric id", () => {
        expect(resolveJob(jobs, "9")).toMatchObject({ id: 9 });
        expect(resolveJob(jobs, "999")).toBeNull();
    });

    it("prefers an exact name over a longer one that contains it", () => {
        // "Email owner" must not resolve to "Email owner (weekly digest)".
        expect(resolveJob(jobs, "Email owner")).toMatchObject({ id: 9 });
    });

    it("resolves a unique partial name", () => {
        expect(resolveJob(jobs, "weekly digest")).toMatchObject({ id: 12 });
    });

    it("refuses to guess when a name is ambiguous", () => {
        // Two jobs are named "Score lead" apart from case; picking either would
        // run someone's real automation on a coin flip.
        expect(resolveJob(jobs, "Score lead")).toBeNull();
        expect(resolveJob(jobs, "Email")).toBeNull();
    });

    it("is null for nothing", () => {
        expect(resolveJob(jobs, "   ")).toBeNull();
    });
});

/**
 * A payload type missing from RICH_PAYLOAD_TYPES makes detectArtifact return
 * null, and the JSON envelope reaches the room as prose instead of a card.
 */
describe("the flow payload types are registered", () => {
    it("carries both types", () => {
        expect(RICH_PAYLOAD_TYPES.has(FLOW_CREATE_PROPOSAL)).toBe(true);
        expect(RICH_PAYLOAD_TYPES.has(FLOW_CREATED)).toBe(true);
    });
});
