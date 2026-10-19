/**
 * Route Parser — extracts screen-level routes from React/Wouter route definition files.
 *
 * Supports:
 * - Self-closing: <Route path="/dashboard" component={Dashboard} />
 * - Multi-line with children: <Route path="/r/:token">...</Route>
 * - React Router v6 element prop: <Route path="/foo" element={<Foo />} />
 * - Both single and double quotes for path values
 *
 * Excludes:
 * - Routes with wildcard catch-all pattern `:rest*`
 * - Routes that render only <Redirect> or <Reload /> elements
 * - Routes with no component/element prop and no meaningful children
 */

export interface ParsedRoute {
  path: string;
  componentName: string | null;
  filePath: string;
  domain: string;
}

/**
 * Extract the domain/module name from a file path.
 *
 * - `server/domain/<DOMAIN>/ui/...` → DOMAIN
 * - `client/src/modules/<MODULE>/...` → MODULE
 * - Fallback: "unknown"
 */
export function extractDomainFromPath(filePath: string): string {
  // Normalize to forward slashes for cross-platform matching
  const normalized = filePath.replace(/\\/g, "/");

  // Match server/domain/<DOMAIN>/ui/...
  const serverMatch = normalized.match(/server\/domain\/([^/]+)\/ui\//);
  if (serverMatch) {
    return serverMatch[1];
  }

  // Match client/src/modules/<MODULE>/...
  const clientMatch = normalized.match(/client\/src\/modules\/([^/]+)\//);
  if (clientMatch) {
    return clientMatch[1];
  }

  return "unknown";
}

/**
 * Parse a route definition file and return qualifying routes.
 *
 * A qualifying route:
 * 1. Has a `path` attribute
 * 2. Does NOT contain `:rest*` in the path (wildcard catch-all)
 * 3. Is NOT a Redirect or Reload-only route
 * 4. Has a component prop, element prop, or meaningful children (LazyRoute, etc.)
 */
export function parseRouteFile(content: string, filePath: string, domain: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  // Pattern 1: Self-closing <Route ... /> (single line or multi-line attributes)
  // Pattern 2: <Route ...>...</Route> (with children)
  //
  // We use a two-pass approach:
  //   Pass A: Match self-closing routes
  //   Pass B: Match routes with children (opening tag + content + closing tag)

  // Pass A: Self-closing <Route ... />
  // The attrs group captures everything up to the closing />, ensuring we don't
  // accidentally match open-close routes.
  const selfClosingRegex = /<Route\s+((?:[^>]|>(?![\s\S]*<\/Route>))*?)\/>/gs;
  let match: RegExpExecArray | null;

  while ((match = selfClosingRegex.exec(content)) !== null) {
    const attrs = match[1];
    const parsed = parseRouteAttributes(attrs, null);
    if (parsed) {
      routes.push({ ...parsed, filePath, domain });
    }
  }

  // Pass B: <Route ...>...</Route>
  // Use a negative lookbehind-style approach: match attrs that end with a non-slash
  // character before >, ensuring we only match non-self-closing Route tags.
  const openCloseRegex = /<Route\s+([^>]*?[^/])>([\s\S]*?)<\/Route>/gs;

  while ((match = openCloseRegex.exec(content)) !== null) {
    const attrs = match[1];
    const children = match[2].trim();
    const parsed = parseRouteAttributes(attrs, children);
    if (parsed) {
      routes.push({ ...parsed, filePath, domain });
    }
  }

  return routes;
}

/**
 * Parse a Route element's attributes and optional children to determine
 * if it qualifies as a screen route.
 *
 * Returns null if the route should be excluded.
 */
function parseRouteAttributes(
  attrs: string,
  children: string | null
): { path: string; componentName: string | null } | null {
  // Extract path attribute (double or single quotes)
  const pathMatch = attrs.match(/path=["']([^"']+)["']/);
  if (!pathMatch) {
    // No path attribute — skip (e.g., catch-all 404 route without path)
    return null;
  }

  const routePath = pathMatch[1];

  // Exclude wildcard catch-all patterns
  if (routePath.includes(":rest*")) {
    return null;
  }

  // Extract component prop: component={ComponentName}
  const componentMatch = attrs.match(/component=\{(\w+)\}/);

  // Extract element prop (React Router v6): element={<ComponentName ... />}
  const elementMatch = attrs.match(/element=\{<(\w+)/);

  // Determine if the route renders only Redirect or Reload
  if (children !== null) {
    // Has children content — check if it's only Redirect or Reload
    if (isRedirectOrReloadOnly(children)) {
      return null;
    }

    // Has meaningful children — extract component name from children if no component prop
    const componentName = componentMatch?.[1]
      ?? elementMatch?.[1]
      ?? extractComponentFromChildren(children);

    return { path: routePath, componentName };
  }

  // Self-closing route — must have a component or element prop to be meaningful
  if (componentMatch) {
    return { path: routePath, componentName: componentMatch[1] };
  }

  if (elementMatch) {
    return { path: routePath, componentName: elementMatch[1] };
  }

  // Self-closing with no component/element — skip
  return null;
}

/**
 * Check if children content is only a Redirect or Reload element.
 */
function isRedirectOrReloadOnly(children: string): boolean {
  const trimmed = children.trim();

  // Check for <Redirect ... /> or <Redirect ...>...</Redirect>
  if (/^\s*<Redirect[\s/>]/.test(trimmed)) {
    return true;
  }

  // Check for <Reload /> or <Reload>...</Reload>
  if (/^\s*<Reload[\s/>]/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Try to extract a component name from children JSX.
 * E.g., <LazyRoute component={RescuePublicPage} /> → "RescuePublicPage"
 * Or any JSX component reference in children.
 */
function extractComponentFromChildren(children: string): string | null {
  // Match <LazyRoute component={Name} /> pattern
  const lazyMatch = children.match(/component=\{(\w+)\}/);
  if (lazyMatch) {
    return lazyMatch[1];
  }

  // Match any PascalCase JSX element in children: <SomeComponent ... />
  const jsxMatch = children.match(/<([A-Z]\w+)/);
  if (jsxMatch) {
    return jsxMatch[1];
  }

  return null;
}
