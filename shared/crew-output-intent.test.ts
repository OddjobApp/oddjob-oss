import { describe, expect, it } from "vitest";
import {
    CREW_OUTPUT_INTENTS,
    OUTPUT_INTENT_DESCRIPTORS,
    extractOutputIntentFromMessage,
    isValidOutputIntent,
} from "./crew-output-intent.js";

describe("crew-output-intent", () => {
    describe("isValidOutputIntent", () => {
        it("accepts all valid intents", () => {
            for (const intent of CREW_OUTPUT_INTENTS) {
                expect(isValidOutputIntent(intent)).toBe(true);
            }
        });

        it("rejects unknown strings and non-string inputs", () => {
            expect(isValidOutputIntent("unknown")).toBe(false);
            expect(isValidOutputIntent("")).toBe(false);
            expect(isValidOutputIntent(null)).toBe(false);
            expect(isValidOutputIntent(undefined)).toBe(false);
            expect(isValidOutputIntent(123)).toBe(false);
        });
    });

    describe("extractOutputIntentFromMessage", () => {
        it("returns original message when no slash command is used", () => {
            const result = extractOutputIntentFromMessage("Can you build a weather app?");
            expect(result.outputIntent).toBeUndefined();
            expect(result.cleanMessage).toBe("Can you build a weather app?");
        });

        it("extracts /present and cleans message", () => {
            const result = extractOutputIntentFromMessage("/present Q3 executive incident review");
            expect(result.outputIntent).toBe("present");
            expect(result.cleanMessage).toBe("Q3 executive incident review");
        });

        it("extracts /deck alias and defaults message when empty", () => {
            const result = extractOutputIntentFromMessage("/deck");
            expect(result.outputIntent).toBe("present");
            expect(result.cleanMessage).toBe("Generate a presentation deck based on our discussion.");
        });

        it("extracts /slides alias", () => {
            const result = extractOutputIntentFromMessage("/slides Market expansion strategy");
            expect(result.outputIntent).toBe("present");
            expect(result.cleanMessage).toBe("Market expansion strategy");
        });

        it("extracts /app and cleans message", () => {
            const result = extractOutputIntentFromMessage("/app mortgage calculator");
            expect(result.outputIntent).toBe("build_app");
            expect(result.cleanMessage).toBe("mortgage calculator");
        });

        it("extracts /build alias and defaults message when empty", () => {
            const result = extractOutputIntentFromMessage("/build");
            expect(result.outputIntent).toBe("build_app");
            expect(result.cleanMessage).toBe("Build and render an instant app surface on the fly.");
        });

        it("extracts /map and cleans message", () => {
            const result = extractOutputIntentFromMessage("/map Regional distribution hubs");
            expect(result.outputIntent).toBe("map");
            expect(result.cleanMessage).toBe("Regional distribution hubs");
        });

        it("extracts /geo and /pin aliases and defaults message when empty", () => {
            const res1 = extractOutputIntentFromMessage("/geo");
            expect(res1.outputIntent).toBe("map");
            expect(res1.cleanMessage).toBe("Display an interactive map with key locations and coordinates.");

            const res2 = extractOutputIntentFromMessage("/pin Bay Area offices");
            expect(res2.outputIntent).toBe("map");
            expect(res2.cleanMessage).toBe("Bay Area offices");
        });

        it("extracts /doc and /scribe aliases", () => {
            const res1 = extractOutputIntentFromMessage("/doc Technical architecture RFC");
            expect(res1.outputIntent).toBe("author_document");
            expect(res1.cleanMessage).toBe("Technical architecture RFC");

            const res2 = extractOutputIntentFromMessage("/scribe");
            expect(res2.outputIntent).toBe("author_document");
            expect(res2.cleanMessage).toBe("Launch Scribe Studio to author a structured document.");
        });

        it("extracts /diagram and /xray aliases", () => {
            const res1 = extractOutputIntentFromMessage("/diagram payment flow");
            expect(res1.outputIntent).toBe("diagram");
            expect(res1.cleanMessage).toBe("payment flow");

            const res2 = extractOutputIntentFromMessage("/xray");
            expect(res2.outputIntent).toBe("diagram");
            expect(res2.cleanMessage).toBe("Render the workflow diagram and system X-Ray.");
        });

        it("extracts /deliberate and /discuss aliases", () => {
            const res = extractOutputIntentFromMessage("/deliberate Pros and cons of PostgreSQL vs ClickHouse");
            expect(res.outputIntent).toBe("deliberate");
            expect(res.cleanMessage).toBe("Pros and cons of PostgreSQL vs ClickHouse");
        });

        it("extracts /image and /imagine aliases", () => {
            const res1 = extractOutputIntentFromMessage("/image A neon-lit skyline at dusk");
            expect(res1.outputIntent).toBe("generate_image");
            expect(res1.cleanMessage).toBe("A neon-lit skyline at dusk");

            const res2 = extractOutputIntentFromMessage("/imagine");
            expect(res2.outputIntent).toBe("generate_image");
            expect(res2.cleanMessage).toBe("Generate an image based on our discussion.");
        });

        it("extracts /audit and /governance aliases", () => {
            const res = extractOutputIntentFromMessage("/audit");
            expect(res.outputIntent).toBe("audit_governance");
            expect(res.cleanMessage).toBe("Review governance policies and active HIL gates.");
        });

        it("ignores unknown slash commands like /unknown", () => {
            const res = extractOutputIntentFromMessage("/unknown something");
            expect(res.outputIntent).toBeUndefined();
            expect(res.cleanMessage).toBe("/unknown something");
        });
    });

    describe("OUTPUT_INTENT_DESCRIPTORS", () => {
        it("has valid descriptors for all intents", () => {
            for (const intent of CREW_OUTPUT_INTENTS) {
                const descriptor = OUTPUT_INTENT_DESCRIPTORS[intent];
                expect(descriptor).toBeDefined();
                expect(descriptor.id).toBe(intent);
                expect(descriptor.label).toBeTruthy();
                expect(descriptor.description).toBeTruthy();
            }
        });
    });
});
