import { and, desc, eq, or, type SQL } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import {
  insertResourceEdgeSchema,
  resourceEdges,
  type ResourceEdge,
} from "@shared/schema/index.js";
import {
  isResourceRelationType,
  isResourceType,
  makeResourceKey,
  type ResourceRelationType,
  type ResourceRelation,
  type ResourceType,
} from "@shared/resource-catalog.js";

import { resourceCatalogService } from "./resource-catalog.service.js";

export interface CreateResourceEdgeInput {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface NormalizedResourceEdgeInput {
  sourceType: ResourceType;
  sourceId: string;
  targetType: ResourceType;
  targetId: string;
  relationType: ResourceRelationType;
  label: string | null;
  metadata: Record<string, unknown>;
}

function edgeOrgCondition(orgContext: OrgContext): SQL {
  return eq(resourceEdges.organizationId, requireOrgId(orgContext));
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeEdgeInput(input: CreateResourceEdgeInput): NormalizedResourceEdgeInput {
  const sourceId = String(input.sourceId ?? "").trim();
  const targetId = String(input.targetId ?? "").trim();
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : null;

  if (!isResourceType(input.sourceType) || !isResourceType(input.targetType)) {
    throw new BadRequestError("Unsupported resource type in edge", { input });
  }
  if (!isResourceRelationType(input.relationType)) {
    throw new BadRequestError("Unsupported relation type", { relationType: input.relationType });
  }
  if (!sourceId || !targetId) {
    throw new BadRequestError("Resource edge endpoints must have non-empty ids");
  }
  if (input.sourceType === input.targetType && sourceId === targetId) {
    throw new BadRequestError("An edge cannot connect a resource to itself");
  }

  return {
    sourceType: input.sourceType,
    sourceId,
    targetType: input.targetType,
    targetId,
    relationType: input.relationType,
    label,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function edgeIdentityCondition(organizationId: number, input: NormalizedResourceEdgeInput): SQL {
  return and(
    eq(resourceEdges.organizationId, organizationId),
    eq(resourceEdges.sourceType, input.sourceType),
    eq(resourceEdges.sourceId, input.sourceId),
    eq(resourceEdges.relationType, input.relationType),
    eq(resourceEdges.targetType, input.targetType),
    eq(resourceEdges.targetId, input.targetId),
  )!;
}

function toRelation(edge: ResourceEdge, perspective: "source" | "target"): ResourceRelation {
  const targetType = (perspective === "source" ? edge.targetType : edge.sourceType) as ResourceType;
  const targetId = perspective === "source" ? edge.targetId : edge.sourceId;

  return {
    type: edge.relationType as ResourceRelation["type"],
    targetType,
    targetId,
    targetKey: makeResourceKey(targetType, targetId),
    label: edge.label ?? undefined,
    metadata: { ...((edge.metadata as Record<string, unknown> | null) ?? {}), edgeId: edge.id, direction: perspective },
    source: "persisted",
  };
}

export class ResourceEdgeService {
  async listEdgesForResource(
    orgContext: OrgContext,
    type: ResourceType,
    id: string,
  ): Promise<ResourceRelation[]> {
    const where = and(
      edgeOrgCondition(orgContext),
      or(
        and(eq(resourceEdges.sourceType, type), eq(resourceEdges.sourceId, id)),
        and(eq(resourceEdges.targetType, type), eq(resourceEdges.targetId, id)),
      ),
    );

    const rows = await db
      .select()
      .from(resourceEdges)
      .where(where)
      .orderBy(desc(resourceEdges.createdAt));

    return rows.map((edge) =>
      toRelation(edge, edge.sourceType === type && edge.sourceId === id ? "source" : "target"),
    );
  }

  async createEdge(orgContext: OrgContext, input: CreateResourceEdgeInput): Promise<ResourceEdge> {
    const normalized = normalizeEdgeInput(input);

    // Re-resolve both endpoints under the caller's own org context so the edges API can't be
    // used to enumerate cross-org resource existence (each lookup 404s if invisible to the caller).
    await resourceCatalogService.getResourceByKey(makeResourceKey(normalized.sourceType, normalized.sourceId), orgContext);
    await resourceCatalogService.getResourceByKey(makeResourceKey(normalized.targetType, normalized.targetId), orgContext);

    const organizationId = requireOrgId(orgContext);
    const [existing] = await db
      .select()
      .from(resourceEdges)
      .where(edgeIdentityCondition(organizationId, normalized))
      .limit(1);
    if (existing) return existing;

    const data = insertResourceEdgeSchema.parse({
      organizationId,
      sourceType: normalized.sourceType,
      sourceId: normalized.sourceId,
      targetType: normalized.targetType,
      targetId: normalized.targetId,
      relationType: normalized.relationType,
      label: normalized.label,
      metadata: normalized.metadata,
      createdBy: orgContext.userId,
    });

    try {
      const [edge] = await db.insert(resourceEdges).values(data).returning();
      return edge;
    } catch (error) {
      const [raceWinner] = await db
        .select()
        .from(resourceEdges)
        .where(edgeIdentityCondition(organizationId, normalized))
        .limit(1);
      if (raceWinner) return raceWinner;
      throw error;
    }
  }

  async deleteEdge(orgContext: OrgContext, id: number): Promise<void> {
    const where = and(eq(resourceEdges.id, id), edgeOrgCondition(orgContext));
    const [deleted] = await db.delete(resourceEdges).where(where).returning({ id: resourceEdges.id });
    if (!deleted) {
      throw new NotFoundError(`Resource edge ${id} not found`);
    }
  }
}

export const resourceEdgeService = new ResourceEdgeService();
