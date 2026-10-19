import { describe, expect, it } from "vitest";
import {
    findDataTetherConflicts,
    formatFigureWithUnit,
    DataTether,
} from "../core/figures.service.js";

describe("Scribe Data Tethering & Figure Drift Detection", () => {
    it("formats figures nicely matching draft style", () => {
        expect(formatFigureWithUnit(2500000, "£", "£2.1M")).toBe("£2.5M");
        expect(formatFigureWithUnit(45, null, "30")).toBe("45");
        expect(formatFigureWithUnit(35, "%", "20%")).toBe("35%");
        expect(formatFigureWithUnit(150000, "$", "$100k")).toBe("$150k");
        expect(formatFigureWithUnit(2500000, "$", "$2,100,000")).toBe("$2,500,000");
    });

    it("detects when draft text conflicts with a tethered calculation node", () => {
        const text = "Under this Agreement, the Committed ARR is £2.1M payable in quarterly instalments.";
        const tethers: DataTether[] = [
            {
                termName: "Committed ARR",
                calculationNodeId: 104,
                lastValue: 2500000,
                unit: "£",
            },
        ];

        const conflicts = findDataTetherConflicts(text, tethers);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].label).toBe("Committed ARR");
        expect(conflicts[0].drafted.raw).toBe("£2.1M");
        expect(conflicts[0].drafted.value).toBe(2100000);
        expect(conflicts[0].tetherValue).toBe(2500000);
        expect(conflicts[0].tetherRaw).toBe("£2.5M");
        expect(conflicts[0].calculationNodeId).toBe(104);
    });

    it("ignores figures that match the tethered value", () => {
        const text = "The Target Margin is 35% across all service lines.";
        const tethers: DataTether[] = [
            {
                termName: "Target Margin",
                calculationNodeId: 42,
                lastValue: 35,
                unit: "%",
            },
        ];

        const conflicts = findDataTetherConflicts(text, tethers);
        expect(conflicts).toHaveLength(0);
    });

    it("handles multiple tethers and case-insensitive label matching", () => {
        const text = "Our Committed ARR of $2,100,000 and Headcount Cap of 40 will sustain the expansion.";
        const tethers: DataTether[] = [
            {
                termName: "committed arr",
                calculationNodeId: 10,
                lastValue: 2500000,
                unit: "$",
            },
            {
                termName: "Headcount Cap",
                calculationNodeId: 11,
                lastValue: 50,
            },
        ];

        const conflicts = findDataTetherConflicts(text, tethers);
        expect(conflicts).toHaveLength(2);
        expect(conflicts[0].label).toBe("Committed ARR");
        expect(conflicts[0].tetherRaw).toBe("$2,500,000");
        expect(conflicts[1].label).toBe("Headcount Cap");
        expect(conflicts[1].tetherRaw).toBe("50");
    });
});
