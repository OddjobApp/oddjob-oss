import { schedules } from "@shared/schema/index.js";
import { CronExpressionParser } from "cron-parser";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScheduleCalculator");

export function calculateNextRun(schedule: typeof schedules.$inferSelect): Date | null {
    const pattern = schedule.pattern; // 1=Daily, 2=Weekly, 3=Monthly, 4=Cron
    const config = schedule.patternString as any;
    const timezone = schedule.timezone || 'UTC';
    const now = new Date();

    switch (pattern) {
        case 1: // Daily
            return calculateDailyNextRun(config, timezone, now);
        case 2: // Weekly
            return calculateWeeklyNextRun(config, timezone, now);
        case 3: // Monthly
            return calculateMonthlyNextRun(config, timezone, now);
        case 4: // Cron
            return calculateCronNextRun(config, timezone, now);
        default:
            logger.warn(`[ScheduleCalculator] Unknown schedule pattern: ${pattern}`);
            return null;
    }
}

function calculateDailyNextRun(config: any, timezone: string, now: Date): Date | null {
    try {
        const timeStr = config.time || config.starttime || "09:00";
        const [hours, minutes] = timeStr.split(':').map(Number);

        const nextRun = new Date(now);
        nextRun.setHours(hours, minutes, 0, 0);

        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        return nextRun;
    } catch (err) {
        logger.error("[ScheduleCalculator] Failed to calculate daily next run:", err);
        return null;
    }
}

function calculateWeeklyNextRun(config: any, timezone: string, now: Date): Date | null {
    try {
        const timeStr = config.time || config.starttime || "09:00";
        const [hours, minutes] = timeStr.split(':').map(Number);
        const days: number[] = config.days || config.weekdays || [1, 2, 3, 4, 5];

        if (days.length === 0) return null;

        const sortedDays = [...days].sort((a, b) => a - b);
        const currentDay = now.getDay();

        let daysToAdd = 0;
        let found = false;

        for (let i = 0; i < 7; i++) {
            const checkDay = (currentDay + i) % 7;
            if (sortedDays.includes(checkDay)) {
                if (i === 0) {
                    const todayRun = new Date(now);
                    todayRun.setHours(hours, minutes, 0, 0);
                    if (todayRun > now) {
                        daysToAdd = 0;
                        found = true;
                        break;
                    }
                } else {
                    daysToAdd = i;
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            daysToAdd = 7 - currentDay + sortedDays[0];
        }

        const nextRun = new Date(now);
        nextRun.setDate(nextRun.getDate() + daysToAdd);
        nextRun.setHours(hours, minutes, 0, 0);

        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 7);
        }

        return nextRun;
    } catch (err) {
        logger.error("[ScheduleCalculator] Failed to calculate weekly next run:", err);
        return null;
    }
}

function calculateMonthlyNextRun(config: any, timezone: string, now: Date): Date | null {
    try {
        const timeStr = config.time || config.starttime || "09:00";
        const [hours, minutes] = timeStr.split(':').map(Number);
        const dayOfMonth = config.dayOfMonth || config.day || 1;

        const nextRun = new Date(now);
        nextRun.setDate(dayOfMonth);
        nextRun.setHours(hours, minutes, 0, 0);

        if (nextRun <= now) {
            nextRun.setMonth(nextRun.getMonth() + 1);
        }

        const maxDays = new Date(nextRun.getFullYear(), nextRun.getMonth() + 1, 0).getDate();
        if (dayOfMonth > maxDays) {
            nextRun.setDate(maxDays);
        }

        return nextRun;
    } catch (err) {
        logger.error("[ScheduleCalculator] Failed to calculate monthly next run:", err);
        return null;
    }
}

function calculateCronNextRun(config: any, timezone: string, now: Date): Date | null {
    try {
        const cronExpression = config.cron || config.expression;
        if (!cronExpression) {
            logger.warn("[ScheduleCalculator] No cron expression in config");
            return null;
        }

        const interval = CronExpressionParser.parse(cronExpression, {
            currentDate: now,
            tz: timezone
        });

        return interval.next().toDate();
    } catch (err) {
        logger.error(`[ScheduleCalculator] Invalid CRON expression: ${config.cron}`, err);
        return null;
    }
}
