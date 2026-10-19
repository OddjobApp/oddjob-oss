/**
 * Endpoint Parser — Express router registration extraction
 *
 * Scans route files for Express Router() definitions and extracts
 * all HTTP method registrations (get/post/put/delete/patch).
 */

export interface ParsedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  filePath: string;
  domain: string;
  routerPrefix: string; // base path from router mount
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/**
 * Extract the domain name from a route file path.
 *
 * Pattern: `server/domain/<DOMAIN>/routes/...` → `<DOMAIN>`
 * Fallback: "unknown"
 */
export function extractDomainFromRoutePath(filePath: string): string {
  // Normalize path separators to forward slashes for consistent matching
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/server\/domain\/([^/]+)\/routes\//);
  return match ? match[1] : 'unknown';
}

/**
 * Detect router variable names from file content.
 *
 * Matches patterns like:
 * - `const router = Router()`
 * - `const router = express.Router()`
 * - `export const compositionRouter = Router()`
 * - `let myRouter = Router()`
 */
function detectRouterVariableNames(content: string): string[] {
  const names: string[] = [];

  // Pattern 1: const/let <name> = [express.]Router()
  const routerDeclRegex = /(?:const|let)\s+(\w+)\s*=\s*(?:express\.)?[Rr]outer\(\)/g;
  let match: RegExpExecArray | null;
  while ((match = routerDeclRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  // Pattern 2: export const/default <name> = Router()
  const exportRouterRegex = /export\s+(?:const|default)\s+(\w+)\s*=\s*(?:express\.)?[Rr]outer\(\)/g;
  while ((match = exportRouterRegex.exec(content)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }

  return names;
}

/**
 * Detect the router mount prefix from file content.
 *
 * Looks for patterns like:
 * - `app.use("/api/missions", router)`
 * - `const PREFIX = "/api/schedules"`
 * - Falls back to deriving from domain: `/api/<domain>`
 */
function detectRouterPrefix(content: string, domain: string): string {
  // Pattern 1: app.use("<prefix>", <routerVar>)
  const appUseMatch = content.match(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,/);
  if (appUseMatch) {
    return appUseMatch[1];
  }

  // Pattern 2: const PREFIX = "/api/..."
  const prefixConstMatch = content.match(/(?:const|let)\s+(?:PREFIX|prefix|BASE_PATH|basePath)\s*=\s*["'`](\/api\/[^"'`]+)["'`]/);
  if (prefixConstMatch) {
    return prefixConstMatch[1];
  }

  // Fallback: derive from domain name
  if (domain && domain !== 'unknown') {
    return `/api/${domain}`;
  }

  return '/api';
}

/**
 * Parse an Express route file and extract all endpoint registrations.
 *
 * @param content - The file content as a string
 * @param filePath - The absolute or relative path to the file
 * @param domain - The domain name (can be auto-extracted from filePath if empty)
 * @returns Array of parsed endpoint definitions
 */
export function parseEndpointFile(content: string, filePath: string, domain: string): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];

  // Resolve domain from file path if not provided
  const resolvedDomain = domain || extractDomainFromRoutePath(filePath);

  // Detect router variable names
  const routerVarNames = detectRouterVariableNames(content);

  // Detect router prefix
  const routerPrefix = detectRouterPrefix(content, resolvedDomain);

  // Build regex pattern for matching route registrations
  // Matches: <routerVar>.<method>("<path>", ...)
  // The router var can be: any detected variable name, or common patterns like "router", "*Router"
  const varPattern = routerVarNames.length > 0
    ? `(?:${routerVarNames.map(escapeRegex).join('|')}|router|\\w+Router)`
    : '(?:router|\\w+Router)';

  const routeRegex = new RegExp(
    `${varPattern}\\.(get|post|put|delete|patch)\\(\\s*["'\`]([^"'\`]+)["'\`]`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase() as HttpMethod;
    const routePath = match[2];

    // Validate method
    if (!VALID_METHODS.has(match[1].toLowerCase())) {
      continue;
    }

    // Build full path: prepend /api prefix if not already present
    let fullPath: string;
    if (routePath.startsWith('/api')) {
      fullPath = routePath;
    } else {
      // Ensure the path starts with /
      const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
      fullPath = `/api${normalizedPath}`;
    }

    endpoints.push({
      method,
      path: fullPath,
      filePath,
      domain: resolvedDomain,
      routerPrefix,
    });
  }

  return endpoints;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
