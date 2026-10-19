import { describe, expect, it } from "vitest";
import { forgeIntentResolver } from "../forge-intent-resolver.service.js";
import { FORGE_STAGES, FORGE_STAGE_COUNT, forgeStageAt, forgeStageHeading, forgeProgressPercent } from "@shared/forge-stages.js";

const ACTIVE_APP = { appId: 42, slug: "fleet-console", name: "Fleet Console" };

describe("ForgeIntentResolverService — the nine routed intents", () => {
    it("routes a plain build request to Forge", () => {
        const res = forgeIntentResolver.resolve("Build me an app that tracks warehouse inventory");
        expect(res.mode).toBe("forge");
        expect(res.intent).toBe("build_app");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("routes a dashboard request to Forge with the preview view", () => {
        const res = forgeIntentResolver.resolve("Create a dashboard for delivery performance");
        expect(res.mode).toBe("forge");
        expect(res.intent).toBe("create_dashboard");
        expect(res.view).toBe("preview");
        expect(res.inferredTitle).toBe("Delivery Performance Dashboard");
    });

    it("routes an API request to Forge opening on the API view", () => {
        const res = forgeIntentResolver.resolve("Create an API for partner webhooks");
        expect(res.mode).toBe("forge");
        expect(res.intent).toBe("create_api");
        expect(res.view).toBe("api");
    });

    it("routes a modify request to Builder when an app is in play", () => {
        const res = forgeIntentResolver.resolve("Change the header on this app", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("modify_app");
        expect(res.appHint?.appId).toBe(42);
        expect(res.appHint?.contextual).toBe(true);
    });

    it("routes a fix request to Builder in diagnostic mode", () => {
        const res = forgeIntentResolver.resolve("This app is broken, the page is blank", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("fix_app");
        expect(res.view).toBe("diagnostics");
    });

    it("routes a continue request to Builder", () => {
        const res = forgeIntentResolver.resolve("Continue the instant app we started", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("continue_scaffold");
    });

    it("routes a restyle request to Builder with gallery migration enabled", () => {
        const res = forgeIntentResolver.resolve("Restyle this app to match the design system", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("restyle_app");
        expect(res.galleryMigration).toBe(true);
    });

    it("routes an add-a-surface request to Builder", () => {
        const res = forgeIntentResolver.resolve("Add a page to the app for audit history", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("add_surface");
    });

    it("routes a publish request to Builder opening on the publish view", () => {
        const res = forgeIntentResolver.resolve("Publish this app", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("publish_app");
        expect(res.view).toBe("publish");
    });
});

describe("ForgeIntentResolverService — undo", () => {
    it.each([
        "Undo that",
        "Revert the last change",
        "Roll back that change",
        "Put it back the way it was",
    ])("routes %s to revert", (message) => {
        const res = forgeIntentResolver.resolve(message, { activeApp: ACTIVE_APP });
        expect(res.intent).toBe("revert_change");
        expect(res.mode).toBe("builder");
        expect(res.appHint?.appId).toBe(42);
    });

    /*
     * "Undo that change" contains "change". Resolving it as modify_app would
     * apply a second change in answer to a request to remove the first, which
     * is the most expensive way to misread an undo.
     */
    it("beats modify_app when both vocabularies appear", () => {
        const res = forgeIntentResolver.resolve("Undo that change please", { activeApp: ACTIVE_APP });
        expect(res.intent).toBe("revert_change");
    });

    it("does not fire without an app in play", () => {
        expect(forgeIntentResolver.resolve("undo that").intent).toBeNull();
    });
});

describe("ForgeIntentResolverService — principle 3: existing scaffolds are the fastest path", () => {
    /*
     * The regression this whole rule exists for. Without it, "build me a
     * dashboard" said in a room that already has an app open re-forges from
     * zero and throws away work the author can see on screen.
     */
    it("continues an existing app rather than re-forging when phrasing is create-shaped", () => {
        const res = forgeIntentResolver.resolve("Build me a dashboard view in this app", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("builder");
        expect(res.intent).toBe("continue_scaffold");
        expect(res.rebuildRequested).toBe(false);
        expect(res.rationale).toContain("rebuild");
    });

    it("re-forges only when a rebuild is explicit", () => {
        const res = forgeIntentResolver.resolve("Rebuild this app from scratch", { activeApp: ACTIVE_APP });
        expect(res.mode).toBe("forge");
        expect(res.intent).toBe("build_app");
        expect(res.rebuildRequested).toBe(true);
    });

    it("still forges when no app is in play", () => {
        const res = forgeIntentResolver.resolve("Build me a dashboard for delivery performance");
        expect(res.mode).toBe("forge");
        expect(res.intent).toBe("create_dashboard");
    });
});

describe("ForgeIntentResolverService — what it refuses to guess", () => {
    it("returns a null intent for ordinary conversation so no studio mounts", () => {
        const res = forgeIntentResolver.resolve("What did the pipeline run cost us last week?");
        expect(res.intent).toBeNull();
        expect(res.mode).toBeNull();
        expect(res.confidence).toBe(0);
    });

    /*
     * A builder verb with nothing to build against must not mount Builder over
     * an empty app slot. It falls through to the create rules instead.
     */
    it("does not mount Builder when a modify verb arrives with no app in context", () => {
        const res = forgeIntentResolver.resolve("Change the layout");
        expect(res.mode).not.toBe("builder");
        expect(res.intent).not.toBe("modify_app");
    });

    it("leaves the app unresolved rather than defaulting to the active app", () => {
        const res = forgeIntentResolver.resolve("Fix the app I made yesterday");
        // "the app" is deictic, but with no activeApp there is nothing to point
        // at — resolving to some app anyway is how you edit the wrong one.
        expect(res.appHint).toBeNull();
    });

    it("matches a named app outright and marks it non-contextual", () => {
        const res = forgeIntentResolver.resolve("Publish Fleet Console", {
            knownApps: [ACTIVE_APP],
        });
        expect(res.appHint?.appId).toBe(42);
        expect(res.appHint?.contextual).toBe(false);
        expect(res.intent).toBe("publish_app");
    });

    it("does not fire single-word rules on substrings", () => {
        // "prefix" contains "fix"; "exchange" contains "change". Both would
        // otherwise mount a studio over an unrelated sentence.
        const res = forgeIntentResolver.resolve("The prefix on the exchange rate column is wrong", {
            activeApp: ACTIVE_APP,
        });
        expect(res.intent).not.toBe("fix_app");
        expect(res.intent).not.toBe("modify_app");
    });
});

describe("Forge stage model", () => {
    /*
     * The App Forge page carried eight labels while the server emits seven
     * indices, so every stage from 3 onward lit the wrong lamp and "Ignition"
     * never activated at all. This pins the count to what the emitter sends.
     */
    it("has exactly the seven stages the server emits", () => {
        expect(FORGE_STAGE_COUNT).toBe(7);
        expect(FORGE_STAGES.map((s) => s.key)).toEqual([
            "discovery",
            "strategy",
            "architecture",
            "assembly",
            "hardening",
            "industrialization",
            "ignition",
        ]);
    });

    it("indexes match the emitted stage numbers", () => {
        FORGE_STAGES.forEach((stage, i) => expect(stage.index).toBe(i));
        expect(forgeStageAt(3)?.key).toBe("assembly");
        expect(forgeStageAt(6)?.key).toBe("ignition");
    });

    it("renders a one-based heading over a zero-based index", () => {
        expect(forgeStageHeading(3)).toBe("Step 4 of 7 — Assembly");
        expect(forgeStageHeading(6)).toBe("Step 7 of 7 — Ignition");
    });

    it("falls back to the table rather than zeroing a bar on a stageless event", () => {
        expect(forgeProgressPercent(undefined)).toBe(0);
        expect(forgeProgressPercent(4)).toBe(65);
        expect(forgeStageAt(99)).toBeNull();
        expect(forgeStageAt(1.5)).toBeNull();
    });
});
