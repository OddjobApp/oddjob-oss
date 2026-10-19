import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
    hasOrganizationPermission,
    permissionsForRoles,
    requireOrganizationPermission,
    resolveOrganizationAuthorization,
    type OrganizationAuthorizationDeps,
} from "@server/utils/organization-permissions.js";
import type { OrgContext } from "@server/utils/auth-context.js";

describe("organization permission model", () => {
    it("separates execution, approval, and audit duties", () => {
        expect(hasOrganizationPermission(["operator"], "mission:execute")).toBe(true);
        expect(hasOrganizationPermission(["operator"], "mission:approve")).toBe(false);
        expect(hasOrganizationPermission(["approver"], "mission:approve")).toBe(true);
        expect(hasOrganizationPermission(["approver"], "audit:export")).toBe(false);
        expect(hasOrganizationPermission(["auditor"], "audit:export")).toBe(true);
    });

    it("combines multiple assigned duties without duplication", () => {
        expect(permissionsForRoles(["operator", "auditor", "operator"])).toEqual([
            "mission:view",
            "mission:execute",
            "audit:export",
        ]);
    });

    it("grants administrators every declared permission", () => {
        expect(permissionsForRoles(["administrator"])).toHaveLength(7);
    });
});

const member: OrgContext = {
    userId: "user-1",
    organizationId: 7,
    isAdmin: false,
    isSuperAdmin: false,
    isOrgAdmin: false,
};

/** Deps with everything stubbed; override per test. */
function makeDeps(
    overrides: Partial<{
        context: OrgContext;
        enforced: boolean | undefined;
        roles: string[];
    }> = {},
): OrganizationAuthorizationDeps {
    return {
        loadContext: async () => overrides.context ?? member,
        loadEnforcement: async () => ("enforced" in overrides ? overrides.enforced : false),
        loadRoles: async () => overrides.roles ?? [],
    };
}

const req = {} as Request;

describe("resolveOrganizationAuthorization", () => {
    it("grants every permission in compatibility mode, whatever the roles say", async () => {
        // This is the current production posture and the reason adding
        // requireOrganizationPermission to a route is a no-op today. Asserted
        // explicitly so that flipping it can never be an accident.
        const auth = await resolveOrganizationAuthorization(req, makeDeps({ enforced: false, roles: [] }));

        expect(auth.enforcement).toBe("compatibility");
        expect(auth.roles).toEqual([]);
        expect(auth.permissions).toHaveLength(7);
    });

    it("restricts a member to their assigned duties once enforcement is on", async () => {
        const auth = await resolveOrganizationAuthorization(
            req,
            makeDeps({ enforced: true, roles: ["operator"] }),
        );

        expect(auth.enforcement).toBe("strict");
        expect(auth.permissions).toEqual(["mission:view", "mission:execute"]);
        expect(auth.permissions).not.toContain("mission:approve");
    });

    it("leaves an unassigned member with nothing under strict enforcement", async () => {
        const auth = await resolveOrganizationAuthorization(req, makeDeps({ enforced: true, roles: [] }));
        expect(auth.permissions).toEqual([]);
    });

    it("treats a missing org_settings row as compatibility, not as strict", async () => {
        // `undefined` is a third state: no settings row at all. Reading it as
        // strict would lock out every org that has never opened the settings
        // page, since none of them have role assignments either.
        const auth = await resolveOrganizationAuthorization(req, makeDeps({ enforced: undefined }));

        expect(auth.enforcement).toBe("compatibility");
        expect(auth.permissions).toHaveLength(7);
    });

    it("ignores role names the permission model does not define", async () => {
        // A role removed from the code, or written straight into the table, must
        // not widen access by falling through the lookup as undefined.
        const auth = await resolveOrganizationAuthorization(
            req,
            makeDeps({ enforced: true, roles: ["operator", "root", "superuser"] }),
        );

        expect(auth.roles).toEqual(["operator"]);
        expect(auth.permissions).toEqual(["mission:view", "mission:execute"]);
    });

    it("reports the org's real posture for an admin, not a flattering one", async () => {
        // Admins bypass the role check in both modes, but an org running in
        // compatibility must not be described as `strict` — that field is what
        // the 403 body and /api/auth/permissions report.
        const admin = { ...member, isOrgAdmin: true };

        const relaxed = await resolveOrganizationAuthorization(
            req,
            makeDeps({ context: admin, enforced: false }),
        );
        expect(relaxed.enforcement).toBe("compatibility");
        expect(relaxed.permissions).toHaveLength(7);

        const strict = await resolveOrganizationAuthorization(
            req,
            makeDeps({ context: admin, enforced: true }),
        );
        expect(strict.enforcement).toBe("strict");
        expect(strict.permissions).toHaveLength(7);
    });

    it("refuses a caller with no organization context", async () => {
        const orphan = { ...member, organizationId: null };
        await expect(
            resolveOrganizationAuthorization(req, makeDeps({ context: orphan })),
        ).rejects.toThrow(/Organization context required/);
    });
});

