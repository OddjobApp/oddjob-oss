/**
 * Agent identity administration — identities, policy bundles, permission grants
 * and the audit trail, as managed from the Governor API.
 *
 * The decision engine that *reads* these rows to allow or deny an action is
 * agent-identity-governance.service.ts; this is the write and reporting side.
 *
 * Every method takes `organizationId: number` and filters on it. There is no
 * unscoped variant and no nullable org: the caller resolves the tenant once
 * (see resolveRequestOrgId in server/routes/governor.ts) and cannot reach a
 * row in another org through this service.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import {
  agentGovernanceAuditEvents,
  agentIdentities,
  agentPermissionGrants,
  agentPolicyBundles,
  type AgentGovernanceAuditEvent,
  type AgentIdentity,
  type AgentPermissionGrant,
  type AgentPolicyBundle,
} from "@shared/schema/index.js";

export const agentIdentitySchema = z.object({
  agentId: z.string().min(1),
  displayName: z.string().min(1),
  ownerId: z.string().min(1),
  environment: z.string().min(1).default("prod"),
  status: z.enum(["draft", "active", "suspended", "revoked"]).default("draft"),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  policyBundleId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentIdentityStatusSchema = z.object({
  status: z.enum(["draft", "active", "suspended", "revoked"]).optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  lastReviewedAt: z.string().datetime().nullable().optional(),
});

export const agentPermissionGrantSchema = z.object({
  tool: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().min(1).default("*"),
  effect: z.enum(["allow", "deny"]).default("allow"),
  requiresApproval: z.boolean().default(false),
  conditions: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const agentPolicyBundleGrantSchema = agentPermissionGrantSchema.omit({ expiresAt: true }).extend({
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const agentPolicyBundleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  grants: z.array(agentPolicyBundleGrantSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentIdentityInput = z.infer<typeof agentIdentitySchema>;
export type AgentIdentityStatusInput = z.infer<typeof agentIdentityStatusSchema>;
export type AgentPermissionGrantInput = z.infer<typeof agentPermissionGrantSchema>;
export type AgentPolicyBundleInput = z.infer<typeof agentPolicyBundleSchema>;

export type ApplyPolicyBundleResult =
  | { ok: true; identity: AgentIdentity; bundle: AgentPolicyBundle; grants: AgentPermissionGrant[] }
  | { ok: false; failure: "identity-not-found" | "bundle-not-found" | "bundle-inactive" };

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_REVIEW_DAYS = 30;
const RECENT_EVENT_LIMIT = 500;

/** A requested page size, clamped to [1, max]; anything unparseable gets the default. */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

class AgentIdentityAdminService {
  // ── Policy bundles ────────────────────────────────────────────────────────

  listBundles(organizationId: number): Promise<AgentPolicyBundle[]> {
    return db
      .select()
      .from(agentPolicyBundles)
      .where(eq(agentPolicyBundles.organizationId, organizationId))
      .orderBy(desc(agentPolicyBundles.updatedAt))
      .limit(100);
  }

  async createBundle(organizationId: number, input: AgentPolicyBundleInput, createdBy: string): Promise<AgentPolicyBundle> {
    const [bundle] = await db.insert(agentPolicyBundles).values({
      ...input,
      organizationId,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
      createdBy,
    }).returning();
    return bundle;
  }

