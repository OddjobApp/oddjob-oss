/**
 * API Documentation Parser Source Collector
 *
 * Fetches API documentation (OpenAPI/Swagger specs or generic REST API docs),
 * parses endpoints, parameters, and schema descriptions, and returns
 * structured CollectorResult with timing metadata.
 *
 * Supports:
 * - OpenAPI 3.x and Swagger 2.x JSON/YAML specifications
 * - Generic HTML-based API documentation pages (text extraction)
 */

import { createLogger } from "@server/utils/logger.js";
import type { CollectorInvocation, SourceCollectorType } from "../types.js";
import type {
  CollectedContent,
  CollectorResult,
  SourceCollector,
} from "./collector.interface.js";

const logger = createLogger("ApiDocParserCollector");

/** Default timeout in ms if not specified in the invocation */
const DEFAULT_TIMEOUT_MS = 60_000;

// ─── OpenAPI/Swagger Detection & Parsing ───────────────────────────────────────

/** Minimal shape of an OpenAPI 3.x spec */
interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
  definitions?: Record<string, unknown>; // Swagger 2.x
}

/** Minimal shape of an OpenAPI operation */
interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    description?: string;
    content?: Record<string, unknown>;
  };
  responses?: Record<string, { description?: string }>;
  tags?: string[];
}

/** Minimal shape of an OpenAPI parameter */
interface OpenApiParameter {
  name?: string;
  in?: string;
  description?: string;
  required?: boolean;
  schema?: { type?: string };
}

/**
 * Attempt to parse content as a JSON-based OpenAPI/Swagger spec.
 * Returns the parsed spec or null if it doesn't look like an API spec.
 */
