import { Router, type Request, type Response } from "express";

import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import {
  isResourceRelationType,
  isResourceType,
  RESOURCE_LIFECYCLES,
  RESOURCE_RELATION_TYPES,
  RESOURCE_TYPE_DEFINITIONS,
  RESOURCE_TYPES,
  type ResourceCatalogQuery,
  type ResourceLifecycle,
  type ResourceType,
} from "@shared/resource-catalog.js";

import { getResourceHealthDashboard } from "./resource-health.service.js";
import { resourceCatalogService } from "./resource-catalog.service.js";
import { resourceEdgeService } from "./resource-edge.service.js";
import { getResourceGraph } from "./resource-graph.service.js";
import { analyzeResourceImpact } from "./resource-impact.service.js";
import { routeResourceIntent } from "./resource-intent.service.js";
import { enrichResourceActionContracts } from "./resource-action-contract.service.js";
import { brokerResourceAction } from "./resource-action-broker.service.js";
import { getResourceStudio } from "./resource-studio.service.js";
import {
  buildAcceleratorManifest,
  buildAgentOpsScorecard,
  buildAuditExportPack,
  buildPolicyPackManifest,
} from "./resource-pack.service.js";

export const resourceCatalogRouter = Router();

resourceCatalogRouter.use(requireAuth);

function splitQueryValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(splitQueryValue);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseResourceTypes(req: Request, res: Response): ResourceType[] | undefined {
  const values = splitQueryValue(req.query.type ?? req.query.types);
  if (values.length === 0) return undefined;

  const invalid = values.filter((value) => !isResourceType(value));
  if (invalid.length > 0) {
    res.status(400).json({
      error: "Unsupported resource type",
      invalid,
      supported: RESOURCE_TYPES,
    });
    return undefined;
  }

  return values as ResourceType[];
}

function parseLifecycle(req: Request, res: Response): ResourceLifecycle | undefined {
  const value = typeof req.query.lifecycle === "string" ? req.query.lifecycle.trim() : "";
  if (!value) return undefined;

  if (!RESOURCE_LIFECYCLES.includes(value as ResourceLifecycle)) {
    res.status(400).json({
      error: "Unsupported resource lifecycle",
      invalid: value,
      supported: RESOURCE_LIFECYCLES,
    });
    return undefined;
  }

  return value as ResourceLifecycle;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

resourceCatalogRouter.get("/ontology", asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    types: RESOURCE_TYPES,
    lifecycles: RESOURCE_LIFECYCLES,
    definitions: RESOURCE_TYPE_DEFINITIONS,
    actionContract: {
      risk: ["low", "medium", "high", "critical"],
      sideEffects: ["none", "read", "write", "delete", "external_api", "notification", "credential_use", "deployment", "human_approval", "cost"],
      brokerStatuses: ["matched", "ambiguous", "needs_input", "needs_confirmation", "blocked", "dry_run", "executed", "failed"],
    },
  });
}));

resourceCatalogRouter.get("/resources", asyncHandler(async (req: Request, res: Response) => {
  const types = parseResourceTypes(req, res);
  if (res.headersSent) return;

  const lifecycle = parseLifecycle(req, res);
  if (res.headersSent) return;

  const query: ResourceCatalogQuery = {
    types,
    lifecycle,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    limit: parseLimit(req.query.limit),
  };

  const orgContext = await getUserOrgContext(req);
  const catalog = await resourceCatalogService.listResources(orgContext, query);
  res.json({
    ...catalog,
    resources: catalog.resources.map(enrichResourceActionContracts),
  });
}));

resourceCatalogRouter.get("/resources/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const resource = await resourceCatalogService.getResourceByKey(req.params.key, orgContext);
  const persistedRelations = await resourceEdgeService.listEdgesForResource(orgContext, resource.type, resource.id);
  res.json(enrichResourceActionContracts({ ...resource, relations: [...resource.relations, ...persistedRelations] }));
}));

resourceCatalogRouter.get("/graph/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const graph = await getResourceGraph(orgContext, req.params.key, {
    maxDepth: parseLimit(req.query.maxDepth),
  });
  res.json({
    ...graph,
    root: enrichResourceActionContracts(graph.root),
    nodes: graph.nodes.map((node) => ({
      ...node,
      resource: enrichResourceActionContracts(node.resource),
    })),
  });
}));

