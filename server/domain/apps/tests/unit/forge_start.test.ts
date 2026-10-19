import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseForgeConfirmation, parseMigrationApproval } from "@domain/crew/core/crew-orchestrator.service.js";
import { deriveForgeSlug } from "@domain/apps/core/forge-start.service.js";

/**
 * The gate in front of provisioning a container.
 *
 * Mounting a studio is free and fires on a keyword match. A forge run is not,
 * so it fires only on the exact string the confirmation card sends. These tests
 * are that asymmetry.
 */
describe("parseForgeConfirmation", () => {
    it("accepts the card's own confirmation and returns the edited name", () => {
        expect(parseForgeConfirmation('Build "Warehouse Inventory" now.')).toEqual({ name: "Warehouse Inventory" });
    });

    it("tolerates surrounding whitespace and casing of the verb", () => {
        expect(parseForgeConfirmation('  build "Ops Console" now.  ')).toEqual({ name: "Ops Console" });
    });

    /*
     * The whole point. A loose "did they say yes?" test would let an ordinary
     * agreement provision a container — which is the single outcome the card
     * exists to prevent.
     */
    it.each([
        "yes",
        "yes please",
        "sounds good, go ahead",
        "do it",
        "build it",
        "ok build the app now",
        'Build "Ops Console" now please',
        'I said Build "Ops Console" now.',
        "Build now.",
        'Build "" now.',
    ])("refuses to start a build for: %s", (message) => {
        expect(parseForgeConfirmation(message)).toBeNull();
    });

    it("does not accept an unbounded name", () => {
        expect(parseForgeConfirmation(`Build "${"x".repeat(200)}" now.`)).toBeNull();
    });
});

/**
 * The scaffold-pack confirmation, and the regression that came with it.
 *
 * A revision of this parser also matched `/confirm(?:ed)?\s+architecture/i`
 * anywhere in a message. The pod's button reads "Confirm Architecture &
 * Continue", but the message it actually sends is the structured stage form —
 * so the free-text pattern bought nothing and matched ordinary prose, turning
 * sentences about architecture into container builds.
 */
describe("parseForgeConfirmation — the scaffold-pack confirmation", () => {
    const real = (packs: string[]) =>
        `I confirmed stage "stage-scaffold" with configuration: ${JSON.stringify({ selectedPacks: packs, stageId: "stage-scaffold" })}`;

    it("accepts the message ScaffoldPackPod actually sends, and reads the packs", () => {
        expect(parseForgeConfirmation(real(["core-node-express", "ui-oddjob-design-system"]))).toEqual({
            packs: ["core-node-express", "ui-oddjob-design-system"],
        });
    });

    it("accepts the pod's own module name as the stage id", () => {
        const msg = `I confirmed stage "ScaffoldPackPod" with configuration: {"selectedPacks":["auth-jwt"]}`;
        expect(parseForgeConfirmation(msg)).toEqual({ packs: ["auth-jwt"] });
    });

    it("still confirms when the payload is unreadable, on the proposal's own terms", () => {
        const msg = `I confirmed stage "stage-scaffold" with configuration: {not json`;
        expect(parseForgeConfirmation(msg)).toEqual({});
    });

    /*
     * The four sentences that started builds. Each contains the words the old
     * free-text pattern looked for and none is a confirmation of anything.
     */
    it.each([
        "Can you confirm architecture decisions with the team?",
        "We should confirm architecture before Friday",
        "Who confirmed architecture on this?",
        "confirm architecture",
        "Let's confirm architecture and then talk pricing",
        "I confirmed architecture with the client yesterday",
    ])("refuses prose about architecture: %s", (message) => {
        expect(parseForgeConfirmation(message)).toBeNull();
    });

    /*
     * Anchoring is what makes the difference. The structured form is only a
     * confirmation when it IS the message, not when it is quoted inside one.
     */
    it("refuses the structured form quoted inside a sentence", () => {
        expect(
            parseForgeConfirmation(`Someone said: I confirmed stage "stage-scaffold" with configuration: {"selectedPacks":[]}`),
        ).toBeNull();
    });

    /*
     * Any stage id is accepted, and that is the point rather than an oversight.
     * ScaffoldPackPod defaults to stage-scaffold, but crew-tools injects
     * "stage-intake" into a mount_builder_pod call that arrives without one — so
     * a real confirmation can name a stage a hardcoded list would have missed.
     * What gates the build is the standing forge proposal; this pattern only has
     * to prove the message came from a surface rather than from someone typing.
     */
    it("accepts a confirmation whatever the stage ended up being called", () => {
        expect(
            parseForgeConfirmation(`I confirmed stage "stage-intake" with configuration: {"selectedPacks":["auth-jwt"]}`),
        ).toEqual({ packs: ["auth-jwt"] });
    });

    it("does not accept an unbounded stage id", () => {
        expect(
            parseForgeConfirmation(`I confirmed stage "${"s".repeat(80)}" with configuration: {}`),
        ).toBeNull();
    });

    it("refuses the stage form with no configuration payload", () => {
        expect(parseForgeConfirmation(`I confirmed stage "stage-scaffold"`)).toBeNull();
        expect(parseForgeConfirmation(`I confirmed stage "stage-scaffold" with configuration:`)).toBeNull();
    });
});

/**
 * Approving a migration writes over an author's files, so it is gated the same
 * way starting a build is — and by naming the proposal it approves, so a bare
 * "apply it" cannot approve a migration nobody has looked at, and an approval
 * of one proposal cannot be replayed against a later one.
 */
describe("parseMigrationApproval", () => {
    it("accepts an approval that names its proposal", () => {
        expect(parseMigrationApproval('apply migration "snap-abc123"')).toEqual({ snapshotId: "snap-abc123" });
        expect(parseMigrationApproval('Apply migration "snap-abc123".')).toEqual({ snapshotId: "snap-abc123" });
    });

    it("accepts the smart quotes the room renders", () => {
        expect(parseMigrationApproval('apply migration “snap-abc123”')).toEqual({ snapshotId: "snap-abc123" });
    });

    it.each([
        "apply it",
        "apply the migration",
        "yes apply migration",
        "go ahead and apply migration",
        'please apply migration "snap-abc123"',
        'apply migration "snap-abc123" and then deploy',
        "apply migration",
    ])("refuses an approval that does not name a proposal: %s", (message) => {
        expect(parseMigrationApproval(message)).toBeNull();
    });

    it("refuses an unbounded or malformed snapshot id", () => {
        expect(parseMigrationApproval(`apply migration "${"s".repeat(100)}"`)).toBeNull();
        expect(parseMigrationApproval('apply migration "snap abc"')).toBeNull();
    });
});

describe("deriveForgeSlug", () => {
    it("makes a URL-safe slug from a display name", () => {
        expect(deriveForgeSlug("Warehouse Inventory Tracker")).toBe("warehouse-inventory-tracker");
        expect(deriveForgeSlug("Ops & Metrics!")).toBe("ops-metrics");
    });

    /*
     * A room has no wizard to pick a slug. Colliding with a name the org already
     * uses would be refused by the concurrency guard, so it steps around instead.
     */
    it("steps around slugs the organization already uses", () => {
        const taken = new Set(["fleet-console", "fleet-console-2"]);
        expect(deriveForgeSlug("Fleet Console", taken)).toBe("fleet-console-3");
    });

    it("always produces something usable", () => {
        expect(deriveForgeSlug("!!!")).toBe("app");
        expect(deriveForgeSlug("")).toBe("app");
        expect(deriveForgeSlug("a".repeat(80)).length).toBeLessThanOrEqual(40);
    });
});
