import { describe, expect, it } from "vitest";
import {
  AgentIdentityBackfillService,
  buildDefaultPermissionGrants,
  buildManifestPermissionGrants,
  type AgentIdentityBackfillCandidate,
  type AgentIdentityBackfillRepository,
} from "./agent-identity-backfill.service.js";
import type {
  AgentIdentity,
  AgentPermissionGrant,
  NewAgentIdentity,
  NewAgentPermissionGrant,
} from "@shared/schema/index.js";

const candidate: AgentIdentityBackfillCandidate = {
  organizationId: 7,
  agentId: "42",
  displayName: "Codegen Agent",
  ownerId: "user-1",
  environment: "prod",
  status: "active",
  riskLevel: "medium",
  source: "job",
  metadata: { principalType: "job", jobId: 42 },
};

describe("AgentIdentityBackfillService", () => {
  it("previews identity and default grants in dry-run mode without writing", async () => {
    const repo = new FakeBackfillRepository([candidate]);
    const summary = await new AgentIdentityBackfillService(repo).backfill({ dryRun: true });

    expect(summary.identitiesCreated).toBe(1);
    expect(summary.grantsCreated).toBe(4);
    expect(repo.createdIdentities).toHaveLength(0);
    expect(repo.createdGrants).toHaveLength(0);
  });

  it("creates identities and conservative default grants", async () => {
    const repo = new FakeBackfillRepository([candidate]);
    const summary = await new AgentIdentityBackfillService(repo).backfill({ dryRun: false, createdBy: "test" });

    expect(summary.identitiesCreated).toBe(1);
    expect(summary.grantsCreated).toBe(4);
    expect(repo.createdIdentities[0]).toMatchObject({
      organizationId: 7,
      agentId: "42",
      displayName: "Codegen Agent",
      status: "active",
      riskLevel: "medium",
      createdBy: "test",
    });
    expect(repo.createdGrants.map((grant) => [grant.action, grant.effect, grant.requiresApproval])).toEqual([
      ["read", "allow", false],
      ["write", "allow", true],
      ["deploy", "allow", true],
      ["delete", "deny", false],
    ]);
  });

  it("is idempotent when identity and grants already exist", async () => {
    const repo = new FakeBackfillRepository([candidate]);
    await new AgentIdentityBackfillService(repo).backfill({ dryRun: false, createdBy: "test" });
    const summary = await new AgentIdentityBackfillService(repo).backfill({ dryRun: false, createdBy: "test" });

    expect(summary.identitiesExisting).toBe(1);
    expect(summary.identitiesCreated).toBe(0);
    expect(summary.grantsExisting).toBe(4);
    expect(summary.grantsCreated).toBe(0);
  });

  it("builds write and deploy grants as approval-gated and delete as denied", () => {
    const grants = buildDefaultPermissionGrants("identity-1", 7, "test");

    expect(grants).toContainEqual(expect.objectContaining({ action: "write", effect: "allow", requiresApproval: true }));
    expect(grants).toContainEqual(expect.objectContaining({ action: "deploy", effect: "allow", requiresApproval: true }));
    expect(grants).toContainEqual(expect.objectContaining({ action: "delete", effect: "deny", requiresApproval: false }));
  });

  it("converts blueprint tools and domain permissions into runtime grants", () => {
    const grants = buildManifestPermissionGrants({
      agentIdentityId: "identity-1",
      organizationId: 7,
      createdBy: "test",
      tools: ["read_file", "mcp_git_create_pr", "mcp_git_push"],
      permissions: ["github:write:pr", "slack:read"],
    });

    expect(grants).toContainEqual(expect.objectContaining({
      tool: "read_file",
      action: "read",
      requiresApproval: false,
    }));
    expect(grants).toContainEqual(expect.objectContaining({
      tool: "mcp_git_create_pr",
      action: "write",
      requiresApproval: true,
    }));
    expect(grants).toContainEqual(expect.objectContaining({
      tool: "github",
      action: "write",
      resource: "pr",
      requiresApproval: true,
    }));
    expect(grants).toContainEqual(expect.objectContaining({
      tool: "slack",
      action: "read",
      resource: "*",
      requiresApproval: false,
    }));
    expect(grants).toContainEqual(expect.objectContaining({
      tool: "*",
      action: "delete",
      effect: "deny",
    }));
  });
});

class FakeBackfillRepository implements AgentIdentityBackfillRepository {
  createdIdentities: NewAgentIdentity[] = [];
  createdGrants: NewAgentPermissionGrant[] = [];
  private readonly identities = new Map<string, AgentIdentity>();
  private readonly grants = new Map<string, AgentPermissionGrant[]>();

  constructor(private readonly candidates: AgentIdentityBackfillCandidate[]) {}

  async listCandidates(): Promise<AgentIdentityBackfillCandidate[]> {
    return this.candidates;
  }

  async findIdentity(params: {
    organizationId: number;
    agentId: string;
    environment: string;
  }): Promise<AgentIdentity | undefined> {
    return this.identities.get(identityKey(params));
  }

  async createIdentity(identity: NewAgentIdentity): Promise<AgentIdentity> {
    this.createdIdentities.push(identity);
    const created = {
      id: `identity-${this.createdIdentities.length}`,
      policyBundleId: null,
      lastReviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...identity,
    } as AgentIdentity;
    this.identities.set(identityKey(created), created);
    return created;
  }

  async listGrants(agentIdentityId: string): Promise<AgentPermissionGrant[]> {
    return this.grants.get(agentIdentityId) ?? [];
  }

  async createGrant(grant: NewAgentPermissionGrant): Promise<AgentPermissionGrant> {
    this.createdGrants.push(grant);
    const created = {
      id: `grant-${this.createdGrants.length}`,
      expiresAt: null,
      createdAt: new Date(),
      ...grant,
    } as AgentPermissionGrant;
    const existing = this.grants.get(grant.agentIdentityId) ?? [];
    existing.push(created);
    this.grants.set(grant.agentIdentityId, existing);
    return created;
  }
}

function identityKey(params: { organizationId: number; agentId: string; environment: string }) {
  return `${params.organizationId}:${params.agentId}:${params.environment}`;
}
