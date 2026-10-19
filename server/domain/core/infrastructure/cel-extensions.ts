/**
 * CEL String Extensions
 * 
 * Provides text manipulation and diff inspection functions
 * for use in Decision Node conditions and Pipeline Triggers.
 */

import type { DiffResult } from './diff-service.js';

/**
 * Text utility functions for CEL expressions
 */
export const textFunctions = {
    /**
     * Check if a string contains a substring (case-sensitive)
     */
    contains(str: string | null | undefined, search: string): boolean {
        if (!str) return false;
        return String(str).includes(search);
    },

    /**
     * Check if a string contains a substring (case-insensitive)
     */
    containsIgnoreCase(str: string | null | undefined, search: string): boolean {
        if (!str) return false;
        return String(str).toLowerCase().includes(search.toLowerCase());
    },

    /**
     * Check if a string matches a regex pattern
     */
    matches(str: string | null | undefined, pattern: string): boolean {
        if (!str) return false;
        try {
            const regex = new RegExp(pattern);
            return regex.test(String(str));
        } catch {
            return false;
        }
    },

    /**
     * Convert string to lowercase
     */
    lower(str: string | null | undefined): string {
        return str ? String(str).toLowerCase() : '';
    },

    /**
     * Convert string to uppercase
     */
    upper(str: string | null | undefined): string {
        return str ? String(str).toUpperCase() : '';
    },

    /**
     * Trim whitespace from string
     */
    trim(str: string | null | undefined): string {
        return str ? String(str).trim() : '';
    },

    /**
     * Check if string starts with prefix
     */
    startsWith(str: string | null | undefined, prefix: string): boolean {
        if (!str) return false;
        return String(str).startsWith(prefix);
    },

    /**
     * Check if string ends with suffix
     */
    endsWith(str: string | null | undefined, suffix: string): boolean {
        if (!str) return false;
        return String(str).endsWith(suffix);
    },

    /**
     * Get string length
     */
    len(str: string | null | undefined): number {
        return str ? String(str).length : 0;
    },

    /**
     * Split string by delimiter
     */
    split(str: string | null | undefined, delimiter: string): string[] {
        if (!str) return [];
        return String(str).split(delimiter);
    },

    /**
     * Replace occurrences in string
     */
    replace(str: string | null | undefined, search: string, replacement: string): string {
        if (!str) return '';
        return String(str).replaceAll(search, replacement);
    },

    /**
     * Extract substring
     */
    substring(str: string | null | undefined, start: number, end?: number): string {
        if (!str) return '';
        return String(str).substring(start, end);
    },

    /**
     * Check if string is empty or whitespace only
     */
    isEmpty(str: string | null | undefined): boolean {
        if (!str) return true;
        return String(str).trim().length === 0;
    },

    /**
     * Check if string is not empty
     */
    isNotEmpty(str: string | null | undefined): boolean {
        return !this.isEmpty(str);
    },
};

/**
 * Diff utility functions for CEL expressions
 */
export const diffFunctions = {
    /**
     * Check if a specific path has changed
     */
    hasChange(diff: DiffResult | null | undefined, path: string): boolean {
        if (!diff || !diff.changes) return false;
        const normalizedPath = path.startsWith('/') ? path : `/${path.replace(/\./g, '/')}`;
        return diff.changes.some(c =>
            c.path === normalizedPath ||
            c.path.startsWith(`${normalizedPath}/`)
        );
    },

    /**
     * Check if there are any changes
     */
    hasChanges(diff: DiffResult | null | undefined): boolean {
        return diff?.hasChanges ?? false;
    },

    /**
     * Get the number of changes
     */
    changeCount(diff: DiffResult | null | undefined): number {
        return diff?.changeCount ?? 0;
    },

    /**
     * Get the new value at a path
     */
    value(diff: DiffResult | null | undefined, path: string): any {
        if (!diff || !diff.changes) return undefined;
        const normalizedPath = path.startsWith('/') ? path : `/${path.replace(/\./g, '/')}`;
        const change = diff.changes.find(c => c.path === normalizedPath);
        return change?.value;
    },

    /**
     * Get the old value at a path
     */
    oldValue(diff: DiffResult | null | undefined, path: string): any {
        if (!diff || !diff.changes) return undefined;
        const normalizedPath = path.startsWith('/') ? path : `/${path.replace(/\./g, '/')}`;
        const change = diff.changes.find(c => c.path === normalizedPath);
        return change?.oldValue;
    },

    /**
     * Calculate percentage change for numeric values
     */
    percentageChange(diff: DiffResult | null | undefined, path: string): number | null {
        const oldVal = this.oldValue(diff, path);
        const newVal = this.value(diff, path);

        if (typeof oldVal === 'number' && typeof newVal === 'number' && oldVal !== 0) {
            return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
        }
        return null;
    },

    /**
     * Get count of added items
     */
    addedCount(diff: DiffResult | null | undefined): number {
        return diff?.summary?.added ?? 0;
    },

    /**
     * Get count of removed items
     */
    removedCount(diff: DiffResult | null | undefined): number {
        return diff?.summary?.removed ?? 0;
    },

    /**
     * Get count of modified items
     */
    modifiedCount(diff: DiffResult | null | undefined): number {
        return diff?.summary?.modified ?? 0;
    },

    /**
     * Get all changed paths
     */
    changedPaths(diff: DiffResult | null | undefined): string[] {
        if (!diff || !diff.changes) return [];
        return diff.changes.map(c => c.path);
    },
};