  /** The updated bundle, or null when no bundle with that id exists in this org. */
  async updateBundle(organizationId: number, id: string, input: Partial<AgentPolicyBundleInput>): Promise<AgentPolicyBundle | null> {
    const [bundle] = await db.update(agentPolicyBundles)
      .set({
        ...input,
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata ?? {} } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agentPolicyBundles.id, id), eq(agentPolicyBundles.organizationId, organizationId)))
      .returning();
    return bundle ?? null;
  }

  /**
   * Stamp a bundle's grant templates onto an identity and adopt its risk level.
   * The grants and the identity update commit together: applying a bundle used
   * to insert grants and then update the identity as two statements, so a
   * failure between them left grants attached to an identity that did not
   * record the bundle.
   */
  async applyBundle(organizationId: number, identityId: string, bundleId: string, createdBy: string): Promise<ApplyPolicyBundleResult> {
    return db.transaction(async (tx) => {
      const [identity] = await tx
        .select({ id: agentIdentities.id })
        .from(agentIdentities)
        .where(and(eq(agentIdentities.id, identityId), eq(agentIdentities.organizationId, organizationId)))
        .limit(1);
      if (!identity) return { ok: false, failure: "identity-not-found" } as const;

      const [bundle] = await tx
        .select()
        .from(agentPolicyBundles)
        .where(and(eq(agentPolicyBundles.id, bundleId), eq(agentPolicyBundles.organizationId, organizationId)))
        .limit(1);
      if (!bundle) return { ok: false, failure: "bundle-not-found" } as const;
      if (bundle.status !== "active") return { ok: false, failure: "bundle-inactive" } as const;

      const now = Date.now();
      const grantRows = agentPolicyBundleSchema.shape.grants.parse(bundle.grants).map((grant) => ({
        organizationId,
        agentIdentityId: identityId,
        tool: grant.tool,
        action: grant.action,
        resource: grant.resource,
        effect: grant.effect,
        requiresApproval: grant.requiresApproval,
        conditions: grant.conditions ?? {},
        expiresAt: grant.expiresInDays ? new Date(now + grant.expiresInDays * DAY_MS) : undefined,
        createdBy,
      }));

      const grants = grantRows.length > 0
        ? await tx.insert(agentPermissionGrants).values(grantRows).returning()
        : [];

      const [updated] = await tx.update(agentIdentities)
        .set({ policyBundleId: bundle.id, riskLevel: bundle.riskLevel, updatedAt: new Date() })
        .where(and(eq(agentIdentities.id, identityId), eq(agentIdentities.organizationId, organizationId)))
        .returning();

      return { ok: true, identity: updated, bundle, grants } as const;
    });
  }

  // ── Identities ────────────────────────────────────────────────────────────

  listIdentities(organizationId: number): Promise<AgentIdentity[]> {
    return db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.organizationId, organizationId))
      .orderBy(desc(agentIdentities.createdAt))
      .limit(250);
  }

  /** The identity with its grants and latest audit events, or null when not in this org. */
  async getIdentityDetail(organizationId: number, id: string): Promise<{
    identity: AgentIdentity;
    grants: AgentPermissionGrant[];
    auditEvents: AgentGovernanceAuditEvent[];
  } | null> {
    const [identity] = await db
      .select()
      .from(agentIdentities)
      .where(and(eq(agentIdentities.id, id), eq(agentIdentities.organizationId, organizationId)))
      .limit(1);
    if (!identity) return null;

    const grants = await db
      .select()
      .from(agentPermissionGrants)
      .where(and(eq(agentPermissionGrants.agentIdentityId, identity.id), eq(agentPermissionGrants.organizationId, organizationId)))
      .orderBy(desc(agentPermissionGrants.createdAt));

    const auditEvents = await this.listAuditEvents(organizationId, { identityId: identity.id, limit: 50 });
    return { identity, grants, auditEvents };
  }

  async createIdentity(organizationId: number, input: AgentIdentityInput, createdBy: string): Promise<AgentIdentity> {
    const [identity] = await db.insert(agentIdentities).values({
      ...input,
      organizationId,
      metadata: input.metadata ?? {},
      createdBy,
    }).returning();
    return identity;
  }

  /** The updated identity, or null when no identity with that id exists in this org. */
  async updateIdentityStatus(organizationId: number, id: string, input: AgentIdentityStatusInput): Promise<AgentIdentity | null> {
    const [identity] = await db.update(agentIdentities)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
        ...(input.lastReviewedAt !== undefined ? { lastReviewedAt: input.lastReviewedAt ? new Date(input.lastReviewedAt) : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agentIdentities.id, id), eq(agentIdentities.organizationId, organizationId)))
      .returning();
    return identity ?? null;
  }

  // ── Permission grants ─────────────────────────────────────────────────────

  /** The new grant, or null when the identity does not exist in this org. */
  async createGrant(organizationId: number, identityId: string, input: AgentPermissionGrantInput, createdBy: string): Promise<AgentPermissionGrant | null> {
    const [identity] = await db
      .select({ id: agentIdentities.id })
      .from(agentIdentities)
      .where(and(eq(agentIdentities.id, identityId), eq(agentIdentities.organizationId, organizationId)))
      .limit(1);
    if (!identity) return null;

    const [grant] = await db.insert(agentPermissionGrants).values({
      organizationId,
      agentIdentityId: identityId,
      tool: input.tool,
      action: input.action,
      resource: input.resource,
      effect: input.effect,
      requiresApproval: input.requiresApproval,
      conditions: input.conditions ?? {},
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      createdBy,
    }).returning();
    return grant;
  }

  /** The expired grant, or null when that grant is not on that identity in this org. */
  async expireGrant(organizationId: number, identityId: string, grantId: string): Promise<AgentPermissionGrant | null> {
    const [grant] = await db.update(agentPermissionGrants)
      .set({ expiresAt: new Date() })
      .where(and(
        eq(agentPermissionGrants.id, grantId),
        eq(agentPermissionGrants.agentIdentityId, identityId),
        eq(agentPermissionGrants.organizationId, organizationId),
      ))
      .returning();
    return grant ?? null;
  }

  // ── Audit trail and reporting ─────────────────────────────────────────────

  listAuditEvents(organizationId: number, opts: { identityId?: string; limit: number }): Promise<AgentGovernanceAuditEvent[]> {
    const scope = opts.identityId
      ? and(eq(agentGovernanceAuditEvents.organizationId, organizationId), eq(agentGovernanceAuditEvents.agentIdentityId, opts.identityId))
      : eq(agentGovernanceAuditEvents.organizationId, organizationId);
    return db
      .select()
      .from(agentGovernanceAuditEvents)
      .where(scope)
      .orderBy(desc(agentGovernanceAuditEvents.createdAt))
      .limit(opts.limit);
  }

  async reportingSummary(organizationId: number, now = new Date()) {
    const identities = await db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.organizationId, organizationId))
      .limit(500);
    const recentEvents = await this.listAuditEvents(organizationId, { limit: RECENT_EVENT_LIMIT });
    return summarizeAgentGovernance(identities, recentEvents, now);
  }
}

