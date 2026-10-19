import { describe, it, expect, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));

const { alertRoomSessionKey, alertCategoryLabel, describeAlerts, groupByRoom } = await import("../crew-alert-rooms.js");

const alert = (id: number, over: Partial<{ severity: string; category: string; message: string; orgId: number }> = {}) => ({
    id,
    severity: "error",
    category: "job_failure",
    message: `Job ${id} failed`,
    orgId: 1,
    ownerUserId: null,
    createdAt: new Date(),
    ...over,
});

describe("alert room keys", () => {
    it("slugs free-text categories into a stable room key", () => {
        expect(alertRoomSessionKey("job_failure")).toBe("alerts-job-failure");
        expect(alertRoomSessionKey("Pipeline Failure!")).toBe("alerts-pipeline-failure");
        expect(alertRoomSessionKey("")).toBe("alerts-general");
        expect(alertRoomSessionKey("***")).toBe("alerts-general");
    });

    it("labels a category for the room title", () => {
        expect(alertCategoryLabel("job_failure")).toBe("Job failure");
        expect(alertCategoryLabel("governance")).toBe("Governance");
        expect(alertCategoryLabel("")).toBe("General");
    });
});

describe("grouping", () => {
    it("groups by org and room, never across orgs", () => {
        const groups = groupByRoom([
            alert(1), alert(2), alert(3, { orgId: 2 }), alert(4, { category: "governance" }),
            // Categories that slug alike share a room.
            alert(5, { category: "Job Failure" }),
        ]);
        expect([...groups.values()].map((g) => g.map((a) => a.id))).toEqual([[1, 2, 5], [3], [4]]);
    });
});

describe("turn text", () => {
    it("lists the worst first and names each alert", () => {
        const text = describeAlerts("job_failure", [
            alert(7, { severity: "warning", message: "Slow" }),
            alert(8, { severity: "critical", message: "Down" }),
        ]);
        expect(text.split("\n")[0]).toBe("**2 new job failure alerts**");
        expect(text.indexOf("Down")).toBeLessThan(text.indexOf("Slow"));
        expect(text).toContain("_(alert #8)_");
        expect(text).toContain("[Alerts](/health/alerts)");
    });

    it("keeps each alert to one clipped line and counts what it does not list", () => {
        const many = Array.from({ length: 13 }, (_, i) => alert(i + 1, { message: `line one\nline two ${"x".repeat(400)}` }));
        const text = describeAlerts("job_failure", many);
        const listed = text.split("\n").filter((l) => l.startsWith("- **"));
        expect(listed).toHaveLength(10);
        expect(listed.every((l) => !l.includes("\n") && l.length < 320)).toBe(true);
        expect(text).toContain("…and 3 more");
    });

    it("uses the singular for one alert", () => {
        expect(describeAlerts("governance", [alert(1)]).split("\n")[0]).toBe("**New governance alert**");
    });
});
