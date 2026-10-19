/**
 * AI Usage & Dashboard Analytics
 * 
 * Re-exports modularized services for backward compatibility.
 */

import { usageService, type LogUsageData } from "./usage.service.js";
import { budgetService } from "../../core/budget.service.js";
import { dashboardService } from "./dashboard.service.js";
import { aiUsageLogs } from "@shared/schema/index.js";
import { db } from "@server/database_service.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { startOfMonth, subDays } from "date-fns";

export { LogUsageData };

export const analyticsService = {
  ...usageService,
  ...budgetService,
  ...dashboardService,
};

// For backward compatibility / direct import
export const logAIUsage = analyticsService.logAIUsage.bind(analyticsService);

export async function getPipelineCurrentMonthSpend(pipelineId: number): Promise<number> {
  return budgetService.getPipelineCurrentMonthSpend(pipelineId);
}

export async function getPipelineDailySpend(pipelineId: number, days: number = 30): Promise<{ date: string; cost: number }[]> {
  const startDate = subDays(new Date(), days);

  const dailyCosts = await db
    .select({
      date: sql<string>`to_char(${aiUsageLogs.createdAt}, 'YYYY-MM-DD')`,
      cost: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
    })
    .from(aiUsageLogs)
    .where(
      and(
        eq(aiUsageLogs.pipelineId, pipelineId),
        gte(aiUsageLogs.createdAt, startDate)
      )
    )
    .groupBy(sql`to_char(${aiUsageLogs.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${aiUsageLogs.createdAt}, 'YYYY-MM-DD')`);

  return dailyCosts.map(r => ({ date: r.date, cost: Number(r.cost) }));
}