describe("requireOrganizationPermission", () => {
    function makeRes() {
        const res = {
            statusCode: 0,
            body: undefined as unknown,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(payload: unknown) {
                this.body = payload;
                return this;
            },
        };
        return res as unknown as Response & { statusCode: number; body: any };
    }

    it("passes a permitted caller through to the route", async () => {
        const next = vi.fn();
        const res = makeRes();
        const request = {} as Request;

        await requireOrganizationPermission(
            "mission:approve",
            makeDeps({ enforced: true, roles: ["approver"] }),
        )(request, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledWith();
        expect(res.statusCode).toBe(0);
        // The route gets the resolved authorization rather than re-deriving it.
        expect((request as any).organizationAuthorization.roles).toEqual(["approver"]);
    });

    it("403s a caller holding the wrong duty, and says which one was needed", async () => {
        const next = vi.fn();
        const res = makeRes();

        await requireOrganizationPermission(
            "mission:approve",
            makeDeps({ enforced: true, roles: ["operator"] }),
        )({} as Request, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            error: "Forbidden",
            requiredPermission: "mission:approve",
            enforcement: "strict",
            assignedRoles: ["operator"],
        });
    });

    it("forwards a lookup failure to the error handler instead of allowing the request", async () => {
        // Fail CLOSED. If the roles cannot be read, the caller must not proceed
        // on the permissive default.
        const next = vi.fn();
        const res = makeRes();
        const deps: OrganizationAuthorizationDeps = {
            loadContext: async () => member,
            loadEnforcement: async () => true,
            loadRoles: async () => {
                throw new Error("connection terminated");
            },
        };

        await requireOrganizationPermission("mission:approve", deps)({} as Request, res, next);

        expect(res.statusCode).toBe(0);
        expect(next).toHaveBeenCalledOnce();
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});

describe("role assignment input", () => {
    it("collapses repeated roles instead of hitting the unique index", async () => {
        // The (organization, user, role) unique index turns a duplicated role
        // into a 500 on what is a perfectly well-formed request. Saying
        // "operator" twice means "operator".
        const { roleAssignmentSchema } = await import("@server/routes/auth.routes.js");

        expect(roleAssignmentSchema.parse({ userId: "u1", roles: ["operator", "operator"] }).roles)
            .toEqual(["operator"]);
        expect(roleAssignmentSchema.parse({ userId: "u1", roles: ["auditor", "operator", "auditor"] }).roles)
            .toEqual(["auditor", "operator"]);
    });

    it("still rejects a role outside the declared set", () => {
        return import("@server/routes/auth.routes.js").then(({ roleAssignmentSchema }) => {
            expect(() => roleAssignmentSchema.parse({ userId: "u1", roles: ["root"] })).toThrow();
        });
    });

    it("clears every role when sent an empty list", async () => {
        const { roleAssignmentSchema } = await import("@server/routes/auth.routes.js");
        expect(roleAssignmentSchema.parse({ userId: "u1", roles: [] }).roles).toEqual([]);
    });
});