/** The reporting-summary payload, computed from already-scoped rows. */
export function summarizeAgentGovernance(
  identities: AgentIdentity[],
  recentEvents: AgentGovernanceAuditEvent[],
  now: Date,
) {
  const staleReviewCutoff = now.getTime() - STALE_REVIEW_DAYS * DAY_MS;
  const highRiskIdentities = identities.filter((identity) => ["high", "critical"].includes(identity.riskLevel));
  const suspendedIdentities = identities.filter((identity) => ["suspended", "revoked"].includes(identity.status));
  const staleReviews = identities.filter((identity) =>
    identity.status === "active"
    && (!identity.lastReviewedAt || identity.lastReviewedAt.getTime() < staleReviewCutoff)
  );
  const deniedActions = recentEvents.filter((event) => event.decision === "deny");
  const approvalRequired = recentEvents.filter((event) => event.decision === "require_approval");

  const policyCounts = new Map<string, number>();
  for (const event of recentEvents) {
    for (const code of event.policyCodes ?? []) {
      policyCounts.set(code, (policyCounts.get(code) ?? 0) + 1);
    }
  }

  const topPolicyCodes = Array.from(policyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, count]) => ({ code, count }));

  const topDeniedActions = deniedActions
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      agentId: event.agentId,
      tool: event.tool,
      action: event.action,
      resource: event.resource,
      riskLevel: event.riskLevel,
      policyCodes: event.policyCodes,
      createdAt: event.createdAt,
    }));

  const reviewQueue = staleReviews
    .sort((a, b) => (a.lastReviewedAt?.getTime() ?? 0) - (b.lastReviewedAt?.getTime() ?? 0))
    .slice(0, 8)
    .map((identity) => ({
      id: identity.id,
      agentId: identity.agentId,
      displayName: identity.displayName,
      riskLevel: identity.riskLevel,
      status: identity.status,
      lastReviewedAt: identity.lastReviewedAt,
    }));

  return {
    generatedAt: now.toISOString(),
    window: { recentEventLimit: RECENT_EVENT_LIMIT, staleReviewDays: STALE_REVIEW_DAYS },
    metrics: {
      identities: identities.length,
      highRiskIdentities: highRiskIdentities.length,
      suspendedIdentities: suspendedIdentities.length,
      staleReviews: staleReviews.length,
      deniedActions: deniedActions.length,
      approvalRequired: approvalRequired.length,
      recentEvents: recentEvents.length,
    },
    topPolicyCodes,
    topDeniedActions,
    reviewQueue,
  };
}

export const agentIdentityAdminService = new AgentIdentityAdminService();
