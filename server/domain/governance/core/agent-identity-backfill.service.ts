import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  agentDeployments,
  agentIdentities,
  agentPermissionGrants,
  appDeployments,
  apps,
  jobs,
  type AgentIdentity,
  type AgentPermissionGrant,
  type NewAgentIdentity,
  type NewAgentPermissionGrant,
} from "@shared/schema/index.js";

export type AgentIdentityBackfillSource = "job" | "agent_deployment" | "app_deployment";

export interface AgentIdentityBackfillCandidate {
  organizationId: number;
  agentId: string;
  displayName: string;
  ownerId: string;
  environment: string;
  status: "active" | "draft" | "suspended";
  riskLevel: "low" | "medium" | "high" | "critical";
  source: AgentIdentityBackfillSource;
  tools?: string[];
  permissions?: string[];
  metadata: Record<string, unknown>;
}

export interface AgentIdentityBackfillOptions {
  organizationId?: number;
  environment?: string;
  createdBy?: string;
  dryRun?: boolean;
  limit?: number;
}

export interface AgentIdentityBackfillSummary {
  dryRun: boolean;
  candidates: number;
  identitiesCreated: number;
  identitiesExisting: number;
  grantsCreated: number;
  grantsExisting: number;
  skipped: Array<{ agentId: string; reason: string }>;
}

export interface AgentIdentityBackfillRepository {
  listCandidates(options: AgentIdentityBackfillOptions): Promise<AgentIdentityBackfillCandidate[]>;
  findIdentity(params: {
    organizationId: number;
    agentId: string;
    environment: string;
  }): Promise<AgentIdentity | undefined>;
  createIdentity(identity: NewAgentIdentity): Promise<AgentIdentity>;
  listGrants(agentIdentityId: string, organizationId: number): Promise<AgentPermissionGrant[]>;
  createGrant(grant: NewAgentPermissionGrant): Promise<AgentPermissionGrant>;
}

class DrizzleAgentIdentityBackfillRepository implements AgentIdentityBackfillRepository {
  async listCandidates(options: AgentIdentityBackfillOptions): Promise<AgentIdentityBackfillCandidate[]> {
    const environment = options.environment ?? "prod";
    const candidates: AgentIdentityBackfillCandidate[] = [];
    const orgFilter = options.organizationId;

    const jobRows = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        type: jobs.type,
        organizationId: jobs.organizationId,
        createdBy: jobs.createdBy,
        isActive: jobs.isActive,
        lifecycleStatus: jobs.lifecycleStatus,
        dataClassification: jobs.dataClassification,
        config: jobs.config,
      })
      .from(jobs)
      .where(orgFilter ? eq(jobs.organizationId, orgFilter) : undefined);

    for (const job of jobRows) {
      const candidate = buildJobCandidate(job, environment);
      if (candidate) candidates.push(candidate);
    }

    const deploymentRows = await db
      .select({
        id: agentDeployments.id,
        jobId: agentDeployments.jobId,
        slug: agentDeployments.slug,
        title: agentDeployments.title,
        organizationId: agentDeployments.organizationId,
        createdBy: agentDeployments.createdBy,
        isActive: agentDeployments.isActive,
        accessPolicy: agentDeployments.accessPolicy,
        allowedTools: agentDeployments.allowedTools,
        orgRole: agentDeployments.orgRole,
      })
      .from(agentDeployments)
      .where(orgFilter ? eq(agentDeployments.organizationId, orgFilter) : undefined);

    for (const deployment of deploymentRows) {
      candidates.push(buildAgentDeploymentCandidate(deployment, environment));
    }

    const appRows = await db
      .select({
        id: appDeployments.id,
        appId: appDeployments.appId,
        appSlug: apps.slug,
        appName: apps.name,
        organizationId: appDeployments.organizationId,
        status: appDeployments.status,
        accessPolicy: appDeployments.accessPolicy,
        allowedTools: appDeployments.allowedTools,
        appTokenCapabilities: appDeployments.appTokenCapabilities,
        installedAt: appDeployments.installedAt,
      })
      .from(appDeployments)
      .innerJoin(apps, eq(appDeployments.appId, apps.id))
      .where(orgFilter ? eq(appDeployments.organizationId, orgFilter) : undefined);

    for (const appDeployment of appRows) {
      candidates.push(buildAppDeploymentCandidate(appDeployment, environment));
    }

    return options.limit ? candidates.slice(0, options.limit) : candidates;
  }

  async findIdentity(params: {
    organizationId: number;
    agentId: string;
    environment: string;
  }): Promise<AgentIdentity | undefined> {
    const [identity] = await db
      .select()
      .from(agentIdentities)
      .where(and(
        eq(agentIdentities.organizationId, params.organizationId),
        eq(agentIdentities.agentId, params.agentId),
        eq(agentIdentities.environment, params.environment),
      ))
      .limit(1);
    return identity;
  }

  async createIdentity(identity: NewAgentIdentity): Promise<AgentIdentity> {
    const [created] = await db.insert(agentIdentities).values(identity).returning();
    return created;
  }

  async listGrants(agentIdentityId: string, organizationId: number): Promise<AgentPermissionGrant[]> {
    return db
      .select()
      .from(agentPermissionGrants)
      .where(and(
        eq(agentPermissionGrants.agentIdentityId, agentIdentityId),
        eq(agentPermissionGrants.organizationId, organizationId),
      ));
  }

  async createGrant(grant: NewAgentPermissionGrant): Promise<AgentPermissionGrant> {
    const [created] = await db.insert(agentPermissionGrants).values(grant).returning();
    return created;
  }
}

