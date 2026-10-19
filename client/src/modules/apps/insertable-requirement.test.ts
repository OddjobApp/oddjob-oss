import { describe, it, expect } from "vitest";
import { forgeRequirementFrom, hasInsertableRequirement } from "./insertable-requirement";

const SPEC_SAMPLE = `
Feature: Real-Time Fleet Tracking
- As an operations lead, I want to track active vehicle positions on an Eulerian hex map.
- Endpoints: GET /api/fleet/live, POST /api/fleet/geofence
- Data Model: vehicles (id, vin, status, h3_index, updated_at)
- Validation: Zod schema enforcing valid H3 index at resolution 8
`.trim();

describe("forgeRequirementFrom", () => {
    it("returns null for empty or null content", () => {
        expect(forgeRequirementFrom(null)).toBeNull();
        expect(forgeRequirementFrom(undefined)).toBeNull();
        expect(forgeRequirementFrom("")).toBeNull();
    });

    it("returns null for conversational pleasantries and banter", () => {
        expect(forgeRequirementFrom("Hello! How can I help you today?")).toBeNull();
        expect(forgeRequirementFrom("Sounds good, I will get to work on that.")).toBeNull();
        expect(forgeRequirementFrom("Let me know if you need anything else!")).toBeNull();
    });

    it("extracts clean specification from verbatim prose", () => {
        expect(forgeRequirementFrom(SPEC_SAMPLE)).toBe(SPEC_SAMPLE);
        expect(hasInsertableRequirement(SPEC_SAMPLE)).toBe(true);
    });

    it("strips conversational handoff openers", () => {
        const wrapped = `Certainly! Based on the uploaded diagram, here are the requirements:\n\n${SPEC_SAMPLE}`;
        expect(forgeRequirementFrom(wrapped)).toBe(SPEC_SAMPLE);
    });

    it("strips conversational handback closers", () => {
        const wrapped = `${SPEC_SAMPLE}\n\nLet me know if you would like me to adjust any of these fields.`;
        expect(forgeRequirementFrom(wrapped)).toBe(SPEC_SAMPLE);
    });

    it("extracts markdown code blocks as first-class specifications", () => {
        const fenced = `Here is the proposed schema:\n\n\`\`\`json\n{"appName": "FleetManager", "routes": ["/api/fleet"]}\n\`\`\``;
        expect(forgeRequirementFrom(fenced)).toBe(`{"appName": "FleetManager", "routes": ["/api/fleet"]}`);
    });
});
