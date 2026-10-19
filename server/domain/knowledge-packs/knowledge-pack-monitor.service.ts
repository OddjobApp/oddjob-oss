import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { alerts } from "@shared/schema/alerts.js";
import {
  knowledgePackChangeCandidates,
  knowledgePackMonitorRuns,
  knowledgePackSourceMonitors,
  knowledgePackSources,
} from "@shared/schema/knowledge-packs.js";
import { knowledgePackLifecycleService } from "./knowledge-pack-lifecycle.service.js";

const MAX_SOURCE_BYTES = 2_000_000;
type SourceFetcher = (url: string, init: RequestInit) => Promise<Response>;

export function assertTrustedSourceUrl(sourceUri: string, trustedHosts: string[]) {
  const url = new URL(sourceUri);
  const normalizedHosts = trustedHosts.map(host => host.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:") throw new Error("Automated regulatory retrieval requires HTTPS");
  if (!normalizedHosts.includes(url.hostname.toLowerCase())) throw new Error(`Source host is not allowlisted: ${url.hostname}`);
  if (url.username || url.password) throw new Error("Source URLs must not contain credentials");
  return url;
}

export async function retrieveTrustedSource(sourceUri: string, trustedHosts: string[], fetcher: SourceFetcher = fetch) {
  const url = assertTrustedSourceUrl(sourceUri, trustedHosts);
  const response = await fetcher(url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/plain, text/html, application/json, application/xml;q=0.9" } });
  if (response.status >= 300 && response.status < 400) throw new Error("Source redirects are rejected; approve the new final host explicitly");
  if (!response.ok) throw new Error(`Source retrieval failed (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error("Source exceeds the 2 MB retrieval limit");
  const contentType = response.headers.get("content-type")?.toLowerCase() || "text/plain";
  if (!/text|json|xml/.test(contentType)) throw new Error(`Unsupported regulatory source content type: ${contentType}`);
  const content = await response.text();
  if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_BYTES) throw new Error("Source exceeds the 2 MB retrieval limit");
  if (!content.trim()) throw new Error("Retrieved regulatory source is empty");
  return content;
}

export class KnowledgePackMonitorService {
  async list(organizationId: number) {
    const monitors = await db.select().from(knowledgePackSourceMonitors).where(eq(knowledgePackSourceMonitors.organizationId, organizationId)).orderBy(asc(knowledgePackSourceMonitors.nextRunAt));
    const monitorIds = monitors.map(item => item.id);
    const runs = monitorIds.length ? await db.select().from(knowledgePackMonitorRuns).where(inArray(knowledgePackMonitorRuns.monitorId, monitorIds)).orderBy(desc(knowledgePackMonitorRuns.startedAt)).limit(100) : [];
    return { monitors, runs };
  }

  async configure(organizationId: number, sourceId: number, input: { enabled: boolean; checkIntervalHours: number; trustedHosts: string[]; ownerUserId: string; escalationHours: number }) {
    const [source] = await db.select().from(knowledgePackSources).where(and(eq(knowledgePackSources.id, sourceId), eq(knowledgePackSources.organizationId, organizationId))).limit(1);
    if (!source) throw new Error("Knowledge pack source not found");
    assertTrustedSourceUrl(source.sourceUri, input.trustedHosts);
    const [monitor] = await db.insert(knowledgePackSourceMonitors).values({ organizationId, sourceId, ...input, nextRunAt: new Date() }).onConflictDoUpdate({
      target: [knowledgePackSourceMonitors.organizationId, knowledgePackSourceMonitors.sourceId],
      set: { ...input, nextRunAt: new Date(), updatedAt: new Date(), lastError: null },
    }).returning();
    return monitor;
  }

  async runMonitor(monitorId: number, fetcher: SourceFetcher = fetch) {
    const [monitor] = await db.select().from(knowledgePackSourceMonitors).where(eq(knowledgePackSourceMonitors.id, monitorId)).limit(1);
    if (!monitor || !monitor.enabled) throw new Error("Enabled knowledge pack monitor not found");
    const [source] = await db.select().from(knowledgePackSources).where(eq(knowledgePackSources.id, monitor.sourceId)).limit(1);
    if (!source) throw new Error("Monitored knowledge pack source not found");
    const [run] = await db.insert(knowledgePackMonitorRuns).values({ monitorId, status: "running" }).returning();
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + monitor.checkIntervalHours * 3_600_000);
    try {
      const contentSnapshot = await retrieveTrustedSource(source.sourceUri, monitor.trustedHosts, fetcher);
      const result = await knowledgePackLifecycleService.recheckSource(monitor.organizationId, source.id, "knowledge-pack-agent:source_monitor", { contentSnapshot });
      const status = result.candidate ? "change_detected" : "unchanged";
      await db.update(knowledgePackMonitorRuns).set({ status, observedHash: result.observation.observedHash, changed: result.observation.changed, candidateId: result.candidate?.id, completedAt: new Date() }).where(eq(knowledgePackMonitorRuns.id, run.id));
      await db.update(knowledgePackSourceMonitors).set({ lastRunAt: now, nextRunAt, lastStatus: status, lastError: null, updatedAt: now }).where(eq(knowledgePackSourceMonitors.id, monitor.id));
      if (result.candidate) await db.insert(alerts).values({ severity: "warning", category: "governance", message: `Regulatory source change requires review: ${source.title}`, details: { sourceId: source.id, candidateId: result.candidate.id, previousHash: source.contentHash, observedHash: result.observation.observedHash }, organizationId: monitor.organizationId, ownerUserId: monitor.ownerUserId, ownerOrgId: monitor.organizationId });
      return { status, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(knowledgePackMonitorRuns).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(knowledgePackMonitorRuns.id, run.id));
      await db.update(knowledgePackSourceMonitors).set({ lastRunAt: now, nextRunAt, lastStatus: "failed", lastError: message, updatedAt: now }).where(eq(knowledgePackSourceMonitors.id, monitor.id));
      await db.insert(alerts).values({ severity: "warning", category: "governance", message: `Regulatory source monitor failed: ${source.title}`, details: { sourceId: source.id, monitorId: monitor.id, error: message }, organizationId: monitor.organizationId, ownerUserId: monitor.ownerUserId, ownerOrgId: monitor.organizationId });
      throw error;
    }
  }

  async runDue(now = new Date()) {
    const due = await db.select().from(knowledgePackSourceMonitors).where(and(eq(knowledgePackSourceMonitors.enabled, true), lte(knowledgePackSourceMonitors.nextRunAt, now))).orderBy(asc(knowledgePackSourceMonitors.nextRunAt)).limit(25);
    const results = [];
    for (const monitor of due) {
      try { results.push({ monitorId: monitor.id, result: await this.runMonitor(monitor.id) }); }
      catch (error) { results.push({ monitorId: monitor.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    await this.escalateUnresolved(now);
    return results;
  }

  async escalateUnresolved(now = new Date()) {
    const monitors = await db.select().from(knowledgePackSourceMonitors).where(eq(knowledgePackSourceMonitors.enabled, true));
    for (const monitor of monitors) {
      const cutoff = new Date(now.getTime() - monitor.escalationHours * 3_600_000);
      const [candidate] = await db.select().from(knowledgePackChangeCandidates).where(and(eq(knowledgePackChangeCandidates.sourceId, monitor.sourceId), eq(knowledgePackChangeCandidates.status, "open"), lte(knowledgePackChangeCandidates.createdAt, cutoff))).limit(1);
      const shouldEscalate = candidate && (!monitor.lastEscalatedAt || monitor.lastEscalatedAt < candidate.createdAt);
      if (!shouldEscalate) continue;
      await db.insert(alerts).values({ severity: "critical", category: "governance", message: `Unresolved regulatory change exceeded escalation window`, details: { sourceId: monitor.sourceId, candidateId: candidate.id, escalationHours: monitor.escalationHours }, organizationId: monitor.organizationId, ownerUserId: monitor.ownerUserId, ownerOrgId: monitor.organizationId });
      await db.update(knowledgePackSourceMonitors).set({ lastEscalatedAt: now, updatedAt: now }).where(eq(knowledgePackSourceMonitors.id, monitor.id));
    }
  }
}

export const knowledgePackMonitorService = new KnowledgePackMonitorService();
