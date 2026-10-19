const fs = require('fs');
const path = require('path');

const targetFile = path.resolve('client/src/modules/operations/utils/gantt-cpm.ts');
let content = fs.readFileSync(targetFile, 'utf8');

const targetText = `// ── Date helpers used by the chart ───────────────────────────────────────────

/** Add fractional units to a Date */
export function addUnits(base: Date, value: number, unit: TimeUnit): Date {
    return new Date(base.getTime() + value * MS_PER_UNIT[unit]);
}

/** Units between two dates (fractional) */
export function unitsBetween(a: Date, b: Date, unit: TimeUnit): number {
    return (b.getTime() - a.getTime()) / MS_PER_UNIT[unit];
}

/** Add fractional days to a Date (legacy wrapper) */
export function addDays(base: Date, days: number): Date {
    return addUnits(base, days, "d");
}

/** Days between two dates (fractional) (legacy wrapper) */
export function daysBetween(a: Date, b: Date): number {
    return unitsBetween(a, b, "d");
}

/** Format a Date as "D MMM" (e.g. "3 Jun") */
export function fmtAxisDate(d: Date): string {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}`;

const replacementText = `// ── Date helpers used by the chart ───────────────────────────────────────────

function addWorkingDays(baseDate: Date, days: number): Date {
    let current = new Date(baseDate.getTime());
    let sign = Math.sign(days);
    let remainingMs = Math.abs(days) * 24 * 60 * 60 * 1000;
    
    if (remainingMs === 0) return current;
    
    while (remainingMs > 0) {
        if (sign >= 0) {
            // Moving forward. Find end of today (next midnight)
            const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
            const msToMidnight = nextMidnight.getTime() - current.getTime();
            const day = current.getDay();
            
            if (day !== 0 && day !== 6) {
                if (remainingMs <= msToMidnight) {
                    current.setTime(current.getTime() + remainingMs);
                    remainingMs = 0;
                } else {
                    current = nextMidnight;
                    remainingMs -= msToMidnight;
                }
            } else {
                current = nextMidnight;
            }
        } else {
            // Moving backward. Find start of today (previous midnight)
            const prevMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            let msFromMidnight = current.getTime() - prevMidnight.getTime();
            if (msFromMidnight === 0) {
                prevMidnight.setDate(prevMidnight.getDate() - 1);
                msFromMidnight = 24 * 60 * 60 * 1000;
            }
            
            const testDate = new Date(current.getTime() - 1);
            const day = testDate.getDay();
            
            if (day !== 0 && day !== 6) {
                if (remainingMs <= msFromMidnight) {
                    current.setTime(current.getTime() - remainingMs);
                    remainingMs = 0;
                } else {
                    current = prevMidnight;
                    remainingMs -= msFromMidnight;
                }
            } else {
                current = prevMidnight;
            }
        }
    }
    return current;
}

function workingDaysBetween(a: Date, b: Date): number {
    const start = new Date(Math.min(a.getTime(), b.getTime()));
    const end = new Date(Math.max(a.getTime(), b.getTime()));
    const sign = a.getTime() <= b.getTime() ? 1 : -1;
    
    let totalMs = 0;
    let current = new Date(start.getTime());
    
    while (current < end) {
        const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
        const segmentEnd = nextDay < end ? nextDay : end;
        const day = current.getDay();
        if (day !== 0 && day !== 6) {
            totalMs += segmentEnd.getTime() - current.getTime();
        }
        current = segmentEnd;
    }
    
    return (totalMs / (24 * 60 * 60 * 1000)) * sign;
}

/** Add fractional units to a Date */
export function addUnits(base: Date, value: number, unit: TimeUnit, excludeWeekends?: boolean): Date {
    if (excludeWeekends && unit === "d") {
        return addWorkingDays(base, value);
    }
    return new Date(base.getTime() + value * MS_PER_UNIT[unit]);
}

/** Units between two dates (fractional) */
export function unitsBetween(a: Date, b: Date, unit: TimeUnit, excludeWeekends?: boolean): number {
    if (excludeWeekends && unit === "d") {
        return workingDaysBetween(a, b);
    }
    return (b.getTime() - a.getTime()) / MS_PER_UNIT[unit];
}

/** Add fractional days to a Date (legacy wrapper) */
export function addDays(base: Date, days: number, excludeWeekends?: boolean): Date {
    return addUnits(base, days, "d", excludeWeekends);
}

/** Days between two dates (fractional) (legacy wrapper) */
export function daysBetween(a: Date, b: Date, excludeWeekends?: boolean): number {
    return unitsBetween(a, b, "d", excludeWeekends);
}

/** Format a Date as "D MMM" (e.g. "3 Jun") */
export function fmtAxisDate(d: Date): string {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}`;

// Normalize line endings for replacement
const normalize = (str) => str.replace(/\r\n/g, '\n');

const normalizedContent = normalize(content);
const normalizedTarget = normalize(targetText);
const normalizedReplacement = normalize(replacementText);

if (normalizedContent.includes(normalizedTarget)) {
    fs.writeFileSync(targetFile, normalizedContent.replace(normalizedTarget, normalizedReplacement), 'utf8');
    console.log('Successfully patched gantt-cpm.ts');
} else {
    console.error('Target text not found in gantt-cpm.ts');
    process.exit(1);
}