export class AgentIdentityBackfillService {
  constructor(
    private readonly repository: AgentIdentityBackfillRepository = new DrizzleAgentIdentityBackfillRepository(),
  ) {}

  async backfill(options: AgentIdentityBackfillOptions = {}): Promise<AgentIdentityBackfillSummary> {
    const dryRun = options.dryRun ?? true;
    const createdBy = options.createdBy ?? "agent-identity-backfill";
    const candidates = await this.repository.listCandidates(options);
    const summary: AgentIdentityBackfillSummary = {
      dryRun,
      candidates: candidates.length,
      identitiesCreated: 0,
      identitiesExisting: 0,
      grantsCreated: 0,
      grantsExisting: 0,
      skipped: [],
    };

    for (const candidate of candidates) {
      if (!candidate.organizationId || !candidate.agentId) {
        summary.skipped.push({ agentId: candidate.agentId || "(missing)", reason: "missing organization or agent id" });
        continue;
      }

      let identity = await this.repository.findIdentity({
        organizationId: candidate.organizationId,
        agentId: candidate.agentId,
        environment: candidate.environment,
      });

      if (identity) {
        summary.identitiesExisting++;
      } else if (dryRun) {
        summary.identitiesCreated++;
        summary.grantsCreated += buildCandidatePermissionGrants("(dry-run)", candidate, createdBy).length;
        continue;
      } else {
        identity = await this.repository.createIdentity({
          organizationId: candidate.organizationId,
          agentId: candidate.agentId,
          displayName: candidate.displayName,
          ownerId: candidate.ownerId,
          environment: candidate.environment,
          status: candidate.status,
          riskLevel: candidate.riskLevel,
          metadata: {
            ...candidate.metadata,
            backfilledFrom: candidate.source,
          },
          createdBy,
        });
        summary.identitiesCreated++;
      }

      if (!identity) continue;

      const existingGrants = await this.repository.listGrants(identity.id, candidate.organizationId);
      for (const grant of buildCandidatePermissionGrants(identity.id, candidate, createdBy)) {
        if (grantExists(existingGrants, grant)) {
          summary.grantsExisting++;
          continue;
        }

        if (!dryRun) {
          await this.repository.createGrant(grant);
        }
        summary.grantsCreated++;
      }
    }

    return summary;
  }
}