resourceCatalogRouter.get("/studio/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const studio = await getResourceStudio(orgContext, req.params.key, {
    maxDepth: parseLimit(req.query.maxDepth),
  });
  res.json(studio);
}));

// --- Persisted Ontology Edges ---

resourceCatalogRouter.get("/edges", asyncHandler(async (req: Request, res: Response) => {
  const key = typeof req.query.key === "string" ? req.query.key : undefined;
  if (!key) {
    res.status(400).json({ error: "Missing required query parameter: key" });
    return;
  }

  const [type, ...idParts] = key.split(":");
  const id = idParts.join(":");
  if (!type || !id || !isResourceType(type)) {
    res.status(400).json({ error: `Invalid resource key: ${key}` });
    return;
  }

  const orgContext = await getUserOrgContext(req);
  const relations = await resourceEdgeService.listEdgesForResource(orgContext, type, id);
  res.json({ key, relations });
}));

resourceCatalogRouter.post("/edges", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const edge = await resourceEdgeService.createEdge(orgContext, req.body ?? {});
  res.status(201).json(edge);
}));

resourceCatalogRouter.delete("/edges/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid edge id" });
    return;
  }

  const orgContext = await getUserOrgContext(req);
  await resourceEdgeService.deleteEdge(orgContext, id);
  res.status(204).send();
}));

// --- Policy Impact Analysis ---

resourceCatalogRouter.get("/impact/:key", asyncHandler(async (req: Request, res: Response) => {
  const relationTypes = splitQueryValue(req.query.relationTypes);
  const invalidRelationTypes = relationTypes.filter((type) => !isResourceRelationType(type));
  if (invalidRelationTypes.length > 0) {
    res.status(400).json({
      error: "Unsupported relation type",
      invalid: invalidRelationTypes,
      supported: RESOURCE_RELATION_TYPES,
    });
    return;
  }

  const orgContext = await getUserOrgContext(req);
  const result = await analyzeResourceImpact(orgContext, req.params.key, {
    maxDepth: parseLimit(req.query.maxDepth),
    relationTypes: relationTypes.length > 0 ? relationTypes : undefined,
  });
  res.json(result);
}));

// --- Intent-to-Action Routing ---

resourceCatalogRouter.get("/intent", asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  if (!query.trim()) {
    res.status(400).json({ error: "Missing required query parameter: query" });
    return;
  }

  const types = parseResourceTypes(req, res);
  if (res.headersSent) return;

  const orgContext = await getUserOrgContext(req);
  const result = await routeResourceIntent(orgContext, query, {
    types,
    limit: parseLimit(req.query.limit),
  });
  res.json(result);
}));

resourceCatalogRouter.post("/actions/broker", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const result = await brokerResourceAction(orgContext, req.body ?? {});
  res.json(result);
}));

resourceCatalogRouter.post("/intent/execute", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const result = await brokerResourceAction(orgContext, req.body ?? {});
  res.json(result);
}));

// --- Accelerator, Policy, Audit, and AgentOps Packs ---

resourceCatalogRouter.get("/accelerators/:key/manifest", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const manifest = await buildAcceleratorManifest(orgContext, req.params.key);
  res.json(manifest);
}));

resourceCatalogRouter.get("/policy-packs", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const rootKey = typeof req.query.key === "string" ? req.query.key : undefined;
  const manifest = await buildPolicyPackManifest(orgContext, rootKey);
  res.json(manifest);
}));

resourceCatalogRouter.get("/policy-packs/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const manifest = await buildPolicyPackManifest(orgContext, req.params.key);
  res.json(manifest);
}));

resourceCatalogRouter.get("/audit-packs/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const pack = await buildAuditExportPack(orgContext, req.params.key);
  res.json(pack);
}));

resourceCatalogRouter.get("/agentops/:key", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const scorecard = await buildAgentOpsScorecard(orgContext, req.params.key);
  res.json(scorecard);
}));

// --- Resource Health Dashboard ---

resourceCatalogRouter.get("/health", asyncHandler(async (req: Request, res: Response) => {
  const types = parseResourceTypes(req, res);
  if (res.headersSent) return;

  const orgContext = await getUserOrgContext(req);
  const dashboard = await getResourceHealthDashboard(orgContext, {
    types,
    limit: parseLimit(req.query.limit),
  });
  res.json(dashboard);
}));
