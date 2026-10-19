/**
 * Multi-SPA Utility Functions
 * Used to manage navigation and entry point identification across the hybrid architecture.
 *
 * Route ownership comes from shared/spa-routes.ts, the same manifest the server
 * uses to pick a bundle, so "is this a cross-SPA navigation?" cannot disagree
 * with what the server will actually serve.
 */
import { resolveSpaTemplate, SPA_ROUTES, type SpaTemplate } from "@shared/spa-routes";

type SpaEntry = 'auth' | 'operations' | 'intelligence' | 'knowledge' | 'armory';

const ENTRY_FOR_TEMPLATE: Record<SpaTemplate, SpaEntry> = {
  "login.html": "auth",
  "knowledge.html": "knowledge",
  "operations.html": "operations",
  "intelligence.html": "intelligence",
  "armory.html": "armory",
};

function prefixesFor(template: SpaTemplate): string[] {
  return [...(SPA_ROUTES.find((r) => r.template === template)?.prefixes ?? [])];
}

// The route prefixes owned by each SPA entry point.
export const SPA_ENTRIES = {
  AUTH: prefixesFor("login.html"),
  KNOWLEDGE: prefixesFor("knowledge.html"),
  OPERATIONS: prefixesFor("operations.html"),
  INTELLIGENCE: prefixesFor("intelligence.html"),
  ARMORY: prefixesFor("armory.html"),
};

/**
 * Identifies which SPA entry point should handle a given URL.
 */
export function getEntryForUrl(url: string): SpaEntry {
  // Normalize URL
  const path = url.split('?')[0].split('#')[0];
  const template = resolveSpaTemplate(path);
  // Unmatched paths use the public 404 in login.html, matching the server.
  return template ? ENTRY_FOR_TEMPLATE[template] : 'auth';
}

/**
 * Returns the logical entry point for the current browser location.
 */
export function getCurrentEntry(): SpaEntry {
  if (typeof window === 'undefined') return 'auth';
  return getEntryForUrl(window.location.pathname);
}

/**
 * Determines if a navigation target requires a hard reload (cross-SPA transition).
 */
export function isCrossEntryNav(targetUrl: string): boolean {
  if (typeof window === 'undefined') return false;

  const currentEntry = getCurrentEntry();
  const targetEntry = getEntryForUrl(targetUrl);

  return currentEntry !== targetEntry;
}
