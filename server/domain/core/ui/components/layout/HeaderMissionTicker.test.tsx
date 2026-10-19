import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeaderMissionTicker } from "./HeaderMissionTicker.js";

/**
 * The header ticker must show real values or nothing.
 *
 * The first version filled gaps with constants: five rotating invented
 * "thoughts" in quotation marks, and `topMission.spend || 0.42`. Neither `spend`
 * nor `softCap` is a field on a mission, so those fallbacks were not an edge
 * case — they fired for every viewer on every render, and the header reported a
 * fabricated $0.42 as money spent.
 */

const mockQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
    useQuery: (...args: any[]) => mockQuery(...args),
}));

const mission = (over: Record<string, unknown> = {}) => ({
    id: 7,
    name: "Vendor Reconciliation",
    status: "running",
    ...over,
});

beforeEach(() => mockQuery.mockReset());

describe("HeaderMissionTicker", () => {
    it("renders nothing when no mission is active", () => {
        mockQuery.mockReturnValue({ data: [mission({ status: "completed" })] });
        const { container } = render(<HeaderMissionTicker />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows no spend segment when the mission has no recorded spend", () => {
        mockQuery.mockReturnValue({ data: [mission()] });
        render(<HeaderMissionTicker />);
        expect(screen.getByTestId("header-mission-ticker")).toBeTruthy();
        expect(screen.queryByTestId("header-mission-ticker-spend")).toBeNull();
    });

    it("never invents a currency figure", () => {
        // The specific constant that used to render for every viewer.
        mockQuery.mockReturnValue({ data: [mission()] });
        render(<HeaderMissionTicker />);
        expect(screen.getByTestId("header-mission-ticker").textContent).not.toContain("0.42");
        expect(screen.getByTestId("header-mission-ticker").textContent).not.toContain("$");
    });

    it("renders spend from the real decimal column, which arrives as a string", () => {
        mockQuery.mockReturnValue({ data: [mission({ currentSpendUsd: "1.30" })] });
        render(<HeaderMissionTicker />);
        expect(screen.getByTestId("header-mission-ticker-spend").textContent).toContain("$1.30");
    });

    it("shows spend against budget when both are present", () => {
        mockQuery.mockReturnValue({
            data: [mission({ currentSpendUsd: "1.30", budgetLimitUsd: "5.00" })],
        });
        render(<HeaderMissionTicker />);
        const text = screen.getByTestId("header-mission-ticker-spend").textContent ?? "";
        expect(text).toContain("$1.30");
        expect(text).toContain("$5.00");
    });

    it("ignores an unparseable decimal rather than rendering NaN", () => {
        mockQuery.mockReturnValue({ data: [mission({ currentSpendUsd: "not-a-number" })] });
        render(<HeaderMissionTicker />);
        expect(screen.queryByTestId("header-mission-ticker-spend")).toBeNull();
    });

    it("shows no summary line when the mission has no description", () => {
        mockQuery.mockReturnValue({ data: [mission()] });
        render(<HeaderMissionTicker />);
        expect(screen.queryByTestId("header-mission-ticker-summary")).toBeNull();
    });

    it("shows the real description, unquoted so it does not read as live reasoning", () => {
        mockQuery.mockReturnValue({ data: [mission({ description: "Reconcile Q3 vendor invoices" })] });
        render(<HeaderMissionTicker />);
        const summary = screen.getByTestId("header-mission-ticker-summary").textContent ?? "";
        expect(summary).toBe("Reconcile Q3 vendor invoices");
        expect(summary).not.toContain('"');
    });
});
