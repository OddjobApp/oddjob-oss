import { describe, expect, it } from "vitest";
import { INITIAL_STAGES, stagesFromLog } from "@domain/apps/ui/modules/apps/pages/AppForge.js";
import { FORGE_STAGES } from "@shared/forge-stages.js";

/**
 * The App Forge progress row against the stages the server actually emits.
 *
 * The page used to carry its own eight labels while app-forge.service.ts emits
 * seven indices, so every stage from 3 onward lit the wrong lamp and "Ignition"
 * never went active. Both derivation paths — the SSE stage index and this log
 * regex fallback used by polling — now key off the shared list.
 */

const activeLabel = (message: string): string | undefined =>
    stagesFromLog(message, INITIAL_STAGES).find((s) => s.status === "active")?.label;

describe("App Forge progress row", () => {
    it("is built from the emitter's stage table, not a second list", () => {
        expect(INITIAL_STAGES).toHaveLength(FORGE_STAGES.length);
        expect(INITIAL_STAGES.map((s) => s.key)).toEqual(FORGE_STAGES.map((s) => s.key));
        expect(INITIAL_STAGES.every((s) => s.status === "pending")).toBe(true);
    });

    /*
     * Message strings lifted from app-forge.service.ts, so a change to what the
     * server says fails here rather than silently lighting the wrong stage.
     */
    it.each([
        ["Strategy: Wave Plan finalized.", "Strategy"],
        ["Architecture: Technical proposal generated.", "Architecture"],
        ["Provisioning: Claimed warm container on port 4310.", "Assembly"],
        ["UI Assembly: Mounting selected components into the application shell.", "Assembly"],
        ["Hardening findings: missing alt text", "Hardening"],
        ["Industrialization: Promoting build artifacts and preparing production image...", "Industrialization"],
        ["Ignition: Running governance check before deployment...", "Ignition"],
    ])("maps %s to the %s stage", (message, label) => {
        expect(activeLabel(message)).toBe(label);
    });

    it("collapses provisioning into assembly, because the server emits both at one index", () => {
        expect(activeLabel("Provisioning: Claimed warm container on port 4310."))
            .toBe(activeLabel("UI Assembly: Mounting selected components into the application shell."));
    });

    it("marks everything done on a terminal success line", () => {
        const done = stagesFromLog("Application is live at /app/ops-console", INITIAL_STAGES);
        expect(done.every((s) => s.status === "done")).toBe(true);
    });

    it("leaves the row alone for a line it cannot place", () => {
        const seeded = stagesFromLog("Architecture: Technical proposal generated.", INITIAL_STAGES);
        const after = stagesFromLog("...", seeded);
        expect(after.find((s) => s.status === "active")?.label).toBe("Architecture");
    });
});
