import * as cron from "cron-parser";

/**
 * Calculate the next run time for a schedule based on its pattern
 * Returns a formatted date string or null if not scheduled/inactive
 */
export function calculateNextRunTime(
    schedule: {
        pattern: number | null;
        patternString: any;
        timezone: string | null;
        isActive: boolean | null;
    } | null
): string | null {
    if (!schedule) {
        return null;
    }

    // Allow undefined to default to true for backward compatibility
    if (schedule.isActive === false) {
        return null;
    }

    if (!schedule.pattern || schedule.pattern < 1 || schedule.pattern > 4) {
        return null;
    }

    const pattern = schedule.pattern;
    const patternString = schedule.patternString || {};
    const tzString = schedule.timezone || 'UTC';

    // Get timezone - default to UTC
    let tz: string = tzString;
    if (!tz || tz.trim() === '') {
        tz = 'UTC';
    }

    const now = new Date();

    // Helper to extract hour and minute from pattern_string
    const getHourMinute = (): [number, number] => {
        // Try new format first: starttime as "HH:MM" string
        if (patternString.starttime && typeof patternString.starttime === 'string') {
            const parts = patternString.starttime.split(':');
            if (parts.length === 2) {
                const hour = parseInt(parts[0], 10);
                const minute = parseInt(parts[1], 10);
                if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                    return [hour, minute];
                }
            }
        }
        // Fallback to legacy format: hour and minute as integers
        const hour = typeof patternString.hour === 'number' ? patternString.hour : 0;
        const minute = typeof patternString.minute === 'number' ? patternString.minute : 0;
        return [hour, minute];
    };

    try {
        let nextRun: Date;

        // Helper to get current time components in target timezone
        const getNowInTimezone = (): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } => {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                weekday: 'short',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            return {
                year: parseInt(parts.find(p => p.type === 'year')?.value || '0', 10),
                month: parseInt(parts.find(p => p.type === 'month')?.value || '0', 10) - 1,
                day: parseInt(parts.find(p => p.type === 'day')?.value || '0', 10),
                hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10),
                minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10),
                dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday')?.value || 'Sun')
            };
        };

        // Helper to convert a date/time in the target timezone to UTC Date
        // Uses the approach: create a date string representing local time in the target timezone,
        // then use Intl to determine what UTC time that corresponds to
        const createDateInTimezone = (year: number, month: number, day: number, hour: number, minute: number): Date => {
            // Create a date string in ISO format (without timezone)
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

            // We need to find what UTC time this local time in the target timezone represents
            // Strategy: Try different UTC times until we find one that formats to our desired time in the target timezone

            // Better approach: Create a date assuming it's UTC, see what it becomes in target timezone, adjust
            let testDate = new Date(Date.UTC(year, month, day, hour, minute, 0));

            // Get what this UTC time represents in target timezone
            const testFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const testParts = testFormatter.formatToParts(testDate);
            const testTzYear = parseInt(testParts.find(p => p.type === 'year')?.value || '0', 10);
            const testTzMonth = parseInt(testParts.find(p => p.type === 'month')?.value || '0', 10) - 1;
            const testTzDay = parseInt(testParts.find(p => p.type === 'day')?.value || '0', 10);
            const testTzHour = parseInt(testParts.find(p => p.type === 'hour')?.value || '0', 10);
            const testTzMinute = parseInt(testParts.find(p => p.type === 'minute')?.value || '0', 10);

            // Calculate the difference
            const targetMs = Date.UTC(year, month, day, hour, minute, 0);
            const actualMs = Date.UTC(testTzYear, testTzMonth, testTzDay, testTzHour, testTzMinute, 0);
            const offsetMs = testDate.getTime() - actualMs;

            // Apply the offset to get the correct UTC time
            return new Date(targetMs + offsetMs);
        };

        // Pattern 1: Daily
        if (pattern === 1) {
            const [hour, minute] = getHourMinute();
            const nowInTz = getNowInTimezone();

            nextRun = createDateInTimezone(nowInTz.year, nowInTz.month, nowInTz.day, hour, minute);

            // If the time has passed today, schedule for tomorrow
            if (nowInTz.hour > hour || (nowInTz.hour === hour && nowInTz.minute >= minute)) {
                // Add one day
                const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour12: false
                });
                const parts = formatter.formatToParts(tomorrow);
                const tzYear = parseInt(parts.find(p => p.type === 'year')?.value || '0', 10);
                const tzMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0', 10) - 1;
                const tzDay = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
                nextRun = createDateInTimezone(tzYear, tzMonth, tzDay, hour, minute);
            }
        }
        // Pattern 2: Weekly
        else if (pattern === 2) {
            const [hour, minute] = getHourMinute();

            // Handle weekdays
            let dayOfWeek: number;
            if (patternString.weekdays && typeof patternString.weekdays === 'string') {
                const weekdaysList = patternString.weekdays.split(',').map((d: string) => parseInt(d.trim(), 10)).filter((d: number) => !isNaN(d));
                if (weekdaysList.length > 0) {
                    const firstWeekday = weekdaysList[0];
                    dayOfWeek = firstWeekday === 7 ? 0 : firstWeekday;
                } else {
                    dayOfWeek = typeof patternString.dayOfWeek === 'number' ? patternString.dayOfWeek : 0;
                }
            } else {
                dayOfWeek = typeof patternString.dayOfWeek === 'number' ? patternString.dayOfWeek : 0;
            }

            const nowInTz = getNowInTimezone();
            let targetYear = nowInTz.year;
            let targetMonth = nowInTz.month;
            let targetDay = nowInTz.day;

            const currentDay = nowInTz.dayOfWeek;
            let daysUntilNext = (dayOfWeek - currentDay + 7) % 7;

            // Check if today's time has passed
            if (daysUntilNext === 0) {
                if (nowInTz.hour > hour || (nowInTz.hour === hour && nowInTz.minute >= minute)) {
                    daysUntilNext = 7;
                }
            }

            // Calculate target date
            const targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + daysUntilNext);
            const targetParts = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour12: false
            }).formatToParts(targetDate);
            targetYear = parseInt(targetParts.find(p => p.type === 'year')?.value || '0', 10);
            targetMonth = parseInt(targetParts.find(p => p.type === 'month')?.value || '0', 10) - 1;
            targetDay = parseInt(targetParts.find(p => p.type === 'day')?.value || '0', 10);

            nextRun = createDateInTimezone(targetYear, targetMonth, targetDay, hour, minute);
        }
        // Pattern 3: Monthly
        else if (pattern === 3) {
            const [hour, minute] = getHourMinute();
            const dayOfMonth = patternString.dayOfMonth || patternString.dayofmonth || 1;

            const nowInTz = getNowInTimezone();
            let targetYear = nowInTz.year;
            let targetMonth = nowInTz.month;

            // Get last day of month
            const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
            let targetDay = Math.min(dayOfMonth, lastDay);

            // Check if the date/time has passed this month
            const hasPassed = nowInTz.day > targetDay ||
                (nowInTz.day === targetDay && (nowInTz.hour > hour || (nowInTz.hour === hour && nowInTz.minute >= minute)));

            if (hasPassed) {
                targetMonth++;
                if (targetMonth > 11) {
                    targetMonth = 0;
                    targetYear++;
                }
                const nextLastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
                targetDay = Math.min(dayOfMonth, nextLastDay);
            }

            nextRun = createDateInTimezone(targetYear, targetMonth, targetDay, hour, minute);
        }
        // Pattern 4: Custom Cron
        else if (pattern === 4) {
            const cronExpr = patternString.cron;
            if (!cronExpr || typeof cronExpr !== 'string') {
                return null;
            }

            try {
                const interval = (cron as any).parseExpression(cronExpr, {
                    tz: tz,
                    currentDate: now
                });
                nextRun = interval.next().toDate();
            } catch (error: any) {
                console.error(`Error parsing cron expression ${cronExpr}:`, error);
                return null;
            }
        } else {
            return null;
        }

        // Format the date nicely
        return nextRun.toISOString();
    } catch (error) {
        console.error('Error calculating next run time:', error);
        return null;
    }
}

