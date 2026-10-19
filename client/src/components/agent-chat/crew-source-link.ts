/**
 * Repairs links emitted by older crew turns whose model invented a Google host
 * for an internal Oddjob knowledge route. New turns receive exact, document-
 * specific relative URLs from search_unified_knowledge.
 */
export function normalizeCrewSourceHref(href?: string): string | undefined {
  if (!href) return href;

  try {
    const url = new URL(href, window.location.origin);
    if (url.hostname === 'oddjob.google.com' && url.pathname.startsWith('/knowledge/')) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return href;
  }

  return href;
}
