/**
 * Collector Registry & Factory
 *
 * Maintains a registry mapping SourceCollectorType -> SourceCollector instance
 * and provides a factory method to retrieve collectors by type.
 */

import type { SourceCollectorType } from "../types.js";
import type { SourceCollector } from "./collector.interface.js";
import { webScraperCollector } from "./web-scraper.collector.js";
import { AcademicSearchCollector } from "./academic-search.collector.js";
import { apiDocParserCollector } from "./api-doc-parser.collector.js";
import { codeRepoScannerCollector } from "./code-repo-scanner.collector.js";
import { documentParserCollector } from "./document-parser.collector.js";

// ─── Registry ──────────────────────────────────────────────────────────────────

const collectorRegistry = new Map<SourceCollectorType, SourceCollector>([
  ["web_scraper", webScraperCollector],
  ["academic_search", new AcademicSearchCollector()],
  ["api_documentation_parser", apiDocParserCollector],
  ["code_repository_scanner", codeRepoScannerCollector],
  ["document_parser", documentParserCollector],
]);

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Retrieve a registered SourceCollector instance by its type.
 *
 * @throws Error if the requested collector type is not registered.
 */
export function getCollector(type: SourceCollectorType): SourceCollector {
  const collector = collectorRegistry.get(type);
  if (!collector) {
    throw new Error(
      `Unknown collector type "${type}". Registered types: ${[...collectorRegistry.keys()].join(", ")}`,
    );
  }
  return collector;
}

export { collectorRegistry };
