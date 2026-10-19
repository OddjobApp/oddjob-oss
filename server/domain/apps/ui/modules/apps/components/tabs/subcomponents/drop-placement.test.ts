import { describe, it, expect } from "vitest";
import {
    EXTERNAL_DRAG,
    PRIMITIVE_MIME,
    slotInstructionFor,
    resolveDroppedComponent,
    needsConfiguration,
    type DropSlot,
} from "./drop-placement.js";

describe("slotInstructionFor", () => {
    const slots: DropSlot[] = ["top", "left", "right", "bottom"];

    it("gives each slot a distinct placement instruction", () => {
        const texts = slots.map((s) => slotInstructionFor(s));
        expect(new Set(texts).size).toBe(slots.length);
        for (const t of texts) expect(t).toContain("PLACEMENT:");
    });

    it("says nothing when there is no slot", () => {
        expect(slotInstructionFor(null)).toBe("");
        expect(slotInstructionFor(undefined)).toBe("");
    });

    it("keeps the two-column grid for the side slots", () => {
        for (const s of ["left", "right"] as const) {
            expect(slotInstructionFor(s)).toContain("grid-cols-1 md:grid-cols-2");
        }
    });

    // Regression: the left/right instructions named another app's components, so
    // every app was told to place blocks relative to components it lacks.
    it("never names a specific component from any one app", () => {
        const foreign = [
            "Squad Fleet Readiness",
            "Service Provider Network",
            "Activity Stream",
            "Rescue",
            "card grid",
        ];
        for (const slot of slots) {
            const text = slotInstructionFor(slot);
            for (const name of foreign) {
                expect(text, `${slot} mentions ${name}`).not.toContain(name);
            }
        }
    });
});

describe("resolveDroppedComponent", () => {
    it("prefers the name carried by the drop", () => {
        expect(resolveDroppedComponent("PlatformFormBlock", null)).toBe("PlatformFormBlock");
    });

    it("falls back to the armed Arsenal drag when the payload is empty", () => {
        expect(resolveDroppedComponent("", "Chart")).toBe("Chart");
        expect(resolveDroppedComponent(null, "Chart")).toBe("Chart");
    });

    // The placeholder is not a component: firing a rewrite for "__external__"
    // would ask the model to add a component by that name.
    it("never returns the external-drag placeholder as a component", () => {
        expect(resolveDroppedComponent("", EXTERNAL_DRAG)).toBeNull();
        expect(resolveDroppedComponent(undefined, EXTERNAL_DRAG)).toBeNull();
    });

    // A drag from the Visual canvas palette arms the placeholder but does carry
    // a real payload — this is the path that used to be a dead end.
    it("resolves an external drag from its payload", () => {
        expect(resolveDroppedComponent("PlatformMetricGaugeBlock", EXTERNAL_DRAG))
            .toBe("PlatformMetricGaugeBlock");
    });

    it("returns null when there is nothing to place", () => {
        expect(resolveDroppedComponent(null, null)).toBeNull();
    });
});

describe("needsConfiguration", () => {
    // A drop fills every non-defaulted field with "", so a required prop would
    // reach the builder as collection="".
    it("is true when a required field has no default", () => {
        expect(needsConfiguration([{ required: true }])).toBe(true);
        expect(needsConfiguration([{ key: "a" } as any, { required: true }])).toBe(true);
    });

    it("is false when every required field has a default", () => {
        expect(needsConfiguration([{ required: true, default: "10" }])).toBe(false);
    });

    it("is false for optional-only or absent schemas", () => {
        expect(needsConfiguration([{ required: false }, {}])).toBe(false);
        expect(needsConfiguration([])).toBe(false);
        expect(needsConfiguration(undefined)).toBe(false);
    });
});

describe("PRIMITIVE_MIME", () => {
    it("is the type both drag sources set and the preview pane listens for", () => {
        expect(PRIMITIVE_MIME).toBe("application/oddjob-primitive");
    });
});
