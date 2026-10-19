import { describe, expect, it } from "vitest";
import {
    defaultUsernameFor,
    MIN_ADMIN_PASSWORD_LENGTH,
    validateFirstAdminInput,
} from "./first-admin.service.js";

const valid = {
    email: "owner@example.com",
    password: "a".repeat(MIN_ADMIN_PASSWORD_LENGTH),
    username: "owner",
    organizationName: "Example Org",
};

describe("validateFirstAdminInput", () => {
    it("accepts a complete input", () => {
        expect(validateFirstAdminInput(valid)).toEqual([]);
    });

    it("rejects a password shorter than the minimum", () => {
        const problems = validateFirstAdminInput({ ...valid, password: "a".repeat(MIN_ADMIN_PASSWORD_LENGTH - 1) });
        expect(problems).toEqual([`the admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`]);
    });

    it("reports every problem at once", () => {
        expect(validateFirstAdminInput({ email: "not-an-email", password: "", username: "x", organizationName: " " }))
            .toHaveLength(4);
    });

    it("rejects an organization name longer than the column", () => {
        expect(validateFirstAdminInput({ ...valid, organizationName: "o".repeat(121) })).toHaveLength(1);
    });
});

describe("defaultUsernameFor", () => {
    it("uses the local part of the email", () => {
        expect(defaultUsernameFor("jane.doe@example.com")).toBe("jane.doe");
    });
});
