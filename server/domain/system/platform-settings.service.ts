/**
 * Platform-wide settings (the single `global` system_settings row) and
 * per-user preferences stored alongside it under `user:<id>:...` keys.
 *
 * The global row is shared by every tenant — SMTP, maintenance mode, MFA
 * policy, governor and AI defaults — so only a super admin may write it.
 * Organization-scoped settings live in org_settings (/api/org-settings).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { jobs, systemSettings } from "@shared/schema/index.js";

const GLOBAL_KEY = "global";
const browserNotificationKey = (userId: string) => `user:${userId}:browser_notification_preferences`;

async function readSetting(key: string) {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row ?? null;
}

async function upsertSetting(key: string, settingsData: Record<string, unknown>, updatedBy: string) {
  const existing = await readSetting(key);
  if (existing) {
    const [updated] = await db.update(systemSettings)
      .set({ settingsData, updatedAt: new Date(), updatedBy })
      .where(eq(systemSettings.key, key))
      .returning();
    return updated;
  }
  const [created] = await db.insert(systemSettings).values({ key, settingsData, updatedBy }).returning();
  return created;
}

export const platformSettingsService = {
  /** The global settings payload, or null when none has been saved. */
  async getGlobalSettings(): Promise<Record<string, any> | null> {
    const row = await readSetting(GLOBAL_KEY);
    return row ? ((row.settingsData as Record<string, any>) ?? {}) : null;
  },

  async saveGlobalSettings(settingsData: Record<string, unknown>, updatedBy: string): Promise<Record<string, any>> {
    const row = await upsertSetting(GLOBAL_KEY, settingsData, updatedBy);
    return (row.settingsData as Record<string, any>) ?? {};
  },

  async getBrowserNotificationPreferences(userId: string): Promise<Record<string, any> | null> {
    const row = await readSetting(browserNotificationKey(userId));
    return row ? (row.settingsData as Record<string, any>) : null;
  },

  async saveBrowserNotificationPreferences(userId: string, settingsData: Record<string, unknown>): Promise<void> {
    await upsertSetting(browserNotificationKey(userId), settingsData, userId);
  },

  /** Active jobs in one org, or across the platform when `organizationId` is null. */
  async countActiveJobs(organizationId: number | null): Promise<number> {
    const where = organizationId === null
      ? eq(jobs.isActive, true)
      : and(eq(jobs.isActive, true), eq(jobs.organizationId, organizationId));
    const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(jobs).where(where);
    return Number(row?.count || 0);
  },
};
