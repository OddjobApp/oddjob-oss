import { describe, it, expect } from "vitest";
import { requireOrg, capRole, UNGOVERNED_AGENT, type AgentCeiling } from "../../core/project.service.js";
import { ForbiddenError } from "@server/utils/errors.js";
import {
    slugifyProjectKey,
    projectKeySchema,
    insertProjectSchema,
    createProjectSchema,
    PROJECT_RESOURCE_TYPES,
} from "@shared/schema/projects.js";

// The DB-backed ProjectService (CRUD, membership, rollup) needs a live migrated DB
// and is covered by integration coverage. Here we lock the PURE logic: the org gate,
// key derivation, and the input contract.

describe("ProjectService.requireOrg (tenant isolation gate)", () => {
    it("returns the org id when present", () => {
        expect(requireOrg({ organizationId: 42 })).toBe(42);
    });

    it("refuses a missing/invalid org context rather than defaulting", () => {
        expect(() => requireOrg({} as any)).toThrow(ForbiddenError);
        expect(() => requireOrg(undefined as any)).toThrow(ForbiddenError);
        expect(() => requireOrg({ organizationId: "7" } as any)).toThrow(ForbiddenError);
        expect(() => requireOrg({ organizationId: null } as any)).toThrow(ForbiddenError);
        expect(() => requireOrg({ organizationId: NaN } as any)).toThrow(ForbiddenError);
    });
});

describe("slugifyProjectKey", () => {
    it("derives a URL/DNS-safe key from a name", () => {
        expect(slugifyProjectKey("Rescue Dispatch")).toBe("rescue-dispatch");
        expect(slugifyProjectKey("Trust & Quality")).toBe("trust-quality");
        expect(slugifyProjectKey("  Leading and trailing  ")).toBe("leading-and-trailing");
    });

    it("collapses runs of separators rather than emitting empty segments", () => {
        expect(slugifyProjectKey("a///b___c")).toBe("a-b-c");
    });

    it("never returns an empty key", () => {
        expect(slugifyProjectKey("!!!")).toBe("project");
        expect(slugifyProjectKey("")).toBe("project");
    });

    it("produces keys the key schema accepts", () => {
        // Callers derive keys without re-validating, so this invariant must hold for
        // any input — including names too short to slugify into a legal key.
        for (const name of ["Rescue Dispatch", "Trust & Quality", "2026 Q3 — Growth!", "x", "!!!", ""]) {
            expect(projectKeySchema.safeParse(slugifyProjectKey(name)).success).toBe(true);
        }
    });
});

describe("projectKeySchema", () => {
    it("rejects keys that are not lowercase single-hyphen slugs", () => {
        for (const bad of ["Rescue", "rescue_dispatch", "-rescue", "rescue-", "rescue--dispatch", "a"]) {
            expect(projectKeySchema.safeParse(bad).success).toBe(false);
        }
    });
});

describe("insertProjectSchema", () => {
    it("hands Drizzle a string for the NUMERIC budget column even when given a number", () => {
        const parsed = insertProjectSchema.parse({
            organizationId: 1,
            createdBy: "tester",
            key: "rescue-dispatch",
            name: "Rescue Dispatch",
            budgetLimitUsd: 250,
        });
        expect(parsed.budgetLimitUsd).toBe("250");
    });

    it("defaults status and visibility so a minimal create is valid", () => {
        const parsed = insertProjectSchema.parse({
            organizationId: 1,
            createdBy: "tester",
            key: "minimal",
            name: "Minimal",
        });
        expect(parsed.status).toBe("active");
        expect(parsed.visibility).toBe("org");
    });

    it("rejects an invalid key rather than silently correcting it", () => {
        expect(insertProjectSchema.safeParse({
            organizationId: 1,
            createdBy: "tester",
            key: "Not A Key",
            name: "x",
        }).success).toBe(false);
    });
});

describe("createProjectSchema (POST /api/projects body)", () => {
    it("accepts a name-only body — the server derives the key", () => {
        const parsed = createProjectSchema.parse({ name: "Rescue Dispatch" });
        expect(parsed.key).toBeUndefined();
        expect(parsed.name).toBe("Rescue Dispatch");
    });

    it("honours an explicit key when the caller supplies one", () => {
        expect(createProjectSchema.parse({ name: "x", key: "rescue-dispatch" }).key).toBe("rescue-dispatch");
    });

    it("does not let a caller claim org, creator, or default status", () => {
        const parsed: any = createProjectSchema.parse({
            name: "Sneaky",
            organizationId: 999,
            createdBy: "someone-else",
            isDefault: true,
        });
        expect(parsed.organizationId).toBeUndefined();
        expect(parsed.createdBy).toBeUndefined();
        expect(parsed.isDefault).toBeUndefined();
    });
});

describe("capRole (§8 agent blast radius)", () => {
    const granted = (role: AgentCeiling["role"]): AgentCeiling => ({ governed: true, role });

    it("leaves a request with no agent principal exactly as it was", () => {
        expect(capRole("owner", null)).toBe("owner");
        expect(capRole("viewer", null)).toBe("viewer");
        expect(capRole(null, null)).toBeNull();
    });

    it("leaves an UNGOVERNED agent alone — every agent is ungoverned until granted", () => {
        // This is the property that makes the feature free to adopt: no membership row
        // exists for any agent today, so nothing changes until someone grants one.
        expect(capRole("owner", UNGOVERNED_AGENT)).toBe("owner");
        expect(capRole("editor", UNGOVERNED_AGENT)).toBe("editor");
    });

    it("shuts a governed agent out of projects it was not granted", () => {
        expect(capRole("owner", granted(null))).toBeNull();
        expect(capRole("viewer", granted(null))).toBeNull();
    });

    it("lowers to the agent's grant, including under an org admin's authority", () => {
        // `owner` here is what hasOrgWideAccess hands an org admin. A ceiling that did
        // not bind admins would not bound anything: agents run on someone's authority.
        expect(capRole("owner", granted("viewer"))).toBe("viewer");
        expect(capRole("owner", granted("editor"))).toBe("editor");
    });

    it("keeps the human's role when it is already the lower of the two", () => {
        expect(capRole("viewer", granted("owner"))).toBe("viewer");
        expect(capRole("operator", granted("editor"))).toBe("operator");
    });

    it("never GRANTS — a ceiling can only lower", () => {
        // §8: project roles are additive to org roles and never expand them. An agent's
        // grant must not become a way for a user to reach a project they cannot.
        expect(capRole(null, granted("owner"))).toBeNull();
        expect(capRole(null, granted("viewer"))).toBeNull();
    });
});

describe("PROJECT_RESOURCE_TYPES", () => {
    it("covers every resource kind the Phase 1 backfill attaches", () => {
        // If a kind is added to the backfill without being added here, the route-level
        // assertResourceType guard would reject rows the backfill created.
        expect([...PROJECT_RESOURCE_TYPES].sort()).toEqual(
            ["app", "crew_room", "cycle", "dataset", "form", "job_collection", "kb_document", "mission", "workflow"],
        );
    });
});
