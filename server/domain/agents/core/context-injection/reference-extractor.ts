/**
 * Reference Extractor — Parses implementation plans into extractable code references.
 *
 * Handles two input formats:
 * 1. Structured plans (objects with tasks, file_targets, acceptance_criteria)
 * 2. String plans (markdown/text with file paths, function declarations, type definitions)
 */

import type { ExtractedReferences } from "./types.js";

// --- Regex patterns for string plan parsing ---

/** Matches file paths like server/routes/users.ts, client/src/App.tsx, src/lib/utils.js */
const FILE_PATH_PATTERN = /(?:^|[\s`"'(])((server|client|src|shared|packages|tests|lib)\/[\w./-]+\.(tsx|ts|jsx|js|mjs|cjs))/gm;

/** Matches function declarations: function X, export function X, async function X, export async function X */
const FUNCTION_DECL_PATTERN = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

/** Matches arrow/const function patterns: const X =, export const X = */
const CONST_FUNCTION_PATTERN = /(?:export\s+)?const\s+(\w+)\s*=/g;

/** Matches method references like obj.method() */
const METHOD_REF_PATTERN = /(\w+)\.(\w+)\s*\(/g;

/** Matches class declarations: class X, export class X, abstract class X */
const CLASS_PATTERN = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;

/** Matches PascalCase identifiers ending with common service suffixes */
const CLASS_SUFFIX_PATTERN = /\b([A-Z][a-zA-Z]+(?:Service|Controller|Module|Factory|Handler))\b/g;

/** Matches interface/type declarations: interface X, export interface X, type X, export type X */
const TYPE_PATTERN = /(?:export\s+)?(?:interface|type)\s+(\w+)/g;

/** Matches PascalCase identifiers ending with common type suffixes */
const TYPE_SUFFIX_PATTERN = /\b([A-Z][a-zA-Z]+(?:Props|Config|Options|Result|State|Params|Payload|Response|Request))\b/g;

/** Matches scoped module names: @scope/package, @server/..., @domain/... */
const SCOPED_MODULE_PATTERN = /@[\w-]+\/[\w-]+(?:\/[\w-]+)*/g;

/** Matches from "..." or from '...' import paths */
const IMPORT_FROM_PATTERN = /from\s+["']([^"']+)["']/g;

/**
 * Extracts code references from an implementation plan.
 *
 * @param plan - Either a structured plan object or a string (markdown/text) plan
 * @returns Deduplicated references organized by category
 */
export function extractReferences(plan: string | object): ExtractedReferences {
    const result: ExtractedReferences = {
        filePaths: [],
        functionNames: [],
        classNames: [],
        moduleNames: [],
        typeNames: [],
    };

    if (!plan) {
        return result;
    }

    if (typeof plan === "string") {
        return extractFromString(plan);
    }

    return extractFromStructured(plan as Record<string, unknown>);
}

/**
 * Extracts references from a string plan using regex pattern matching.
 */
function extractFromString(text: string): ExtractedReferences {
    const filePaths = new Set<string>();
    const functionNames = new Set<string>();
    const classNames = new Set<string>();
    const moduleNames = new Set<string>();
    const typeNames = new Set<string>();

    // Extract file paths
    for (const match of text.matchAll(FILE_PATH_PATTERN)) {
        filePaths.add(match[1]);
    }

    // Extract type names (must come before function/const to avoid overlap)
    for (const match of text.matchAll(TYPE_PATTERN)) {
        typeNames.add(match[1]);
    }

    // Extract PascalCase type-suffix identifiers (Props, Config, Options, Result, etc.)
    for (const match of text.matchAll(TYPE_SUFFIX_PATTERN)) {
        typeNames.add(match[1]);
    }

    // Extract class names
    for (const match of text.matchAll(CLASS_PATTERN)) {
        classNames.add(match[1]);
    }

    // Extract PascalCase class-suffix identifiers (Service, Controller, Module, etc.)
    for (const match of text.matchAll(CLASS_SUFFIX_PATTERN)) {
        const name = match[1];
        if (!typeNames.has(name)) {
            classNames.add(name);
        }
    }

    // Extract function declarations
    for (const match of text.matchAll(FUNCTION_DECL_PATTERN)) {
        functionNames.add(match[1]);
    }

    // Extract const/arrow function names
    for (const match of text.matchAll(CONST_FUNCTION_PATTERN)) {
        const name = match[1];
        // Skip names already captured as types or classes
        if (!typeNames.has(name) && !classNames.has(name)) {
            functionNames.add(name);
        }
    }

    // Extract method references (obj.method())
    for (const match of text.matchAll(METHOD_REF_PATTERN)) {
        const methodName = match[2];
        // Skip common noise like console.log, Object.keys, etc.
        const noiseObjects = new Set(["console", "Object", "Array", "JSON", "Math", "Promise", "Date", "String", "Number", "RegExp"]);
        if (!noiseObjects.has(match[1]) && !typeNames.has(methodName) && !classNames.has(methodName)) {
            functionNames.add(methodName);
        }
    }

    // Extract scoped module names (@scope/package, @server/..., @domain/...)
    for (const match of text.matchAll(SCOPED_MODULE_PATTERN)) {
        moduleNames.add(match[0]);
    }

    // Extract import-from module paths
    for (const match of text.matchAll(IMPORT_FROM_PATTERN)) {
        moduleNames.add(match[1]);
    }

    return {
        filePaths: [...filePaths],
        functionNames: [...functionNames],
        classNames: [...classNames],
        moduleNames: [...moduleNames],
        typeNames: [...typeNames],
    };
}

/**
 * Extracts references from a structured plan object.
 * Handles objects with known fields (tasks, file_targets, acceptance_criteria)
 * and recursively processes other string values.
 */
function extractFromStructured(plan: Record<string, unknown>): ExtractedReferences {
    const filePaths = new Set<string>();
    const functionNames = new Set<string>();
    const classNames = new Set<string>();
    const moduleNames = new Set<string>();
    const typeNames = new Set<string>();

    // Direct file_targets field
    if (Array.isArray(plan.file_targets)) {
        for (const target of plan.file_targets) {
            if (typeof target === "string") {
                filePaths.add(target);
            }
        }
    }

    // Collect all text content from known string/array fields
    const textSources: string[] = [];

    if (Array.isArray(plan.tasks)) {
        for (const task of plan.tasks) {
            if (typeof task === "string") {
                textSources.push(task);
            } else if (task && typeof task === "object") {
                collectStringsRecursive(task as Record<string, unknown>, textSources);
            }
        }
    }

    if (Array.isArray(plan.acceptance_criteria)) {
        for (const criterion of plan.acceptance_criteria) {
            if (typeof criterion === "string") {
                textSources.push(criterion);
            } else if (criterion && typeof criterion === "object") {
                collectStringsRecursive(criterion as Record<string, unknown>, textSources);
            }
        }
    }

    // Process any other fields recursively
    for (const [key, value] of Object.entries(plan)) {
        if (key === "file_targets" || key === "tasks" || key === "acceptance_criteria") {
            continue;
        }
        if (typeof value === "string") {
            textSources.push(value);
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string") {
                    textSources.push(item);
                } else if (item && typeof item === "object") {
                    collectStringsRecursive(item as Record<string, unknown>, textSources);
                }
            }
        } else if (value && typeof value === "object") {
            collectStringsRecursive(value as Record<string, unknown>, textSources);
        }
    }

    // Parse combined text for patterns
    const combinedText = textSources.join("\n");
    const parsed = extractFromString(combinedText);

    // Merge file_targets with parsed file paths
    for (const fp of parsed.filePaths) {
        filePaths.add(fp);
    }

    return {
        filePaths: [...filePaths],
        functionNames: parsed.functionNames,
        classNames: parsed.classNames,
        moduleNames: parsed.moduleNames,
        typeNames: parsed.typeNames,
    };
}

/**
 * Recursively collects all string values from a nested object.
 */
function collectStringsRecursive(obj: Record<string, unknown>, out: string[]): void {
    for (const value of Object.values(obj)) {
        if (typeof value === "string") {
            out.push(value);
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string") {
                    out.push(item);
                } else if (item && typeof item === "object") {
                    collectStringsRecursive(item as Record<string, unknown>, out);
                }
            }
        } else if (value && typeof value === "object") {
            collectStringsRecursive(value as Record<string, unknown>, out);
        }
    }
}
