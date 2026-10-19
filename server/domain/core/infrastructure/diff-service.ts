/**
 * Diff Service
 * 
 * Provides utilities for computing semantic differences between JSON objects.
 * Used by the Pipeline Runner to detect changes between runs.
 */

import * as jsonPatch from 'fast-json-patch';
const { compare } = jsonPatch;
import { Operation } from 'fast-json-patch';

export interface DiffChange {
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: any;
    oldValue?: any;
}

export interface DiffResult {
    hasChanges: boolean;
    changeCount: number;
    changes: DiffChange[];
    summary: {
        added: number;
        removed: number;
        modified: number;
    };
}

export interface DiffOptions {
    /** JSON paths to ignore (e.g., ['timestamp', 'updatedAt']) */
    ignorePaths?: string[];
    /** Only compare specific paths */
    includePaths?: string[];
    /** Treat arrays as sets (order doesn't matter) */
    ignoreArrayOrder?: boolean;
}

/**
 * Compute the difference between two JSON objects
 */
export function computeDiff(
    baseline: any,
    current: any,
    options: DiffOptions = {}
): DiffResult {
    const { ignorePaths = [], includePaths, ignoreArrayOrder } = options;

    // Normalize inputs
    const baselineNormalized = normalizeForDiff(baseline, { ignoreArrayOrder });
    const currentNormalized = normalizeForDiff(current, { ignoreArrayOrder });

    // Compute raw patch operations
    const operations = compare(baselineNormalized, currentNormalized);

    // Filter operations based on options
    const filteredOps = operations.filter(op => {
        const path = op.path;

        // Check ignore paths
        for (const ignorePath of ignorePaths) {
            if (path.includes(`/${ignorePath}`) || path.endsWith(`/${ignorePath}`)) {
                return false;
            }
        }

        // Check include paths (if specified)
        if (includePaths && includePaths.length > 0) {
            return includePaths.some(incPath => path.startsWith(`/${incPath}`));
        }

        return true;
    });

    // Build result
    const changes: DiffChange[] = filteredOps.map(op => {
        const change: DiffChange = {
            op: op.op as 'add' | 'remove' | 'replace',
            path: op.path,
        };

        if ('value' in op) {
            change.value = op.value;
        }

        // For 'replace' and 'remove', get the old value from baseline
        if (op.op === 'replace' || op.op === 'remove') {
            change.oldValue = getValueAtPath(baselineNormalized, op.path);
        }

        return change;
    });

    const summary = {
        added: changes.filter(c => c.op === 'add').length,
        removed: changes.filter(c => c.op === 'remove').length,
        modified: changes.filter(c => c.op === 'replace').length,
    };

    return {
        hasChanges: changes.length > 0,
        changeCount: changes.length,
        changes,
        summary,
    };
}

/**
 * Check if a specific path has changed
 */
export function hasChange(diff: DiffResult, path: string): boolean {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return diff.changes.some(c => c.path === normalizedPath || c.path.startsWith(`${normalizedPath}/`));
}

/**
 * Get the new value at a path (from current state)
 */
export function getNewValue(diff: DiffResult, path: string): any {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const change = diff.changes.find(c => c.path === normalizedPath);
    return change?.value;
}

/**
 * Get the old value at a path (from baseline state)
 */
export function getOldValue(diff: DiffResult, path: string): any {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const change = diff.changes.find(c => c.path === normalizedPath);
    return change?.oldValue;
}

/**
 * Calculate percentage change for numeric values
 */
export function percentageChange(diff: DiffResult, path: string): number | null {
    const oldVal = getOldValue(diff, path);
    const newVal = getNewValue(diff, path);

    if (typeof oldVal === 'number' && typeof newVal === 'number' && oldVal !== 0) {
        return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
    }
    return null;
}

/**
 * Normalize an object for consistent diffing
 */
function normalizeForDiff(obj: any, options: { ignoreArrayOrder?: boolean } = {}): any {
    if (obj === null || obj === undefined) {
        return null;
    }

    if (typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        const normalized = obj.map(item => normalizeForDiff(item, options));
        if (options.ignoreArrayOrder) {
            // Sort arrays by JSON stringification for consistent comparison
            return normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        }
        return normalized;
    }

    // Object: sort keys for consistent comparison
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = normalizeForDiff(obj[key], options);
    }
    return sorted;
}

/**
 * Get value at a JSON path
 */
function getValueAtPath(obj: any, path: string): any {
    const parts = path.split('/').filter(p => p !== '');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (Array.isArray(current)) {
            const index = parseInt(part, 10);
            current = current[index];
        } else if (typeof current === 'object') {
            current = current[part];
        } else {
            return undefined;
        }
    }

    return current;
}

/**
 * Create a human-readable summary of changes
 */
export function formatDiffSummary(diff: DiffResult): string {
    if (!diff.hasChanges) {
        return 'No changes detected.';
    }

    const parts: string[] = [];
    if (diff.summary.added > 0) {
        parts.push(`${diff.summary.added} added`);
    }
    if (diff.summary.removed > 0) {
        parts.push(`${diff.summary.removed} removed`);
    }
    if (diff.summary.modified > 0) {
        parts.push(`${diff.summary.modified} modified`);
    }

    return `${diff.changeCount} changes: ${parts.join(', ')}.`;
}




