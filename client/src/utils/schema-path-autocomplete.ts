import type { FieldDefinition, JobOutputSchema } from "@shared/schema/jobs/types";

export interface PathSuggestion {
  path: string;              // Full path (e.g., "user.name")
  fullPath: string;          // Complete path from schema
  fieldDef: FieldDefinition; // Field definition with type, examples, etc.
  displayPath: string;       // Part to show (after current prefix)
}

/**
 * Parse a path string into segments
 * Handles: "step.0.output.category" -> ["step", "0", "output", "category"]
 */
export function parsePath(path: string): string[] {
  return path.split('.').filter(Boolean);
}

/**
 * Get the current prefix being typed
 * "step.0.output.cat" -> "step.0.output"
 */
export function getCurrentPrefix(path: string): string {
  const segments = parsePath(path);
  if (segments.length === 0) return '';
  // Remove the last segment if it's incomplete (no trailing dot)
  const lastSegment = segments[segments.length - 1];
  const hasTrailingDot = path.endsWith('.');
  if (hasTrailingDot) {
    return segments.join('.');
  }
  return segments.slice(0, -1).join('.');
}

/**
 * Get the current fragment being typed
 * "step.0.output.cat" -> "cat"
 */
export function getCurrentFragment(path: string): string {
  const segments = parsePath(path);
  if (segments.length === 0) return path;
  const hasTrailingDot = path.endsWith('.');
  if (hasTrailingDot) return '';
  return segments[segments.length - 1] || '';
}

/**
 * Find all fields that match the current path prefix
 */
export function findSchemaSuggestions(
  schema: JobOutputSchema | null | undefined,
  currentPath: string
): PathSuggestion[] {
  if (!schema || !schema.schemaDef) return [];

  const prefix = getCurrentPrefix(currentPath);
  const fragment = getCurrentFragment(currentPath).toLowerCase();
  
  const suggestions: PathSuggestion[] = [];
  const seenPaths = new Set<string>();

  // Iterate through all schema fields
  for (const [fullPath, fieldDef] of Object.entries(schema.schemaDef)) {
    if (prefix === '') {
      // Root level - show all top-level fields
      const firstDot = fullPath.indexOf('.');
      const topLevelPath = firstDot === -1 ? fullPath : fullPath.substring(0, firstDot);
      
      // Only add each top-level path once
      if (!seenPaths.has(topLevelPath)) {
        seenPaths.add(topLevelPath);
        if (topLevelPath.toLowerCase().includes(fragment)) {
          suggestions.push({
            path: topLevelPath,
            fullPath: fullPath,
            fieldDef: fieldDef,
            displayPath: topLevelPath,
          });
        }
      }
    } else {
      // Check if this field starts with the prefix
      if (fullPath.startsWith(prefix + '.')) {
        // Get the next segment after the prefix
        const remaining = fullPath.substring(prefix.length + 1);
        const nextSegment = remaining.split('.')[0];
        
        // Check if it matches the fragment
        if (nextSegment.toLowerCase().includes(fragment)) {
          // Check if we already added this suggestion
          const suggestionPath = prefix ? `${prefix}.${nextSegment}` : nextSegment;
          if (!seenPaths.has(suggestionPath)) {
            seenPaths.add(suggestionPath);
            suggestions.push({
              path: suggestionPath,
              fullPath: fullPath,
              fieldDef: fieldDef,
              displayPath: nextSegment,
            });
          }
        }
      }
    }
  }

  // Sort suggestions: exact matches first, then alphabetical
  return suggestions.sort((a, b) => {
    const aExact = a.displayPath.toLowerCase() === fragment;
    const bExact = b.displayPath.toLowerCase() === fragment;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.displayPath.localeCompare(b.displayPath);
  });
}

/**
 * Check if a path segment represents an array
 */
export function isArrayPath(path: string): boolean {
  return /\[\d*\]/.test(path) || path.endsWith('[]');
}

/**
 * Get the type badge color for a field type
 */
export function getTypeBadgeVariant(type: string): string {
  if (type.includes('array')) return 'bg-blue-100 text-blue-800';
  if (type === 'string') return 'bg-green-100 text-green-800';
  if (type === 'number') return 'bg-purple-100 text-purple-800';
  if (type === 'boolean') return 'bg-orange-100 text-orange-800';
  if (type === 'object') return 'bg-gray-100 text-gray-800';
  return 'bg-slate-100 text-slate-800';
}