function tryParseOpenApiJson(text: string): OpenApiSpec | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && (parsed.openapi || parsed.swagger) && parsed.paths) {
      return parsed as OpenApiSpec;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to parse content as a YAML-based OpenAPI/Swagger spec.
 * Uses a lightweight heuristic check (no full YAML parser dependency).
 */
function tryParseOpenApiYaml(text: string): OpenApiSpec | null {
  // Check for common YAML OpenAPI markers
  const hasOpenApiMarker =
    /^openapi:\s*["']?3/m.test(text) || /^swagger:\s*["']?2/m.test(text);
  const hasPathsMarker = /^paths:/m.test(text);

  if (!hasOpenApiMarker || !hasPathsMarker) {
    return null;
  }

  // Perform basic YAML-to-JSON-like extraction for key fields
  // This is a simplified parser for spec detection; real parsing uses the JSON content
  // Most API documentation endpoints serve JSON alongside YAML
  try {
    // Extract version info
    const openapiMatch = text.match(/^openapi:\s*["']?([^"'\s\n]+)/m);
    const swaggerMatch = text.match(/^swagger:\s*["']?([^"'\s\n]+)/m);
    const titleMatch = text.match(/^\s+title:\s*["']?(.+?)["']?\s*$/m);
    const versionMatch = text.match(/^\s+version:\s*["']?(.+?)["']?\s*$/m);

    const spec: OpenApiSpec = {
      openapi: openapiMatch?.[1],
      swagger: swaggerMatch?.[1],
      info: {
        title: titleMatch?.[1]?.trim(),
        version: versionMatch?.[1]?.trim(),
      },
      paths: extractYamlPaths(text),
    };

    return spec;
  } catch {
    return null;
  }
}

/**
 * Extract path entries from YAML text using line-based heuristics.
 * Returns a Record of path -> methods with basic operation info.
 */
function extractYamlPaths(
  text: string,
): Record<string, Record<string, OpenApiOperation>> {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const lines = text.split("\n");

  let inPaths = false;
  let currentPath = "";
  let currentMethod = "";

  for (const line of lines) {
    // Detect "paths:" section start
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }

    // Exit paths section on next top-level key
    if (inPaths && /^\S/.test(line) && !line.startsWith(" ")) {
      break;
    }

    if (!inPaths) continue;

    // Match path entries (e.g., "  /users:")
    const pathMatch = line.match(/^  (\/[^:]*):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      paths[currentPath] = {};
      continue;
    }

    // Match HTTP methods (e.g., "    get:")
    const methodMatch = line.match(/^    (get|post|put|patch|delete|options|head):\s*$/);
    if (methodMatch && currentPath) {
      currentMethod = methodMatch[1];
      paths[currentPath][currentMethod] = {};
      continue;
    }

    // Match summary (e.g., "      summary: Get all users")
    const summaryMatch = line.match(/^\s{6}summary:\s*["']?(.+?)["']?\s*$/);
    if (summaryMatch && currentPath && currentMethod && paths[currentPath][currentMethod]) {
      paths[currentPath][currentMethod].summary = summaryMatch[1];
    }
  }

  return paths;
}

/**
 * Extract structured content from a parsed OpenAPI/Swagger spec.
 * Produces a human-readable text summary of endpoints, parameters, and schemas.
 */
function extractOpenApiContent(spec: OpenApiSpec): {
  content: string;
  endpointsCount: number;
  schemasCount: number;
  specVersion: string;
} {
  const sections: string[] = [];
  let endpointsCount = 0;

  // Header
  const specVersion = spec.openapi || spec.swagger || "unknown";
  const title = spec.info?.title || "Untitled API";
  const version = spec.info?.version || "";
  sections.push(`API: ${title} (v${version})`);
  sections.push(`Spec Version: ${specVersion}`);

  if (spec.info?.description) {
    sections.push(`\nDescription: ${spec.info.description}`);
  }

  // Endpoints
  sections.push("\n--- Endpoints ---\n");

  if (spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation || typeof operation !== "object") continue;

        endpointsCount++;
        const op = operation as OpenApiOperation;
        const summary = op.summary || op.description || "";
        sections.push(`${method.toUpperCase()} ${path}`);

        if (summary) {
          sections.push(`  Summary: ${summary}`);
        }

        if (op.operationId) {
          sections.push(`  Operation ID: ${op.operationId}`);
        }

        if (op.tags?.length) {
          sections.push(`  Tags: ${op.tags.join(", ")}`);
        }

        // Parameters
        if (op.parameters?.length) {
          sections.push("  Parameters:");
          for (const param of op.parameters) {
            const required = param.required ? " (required)" : "";
            const type = param.schema?.type ? `: ${param.schema.type}` : "";
            sections.push(
              `    - ${param.name} [${param.in}]${type}${required}${param.description ? ` — ${param.description}` : ""}`,
            );
          }
        }

        // Responses
        if (op.responses) {
          const responseCodes = Object.keys(op.responses).join(", ");
          sections.push(`  Responses: ${responseCodes}`);
        }

        sections.push("");
      }
    }
  }

  // Schemas
  const schemas =
    spec.components?.schemas || spec.definitions || {};
  const schemaNames = Object.keys(schemas);
  const schemasCount = schemaNames.length;

  if (schemasCount > 0) {
    sections.push("--- Schemas ---\n");
    for (const name of schemaNames) {
      sections.push(`• ${name}`);
    }
  }

  return {
    content: sections.join("\n"),
    endpointsCount,
    schemasCount,
    specVersion,
  };
}

// ─── Generic API Docs (HTML) ───────────────────────────────────────────────────

/**
 * Strip HTML tags and decode basic entities to extract readable text content.
 */
function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Extract a page title from HTML content.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match?.[1]) {
    return stripHtml(match[1]).trim();
  }
  return "";
}

// ─── Collector Implementation ──────────────────────────────────────────────────

/**
 * API Documentation Parser collector implementation.
 *
 * Fetches the URL from the invocation query, detects if it's an
 * OpenAPI/Swagger JSON/YAML spec or generic API documentation page,
 * and extracts structured content accordingly.
 */
export const apiDocParserCollector: SourceCollector = {
  type: "api_documentation_parser" as SourceCollectorType,

  async collect(invocation: CollectorInvocation): Promise<CollectorResult> {
    const startTime = new Date().toISOString();
    const timeout = invocation.timeout || DEFAULT_TIMEOUT_MS;
    const url = invocation.query;

    logger.info("Starting API documentation parse", {
      collectorId: invocation.id,
      url,
      timeout,
    });

    // Set up timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "OddjobResearchBot/1.0 (autonomous research ingestion)",
          Accept:
            "application/json,application/x-yaml,text/yaml,text/html,*/*;q=0.8",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const endTime = new Date().toISOString();
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        logger.warn("API doc fetch failed with HTTP error", {
          collectorId: invocation.id,
          url,
          status: response.status,
        });

        return {
          collectorId: invocation.id,
          status: "failed",
          startTime,
          endTime,
          error: errorMsg,
          contentSize: 0,
        };
      }

      const rawText = await response.text();
      const contentType =
        response.headers.get("content-type") || "text/html";

      // Attempt OpenAPI/Swagger detection (JSON first, then YAML)
      const openApiSpec =
        tryParseOpenApiJson(rawText) || tryParseOpenApiYaml(rawText);

      let collectedContent: CollectedContent;

      if (openApiSpec) {
        // Structured OpenAPI/Swagger parsing
        const { content, endpointsCount, schemasCount, specVersion } =
          extractOpenApiContent(openApiSpec);
        const contentSize = Buffer.byteLength(content, "utf-8");

        collectedContent = {
          url,
          title: openApiSpec.info?.title || `API Spec: ${url}`,
          content,
          contentType: "application/openapi+json",
          sourceType: "api_documentation_parser",
          contentSize,
          metadata: {
            format: "openapi",
            specVersion,
            apiVersion: openApiSpec.info?.version || null,
            endpointsCount,
            schemasCount,
            fetchedAt: new Date().toISOString(),
          },
        };

        logger.info("Parsed OpenAPI/Swagger spec", {
          collectorId: invocation.id,
          url,
          specVersion,
          endpointsCount,
          schemasCount,
        });
      } else {
        // Generic API docs page — strip HTML and extract text
        const isHtml =
          contentType.includes("text/html") || rawText.trimStart().startsWith("<");
        const content = isHtml ? stripHtml(rawText) : rawText;
        const title = isHtml ? extractTitle(rawText) || url : url;
        const contentSize = Buffer.byteLength(content, "utf-8");

        collectedContent = {
          url,
          title,
          content,
          contentType,
          sourceType: "api_documentation_parser",
          contentSize,
          metadata: {
            format: "generic",
            isHtml,
            fetchedAt: new Date().toISOString(),
          },
        };

        logger.info("Parsed generic API documentation page", {
          collectorId: invocation.id,
          url,
          contentSize,
          isHtml,
        });
      }

      const endTime = new Date().toISOString();

      return {
        collectorId: invocation.id,
        status: "completed",
        startTime,
        endTime,
        content: [collectedContent],
        contentSize: collectedContent.contentSize,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const endTime = new Date().toISOString();
      const error = err instanceof Error ? err : new Error(String(err));
      const isTimeout = error.name === "AbortError";

      logger.error("API doc parse error", {
        collectorId: invocation.id,
        url,
        error: error.message,
        isTimeout,
      });

      return {
        collectorId: invocation.id,
        status: isTimeout ? "timeout" : "failed",
        startTime,
        endTime,
        error: isTimeout
          ? `Request timed out after ${timeout}ms`
          : error.message,
        contentSize: 0,
      };
    }
  },
};
