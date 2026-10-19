/**
 * Rule Suite Service
 * 
 * Domain service managing CRUD, deployment transactions, rule specifications,
 * and execution audits for the Governed Rules & Decision Intelligence Engine (GRIE).
 */

import { db } from "@server/database_service.js";
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import {
  ruleSuites,
  ruleSpecifications,
  ruleExecutionAudits,
  type RuleSuite,
} from "@shared/schema/index.js";
import { ConflictError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RuleSuiteService");

export class RuleSuiteService {
  private scopeOf(orgId: number, projectId?: number): SQL | undefined {
    const org = eq(ruleSuites.organizationId, orgId);
    if (projectId == null) return org;
    return and(org, or(eq(ruleSuites.projectId, projectId), isNull(ruleSuites.projectId)));
  }

  async findSuite(suiteId: string, orgId: number, projectId?: number): Promise<RuleSuite | null> {
    const [suite] = await db
      .select()
      .from(ruleSuites)
      .where(and(eq(ruleSuites.suiteId, suiteId), this.scopeOf(orgId, projectId)))
      .limit(1);
    return suite ?? null;
  }

  async requireSuite(suiteId: string, orgId: number, projectId?: number): Promise<RuleSuite> {
    const suite = await this.findSuite(suiteId, orgId, projectId);
    if (!suite) throw new NotFoundError(`Rule suite '${suiteId}' not found`);
    return suite;
  }

  async listSuitesWithCounts(orgId: number, projectId?: number) {
    const suites = await db
      .select()
      .from(ruleSuites)
      .where(this.scopeOf(orgId, projectId))
      .orderBy(desc(ruleSuites.updatedAt));

    const suiteIds = new Set(suites.map((s) => s.id));
    const countBySuite = new Map<number, number>();
    const enabledCountBySuite = new Map<number, number>();

    if (suiteIds.size > 0) {
      const counts = await db
        .select({ suiteDbId: ruleSpecifications.suiteDbId, enabled: ruleSpecifications.enabled })
        .from(ruleSpecifications)
        .where(inArray(ruleSpecifications.suiteDbId, [...suiteIds]));

      for (const row of counts) {
        countBySuite.set(row.suiteDbId, (countBySuite.get(row.suiteDbId) ?? 0) + 1);
        if (row.enabled) {
          enabledCountBySuite.set(row.suiteDbId, (enabledCountBySuite.get(row.suiteDbId) ?? 0) + 1);
        }
      }
    }

    return suites.map((s) => ({
      ...s,
      ruleCount: countBySuite.get(s.id) ?? 0,
      enabledRuleCount: enabledCountBySuite.get(s.id) ?? 0,
    }));
  }

  async createSuite(values: any) {
    try {
      const [suite] = await db.insert(ruleSuites).values(values).returning();
      return suite;
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new ConflictError(`Rule suite id '${values.suiteId}' is not available`);
      }
      throw err;
    }
  }

  async updateSuite(suiteDbId: number, updates: any) {
    const [updated] = await db
      .update(ruleSuites)
      .set(updates)
      .where(eq(ruleSuites.id, suiteDbId))
      .returning();
    return updated;
  }

  async deleteSuite(suiteDbId: number) {
    await db.delete(ruleSuites).where(eq(ruleSuites.id, suiteDbId));
  }

  async deployRuleTransaction(orgId: number, projectId: number | undefined, data: any, userEmail: string) {
    return await db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(ruleSuites)
        .where(
          and(
            eq(ruleSuites.organizationId, orgId),
            projectId == null ? isNull(ruleSuites.projectId) : eq(ruleSuites.projectId, projectId),
            eq(ruleSuites.suiteId, data.suite.suiteId)
          )
        )
        .limit(1);

      const suite =
        found ??
        (
          await tx
            .insert(ruleSuites)
            .values({
              organizationId: orgId,
              projectId: projectId ?? null,
              suiteId: data.suite.suiteId,
              suiteName: data.suite.suiteName,
              category: data.suite.category ?? "Supply Chain & Logistics",
              version: data.suite.version ?? "1.0.0",
              owner: data.suite.owner ?? "Operations Team",
              description: data.suite.description,
              executionPolicy: data.suite.executionPolicy ?? "HIGHEST_PRIORITY_MAUF",
              enabled: data.suite.enabled ?? true,
              createdBy: userEmail,
            })
            .returning()
        )[0];

      const spec = data.rule;
      const [prior] = await tx
        .select({ id: ruleSpecifications.id })
        .from(ruleSpecifications)
        .where(and(eq(ruleSpecifications.suiteDbId, suite.id), eq(ruleSpecifications.ruleId, spec.ruleId)))
        .limit(1);

      const ruleValues = {
        suiteDbId: suite.id,
        ruleId: spec.ruleId,
        ruleName: spec.ruleName,
        enabled: spec.enabled,
        priorityWeight: spec.priorityWeight ?? 50,
        specification: spec,
        updatedAt: new Date(),
      };

      const [row] = prior
        ? await tx
            .update(ruleSpecifications)
            .set(ruleValues)
            .where(eq(ruleSpecifications.id, prior.id))
            .returning()
        : await tx.insert(ruleSpecifications).values(ruleValues).returning();

      return { suite, rule: row, isNewRule: !prior };
    });
  }

  async listRules(suiteDbId: number) {
    return await db
      .select()
      .from(ruleSpecifications)
      .where(eq(ruleSpecifications.suiteDbId, suiteDbId))
      .orderBy(desc(ruleSpecifications.priorityWeight), asc(ruleSpecifications.ruleId));
  }

  async upsertRule(suiteDbId: number, spec: any) {
    const [existing] = await db
      .select({ id: ruleSpecifications.id })
      .from(ruleSpecifications)
      .where(and(eq(ruleSpecifications.suiteDbId, suiteDbId), eq(ruleSpecifications.ruleId, spec.ruleId)))
      .limit(1);

    const values = {
      suiteDbId,
      ruleId: spec.ruleId,
      ruleName: spec.ruleName,
      enabled: spec.enabled,
      priorityWeight: spec.priorityWeight ?? 50,
      specification: spec,
      updatedAt: new Date(),
    };

    const [row] = existing
      ? await db
          .update(ruleSpecifications)
          .set(values)
          .where(eq(ruleSpecifications.id, existing.id))
          .returning()
      : await db.insert(ruleSpecifications).values(values).returning();

    return { row, isUpdate: !!existing };
  }

  async updateRuleSpecification(ruleDbId: number, updates: any) {
    const [updated] = await db
      .update(ruleSpecifications)
      .set(updates)
      .where(eq(ruleSpecifications.id, ruleDbId))
      .returning();
    return updated;
  }

  async deleteRule(suiteDbId: number, ruleId: string) {
    const [rule] = await db
      .select()
      .from(ruleSpecifications)
      .where(and(eq(ruleSpecifications.suiteDbId, suiteDbId), eq(ruleSpecifications.ruleId, ruleId)))
      .limit(1);

    if (!rule) throw new NotFoundError(`Rule '${ruleId}' not found in suite`);

    await db.delete(ruleSpecifications).where(eq(ruleSpecifications.id, rule.id));
    return rule;
  }

  async findRule(suiteDbId: number, ruleId: string) {
    const [rule] = await db
      .select()
      .from(ruleSpecifications)
      .where(and(eq(ruleSpecifications.suiteDbId, suiteDbId), eq(ruleSpecifications.ruleId, ruleId)))
      .limit(1);
    return rule ?? null;
  }

  async listAuditsWithFilter(orgId: number, suiteId: string, outcome?: string, limitN: number = 100) {
    return await db
      .select()
      .from(ruleExecutionAudits)
      .where(
        and(
          eq(ruleExecutionAudits.organizationId, orgId),
          eq(ruleExecutionAudits.suiteId, suiteId),
          ...(outcome ? [eq(ruleExecutionAudits.outcome, outcome)] : [])
        )
      )
      .orderBy(desc(ruleExecutionAudits.executedAt))
      .limit(limitN);
  }
}

export const ruleSuiteService = new RuleSuiteService();
