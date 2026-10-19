/**
 * Behavioral Intelligence Engine — Time-Parting Service
 *
 * Segments scoring behavior by time periods:
 * - Hour of day (business hours vs. after hours)
 * - Day of week (weekday vs. weekend)
 * - Seasonal/calendar (Q4 budget season, summer slowdown)
 *
 * Resolves time-parts relative to the entity's local timezone (IANA).
 * Supports DST transitions automatically via Intl.DateTimeFormat.
 */
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BITimeParting");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimePartDefinition {
  id: string;
  name: string;
  type: "hourly" | "daily" | "seasonal";
  multiplier: number;
  // Hourly: start/end in HH:MM format
  start_hour?: string;
  end_hour?: string;
  // Daily: array of day numbers (1=Mon, 7=Sun)
  days?: number[];
  // Seasonal: array of month numbers (1=Jan, 12=Dec)
  months?: number[];
}

export interface TimePartConfig {
  timezone: string; // IANA timezone (e.g., "America/New_York")
  parts: TimePartDefinition[];
}

export interface ActiveTimePart {
  id: string;
  name: string;
  multiplier: number;
  type: string;
}

// ─── Default Time Parts ──────────────────────────────────────────────────────

export const DEFAULT_TIME_PARTS: TimePartDefinition[] = [
  { id: "business_hours", name: "Business Hours", type: "hourly", start_hour: "09:00", end_hour: "17:00", multiplier: 1.5 },
  { id: "after_hours", name: "After Hours", type: "hourly", start_hour: "17:00", end_hour: "09:00", multiplier: 0.7 },
  { id: "weekday", name: "Weekday", type: "daily", days: [1, 2, 3, 4, 5], multiplier: 1.0 },
  { id: "weekend", name: "Weekend", type: "daily", days: [6, 7], multiplier: 0.5 },
  { id: "q4_budget", name: "Q4 Budget Season", type: "seasonal", months: [10, 11, 12], multiplier: 1.8 },
  { id: "summer_slow", name: "Summer Slowdown", type: "seasonal", months: [6, 7, 8], multiplier: 0.6 },
];

// ─── Timezone Resolution ─────────────────────────────────────────────────────

/**
 * Get the current local time in a specific IANA timezone.
 * Handles DST automatically via Intl.DateTimeFormat.
 */
function getLocalTime(timezone: string, date: Date = new Date()): { hour: number; minute: number; dayOfWeek: number; month: number; dayOfMonth: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0");
    const month = parseInt(parts.find(p => p.type === "month")?.value || "1");
    const dayOfMonth = parseInt(parts.find(p => p.type === "day")?.value || "1");

    // Convert weekday name to number (1=Mon, 7=Sun)
    const weekdayStr = parts.find(p => p.type === "weekday")?.value || "Mon";
    const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dayOfWeek = dayMap[weekdayStr] || 1;

    return { hour, minute, dayOfWeek, month, dayOfMonth };
  } catch {
    // Fallback to UTC if timezone is invalid
    const utc = date;
    return {
      hour: utc.getUTCHours(),
      minute: utc.getUTCMinutes(),
      dayOfWeek: utc.getUTCDay() === 0 ? 7 : utc.getUTCDay(),
      month: utc.getUTCMonth() + 1,
      dayOfMonth: utc.getUTCDate(),
    };
  }
}

// ─── Time-Part Evaluation ────────────────────────────────────────────────────

/**
 * Determine which time-parts are currently active for a given timezone.
 */
function getActiveTimeParts(config: TimePartConfig, date: Date = new Date()): ActiveTimePart[] {
  const local = getLocalTime(config.timezone, date);
  const active: ActiveTimePart[] = [];

  for (const part of config.parts) {
    let isActive = false;

    switch (part.type) {
      case "hourly": {
        if (!part.start_hour || !part.end_hour) break;
        const [startH, startM] = part.start_hour.split(":").map(Number);
        const [endH, endM] = part.end_hour.split(":").map(Number);
        const currentMinutes = local.hour * 60 + local.minute;
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        if (startMinutes < endMinutes) {
          // Normal range (e.g., 09:00-17:00)
          isActive = currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {
          // Overnight range (e.g., 17:00-09:00)
          isActive = currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }
        break;
      }
      case "daily": {
        isActive = (part.days || []).includes(local.dayOfWeek);
        break;
      }
      case "seasonal": {
        isActive = (part.months || []).includes(local.month);
        break;
      }
    }

    if (isActive) {
      active.push({ id: part.id, name: part.name, multiplier: part.multiplier, type: part.type });
    }
  }

  return active;
}

/**
 * Get the combined time-part multiplier (product of all active parts).
 */
function getTimePartMultiplier(config: TimePartConfig, date: Date = new Date()): number {
  const active = getActiveTimeParts(config, date);
  if (active.length === 0) return 1.0;
  return active.reduce((product, part) => product * part.multiplier, 1.0);
}

/**
 * Resolve timezone for an entity using the hierarchy:
 * 1. Entity explicit timezone
 * 2. Geo-inferred timezone
 * 3. Org default timezone
 * 4. UTC fallback
 */
function resolveTimezone(
  entityTimezone?: string,
  geoTimezone?: string,
  orgTimezone?: string
): string {
  if (entityTimezone && isValidTimezone(entityTimezone)) return entityTimezone;
  if (geoTimezone && isValidTimezone(geoTimezone)) return geoTimezone;
  if (orgTimezone && isValidTimezone(orgTimezone)) return orgTimezone;
  return "UTC";
}

/**
 * Validate an IANA timezone identifier.
 */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biTimeParting = {
  getActiveTimeParts,
  getTimePartMultiplier,
  getLocalTime,
  resolveTimezone,
  isValidTimezone,
  DEFAULT_TIME_PARTS,
};
