import { describe, it, expect, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));

import { parseAdminUserUpdate, parseSelfProfileUpdate } from "./self-profile.service.js";

describe("parseSelfProfileUpdate", () => {
    it("accepts the profile and quiet-hours fields", () => {
        expect(
            parseSelfProfileUpdate(
                {
                    firstName: " Ada ",
                    lastName: "",
                    slackHandle: "ada",
                    quietHoursEnabled: true,
                    quietHoursStart: "22:00",
                    quietHoursEnd: "07:30",
                    quietHoursTimezone: "Europe/Amsterdam",
                },
                "ada@example.com",
            ),
        ).toEqual({
            firstName: "Ada",
            lastName: null,
            slackHandle: "ada",
            quietHoursEnabled: true,
            quietHoursStart: "22:00",
            quietHoursEnd: "07:30",
            quietHoursTimezone: "Europe/Amsterdam",
        });
    });

    it("rejects every field outside the allow-list, by name", () => {
        for (const field of ["password", "pin", "username", "defaultOrgId", "id", "tosAccepted", "alertFilters"]) {
            expect(() => parseSelfProfileUpdate({ [field]: "x" }, null)).toThrow(new RegExp(field));
        }
    });

    it("accepts the email only unchanged, which is what the web form sends", () => {
        expect(parseSelfProfileUpdate({ email: "a@b.c", firstName: "A" }, "a@b.c")).toEqual({ firstName: "A" });
        expect(() => parseSelfProfileUpdate({ email: "other@b.c" }, "a@b.c")).toThrow(/Email cannot be changed/);
        expect(parseSelfProfileUpdate({ email: null }, null)).toEqual({});
    });

    it("validates times and timezones", () => {
        expect(() => parseSelfProfileUpdate({ quietHoursStart: "24:00" }, null)).toThrow(/HH:MM/);
        expect(() => parseSelfProfileUpdate({ quietHoursStart: "7:30" }, null)).toThrow(/HH:MM/);
        expect(() => parseSelfProfileUpdate({ quietHoursTimezone: "Mars/Olympus" }, null)).toThrow(/timezone/);
        expect(() =>
            parseSelfProfileUpdate({ quietHoursEnabled: true, quietHoursStart: null, quietHoursEnd: "07:00" }, null),
        ).toThrow(/start and an end/);
    });

    it("treats a missing body as no change", () => {
        expect(parseSelfProfileUpdate(undefined, null)).toEqual({});
    });
});

describe("parseAdminUserUpdate", () => {
    it("accepts exactly what the admin UserDetail page sends", () => {
        const body = {
            email: "ops@example.com",
            firstName: "Ops",
            lastName: "Lead",
            quietHoursEnabled: false,
            quietHoursStart: null,
            quietHoursEnd: null,
            alertFilters: { severity: "all" },
        };
        expect(parseAdminUserUpdate(body)).toEqual(body);
    });

    it("refuses credentials, identity, tenancy and legal flags", () => {
        for (const field of ["password", "pin", "username", "id", "defaultOrgId", "tosAccepted", "privacyPolicyAccepted"]) {
            expect(() => parseAdminUserUpdate({ [field]: "x" })).toThrow(new RegExp(`cannot be changed here: ${field}`));
        }
    });

    it("validates the email", () => {
        expect(() => parseAdminUserUpdate({ email: "not-an-email" })).toThrow(/email/);
        // A user with no email is shown, and sent back, as "".
        expect(parseAdminUserUpdate({ email: "", firstName: "A" })).toEqual({ email: null, firstName: "A" });
    });
});