/**
 * List/Array utility functions for CEL expressions
 */
export const listFunctions = {
    /**
     * Check if array contains an item
     */
    contains(arr: any[] | null | undefined, item: any): boolean {
        if (!arr || !Array.isArray(arr)) return false;
        return arr.includes(item);
    },

    /**
     * Get array length
     */
    size(arr: any[] | null | undefined): number {
        if (!arr || !Array.isArray(arr)) return 0;
        return arr.length;
    },

    /**
     * Check if array is empty
     */
    isEmpty(arr: any[] | null | undefined): boolean {
        if (!arr || !Array.isArray(arr)) return true;
        return arr.length === 0;
    },

    /**
     * Get first element
     */
    first(arr: any[] | null | undefined): any {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return undefined;
        return arr[0];
    },

    /**
     * Get last element
     */
    last(arr: any[] | null | undefined): any {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return undefined;
        return arr[arr.length - 1];
    },

    /**
     * Check if any element satisfies a condition (via property check)
     */
    any(arr: any[] | null | undefined, property: string, value: any): boolean {
        if (!arr || !Array.isArray(arr)) return false;
        return arr.some(item => item?.[property] === value);
    },

    /**
     * Check if all elements satisfy a condition (via property check)
     */
    all(arr: any[] | null | undefined, property: string, value: any): boolean {
        if (!arr || !Array.isArray(arr)) return false;
        return arr.every(item => item?.[property] === value);
    },

    /**
     * Filter array by property value
     */
    filter(arr: any[] | null | undefined, property: string, value: any): any[] {
        if (!arr || !Array.isArray(arr)) return [];
        return arr.filter(item => item?.[property] === value);
    },

    /**
     * Get unique values from array
     */
    unique(arr: any[] | null | undefined): any[] {
        if (!arr || !Array.isArray(arr)) return [];
        return [...new Set(arr)];
    },

    /**
     * Sum numeric values in array
     */
    sum(arr: number[] | null | undefined): number {
        if (!arr || !Array.isArray(arr)) return 0;
        return arr.reduce((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
    },

    /**
     * Get average of numeric values
     */
    avg(arr: number[] | null | undefined): number {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
        return this.sum(arr) / arr.length;
    },

    /**
     * Get min value
     */
    min(arr: number[] | null | undefined): number | undefined {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return undefined;
        return Math.min(...arr.filter(v => typeof v === 'number'));
    },

    /**
     * Get max value
     */
    max(arr: number[] | null | undefined): number | undefined {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return undefined;
        return Math.max(...arr.filter(v => typeof v === 'number'));
    },
};

/**
 * Create the CEL context with all utility functions
 */
export function createCELContext(additionalContext: Record<string, any> = {}): Record<string, any> {
    return {
        text: textFunctions,
        diff: diffFunctions,
        list: listFunctions,
        ...additionalContext,
    };
}

/**
 * Evaluate a CEL-like expression with the extended context
 * This is a simplified evaluator - for production, consider using a proper CEL library
 */
export function evaluateExpression(
    expression: string,
    context: Record<string, any>
): boolean {
    try {
        // Build the evaluation context
        const fullContext = createCELContext(context);

        // Create a function that evaluates the expression in the context
        const contextKeys = Object.keys(fullContext);
        const contextValues = Object.values(fullContext);

        // Wrap in a function and evaluate
        const fn = new Function(...contextKeys, `return (${expression});`);
        const result = fn(...contextValues);

        return Boolean(result);
    } catch (error) {
        console.error('[CEL] Expression evaluation error:', error);
        return false;
    }
}




