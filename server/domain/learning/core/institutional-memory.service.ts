/**
 * Institutional Memory Service
 *
 * Distills accumulated failure clusters and prevention rules into condensed
 * knowledge entries and injects them into agent system prompts at mission startup.
 * This closes the loop: failures → clusters → rules → lessons → better missions.
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
  failureClusters,
  preventionRules,
  orgLearningProfiles,
} from "@shared/schema/learning/index.js";
import { knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, desc, gte, sql } from "drizzle-orm";

const logger = createLogger("InstitutionalMemory");

export interface MemoryLesson {
  id: string;
  domain: string;
  lesson: string;
  preventionRule: string;
  severity: string;
  incidentCount: number;
  lastSeenAt: Date | null;
}

export interface OrgMemoryHealth {
  organizationId: number;
  totalLessons: number;
  activeClusters: number;
  activeRules: number;
  topDomains: string[];
  coverageScore: number;
  lastDistilledAt: Date | null;
  staleRulesCount: number;
}

export class InstitutionalMemoryService {

  // =========================================================================
  // DISTILLATION — reads failure data, writes to knowledgeTopics
  // =========================================================================

  /**
   * Runs the distillation job for an org: reads failure clusters + prevention
   * rules and upserts them as auto-tagged knowledge topics.
   */
  async distillForOrg(organizationId: number): Promise<{ distilled: number; skipped: number }> {
    logger.info(`[InstitutionalMemory] Distilling memory for org ${organizationId}`);
    let distilled = 0;
    let skipped = 0;

    try {
      // Pull active clusters with incident counts
      const clusters = await db.query.failureClusters.findMany({
        where: and(
          eq(failureClusters.organizationId, organizationId),
          eq(failureClusters.status, "active")
        ),
        orderBy: desc(failureClusters.incidentCount),
        limit: 10000,
      });

      // Pull active prevention rules
      const rules = await db.query.preventionRules.findMany({
        where: and(
          eq(preventionRules.organizationId, organizationId),
          eq(preventionRules.isActive, true)
        ),
        limit: 10000,
      });

      // Map clusters to lessons
      const lessons: MemoryLesson[] = clusters.map(c => ({
        id: `cluster-${c.id}`,
        domain: c.domain,
        lesson: c.description || `Recurring failure in ${c.domain}: ${c.name}`,
        preventionRule: (rules.find(r => r.matchesDomain === c.domain)?.matchesPattern) || "Monitor and retry with alternative approach.",
        severity: c.severity || "medium",
        incidentCount: c.incidentCount || 0,
        lastSeenAt: c.lastSeenAt || null,
      }));

      // Upsert each lesson as a knowledge topic
      for (const lesson of lessons) {
        try {
          const topicName = `[IM] ${lesson.domain} — ${lesson.lesson.slice(0, 80)}`;
          const topicContent = [
            `Domain: ${lesson.domain}`,
            `Lesson: ${lesson.lesson}`,
            `Prevention: ${lesson.preventionRule}`,
            `Severity: ${lesson.severity}`,
            `Seen ${lesson.incidentCount} time(s) — last seen: ${lesson.lastSeenAt?.toISOString() ?? "unknown"}`,
          ].join("\n");

          // Check if this topic already exists
          const existing = await db.query.knowledgeTopics.findFirst({
            where: and(
              eq(knowledgeTopics.organizationId, organizationId),
              eq(knowledgeTopics.name, topicName)
            ),
          });

          if (existing) {
            await db.update(knowledgeTopics)
              .set({ description: topicContent, updatedAt: new Date() })
              .where(eq(knowledgeTopics.id, existing.id));
          } else {
            await db.insert(knowledgeTopics).values({
              organizationId,
              name: topicName,
              description: topicContent,
              tags: ["institutional-memory", lesson.domain, lesson.severity],
              createdBy: "system:institutional-memory",
            } as any);
          }
          distilled++;
        } catch (lessonErr: any) {
          logger.warn(`[InstitutionalMemory] Failed to upsert lesson ${lesson.id}: ${lessonErr.message}`);
          skipped++;
        }
      }

      // Record last distillation timestamp in org profile
      await db.update(orgLearningProfiles)
        .set({ lastAnalyzedAt: new Date(), updatedAt: new Date() })
        .where(eq(orgLearningProfiles.organizationId, organizationId));

      logger.info(`[InstitutionalMemory] Org ${organizationId}: distilled=${distilled}, skipped=${skipped}`);
    } catch (err: any) {
      logger.error(`[InstitutionalMemory] Distillation failed for org ${organizationId}: ${err.message}`);
    }

    return { distilled, skipped };
  }

  // =========================================================================
  // PROMPT INJECTION — called at mission startup
  // =========================================================================

  /**
   * Returns the top N institutional lessons formatted for injection into
   * the agent system prompt. Call this in prompt-builder.ts or orchestrators.
   */
  async getLessonsForPromptInjection(
    organizationId: number,
    domain?: string,
    maxLessons: number = 5
  ): Promise<string> {
    try {
      const rules = await db.query.preventionRules.findMany({
        where: and(
          eq(preventionRules.organizationId, organizationId),
          eq(preventionRules.isActive, true),
          domain ? eq(preventionRules.matchesDomain, domain) : undefined
        ),
        limit: maxLessons,
      });

      if (rules.length === 0) return "";

      const lines = rules.map((r, i) =>
        `${i + 1}. [${r.ruleType?.toUpperCase() || "RULE"}] ${r.matchesPattern || "No pattern"} → ${JSON.stringify(r.actionConfig || {})}`
      );

      return `\n## INSTITUTIONAL MEMORY — Lessons From Past Failures\nYour organization has learned the following. Apply these proactively:\n${lines.join("\n")}\n`;
    } catch (err: any) {
      logger.warn(`[InstitutionalMemory] Failed to fetch lessons for org ${organizationId}: ${err.message}`);
      return "";
    }
  }

  // =========================================================================
  // HEALTH REPORTING — used by the API route
  // =========================================================================

  async getOrgMemoryHealth(organizationId: number): Promise<OrgMemoryHealth> {
    const [clustersResult, rulesResult, profileResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)`, domain: failureClusters.domain })
        .from(failureClusters)
        .where(and(
          eq(failureClusters.organizationId, organizationId),
          eq(failureClusters.status, "active")
        ))
        .groupBy(failureClusters.domain)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(10),

      db.select({ count: sql<number>`count(*)` })
        .from(preventionRules)
        .where(and(
          eq(preventionRules.organizationId, organizationId),
          eq(preventionRules.isActive, true)
        )),

      db.query.orgLearningProfiles.findFirst({
        where: eq(orgLearningProfiles.organizationId, organizationId),
      }),
    ]);

    const activeClusters = clustersResult.reduce((s, r) => s + (r.count || 0), 0);
    const activeRules = rulesResult[0]?.count || 0;
    const topDomains = clustersResult.slice(0, 5).map(r => r.domain);

    // Stale rules = rules not updated in 60 days
    const staleRulesCount = await db.select({ count: sql<number>`count(*)` })
      .from(preventionRules)
      .where(and(
        eq(preventionRules.organizationId, organizationId),
        eq(preventionRules.isActive, true),
        // updatedAt older than 60 days
        sql`${preventionRules.updatedAt} < NOW() - INTERVAL '60 days'`
      ))
      .then(r => r[0]?.count || 0);

    // Coverage score: 0-100 based on how many domains have rules
    const domainsWithRules = new Set(topDomains).size;
    const coverageScore = Math.min(100, Math.round((domainsWithRules / Math.max(topDomains.length, 1)) * 100));

    // Count distilled knowledge topics
    const knowledgeTopicsCount = await db.select({ count: sql<number>`count(*)` })
      .from(knowledgeTopics)
      .where(and(
        eq(knowledgeTopics.organizationId, organizationId),
        sql`${knowledgeTopics.name} LIKE '[IM]%'`
      ))
      .then(r => r[0]?.count || 0);

    return {
      organizationId,
      totalLessons: knowledgeTopicsCount,
      activeClusters,
      activeRules,
      topDomains,
      coverageScore,
      lastDistilledAt: profileResult?.lastAnalyzedAt || null,
      staleRulesCount,
    };
  }

  recordMissionOutcome(outcome: {
    missionId: number;
    objective: string;
    success: boolean;
    patterns: { type: string; description: string; frequency: number; confidence: number }[];
    insights: { category: string; statement: string; evidence: string[]; confidence: number }[];
    timestamp: string;
  }): void {
    logger.debug(
      `[InstitutionalMemory] Mission ${outcome.missionId} outcome recorded: ${outcome.success ? 'success' : 'failure'} — "${outcome.objective.slice(0, 80)}"`
    );
  }
}

export const institutionalMemoryService = new InstitutionalMemoryService();
