import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  BlueprintGovernanceDependencySchema,
  KnowledgePackManifestSchema,
  governanceDecisionEvidence,
  knowledgePackChangeCandidates,
  knowledgePackSourceLinks,
  knowledgePackSources,
  knowledgePacks,
  orgKnowledgePackInstallations,
  type KnowledgePackManifest,
} from "@shared/schema/knowledge-packs.js";
import { evaluateKnowledgePack, versionSatisfies } from "./knowledge-pack-policy.js";

export class KnowledgePackService {
  async publish(manifestInput: unknown) {
    const manifest = KnowledgePackManifestSchema.parse(manifestInput);
    const [row] = await db.insert(knowledgePacks).values({
      packKey: manifest.metadata.id,
      version: manifest.metadata.version,
      name: manifest.metadata.name,
      publisher: manifest.metadata.publisher,
      contentHash: manifest.metadata.contentHash,
      synthetic: manifest.metadata.synthetic,
      manifest,
    }).onConflictDoUpdate({
      target: [knowledgePacks.packKey, knowledgePacks.version],
      set: { name: manifest.metadata.name, publisher: manifest.metadata.publisher, contentHash: manifest.metadata.contentHash, synthetic: manifest.metadata.synthetic, manifest },
    }).returning();
    return row;
  }

  async listForOrganization(organizationId: number) {
    return db.select({ installation: orgKnowledgePackInstallations, pack: knowledgePacks })
      .from(orgKnowledgePackInstallations)
      .innerJoin(knowledgePacks, eq(orgKnowledgePackInstallations.knowledgePackId, knowledgePacks.id))
      .where(eq(orgKnowledgePackInstallations.organizationId, organizationId));
  }

  async install(organizationId: number, packKey: string, version: string, applicabilityProfile: Record<string, unknown>) {
    const [pack] = await db.select().from(knowledgePacks).where(and(eq(knowledgePacks.packKey, packKey), eq(knowledgePacks.version, version))).limit(1);
    if (!pack) throw new Error(`Knowledge pack not found: ${packKey}@${version}`);
    if (pack.status !== "published") throw new Error(`Knowledge pack release is not published: ${packKey}@${version}`);
    const manifest = KnowledgePackManifestSchema.parse(pack.manifest);
    const missing = manifest.requiredProfileFields.filter(field => applicabilityProfile[field] === undefined || applicabilityProfile[field] === "");
    if (missing.length) throw new Error(`Missing organization applicability profile fields: ${missing.join(", ")}`);
    const compiledPolicy = { packKey, version, contentHash: pack.contentHash, controls: manifest.controls, compiledAt: new Date().toISOString() };
    const [installation] = await db.insert(orgKnowledgePackInstallations).values({
      organizationId, knowledgePackId: pack.id, status: "staged", applicabilityProfile, compiledPolicy,
    }).onConflictDoUpdate({
      target: [orgKnowledgePackInstallations.organizationId, orgKnowledgePackInstallations.knowledgePackId],
      set: { status: "staged", applicabilityProfile, compiledPolicy, updatedAt: new Date(), certifiedAt: null, certifiedBy: null, activatedAt: null },
    }).returning();
    return installation;
  }

  async certifyAndActivate(organizationId: number, installationId: number, certification: { complianceApproved: boolean; evaluationPassRate: number; certifiedBy: string }) {
    const [record] = await db.select({ installation: orgKnowledgePackInstallations, pack: knowledgePacks })
      .from(orgKnowledgePackInstallations)
      .innerJoin(knowledgePacks, eq(orgKnowledgePackInstallations.knowledgePackId, knowledgePacks.id))
      .where(and(eq(orgKnowledgePackInstallations.id, installationId), eq(orgKnowledgePackInstallations.organizationId, organizationId))).limit(1);
    if (!record) throw new Error("Knowledge pack installation not found");
    const manifest = KnowledgePackManifestSchema.parse(record.pack.manifest);
    if (manifest.certification.requiresComplianceApproval && !certification.complianceApproved) throw new Error("Compliance approval is required");
    if (certification.evaluationPassRate < manifest.certification.minimumPassRate) throw new Error(`Certification pass rate must be at least ${manifest.certification.minimumPassRate}`);
    const now = new Date();
    const installed = await this.listForOrganization(organizationId);
    const supersededIds = installed.filter(item => item.pack.packKey === record.pack.packKey && item.installation.id !== installationId && item.installation.status === "active").map(item => item.installation.id);
    if (supersededIds.length) await db.update(orgKnowledgePackInstallations).set({ status: "superseded", updatedAt: now }).where(inArray(orgKnowledgePackInstallations.id, supersededIds));
    const [active] = await db.update(orgKnowledgePackInstallations).set({ status: "active", certifiedBy: certification.certifiedBy, certifiedAt: now, activatedAt: now, updatedAt: now })
      .where(and(eq(orgKnowledgePackInstallations.id, installationId), eq(orgKnowledgePackInstallations.organizationId, organizationId))).returning();
    return active;
  }

