import { type Request, type Response, type NextFunction } from "express";
import { projectService, type ProjectCtx } from "../domain/projects/core/project.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { BadRequestError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ProjectScopeMiddleware");

/**
 * Project Space scope resolution — the sibling of requireOrganization in tenant.ts.
 *
 * Precedence is deliberate (docs/PROJECT_SPACES_DESIGN.md §6.1):
 *
 *   1. explicit ?projectId / ?projectKey   — a request parameter always wins
 *   2. X-Project-Id / X-Project-Key header — explicit switch for API clients
 *   3. session active project              — what the UI switcher sets
 *   4. the org's default project           — so callers that name no project keep
 *                                            behaving exactly as they do today
 *
 * Because step 4 is total, adding this middleware to an existing route changes no
 * behaviour on its own: every request still lands in a real project.
 */

export interface ProjectScopeOptions {
    /** Reject with 400 when no project could be resolved. Default: false. */
    strict?: boolean;
    /**
     * Fall back to (and lazily create) the org default project. Default: true.
     * Set false where a missing project should stay unset rather than be invented.
     */
    useDefault?: boolean;
}

const SESSION_KEY = "activeProjectId";

function parseId(value: unknown): number | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || undefined;
    return undefined;
}

/**
 * Look up a project the caller is actually allowed to see.
 *
 * The org id comes from the resolved session context, never from the request, so
 * naming another org's project id cannot cross the tenant boundary. Resolution runs
 * through `projectService.getProject`, which applies §8's read gate as well: a
 * `private` project the caller is not a member of, and a project outside a governed
 * agent's grants, resolve to nothing rather than becoming the caller's active scope.
 * Skipping that check here would have made scope the way around it — this scope
 * reaches RAG retrieval and the capability prior, so it decides what the copilot may
 * read back to you.
 *
 * Invisible and absent deliberately look identical to the caller (`getProject` throws
 * NotFound either way), so probing keys cannot enumerate private projects.
 */
async function findInOrg(
    ctx: ProjectCtx,
    by: { id?: number; key?: string },
): Promise<{ id: number; key: string } | null> {
    const idOrKey = by.id !== undefined ? by.id : by.key;
    if (idOrKey === undefined) return null;
    try {
        const project = await projectService.getProject(ctx, idOrKey);
        return { id: project.id, key: project.key };
    } catch {
        return null;
    }
}

export async function resolveProjectScope(
    req: Request,
    opts: ProjectScopeOptions = {},
): Promise<{ id: number; key: string } | null> {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId ?? req.organizationId;
    if (typeof organizationId !== "number") return null;

    const ctx: ProjectCtx = {
        organizationId,
        userId: orgContext.userId,
        // An `X-Agent-Id` caller declares which agent principal it is acting as, which
        // can only ever NARROW what resolves (§8 ceilings lower, never grant), so
        // honouring a self-declared value is safe: the worst a caller can do by lying is
        // lock itself out of its own projects.
        agentId: firstString(req.headers["x-agent-id"]),
        isSuperAdmin: orgContext.isSuperAdmin,
        isOrgAdmin: orgContext.isOrgAdmin,
    };

    // 1. Explicit request parameter.
    const queryId = parseId(firstString(req.query.projectId) ?? firstString((req.query as any).project_id));
    const queryKey = firstString(req.query.projectKey) ?? firstString((req.query as any).project);
    if (queryId !== undefined || queryKey) {
        const found = await findInOrg(ctx, { id: queryId, key: queryKey });
        if (found) return found;
        // An explicitly named project that does not exist in this org is an error the
        // caller needs to see, not something to paper over with the default. A project
        // that exists but is not theirs to see reports the same thing, deliberately.
        throw new BadRequestError(
            `Project '${queryKey ?? queryId}' does not exist in this organization.`,
        );
    }

    // 2. Header.
    const headerId = parseId(firstString(req.headers["x-project-id"]));
    const headerKey = firstString(req.headers["x-project-key"]);
    if (headerId !== undefined || headerKey) {
        const found = await findInOrg(ctx, { id: headerId, key: headerKey });
        if (found) return found;
        throw new BadRequestError(
            `Project '${headerKey ?? headerId}' does not exist in this organization.`,
        );
    }

    // 3. Session (what the header switcher sets).
    const sessionProjectId = parseId((req.session as any)?.[SESSION_KEY]);
    if (sessionProjectId !== undefined) {
        const found = await findInOrg(ctx, { id: sessionProjectId });
        // A stale session pointer (project archived, org switched, membership revoked
        // since the switch) falls through to the default rather than failing the request.
        if (found) return found;
    }

    // 4. Org default.
    if (opts.useDefault === false) return null;

    // A governed agent has no business being dropped into the org default just because
    // it named nothing — the default is a project like any other, and it was not
    // granted. It lands in its own first project, or nowhere.
    if (await projectService.isGovernedAgent(ctx)) {
        const [first] = await projectService.listProjects(ctx);
        return first ? { id: first.id, key: first.key } : null;
    }

    const fallback = await projectService.ensureDefaultProject(ctx);
    return { id: fallback.id, key: fallback.key };
}

export const withProjectScope = (opts: ProjectScopeOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const scope = await resolveProjectScope(req, opts);
            if (scope) {
                req.projectId = scope.id;
                req.projectKey = scope.key;
            }
            if (opts.strict && !req.projectId) {
                logger.warn("Request blocked: no Project Space context", { path: req.path });
                return next(new BadRequestError("Project context required"));
            }
            next();
        } catch (err) {
            next(err);
        }
    };
};

/** Resolves a project when one is available, but never blocks the request. */
export const resolveProject = withProjectScope({ strict: false });

/** Set (or clear) the session's active project. Used by the header switcher. */
export function setSessionProject(req: Request, projectId: number | null): void {
    if (!req.session) return;
    if (projectId === null) {
        delete (req.session as any)[SESSION_KEY];
    } else {
        (req.session as any)[SESSION_KEY] = projectId;
    }
}