export function buildDefaultPermissionGrants(
  agentIdentityId: string,
  organizationId: number,
  createdBy: string,
): NewAgentPermissionGrant[] {
  return [
    {
      organizationId,
      agentIdentityId,
      tool: "*",
      action: "read",
      resource: "*",
      effect: "allow",
      requiresApproval: false,
      conditions: {},
      createdBy,
    },
    {
      organizationId,
      agentIdentityId,
      tool: "*",
      action: "write",
      resource: "*",
      effect: "allow",
      requiresApproval: true,
      conditions: { reason: "Backfilled agents need approval for side-effecting writes." },
      createdBy,
    },
    {
      organizationId,
      agentIdentityId,
      tool: "*",
      action: "deploy",
      resource: "*",
      effect: "allow",
      requiresApproval: true,
      conditions: { reason: "Deployment changes require human approval." },
      createdBy,
    },
    {
      organizationId,
      agentIdentityId,
      tool: "*",
      action: "delete",
      resource: "*",
      effect: "deny",
      requiresApproval: false,
      conditions: { reason: "Backfill never grants destructive delete by default." },
      createdBy,
    },
  ];
}

export function buildManifestPermissionGrants(params: {
  agentIdentityId: string;
  organizationId: number;
  createdBy: string;
  tools?: string[];
  permissions?: string[];
}): NewAgentPermissionGrant[] {
  const grants: NewAgentPermissionGrant[] = [];
  const addGrant = (grant: NewAgentPermissionGrant) => {
    if (!grants.some((existing) => grantExistsForInsert(existing, grant))) {
      grants.push(grant);
    }
  };

  for (const tool of params.tools ?? []) {
    if (!tool) continue;
    const action = inferActionFromToolName(tool);
    addGrant({
      organizationId: params.organizationId,
      agentIdentityId: params.agentIdentityId,
      tool,
      action,
      resource: "*",
      effect: "allow",
      requiresApproval: action !== "read",
      conditions: { source: "blueprint_tool" },
      createdBy: params.createdBy,
    });
  }

  for (const permission of params.permissions ?? []) {
    const parsed = parsePermissionSpec(permission);
    if (!parsed) continue;
    addGrant({
      organizationId: params.organizationId,
      agentIdentityId: params.agentIdentityId,
      tool: parsed.tool,
      action: parsed.action,
      resource: parsed.resource,
      effect: "allow",
      requiresApproval: parsed.action !== "read",
      conditions: { source: "blueprint_permission", permission },
      createdBy: params.createdBy,
    });
  }

  addGrant({
    organizationId: params.organizationId,
    agentIdentityId: params.agentIdentityId,
    tool: "*",
    action: "delete",
    resource: "*",
    effect: "deny",
    requiresApproval: false,
    conditions: { reason: "Blueprint installs never grant destructive delete by default." },
    createdBy: params.createdBy,
  });

  return grants.length > 1
    ? grants
    : buildDefaultPermissionGrants(params.agentIdentityId, params.organizationId, params.createdBy);
}

