/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { canDecideApproval } from "./approval-authority.js";

const request = { approverId: "u-approver", approverEmail: "approver@example.com", organizationId: 7 };

describe("who may decide an approval request", () => {
    it("lets the designated approver decide, by id or by email", () => {
        expect(canDecideApproval(request, "u-approver", "someone@else.com")).toBe(true);
        expect(canDecideApproval(request, "u-other", "approver@example.com")).toBe(true);
    });

    it("lets a super admin, or an admin of the request's own org, decide", () => {
        expect(canDecideApproval(request, "u-x", "x@x.com", { isSuperAdmin: true })).toBe(true);
        expect(canDecideApproval(request, "u-x", "x@x.com", { isOrgAdmin: true, organizationId: 7 })).toBe(true);
        expect(canDecideApproval(request, "u-x", "x@x.com", { isOrgAdmin: true, organizationId: 8 })).toBe(false);
    });

    it("gives the account whose id is 1 no special power", () => {
        // users.id is text; a real row with id "1" exists in development data and
        // used to decide every tenant's approvals through a "system user" exemption.
        expect(canDecideApproval(request, "1", "test@x.com")).toBe(false);
        expect(canDecideApproval(request, 1, "test@x.com")).toBe(false);
    });
});
