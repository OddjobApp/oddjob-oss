import { describe, expect, it } from "vitest";
import { decideStudioAction } from "../forge-intent-resolver.service.js";

/**
 * The gate in front of writing code to somebody's app.
 *
 * decideStudioAction is the whole of that decision, so these tests are the whole
 * of its safety story: what makes it fire, and — more importantly — everything
 * that must not.
 */

const MOUNTED = { appId: 42, slug: "fleet-console", name: "Fleet Console" };

describe("decideStudioAction — applies a change", () => {
    it.each([
        "Change the header on this app",
        "Add a page for audit history",
        "Make the header sticky",
        "Move the total to the top of the table",
        "Hide the sidebar on mobile",
    ])("dispatches %s", (message) => {
        const action = decideStudioAction(message, MOUNTED);
        expect(action.kind).toBe("apply");
        if (action.kind === "apply") {
            expect(action.appId).toBe(42);
            expect(action.instruction).toContain(message);
        }
    });

    it("carries a fix to the diagnostics view", () => {
        const action = decideStudioAction("This app is broken, the page is blank", MOUNTED);
        expect(action.kind).toBe("apply");
        if (action.kind === "apply") expect(action.view).toBe("diagnostics");
    });

    it("passes an ordinary change through unembellished", () => {
        const action = decideStudioAction("Rename the Save button to Submit", MOUNTED);
        expect(action.kind).toBe("apply");
        if (action.kind === "apply") expect(action.instruction).not.toContain("@domain-ui/packaged/*");
    });
});

/*
 * A restyle takes the deterministic migration pipeline, not the model.
 *
 * It previously resolved to an ordinary change with an instruction appended
 * telling a model to migrate onto the gallery — which is a request rather than
 * a guarantee: nothing verified it did, and nothing stopped it altering
 * business logic on the way past. Routing it here is what makes the restyle row
 * of the intent table mean something checkable.
 */
describe("decideStudioAction — a restyle is a migration", () => {
    it.each([
        "Restyle this app to match the design system",
        "Redesign this app using the component gallery",
        "Re-skin this app on brand",
    ])("routes %s to the migration pipeline", (message) => {
        const action = decideStudioAction(message, MOUNTED);
        expect(action.kind).toBe("migrate");
        if (action.kind === "migrate") expect(action.appId).toBe(42);
    });

    it("does not send a restyle through the model", () => {
        const action = decideStudioAction("Restyle this app to match the design system", MOUNTED);
        expect(action.kind).not.toBe("apply");
    });

    it("leaves an ordinary change on the model path", () => {
        expect(decideStudioAction("Make the header sticky", MOUNTED).kind).toBe("apply");
        expect(decideStudioAction("Add a page for audit history", MOUNTED).kind).toBe("apply");
    });
});

describe("decideStudioAction — reverts", () => {
    it.each(["Undo that", "Revert the last change", "Roll back that change"])(
        "dispatches %s as a revert, not another change",
        (message) => {
            const action = decideStudioAction(message, MOUNTED);
            expect(action.kind).toBe("revert");
            if (action.kind === "revert") expect(action.appId).toBe(42);
        },
    );
});

describe("decideStudioAction — what it refuses", () => {
    /*
     * Condition 1. A change is never the first thing that happens to an app: it
     * has to be on screen before the room can rewrite it.
     */
    it("does nothing when no studio is open", () => {
        expect(decideStudioAction("Change the header on this app", null).kind).toBe("none");
        expect(decideStudioAction("Add a page", { name: "no id" }).kind).toBe("none");
    });

    /*
     * Condition 3. The author naming another app is a request to open THAT app,
     * not a licence to edit the one that happens to be mounted.
     */
    it("does not edit the mounted app when a different one is named", () => {
        const action = decideStudioAction("Publish Ops Console", {
            ...MOUNTED,
        });
        // No knownApps are passed here, so the name cannot resolve to an id and
        // the publish intent is not a change either way.
        expect(action.kind).toBe("none");
    });

    it("leaves ordinary conversation alone", () => {
        expect(decideStudioAction("What did this cost us last week?", MOUNTED).kind).toBe("none");
        expect(decideStudioAction("Thanks, that looks right", MOUNTED).kind).toBe("none");
        expect(decideStudioAction("Who owns the onboarding workstream?", MOUNTED).kind).toBe("none");
    });

    /*
     * Condition 4. "Continue" is too vague to write code from, and publishing
     * opens a review rather than editing anything.
     */
    it("does not treat continue or publish as a change", () => {
        expect(decideStudioAction("Continue the instant app we started", MOUNTED).kind).toBe("none");
        expect(decideStudioAction("Publish this app", MOUNTED).kind).toBe("none");
    });

    it("does not treat an explicit rebuild as an edit", () => {
        // A rebuild resolves to Forge, which is a mount, not a change.
        expect(decideStudioAction("Rebuild this app from scratch", MOUNTED).kind).toBe("none");
    });

    it("does not fire on a UI noun with no verb aimed at it", () => {
        expect(decideStudioAction("The header looks good to me", MOUNTED).kind).toBe("none");
    });

    /*
     * The cost of a false positive here is a silent rewrite of somebody's app,
     * so these are the sentences that matter most. Each contains a verb the
     * modify rule knows, in a room where a studio is open, aimed at something
     * that is not the app.
     */
    it.each([
        "Can you update me on the pipeline?",
        "Any change in the numbers since Friday?",
        "Remove me from that meeting invite",
        "Did the dataset change last night?",
        "We should improve our onboarding docs",
        "Edit the calendar entry to 3pm",
    ])("does not rewrite the app for: %s", (message) => {
        expect(decideStudioAction(message, MOUNTED).kind).toBe("none");
    });
});