export async function ensureAgentIdentityForBlueprintAgent(params: {
  organizationId: number;
  agentId: string;
  displayName: string;
  ownerId?: string;
  environment?: string;
  status?: "active" | "draft" | "suspended";
  riskLevel?: "low" | "medium" | "high" | "critical";
  tools?: string[];
  permissions?: string[];
  metadata?: Record<string, unknown>;
  createdBy?: string;
}): Promise<{ identity: AgentIdentity; grantsCreated: number; grantsExisting: number }> {
  const repository = new DrizzleAgentIdentityBackfillRepository();
  const environment = params.environment ?? "prod";
  const createdBy = params.createdBy ?? "system";
  let identity = await repository.findIdentity({
    organizationId: params.organizationId,
    agentId: params.agentId,
    environment,
  });

  if (!identity) {
    identity = await repository.createIdentity({
      organizationId: params.organizationId,
      agentId: params.agentId,
      displayName: params.displayName,
      ownerId: params.ownerId ?? createdBy,
      environment,
      status: params.status ?? "active",
      riskLevel: params.riskLevel ?? riskFromManifest(params.permissions, params.tools),
      metadata: params.metadata ?? {},
      createdBy,
    });
  }

  const existingGrants = await repository.listGrants(identity.id, params.organizationId);
  let grantsCreated = 0;
  let grantsExisting = 0;
  for (const grant of buildManifestPermissionGrants({
    agentIdentityId: identity.id,
    organizationId: params.organizationId,
    createdBy,
    tools: params.tools,
    permissions: params.permissions,
  })) {
    if (grantExists(existingGrants, grant)) {
      grantsExisting++;
      continue;
    }
    await repository.createGrant(grant);
    grantsCreated++;
  }

  return { identity, grantsCreated, grantsExisting };
}

function buildJobCandidate(
  job: {
    id: number;
    name: string;
    type: string;
    organizationId: number | null;
    createdBy: string;
    isActive: boolean | null;
    lifecycleStatus: string;
    dataClassification: string;
    config: unknown;
  },
  environment: string,
): AgentIdentityBackfillCandidate | undefined {
  if (!job.organizationId) return undefined;

  return {
    organizationId: job.organizationId,
    agentId: String(job.id),
    displayName: job.name,
    ownerId: job.createdBy,
    environment,
    status: job.isActive === false || job.lifecycleStatus === "archived" ? "suspended" : job.lifecycleStatus === "draft" ? "draft" : "active",
    riskLevel: riskFromDataClassification(job.dataClassification),
    source: "job",
    tools: Array.isArray((job.config as any)?.allowedTools) ? (job.config as any).allowedTools : [],
    permissions: Array.isArray((job.config as any)?.permissions) ? (job.config as any).permissions : [],
    metadata: {
      principalType: "job",
      jobId: job.id,
      jobType: job.type,
      allowedTools: Array.isArray((job.config as any)?.allowedTools) ? (job.config as any).allowedTools : [],
      permissions: Array.isArray((job.config as any)?.permissions) ? (job.config as any).permissions : [],
      lifecycleStatus: job.lifecycleStatus,
      dataClassification: job.dataClassification,
    },
  };
}

function buildAgentDeploymentCandidate(
  deployment: {
    id: number;
    jobId: number;
    slug: string;
    title: string;
    organizationId: number;
    createdBy: string;
    isActive: boolean | null;
    accessPolicy: string | null;
    allowedTools: string[] | null;
    orgRole: string | null;
  },
  environment: string,
): AgentIdentityBackfillCandidate {
  return {
    organizationId: deployment.organizationId,
    agentId: String(deployment.jobId),
    displayName: deployment.title,
    ownerId: deployment.createdBy,
    environment,
    status: deployment.isActive === false ? "suspended" : "active",
    riskLevel: deployment.accessPolicy === "public" ? "high" : "medium",
    source: "agent_deployment",
    tools: deployment.allowedTools ?? [],
    permissions: [],
    metadata: {
      principalType: "agent_deployment",
      deploymentId: deployment.id,
      jobId: deployment.jobId,
      slug: deployment.slug,
      accessPolicy: deployment.accessPolicy,
      allowedTools: deployment.allowedTools ?? [],
      orgRole: deployment.orgRole,
    },
  };
}

