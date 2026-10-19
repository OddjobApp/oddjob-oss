import { describe, expect, it } from "vitest";
import { isAppStudioRequest, isScribeAuthoringRequest } from "../crew-orchestrator.service.js";

/**
 * The gate in front of the App Studio direct mount.
 *
 * It is deliberately looser than the resolver it guards — its job is only to
 * decide whether a round is worth one lookup. What it must not do is fire on
 * ordinary conversation, or steal a message that belongs to Scribe.
 */
describe("isAppStudioRequest", () => {
    it("admits the create phrasings", () => {
        expect(isAppStudioRequest("I want to develop a distressed properties research tool")).toBe(true);
        expect(isAppStudioRequest("Build me an app for warehouse inventory")).toBe(true);
        expect(isAppStudioRequest("Create a dashboard for delivery performance")).toBe(true);
        expect(isAppStudioRequest("Spin up an API service for partner webhooks")).toBe(true);
    });

    it("admits the evolve phrasings", () => {
        expect(isAppStudioRequest("Fix this app, the page is blank")).toBe(true);
        expect(isAppStudioRequest("Publish the app")).toBe(true);
        expect(isAppStudioRequest("Restyle this dashboard to match the design system")).toBe(true);
        expect(isAppStudioRequest("Continue the instant app we started")).toBe(true);
    });

    it("stays out of ordinary conversation", () => {
        expect(isAppStudioRequest("What did the pipeline run cost us last week?")).toBe(false);
        expect(isAppStudioRequest("Summarise yesterday's incident")).toBe(false);
        expect(isAppStudioRequest("Who owns the onboarding workstream?")).toBe(false);
    });

    /*
     * The overlap that matters: both gates match "write a spec for the app", and
     * mounting a build surface over a request to write a document is the more
     * expensive mistake. Authoring wins, and the two gates must never both fire.
     */
    it("yields to authoring on the overlap", () => {
        const overlapping = "Write a specification document for the app";
        expect(isScribeAuthoringRequest(overlapping)).toBe(true);
        expect(isAppStudioRequest(overlapping)).toBe(false);
    });

    it("never fires alongside the authoring gate", () => {
        const messages = [
            "Draft an SOW for the client portal app",
            "Build me an app for warehouse inventory",
            "Write a PRD for a new dashboard",
            "Fix this app",
            "Compose a memo about the tooling migration",
        ];
        for (const m of messages) {
            expect(
                isScribeAuthoringRequest(m) && isAppStudioRequest(m),
                `both gates fired for: ${m}`,
            ).toBe(false);
        }
    });
});
