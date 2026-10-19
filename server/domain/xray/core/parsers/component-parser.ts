/**
 * Component Parser
 *
 * Extracts React component exports from files under client/src/components/.
 * Handles default exports, named exports (PascalCase only), barrel file detection,
 * and import specifier extraction for dependency edge building.
 */

import path from "node:path";

export interface ParsedComponent {
  name: string;                  // PascalCase export name
  filePath: string;
  isDefault: boolean;
  parentDir: string;             // immediate parent under client/src/components/
  imports: string[];             // imported module specifiers
}

/**
 * Determines if a file is a barrel file (contains only re-export statements).
 * Barrel files (index.ts/index.tsx) that just re-export from other modules are excluded
 * from component node creation.
 */
export function isBarrelFile(content: string): boolean {
  const lines = content.split("\n");
  const meaningfulLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip empty lines
    if (trimmed === "") return false;
    // Skip single-line comments
    if (trimmed.startsWith("//")) return false;
    // Skip block comment lines (crude but sufficient for this purpose)
    if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) return false;
    return true;
  });

  // If no meaningful lines, not a barrel (just empty)
  if (meaningfulLines.length === 0) return false;

  // A barrel file has ALL meaningful lines as re-export statements
  const reExportPattern = /^export\s+(?:\{[^}]*\}\s+from\s+["'][^"']+["']|.*\*\s+(?:as\s+\w+\s+)?from\s+["'][^"']+["'])\s*;?\s*$/;

  return meaningfulLines.every((line) => reExportPattern.test(line.trim()));
}

/**
 * Extracts the first directory segment after `components/` from a file path.
 * Normalizes path separators to forward slashes before extraction.
 *
 * Example: `client/src/components/ui/button.tsx` → `ui`
 * Example: `client/src/components/admin/forms/Input.tsx` → `admin`
 */
export function extractParentDir(filePath: string): string {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "components/";
  const idx = normalized.indexOf(marker);
  if (idx === -1) {
    // Fallback: use the immediate parent directory name
    return path.basename(path.dirname(filePath));
  }
  const afterComponents = normalized.slice(idx + marker.length);
  const firstSegment = afterComponents.split("/")[0];
  return firstSegment || path.basename(path.dirname(filePath));
}

/**
 * Parses a component file and extracts component information.
 *
 * Returns null if:
 * - The file is a barrel file (only re-exports)
 * - No PascalCase exports are found
 *
 * @param content - The file content as a string
 * @param filePath - The path to the file (used for fallback naming)
 * @param parentDir - The parent directory under components/ (for grouping)
 */
export function parseComponentFile(
  content: string,
  filePath: string,
  parentDir: string
): ParsedComponent | null {
  // Step 1: Skip barrel files
  if (isBarrelFile(content)) {
    return null;
  }

  // Step 2: Extract imports for dependency edge building
  const imports = extractImports(content);

  // Step 3: Try to find default export name
  let defaultExportName: string | null = null;
  let hasDefaultExport = false;

  // Named default export: export default function ComponentName
  const namedDefaultFnMatch = content.match(
    /export\s+default\s+function\s+([A-Z]\w*)/
  );
  if (namedDefaultFnMatch) {
    defaultExportName = namedDefaultFnMatch[1];
    hasDefaultExport = true;
  }

  // Reference default export: export default ComponentName (referencing a declared variable/function)
  if (!defaultExportName) {
    const refDefaultMatch = content.match(
      /export\s+default\s+([A-Z]\w*)\s*;?/
    );
    if (refDefaultMatch) {
      // Make sure it's not "export default function" (already handled) or "export default class"
      const fullLine = content.slice(
        Math.max(0, content.indexOf(refDefaultMatch[0]) - 10),
        content.indexOf(refDefaultMatch[0]) + refDefaultMatch[0].length + 10
      );
      if (!/export\s+default\s+(?:function|class)\s/.test(fullLine)) {
        defaultExportName = refDefaultMatch[1];
        hasDefaultExport = true;
      }
    }
  }

  // Anonymous default export: export default function( or export default () =>
  if (!hasDefaultExport) {
    const anonDefaultMatch = content.match(
      /export\s+default\s+(?:function\s*\(|(?:memo|forwardRef)\s*\(|\([^)]*\)\s*=>)/
    );
    if (anonDefaultMatch) {
      hasDefaultExport = true;
      // Name will be derived from filename
    }
  }

  // Step 4: Find named PascalCase exports
  const namedExports: string[] = [];
  const namedExportPattern = /export\s+(?:const|function)\s+([A-Z]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = namedExportPattern.exec(content)) !== null) {
    namedExports.push(match[1]);
  }

  // Step 5: Determine the component name
  let componentName: string | null = null;
  let isDefault = false;

  if (defaultExportName && isPascalCase(defaultExportName)) {
    componentName = defaultExportName;
    isDefault = true;
  } else if (namedExports.length > 0) {
    // Use the first PascalCase named export
    componentName = namedExports[0];
    isDefault = false;
  } else if (hasDefaultExport) {
    // Fallback: use filename without extension, capitalize first letter
    componentName = filenameToComponentName(filePath);
    isDefault = true;
  }

  // If no component name found, skip this file
  if (!componentName) {
    return null;
  }

  return {
    name: componentName,
    filePath,
    isDefault,
    parentDir,
    imports,
  };
}

/**
 * Checks if a name starts with an uppercase letter (PascalCase convention).
 */
function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Extracts module specifiers from ES import statements.
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importPattern =
    /import\s+(?:\{[^}]+\}|\w+(?:\s*,\s*\{[^}]+\})?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

/**
 * Derives a component name from a file path by taking the filename without extension
 * and capitalizing the first letter.
 */
function filenameToComponentName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? "Component";
  const nameWithoutExt = basename.replace(/\.\w+$/, "");
  // Capitalize first letter
  return nameWithoutExt.charAt(0).toUpperCase() + nameWithoutExt.slice(1);
}