  async evaluateAction(organizationId: number, actionType: string, context: Record<string, unknown>, actorId?: string) {
    const active = await db.select({ installation: orgKnowledgePackInstallations, pack: knowledgePacks })
      .from(orgKnowledgePackInstallations)
      .innerJoin(knowledgePacks, eq(orgKnowledgePackInstallations.knowledgePackId, knowledgePacks.id))
      .where(and(eq(orgKnowledgePackInstallations.organizationId, organizationId), eq(orgKnowledgePackInstallations.status, "active")));
    if (!active.length) return { decision: "INSUFFICIENT_CONTEXT" as const, applicableControls: [], missingContext: ["activeKnowledgePack"], reasons: ["No active organization knowledge pack governs this action."], safeNextActions: ["Install, certify, and activate a compatible knowledge pack."], contextHash: "" };
    const activePackIds = active.map(item => item.pack.id);
    const sourceLinks = await db.select().from(knowledgePackSourceLinks).where(inArray(knowledgePackSourceLinks.knowledgePackId, activePackIds));
    const sourceIds = sourceLinks.map(link => link.sourceId);
    if (sourceIds.length) {
      const sources = await db.select().from(knowledgePackSources).where(inArray(knowledgePackSources.id, sourceIds));
      const openChanges = await db.select().from(knowledgePackChangeCandidates).where(and(eq(knowledgePackChangeCandidates.organizationId, organizationId), eq(knowledgePackChangeCandidates.status, "open"), inArray(knowledgePackChangeCandidates.sourceId, sourceIds)));
      const stale = sources.filter(source => !source.staleAt || source.staleAt.getTime() <= Date.now());
      if (stale.length || openChanges.length) {
        const reasons = [...stale.map(source => `Regulatory source is stale: ${source.title}`), ...openChanges.map(change => `Regulatory source change awaits review (candidate ${change.id})`)];
        const contextHash = `sha256:${createHash("sha256").update(JSON.stringify({ actionType, sourceIds, reasons })).digest("hex")}`;
        await db.insert(governanceDecisionEvidence).values({ organizationId, actionType, contextHash, decision: "BLOCK", applicableControls: ["KNOWLEDGE_PACK_FRESHNESS"], actorId, evidence: { reasons, sourceIds, openCandidateIds: openChanges.map(change => change.id) } });
        return { decision: "BLOCK" as const, applicableControls: ["KNOWLEDGE_PACK_FRESHNESS"], missingContext: [], reasons, safeNextActions: ["Recheck stale sources and resolve open change candidates before retrying."], contextHash };
      }
    }
    const results = active.map(record => ({ record, result: evaluateKnowledgePack(KnowledgePackManifestSchema.parse(record.pack.manifest), actionType, context) }));
    const rank = { BLOCK: 4, INSUFFICIENT_CONTEXT: 3, APPROVAL_REQUIRED: 2, ALLOW: 1 } as const;
    const selected = results.map(item => item.result).sort((a, b) => rank[b.decision] - rank[a.decision])[0];
    await Promise.all(results.map(({ record, result }) => db.insert(governanceDecisionEvidence).values({
      organizationId, installationId: record.installation.id, actionType, contextHash: result.contextHash, decision: result.decision,
      applicableControls: result.applicableControls, actorId, evidence: { pack: `${record.pack.packKey}@${record.pack.version}`, contentHash: record.pack.contentHash, missingContext: result.missingContext, reasons: result.reasons },
    })));
    return { ...selected, applicableControls: [...new Set(results.flatMap(item => item.result.applicableControls))] };
  }

  async getApplicableGovernance(organizationId: number, actionType: string) {
    const active = await this.listForOrganization(organizationId);
    return active.filter(item => item.installation.status === "active").map(item => {
      const manifest = KnowledgePackManifestSchema.parse(item.pack.manifest);
      return {
        pack: `${item.pack.packKey}@${item.pack.version}`,
        contentHash: item.pack.contentHash,
        synthetic: item.pack.synthetic,
        controls: manifest.controls.filter(control => control.actionTypes.includes(actionType)),
      };
    }).filter(item => item.controls.length > 0);
  }

  async checkBlueprintDependencies(organizationId: number, manifest: Record<string, unknown>) {
    const raw = Array.isArray(manifest.governance_dependencies) ? manifest.governance_dependencies : [];
    const dependencies = raw.map(value => BlueprintGovernanceDependencySchema.parse(value));
    const installed = await this.listForOrganization(organizationId);
    const issues = dependencies.flatMap(dependency => {
      const match = installed.find(item => item.pack.packKey === dependency.pack && item.installation.status === "active" && versionSatisfies(item.pack.version, dependency.version));
      if (match || !dependency.required) return [];
      return [`Required governance pack ${dependency.pack} (${dependency.version}) is not active for this organization.`];
    });
    return { activatable: issues.length === 0, dependencies, issues };
  }

  async listDecisions(organizationId: number, limit: number = 100) {
    return db.select().from(governanceDecisionEvidence).where(eq(governanceDecisionEvidence.organizationId, organizationId)).orderBy(desc(governanceDecisionEvidence.createdAt)).limit(limit);
  }

  async getPackById(id: number) {
    const [pack] = await db.select().from(knowledgePacks).where(eq(knowledgePacks.id, id)).limit(1);
    return pack ?? null;
  }
}

export const knowledgePackService = new KnowledgePackService();
