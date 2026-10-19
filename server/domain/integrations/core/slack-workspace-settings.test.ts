import { describe, expect, it } from "vitest";
import { normalizeSlackWorkspaceSettings } from "./slack-workspace-settings";

describe("normalizeSlackWorkspaceSettings", () => {
    it("allows only supported settings", () => {
        expect(normalizeSlackWorkspaceSettings({
            defaultChannel: "ops-alerts",
            notifyOnApproval: false,
            botToken: "must-not-pass-through",
            organizationId: 999,
        })).toEqual({ defaultChannel: "ops-alerts", notifyOnApproval: false });
    });

    it("rejects invalid values and empty updates", () => {
        expect(() => normalizeSlackWorkspaceSettings(null)).toThrow(TypeError);
        expect(() => normalizeSlackWorkspaceSettings({ notifyOnApproval: "yes" })).toThrow(TypeError);
        expect(() => normalizeSlackWorkspaceSettings({ botToken: "secret" })).toThrow(TypeError);
    });
});
