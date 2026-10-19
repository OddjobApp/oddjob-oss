import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  KnowledgePackManifestSchema,
  knowledgePackAttestations,
  knowledgePackChangeCandidates,
  knowledgePackSourceLinks,
  knowledgePackSourceObservations,
  knowledgePackSources,
  knowledgePacks,
  type KnowledgePackManifest,
} from "@shared/schema/knowledge-packs.js";
import { knowledgePackService } from "./knowledge-pack.service.js";

export const snapshotHash = (content: string) => `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
export const hasSourceChanged = (baselineHash: string, content: string) => baselineHash !== snapshotHash(content);
export const isSourceStale = (staleAt: Date | null, now = new Date()) => !staleAt || staleAt.getTime() <= now.getTime();

export function assertReleaseTransition(status: string, target: "validated" | "published") {
  const allowed = status === "draft" && target === "validated" || status === "validated" && target === "published";
  if (!allowed) throw new Error(`Invalid knowledge pack transition: ${status} -> ${target}`);
}

export class KnowledgePackLifecycleService {
  async list(organizationId: number) {
    const sources = await db.select().from(knowledgePackSources).where(eq(knowledgePackSources.organizationId, organizationId)).orderBy(desc(knowledgePackSources.createdAt));
    const sourceIds = sources.map(source => source.id);
    const links = sourceIds.length ? await db.select().from(knowledgePackSourceLinks).where(inArray(knowledgePackSourceLinks.sourceId, sourceIds)) : [];
    const packIds = [...new Set(links.map(link => link.knowledgePackId))];
    const releases = packIds.length ? await db.select().from(knowledgePacks).where(inArray(knowledgePacks.id, packIds)).orderBy(desc(knowledgePacks.createdAt)) : [];
    const attestations = packIds.length ? await db.select().from(knowledgePackAttestations).where(and(eq(knowledgePackAttestations.organizationId, organizationId), inArray(knowledgePackAttestations.knowledgePackId, packIds))) : [];
    const candidates = await db.select().from(knowledgePackChangeCandidates).where(eq(knowledgePackChangeCandidates.organizationId, organizationId)).orderBy(desc(knowledgePackChangeCandidates.createdAt));
    const observations = sourceIds.length ? await db.select().from(knowledgePackSourceObservations).where(inArray(knowledgePackSourceObservations.sourceId, sourceIds)).orderBy(desc(knowledgePackSourceObservations.checkedAt)) : [];
    return { sources, releases, links, attestations, candidates, observations };
  }

  async acquireSource(organizationId: number, actorId: string, input: { packKey: string; title: string; sourceUri: string; authority: string; jurisdiction: string; effectiveDate?: string; contentSnapshot: string; freshnessDays?: number }) {
    const freshnessDays = input.freshnessDays ?? 90;
    const now = new Date();
    const [source] = await db.insert(knowledgePackSources).values({
      organizationId,
      packKey: input.packKey,
      title: input.title,
      sourceUri: input.sourceUri,
      authority: input.authority,
      jurisdiction: input.jurisdiction,
      effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null,
      contentHash: snapshotHash(input.contentSnapshot),
      contentSnapshot: input.contentSnapshot,
      acquiredBy: actorId,
      freshnessDays,
      nextCheckAt: now,
      staleAt: new Date(now.getTime() + freshnessDays * 86_400_000),
    }).returning();
    return source;
  }

  async verifySource(organizationId: number, sourceId: number, actorId: string) {
    const [source] = await db.select().from(knowledgePackSources).where(and(eq(knowledgePackSources.id, sourceId), eq(knowledgePackSources.organizationId, organizationId))).limit(1);
    if (!source) throw new Error("Knowledge pack source not found");
    if (source.acquiredBy === actorId) throw new Error("Source verifier must be independent from the acquiring agent");
    if (snapshotHash(source.contentSnapshot) !== source.contentHash) throw new Error("Source snapshot integrity check failed");
    const now = new Date();
    const [verified] = await db.update(knowledgePackSources).set({ status: "verified", verifiedBy: actorId, verifiedAt: now, lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + Math.max(1, Math.floor(source.freshnessDays / 2)) * 86_400_000), staleAt: new Date(now.getTime() + source.freshnessDays * 86_400_000) }).where(eq(knowledgePackSources.id, source.id)).returning();
    return verified;
  }

  async recheckSource(organizationId: number, sourceId: number, actorId: string, input: { contentSnapshot: string; effectiveDate?: string }) {
    const [source] = await db.select().from(knowledgePackSources).where(and(eq(knowledgePackSources.id, sourceId), eq(knowledgePackSources.organizationId, organizationId))).limit(1);
    if (!source) throw new Error("Knowledge pack source not found");
    const now = new Date();
    const observedHash = snapshotHash(input.contentSnapshot);
    const changed = hasSourceChanged(source.contentHash, input.contentSnapshot);
    const [observation] = await db.insert(knowledgePackSourceObservations).values({ sourceId, observedHash, contentSnapshot: input.contentSnapshot, effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null, changed, checkedBy: actorId, checkedAt: now }).returning();
    await db.update(knowledgePackSources).set({ lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + Math.max(1, Math.floor(source.freshnessDays / 2)) * 86_400_000), staleAt: new Date(now.getTime() + source.freshnessDays * 86_400_000) }).where(eq(knowledgePackSources.id, sourceId));
    let candidate = null;
    if (changed) [candidate] = await db.insert(knowledgePackChangeCandidates).values({ organizationId, sourceId, observationId: observation.id, previousHash: source.contentHash, observedHash }).returning();
    return { observation, candidate };
  }

  async reviewCandidate(organizationId: number, candidateId: number, actorId: string, decision: "accepted" | "dismissed") {
    const [candidate] = await db.select().from(knowledgePackChangeCandidates).where(and(eq(knowledgePackChangeCandidates.id, candidateId), eq(knowledgePackChangeCandidates.organizationId, organizationId))).limit(1);
    if (!candidate || candidate.status !== "open") throw new Error("Open knowledge pack change candidate not found");
    const [source] = await db.select().from(knowledgePackSources).where(eq(knowledgePackSources.id, candidate.sourceId)).limit(1);
    const [observation] = await db.select().from(knowledgePackSourceObservations).where(eq(knowledgePackSourceObservations.id, candidate.observationId)).limit(1);
    if (!source || !observation) throw new Error("Change candidate evidence is incomplete");
    let replacement = null;
    if (decision === "accepted") replacement = await this.acquireSource(organizationId, actorId, { packKey: source.packKey, title: `${source.title} — observed change`, sourceUri: source.sourceUri, authority: source.authority, jurisdiction: source.jurisdiction, effectiveDate: observation.effectiveDate?.toISOString(), contentSnapshot: observation.contentSnapshot, freshnessDays: source.freshnessDays });
    const [reviewed] = await db.update(knowledgePackChangeCandidates).set({ status: decision, reviewedBy: actorId, reviewedAt: new Date() }).where(eq(knowledgePackChangeCandidates.id, candidate.id)).returning();
    return { candidate: reviewed, replacement };
  }

  async createDraft(organizationId: number, manifestInput: unknown, sourceIds: number[]) {
    const manifest: KnowledgePackManifest = KnowledgePackManifestSchema.parse(manifestInput);
    const [existing] = await db.select({ id: knowledgePacks.id }).from(knowledgePacks).where(and(eq(knowledgePacks.packKey, manifest.metadata.id), eq(knowledgePacks.version, manifest.metadata.version))).limit(1);
    if (existing) throw new Error(`Knowledge pack release already exists: ${manifest.metadata.id}@${manifest.metadata.version}`);
    if (!sourceIds.length) throw new Error("A release must cite at least one acquired source");
    const sources = await db.select().from(knowledgePackSources).where(and(eq(knowledgePackSources.organizationId, organizationId), inArray(knowledgePackSources.id, sourceIds)));
    if (sources.length !== new Set(sourceIds).size) throw new Error("One or more release sources are outside this organization");
    if (sources.some(source => source.packKey !== manifest.metadata.id)) throw new Error("All sources must belong to the release pack key");
    const pack = await knowledgePackService.publish(manifest);
    await db.update(knowledgePacks).set({ status: "draft" }).where(eq(knowledgePacks.id, pack.id));
    await db.insert(knowledgePackSourceLinks).values(sourceIds.map(sourceId => ({ knowledgePackId: pack.id, sourceId }))).onConflictDoNothing();
    return { ...pack, status: "draft" };
  }

  async attest(organizationId: number, knowledgePackId: number, actorId: string, input: { type: "legal" | "compliance"; decision: "approved" | "rejected"; notes?: string }) {
    const [pack] = await db.select().from(knowledgePacks).where(eq(knowledgePacks.id, knowledgePackId)).limit(1);
    if (!pack) throw new Error("Knowledge pack release not found");
    const [row] = await db.insert(knowledgePackAttestations).values({ organizationId, knowledgePackId, attestationType: input.type, decision: input.decision, attestedBy: actorId, notes: input.notes })
      .onConflictDoUpdate({ target: [knowledgePackAttestations.organizationId, knowledgePackAttestations.knowledgePackId, knowledgePackAttestations.attestationType, knowledgePackAttestations.attestedBy], set: { decision: input.decision, notes: input.notes, createdAt: new Date() } }).returning();
    return row;
  }

  async promote(organizationId: number, knowledgePackId: number, target: "validated" | "published") {
    const lifecycle = await this.list(organizationId);
    const pack = lifecycle.releases.find(release => release.id === knowledgePackId);
    if (!pack) throw new Error("Knowledge pack release is not linked to this organization");
    assertReleaseTransition(pack.status, target);
    const sourceIds = lifecycle.links.filter(link => link.knowledgePackId === knowledgePackId).map(link => link.sourceId);
    const sources = lifecycle.sources.filter(source => sourceIds.includes(source.id));
    if (!sources.length || sources.some(source => source.status !== "verified")) throw new Error("Every cited source must be independently verified");
    const approvals = lifecycle.attestations.filter(item => item.knowledgePackId === knowledgePackId && item.decision === "approved");
    const legal = approvals.find(item => item.attestationType === "legal");
    const compliance = approvals.find(item => item.attestationType === "compliance");
    if (!legal || !compliance) throw new Error("Legal and compliance approval attestations are required");
    if (legal.attestedBy === compliance.attestedBy) throw new Error("Legal and compliance attestations require independent actors");
    const [updated] = await db.update(knowledgePacks).set({ status: target }).where(eq(knowledgePacks.id, knowledgePackId)).returning();
    return updated;
  }
}

export const knowledgePackLifecycleService = new KnowledgePackLifecycleService();