function buildAppDeploymentCandidate(
  deployment: {
    id: number;
    appId: number;
    appSlug: string;
    appName: string;
    organizationId: number;
    status: string;
    accessPolicy: string | null;
    allowedTools: string[] | null;
    appTokenCapabilities: string[] | null;
    installedAt: Date;
  },
  environment: string,
): AgentIdentityBackfillCandidate {
  return {
    organizationId: deployment.organizationId,
    agentId: `app:${deployment.id}`,
    displayName: deployment.appName,
    ownerId: "system",
    environment,
    status: deployment.status === "suspended" || deployment.status === "failed" ? "suspended" : "active",
    riskLevel: deployment.accessPolicy === "public" ? "high" : "medium",
    source: "app_deployment",
    tools: deployment.allowedTools ?? [],
    permissions: deployment.appTokenCapabilities ?? [],
    metadata: {
      principalType: "app_deployment",
      deploymentId: deployment.id,
      appId: deployment.appId,
      appSlug: deployment.appSlug,
      accessPolicy: deployment.accessPolicy,
      allowedTools: deployment.allowedTools ?? [],
      appTokenCapabilities: deployment.appTokenCapabilities ?? [],
      installedAt: deployment.installedAt,
    },
  };
}

function buildCandidatePermissionGrants(
  agentIdentityId: string,
  candidate: AgentIdentityBackfillCandidate,
  createdBy: string,
): NewAgentPermissionGrant[] {
  if (candidate.tools?.length || candidate.permissions?.length) {
    return buildManifestPermissionGrants({
      agentIdentityId,
      organizationId: candidate.organizationId,
      createdBy,
      tools: candidate.tools,
      permissions: candidate.permissions,
    });
  }

  return buildDefaultPermissionGrants(agentIdentityId, candidate.organizationId, createdBy);
}

function parsePermissionSpec(permission: string): { tool: string; action: string; resource: string } | undefined {
  if (!permission || typeof permission !== "string") return undefined;
  const parts = permission.split(":").filter(Boolean);
  if (parts.length === 1) {
    return { tool: parts[0], action: "execute", resource: "*" };
  }
  return {
    tool: parts[0],
    action: parts[1],
    resource: parts.slice(2).join(":") || "*",
  };
}

function inferActionFromToolName(tool: string): string {
  const normalized = tool.toLowerCase();
  if (/(^|_)(read|get|list|search|query|inspect|analyze|status|fetch|view|download)(_|$)/.test(normalized)) return "read";
  if (/(^|_)(deploy|publish|release|promote|rollback)(_|$)/.test(normalized)) return "deploy";
  if (/(^|_)(delete|remove|drop|destroy|revoke)(_|$)/.test(normalized)) return "delete";
  if (/(^|_)(write|create|update|patch|post|send|commit|push|merge|open|run|trigger|execute)(_|$)/.test(normalized)) return "write";
  return "read";
}

function riskFromManifest(permissions?: string[], tools?: string[]): "low" | "medium" | "high" | "critical" {
  const joined = [...(permissions ?? []), ...(tools ?? [])].join(" ").toLowerCase();
  if (/(delete|destroy|drop|revoke|prod|production|credential|secret)/.test(joined)) return "critical";
  if (/(deploy|publish|release|merge|push|write|send|post|jira|slack|github|aws)/.test(joined)) return "high";
  if (joined.trim()) return "medium";
  return "low";
}

function grantExistsForInsert(a: NewAgentPermissionGrant, b: NewAgentPermissionGrant): boolean {
  return a.tool === b.tool
    && a.action === b.action
    && a.resource === b.resource
    && a.effect === b.effect
    && a.requiresApproval === b.requiresApproval;
}

function riskFromDataClassification(classification: string): "low" | "medium" | "high" | "critical" {
  switch (classification) {
    case "restricted":
      return "critical";
    case "sensitive":
      return "high";
    case "internal":
      return "medium";
    default:
      return "low";
  }
}

function grantExists(existing: AgentPermissionGrant[], grant: NewAgentPermissionGrant): boolean {
  return existing.some((row) =>
    row.tool === grant.tool
    && row.action === grant.action
    && row.resource === grant.resource
    && row.effect === grant.effect
    && row.requiresApproval === grant.requiresApproval
  );
}
