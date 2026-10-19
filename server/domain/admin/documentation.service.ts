
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { queueExtractionJob } from "../knowledge/knowledge-queue.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { RESOURCE_TYPE_DEFINITIONS } from "@shared/resource-catalog.js";
import { getDocumentationMaintenanceStatus } from "./infrastructure/documentation-maintenance.js";
import {
  scanCapabilityFacts,
  buildCapabilityReferenceMarkdown,
  type CapabilityFacts,
} from "./infrastructure/capability-facts.js";
import { computeLineDiff } from "@shared/utils/json-diff.js";
import { CAPABILITY_VERSION_PATTERN, type CapabilityManifest } from "@shared/schema/capabilities/index.js";

import { appForgeToolDefinitions } from "@server/mcp/tools/app-forge.js";
import { antigravityToolDefinitions } from "@server/mcp/tools/antigravity.js";
import { discoveryToolDefinitions } from "@server/mcp/tools/discovery.js";
import { emailToolDefinitions } from "@server/mcp/tools/email.js";
import { gmsToolDefinitions } from "@server/mcp/tools/gms.js";
import { cycleToolDefinitions } from "@server/mcp/tools/cycles.js";
import { datasetToolDefinitions } from "@server/mcp/tools/datasets.js";
import { documentToolDefinitions } from "@server/mcp/tools/documents.js";
import { knowledgeGraphToolDefinitions } from "@server/mcp/tools/knowledge-graph.js";
import { hilFormToolDefinitions } from "@server/mcp/tools/hil.js";
import { messagingToolDefinitions } from "@server/mcp/tools/messaging.js";
import { pipelineToolDefinitions } from "@server/mcp/tools/pipelines.js";
import { governorToolDefinitions } from "@server/mcp/tools/governor.js";
import { jobToolDefinitions } from "@server/mcp/tools/jobs.js";
import { ephemeralToolDefinitions } from "@server/mcp/tools/ephemeral.js";
import { missionToolDefinitions } from "@server/mcp/tools/missions.js";
import { queryBuilderToolDefinitions } from "@server/mcp/tools/query-builder.js";
import { platformStructureToolDefinitions } from "@server/mcp/tools/platform-structure.js";
import { saasToolDefinitions } from "@server/mcp/tools/saas.js";
import { systemToolDefinitions } from "@server/mcp/tools/system.js";
import { scheduleToolDefinitions } from "@server/mcp/tools/schedules.js";
import { predictionToolDefinitions } from "@server/mcp/tools/prediction.js";
import { templateToolDefinitions } from "@server/mcp/tools/templates.js";
import { trycuaToolDefinitions } from "@server/mcp/tools/trycua.js";
import { agentMailToolDefinitions } from "@server/mcp/tools/agentmail.js";

const logger = createLogger("DocumentationService");

export interface Feature {
  id: string;
  name: string;
  description: string;
  version: string;
  components: string[];
  apis: string[];
  dependencies: string[];
  relatedResourceTypes: string[];
  mcpTools: string[];
  maintainers: string[];
  verifiedUiTests: VerifiedUiTest[];
  directory_path: string;
  last_updated: string;
  documentation_status: 'up-to-date' | 'outdated' | 'missing';
}

export interface VerifiedUiTest {
  id: string;
  testName: string;
  filePath: string;
  suiteId?: string;
  behaviorIds?: string[];
  startLine?: number;
  endLine?: number;
}

export interface FeatureSpec {
  featureId: string;
  title: string;
  summary: string;
  markdown: string;
  status: Feature["documentation_status"];
  generatedAt: string | null; // persisted timestamp; null when computed on demand
  persisted: boolean;         // false => built fresh from live analysis, never stored
}

export interface ApiEndpoint {
  module: string;
  method: string;
  path: string;
}

export interface CapabilitySpecResponse extends FeatureSpec {
  /** Hash of the CURRENT extracted facts — what `status` was decided against. */
  fingerprint: string;
  /** The structured catalog behind the markdown, so the UI can render a matrix
   *  and the Copilot can consume capabilities without parsing prose. */
  catalog: CapabilityFacts;
}

export interface CapabilityAvailabilityOverlay {
  organizationId: number;
  evaluatedAt: string;
  /** `null` means the lookup failed — distinct from an empty list, which means
   *  the organization genuinely has none. */
  missions: Array<{
    id: number;
    name: string;
    status: string;
    purpose: string;
    hasStructuredContract: boolean;
  }> | null;
  configuredCredentials: Array<{ entityType: string; credentialCount: number }> | null;
  connectedMcpTools: string[] | null;
  /** Deployed apps for this org — the blueprint layer's per-tenant counterpart. */
  installedApps: Array<{ name: string; slug: string; status: string }> | null;
}

export interface ApiSpecResponse extends FeatureSpec {
  endpoints: ApiEndpoint[];
}

export interface DocumentationStatus {
  overall_status: {
    total_documents: number;
    up_to_date: number;
    outdated: number;
    missing: number;
    average_age_days: number;
    oldest_document_days: number;
    freshness_score: number;
  };
  features: Array<{
    feature_id: string;
    name: string;
    documentation_status: string;
    last_updated: string;
    total_documents: number;
    up_to_date: boolean;
  }>;
  maintenance_status: {
    scheduler_running: boolean;
    last_maintenance_run: string | null;
  };
}

export type DocumentationChangeKind = "addition" | "change" | "deletion";
export type DocumentationSpecType = "module" | "api" | "ui" | "capability";

export interface DocumentationRouteDelta {
  module: string | null;
  method: string;
  path: string;
}

export interface DocumentationUiRouteDelta {
  section: string;
  path: string;
  component: string;
  sourceFile: string | null;
}

export interface DocumentationUiRouteUpdate {
  section: string;
  path: string;
  beforeComponent: string;
  afterComponent: string;
  beforeSourceFile: string | null;
  afterSourceFile: string | null;
}

export interface DocumentationChange {
  id: number;
  documentKey: string;
  documentTitle: string;
  specType: DocumentationSpecType;
  kind: DocumentationChangeKind;
  explanation: string;
  occurredAt: string;
  addedLines: number;
  removedLines: number;
  diff: string;
  releaseIds: number[];
  // When true, the entry is kept in the register but hidden from the default
  // view — used to declutter changes that have already been folded into a
  // release. Not a delete: it can be un-hidden.
  hidden: boolean;
  addedRoutes: DocumentationRouteDelta[];
  removedRoutes: DocumentationRouteDelta[];
  addedUiRoutes: DocumentationUiRouteDelta[];
  removedUiRoutes: DocumentationUiRouteDelta[];
  updatedUiRoutes: DocumentationUiRouteUpdate[];
  interfaces: string[];
  features: string[];
  capabilityVersion?: string;
  revision?: number;
  changedFields?: Array<{ path: string; changeType: string; old: unknown; new: unknown }>;
}

export interface DocumentationRelease {
  id: number;
  title: string;
  version: string | null;
  status: "draft" | "published";
  createdAt: string;
  publishedAt: string | null;
  changeIds: number[];
  markdown: string;
}

const CHANGE_REGISTER_SOURCE = "documentation-change-register";
const RELEASE_NOTES_SOURCE = "documentation-release-notes";

function validateSemanticVersion(version: string | null): void {
  if (version && !CAPABILITY_VERSION_PATTERN.test(version)) {
    throw new BadRequestError("Version must use semantic versioning (for example 1.2.0)");
  }
}

function buildDocumentationDiff(previous: string, next: string) {
  if (previous === next) return null;
  const lines = computeLineDiff(previous, next);
  const addedLines = lines.filter((line) => line.type === "add").length;
  const removedLines = lines.filter((line) => line.type === "remove").length;
  const kind: DocumentationChangeKind = previous.length === 0 || (addedLines > 0 && removedLines === 0)
    ? "addition"
    : next.length === 0 || (removedLines > 0 && addedLines === 0)
      ? "deletion"
      : "change";
  const diff = lines
    .filter((line) => line.type !== "same")
    .map((line) => `${line.type === "add" ? "+" : "-"}${line.content}`)
    .join("\n");
  return { kind, addedLines, removedLines, diff };
}

function extractDocumentedRoutes(markdown: string): DocumentationRouteDelta[] {
  const routes: DocumentationRouteDelta[] = [];
  let module: string | null = null;
  let method: string | null = null;
  for (const line of markdown.split("\n")) {
    const moduleHeading = line.match(/^###\s+(.+?)\s+\(`[^`]+`\)\s*$/);
    if (moduleHeading) {
      module = moduleHeading[1].trim();
      method = null;
      continue;
    }
    const methodHeading = line.match(/^#{3,4}\s+(GET|POST|PUT|PATCH|DELETE)\s*$/i);
    if (methodHeading) {
      method = methodHeading[1].toUpperCase();
      continue;
    }
    const routeLine = line.match(/^-\s+`([^`]+)`\s*$/);
    if (routeLine && method) routes.push({ module, method, path: routeLine[1] });
  }
  return routes;
}

function routeKey(route: DocumentationRouteDelta): string {
  return `${route.module ?? ""}\u0000${route.method}\u0000${route.path}`;
}

function buildRouteDelta(previous: string, next: string) {
  const before = extractDocumentedRoutes(previous);
  const after = extractDocumentedRoutes(next);
  const beforeKeys = new Set(before.map(routeKey));
  const afterKeys = new Set(after.map(routeKey));
  return {
    addedRoutes: after.filter((route) => !beforeKeys.has(routeKey(route))),
    removedRoutes: before.filter((route) => !afterKeys.has(routeKey(route))),
  };
}

function extractDocumentedUiRoutes(markdown: string): DocumentationUiRouteDelta[] {
  const routes: DocumentationUiRouteDelta[] = [];
  let section = "Uncategorized";
  for (const line of markdown.split("\n")) {
    const sectionHeading = line.match(/^###\s+(.+?)\s*$/);
    if (sectionHeading && !HTTP_METHOD_ORDER.includes(sectionHeading[1].toUpperCase())) {
      section = sectionHeading[1].trim();
      continue;
    }
    const row = line.match(/^\|\s+`([^`]+)`\s+\|\s+([^|]+?)\s+\|\s+(?:`([^`]+)`|_unresolved_)\s+\|$/);
    if (row) routes.push({ section, path: row[1], component: row[2].trim(), sourceFile: row[3] ?? null });
  }
  return routes;
}

function uiRouteKey(route: Pick<DocumentationUiRouteDelta, "section" | "path">): string {
  return `${route.section}\u0000${route.path}`;
}

function buildUiRouteDelta(previous: string, next: string) {
  const before = extractDocumentedUiRoutes(previous);
  const after = extractDocumentedUiRoutes(next);
  const beforeMap = new Map(before.map((route) => [uiRouteKey(route), route]));
  const afterMap = new Map(after.map((route) => [uiRouteKey(route), route]));
  const addedUiRoutes = after.filter((route) => !beforeMap.has(uiRouteKey(route)));
  const removedUiRoutes = before.filter((route) => !afterMap.has(uiRouteKey(route)));
  const updatedUiRoutes: DocumentationUiRouteUpdate[] = [];
  for (const route of after) {
    const prior = beforeMap.get(uiRouteKey(route));
    if (prior && (prior.component !== route.component || prior.sourceFile !== route.sourceFile)) {
      updatedUiRoutes.push({
        section: route.section,
        path: route.path,
        beforeComponent: prior.component,
        afterComponent: route.component,
        beforeSourceFile: prior.sourceFile,
        afterSourceFile: route.sourceFile,
      });
    }
  }
  return { addedUiRoutes, removedUiRoutes, updatedUiRoutes };
}

function deriveChangeScope(input: {
  documentKey: string;
  documentTitle: string;
  specType: DocumentationSpecType;
}, routeDelta: ReturnType<typeof buildRouteDelta>, uiRouteDelta: ReturnType<typeof buildUiRouteDelta>) {
  const interfaces = new Set<string>();
  const features = new Set<string>();
  if (input.specType === "api" || routeDelta.addedRoutes.length || routeDelta.removedRoutes.length) interfaces.add("REST API");
  if (input.specType === "ui" || uiRouteDelta.addedUiRoutes.length || uiRouteDelta.removedUiRoutes.length || uiRouteDelta.updatedUiRoutes.length) interfaces.add("Web UI");
  if (input.specType === "module") interfaces.add("Module architecture");
  if (input.specType === "capability") interfaces.add("Capability registry");

  for (const route of [...routeDelta.addedRoutes, ...routeDelta.removedRoutes]) {
    if (route.module) features.add(route.module);
  }
  for (const route of [...uiRouteDelta.addedUiRoutes, ...uiRouteDelta.removedUiRoutes, ...uiRouteDelta.updatedUiRoutes]) {
    if (route.section) features.add(route.section);
  }
  if (input.specType === "module") features.add(input.documentTitle.replace(/\s+—\s+Architecture Reference$/, ""));
  if (features.size === 0) features.add(input.specType === "api" ? "Platform API" : input.specType === "ui" ? "Platform UI" : input.documentKey);
  return { interfaces: [...interfaces], features: [...features] };
}

function firstDocumentedCount(markdown: string, noun: "endpoints" | "routes"): number | null {
  const match = markdown.match(new RegExp(`\\b(\\d+)\\s+(?:router-registered\\s+)?${noun}\\b`, "i"));
  return match ? Number(match[1]) : null;
}

function deterministicReleaseNoteSummary(
  title: string,
  kind: DocumentationChangeKind,
  previous: string,
  next: string,
): string {
  for (const noun of ["endpoints", "routes"] as const) {
    const before = firstDocumentedCount(previous, noun);
    const after = firstDocumentedCount(next, noun);
    if (before != null && after != null && before !== after) {
      const delta = Math.abs(after - before);
      const direction = after > before ? "Expanded" : "Reduced";
      const action = after > before ? "adding coverage for" : "removing";
      return `${direction} ${title} from ${before} to ${after} ${noun}, ${action} ${delta} ${noun === "endpoints" ? "registered API route" : "documented route"}${delta === 1 ? "" : "s"}.`;
    }
  }
  if (kind === "addition") return `Added ${title}, establishing a new generated reference for the current implementation.`;
  if (kind === "deletion") return `Removed obsolete material from ${title} so the reference reflects the current implementation.`;
  return `Updated ${title} to reflect the latest architecture, responsibilities, and extracted implementation details.`;
}

// Tool-definition modules from the MCP server's own registry. Importing the
// data files directly (not server/mcp/index.ts, which has live DB/server
// side effects) lets us cross-reference real tool coverage per feature.
const MCP_TOOL_FILES: Record<string, Array<{ name: string; description?: string }>> = {
  "app-forge": appForgeToolDefinitions,
  antigravity: antigravityToolDefinitions,
  discovery: discoveryToolDefinitions,
  email: emailToolDefinitions,
  gms: gmsToolDefinitions,
  cycles: cycleToolDefinitions,
  datasets: datasetToolDefinitions,
  documents: documentToolDefinitions,
  "knowledge-graph": knowledgeGraphToolDefinitions,
  hil: hilFormToolDefinitions,
  messaging: messagingToolDefinitions,
  pipelines: pipelineToolDefinitions,
  governor: governorToolDefinitions,
  jobs: jobToolDefinitions,
  ephemeral: ephemeralToolDefinitions,
  missions: missionToolDefinitions,
  "query-builder": queryBuilderToolDefinitions,
  "platform-structure": platformStructureToolDefinitions,
  saas: saasToolDefinitions,
  system: systemToolDefinitions,
  schedules: scheduleToolDefinitions,
  prediction: predictionToolDefinitions,
  templates: templateToolDefinitions,
  trycua: trycuaToolDefinitions,
  agentmail: agentMailToolDefinitions,
};

interface McpToolRef {
  name: string;
  description: string;
  sourceFile: string;
}

const ALL_MCP_TOOLS: McpToolRef[] = Object.entries(MCP_TOOL_FILES).flatMap(([sourceFile, defs]) =>
  (defs || []).map((d) => ({ name: d.name, description: d.description ?? "", sourceFile }))
);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "").replace(/s$/, "");
}

function findRelatedMcpTools(featureId: string): McpToolRef[] {
  const normFeature = normalize(featureId);
  if (normFeature.length < 3) return [];
  return ALL_MCP_TOOLS.filter((tool) => {
    const normSource = normalize(tool.sourceFile);
    return normSource === normFeature || normSource.includes(normFeature) || normFeature.includes(normSource);
  });
}

function findRelatedResourceTypes(featureId: string) {
  const normFeature = normalize(featureId);
  return Object.values(RESOURCE_TYPE_DEFINITIONS).filter((def) => {
    const segment = def.canonicalRoute.split("/")[2] ?? "";
    return normalize(segment) === normFeature;
  });
}

const ROUTE_DEFINITION_RE = /\brouter\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/gi;
const DOMAIN_IMPORT_RE = /from\s+["'`]@domain\/([a-z0-9-]+)/g;
const SKIP_DIRS = new Set(["node_modules", "__tests__", "tests", "dist", "ui"]);

async function listSourceFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await listSourceFiles(full)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

// `.route.ts` AND `.routes.ts`. Matching only the singular silently dropped 42
// route files outside a routes/ directory (crew/api/crew.routes.ts,
// notifications/push.routes.ts, agent-card.routes.ts, ...), so their endpoints
// never reached a generated API reference.
export function isRouteFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return /\.routes?\.tsx?$/.test(base) || base === "routes.ts" || filePath.includes(`${path.sep}routes${path.sep}`);
}

// Discovers a feature's real API surface and cross-domain coupling by
// reading its own source instead of guessing — the System Graph's static
// analysis layer applied to the platform's own server/domain modules.
async function scanFeature(featurePath: string, selfId: string, preListedFiles?: string[]): Promise<{ apis: string[]; dependencies: string[]; lastSourceModifiedMs: number }> {
  const files = preListedFiles ?? await listSourceFiles(featurePath);
  return scanSourceFiles(files, selfId);
}

// Core extractor shared by whole-directory scans and the supplemental
// (cross-cutting) feature scans: pulls the route surface and cross-domain
// imports from a concrete set of source files.
async function scanSourceFiles(files: string[], selfId: string): Promise<{ apis: string[]; dependencies: string[]; lastSourceModifiedMs: number }> {
  const apis = new Set<string>();
  const dependencies = new Set<string>();
  let lastSourceModifiedMs = 0;

  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs > lastSourceModifiedMs) lastSourceModifiedMs = stat.mtimeMs;
    } catch {
      // ignore stat failures; a missing mtime just means "not newer"
    }

    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    if (isRouteFile(file)) {
      for (const match of content.matchAll(ROUTE_DEFINITION_RE)) {
        apis.add(`${match[1].toUpperCase()} ${match[2]}`);
      }
    }

    for (const match of content.matchAll(DOMAIN_IMPORT_RE)) {
      if (match[1] !== selfId) dependencies.add(match[1]);
    }
  }

  return { apis: Array.from(apis).sort(), dependencies: Array.from(dependencies).sort(), lastSourceModifiedMs };
}

// Deterministic per-feature document title. Keep in sync between generation
// (createDocument upserts on this) and retrieval (getDocumentByTitle reads it).
function specDocumentTitle(featureName: string): string {
  return `${featureName} — Architecture Reference`;
}

// Explicit display names for feature ids the naive title-caser gets wrong
// (acronyms, product names). Falls back to first-letter-capitalized below.
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "sdlc-pipeline": "SDLC Pipeline",
};

function displayName(featureName: string): string {
  return DISPLAY_NAME_OVERRIDES[featureName]
    ?? featureName.charAt(0).toUpperCase() + featureName.slice(1).replace(/-/g, ' ');
}

// Content fingerprint of a spec's deterministic reference markdown. Because the
// reference markdown is a pure function of the extracted facts, this hash is a
// stable change signal that — unlike file mtime — is immune to git checkout /
// branch-switch churn and only changes when the documented facts change.
function fingerprint(referenceMarkdown: string): string {
  return createHash("sha256").update(referenceMarkdown).digest("hex");
}

export interface SpecSearchResult {
  featureId: string;
  featureName: string;
  title: string;
  snippet: string;
  specType: DocumentationSpecType;
}

// Build a short, context-centered excerpt around the first query match,
// collapsing markdown/whitespace noise so search results stay readable.
function buildSnippet(content: string, query: string, radius = 90): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return flat.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + query.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

// HTTP method ordering for the grouped API section.
const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// The verified, statically-extracted facts as a markdown section — no top-level
// title or prose, so it can stand alone as a "Reference" appendix beneath an
// AI-written narrative or be wrapped by buildFeatureMarkdown for the plain view.
function buildReferenceMarkdown(feature: Feature): string {
  // Resolve full refs (descriptions, canonical routes) the Feature summary drops.
  const resourceTypes = findRelatedResourceTypes(feature.id);
  const mcpTools = findRelatedMcpTools(feature.id);
  const verifiedUiTests = feature.verifiedUiTests ?? [];

  const lines: string[] = [
    "## Reference — extracted facts",
    "",
    `- **Directory:** \`${feature.directory_path}\``,
    `- **API endpoints:** ${feature.apis.length}`,
    `- **Internal dependencies:** ${feature.dependencies.length}`,
    `- **Resource catalog types:** ${resourceTypes.length}`,
    `- **MCP tools:** ${mcpTools.length}`,
    "",
    "### API Endpoints",
  ];

  if (feature.apis.length === 0) {
    lines.push("", "_No router-registered endpoints found in this module's `.route.ts` files._");
  } else {
    // feature.apis entries are "METHOD /path" — group them by method.
    const byMethod = new Map<string, string[]>();
    for (const api of feature.apis) {
      const [method, ...rest] = api.split(" ");
      const path = rest.join(" ");
      const list = byMethod.get(method) ?? [];
      list.push(path);
      byMethod.set(method, list);
    }
    const methods = Array.from(byMethod.keys()).sort(
      (a, b) => (HTTP_METHOD_ORDER.indexOf(a) + 1 || 99) - (HTTP_METHOD_ORDER.indexOf(b) + 1 || 99),
    );
    for (const method of methods) {
      lines.push("", `### ${method}`);
      for (const path of byMethod.get(method)!.sort()) lines.push(`- \`${path}\``);
    }
  }

  if (feature.id === "e2e-testing" || verifiedUiTests.length > 0) {
    lines.push("", "### Verified UI Functionality");
    if (verifiedUiTests.length === 0) {
      lines.push("", "_No indexed Playwright behavior checks are linked to this module._");
    } else {
      lines.push(
        "",
        "These behaviors come directly from the atomic Playwright test index. They describe executable expectations, not inferred product claims.",
        "",
      );
      for (const test of verifiedUiTests) {
        const sourceLocation = test.startLine && test.endLine ? `, lines ${test.startLine}-${test.endLine}` : "";
        const suiteLocation = test.suiteId ? `, suite ${test.suiteId}` : "";
        const verifiedBehaviors = test.behaviorIds?.length ? `, verifies ${test.behaviorIds.join(", ")}` : "";
        const lineRange = `${sourceLocation}${suiteLocation}${verifiedBehaviors}`;
        lines.push(`- **${test.testName}** — atomic block \`${test.id}\` in \`${test.filePath}\`${lineRange}`);
      }
    }
  }

  lines.push("", "### Internal Dependencies");
  if (feature.dependencies.length === 0) {
    lines.push("", "_No imports from other `server/domain` modules detected._");
  } else {
    for (const dep of feature.dependencies) lines.push(`- \`${dep}\` (\`server/domain/${dep}\`)`);
  }

  lines.push("", "### Related Resource Catalog Types");
  if (resourceTypes.length === 0) {
    lines.push("", "_This module maps to no Resource Catalog types._");
  } else {
    for (const def of resourceTypes) lines.push(`- **${def.label}** — \`${def.canonicalRoute}\``);
  }

  lines.push("", "### Related MCP Tools");
  if (mcpTools.length === 0) {
    lines.push("", "_No MCP tools are registered for this module._");
  } else {
    for (const tool of mcpTools) {
      lines.push(`- \`${tool.name}\`${tool.description ? ` — ${tool.description}` : ""}`);
    }
  }

  lines.push(
    "",
    `_Facts extracted from the Resource Catalog ontology, the MCP tool registry, and static route/import analysis of \`${feature.directory_path}\`._`,
  );

  return lines.join("\n");
}

// Resolve static guide files from server/knowledge/features/
function getStaticDocPath(featureId: string): string | null {
  const mapping: Record<string, string> = {
    jobs: "jobs.md",
    alerts: "alerts.md",
    auth: "credentials.md",
    datasets: "datasets.md",
    knowledge: "knowledge-graph.md",
    billing: "monetization-scaling.md",
    pipeline: "pipelines.md",
    "sdlc-pipeline": "sdlc-pipeline.md",
    prospecting: "prospecting-engine.md",
    schedules: "schedules.md",
    templates: "templates.md",
    agents: "workgroups.md",
    capabilities: "capabilities.md",
    "e2e-testing": "e2e-testing.md",
    "transference-engine": "../../docs/features/TRANSFERENCE_ENGINE.md",
    "evolution-engine": "../../docs/features/EVOLUTION_ENGINE.md",
    "self-healing-missions": "../../docs/features/SELF_HEALING_MISSIONS.md",
    "multi-agent-coordination": "../../docs/features/MULTI_AGENT_COORDINATION.md",
    "mission-dependencies": "../../docs/features/MISSION_DEPENDENCIES.md",
    "mission-correlation": "../../docs/features/MISSION_CORRELATION_SYSTEM.md",
    "mission-debug-mode": "../../docs/features/MISSION_DEBUG_MODE.md",
    "mission-replay": "../../docs/features/MISSION_REPLAY_SYSTEM.md",
    "predictive-planning": "../../docs/features/PREDICTIVE_PLANNING.md",
    "circuit-breaker": "../../docs/features/CIRCUIT_BREAKER_SYSTEM.md",
    "retry-system": "../../docs/features/RETRY_SYSTEM.md",
    "computer-use": "computer-use.md",
  };

  const filename = mapping[featureId];
  if (!filename) return null;
  return path.join(process.cwd(), "server", "knowledge", "features", filename);
}

// Parse the ## Overview section from static guide markdown to use as the feature description
async function getStaticDescription(featureId: string): Promise<string | null> {
  const staticPath = getStaticDocPath(featureId);
  if (!staticPath) return null;
  try {
    const content = await fs.readFile(staticPath, "utf-8");
    const overviewMatch = content.match(/##\s+Overview\s+([\s\S]*?)(?:\n##|$)/i);
    if (overviewMatch && overviewMatch[1]) {
      return overviewMatch[1].trim().replace(/\n+/g, " ");
    }
    const paragraphs = content.split("\n\n").map(p => p.trim()).filter(p => p && !p.startsWith("#"));
    if (paragraphs[0]) return paragraphs[0].replace(/\n+/g, " ");
  } catch {}
  return null;
}

// Plain, deterministic spec — title + description + extracted facts. Used as the
// on-demand view and as the fallback when AI enrichment is unavailable.
async function buildFeatureMarkdown(feature: Feature): Promise<string> {
  const reference = buildReferenceMarkdown(feature);
  const staticPath = getStaticDocPath(feature.id);
  if (staticPath) {
    try {
      const content = await fs.readFile(staticPath, "utf-8");
      const cleanedContent = content.replace(/^#\s+.+$/m, "").trim();
      return [`# ${feature.name}`, "", feature.description, "", cleanedContent, "", reference].join("\n");
    } catch {}
  }
  return [`# ${feature.name}`, "", feature.description, "", reference].join("\n");
}

// Prompt for the architectural narrative. Grounds the model strictly in the
// extracted facts and asks it to hedge any inference, to avoid fabricated APIs.
function buildEnrichmentPrompt(feature: Feature, referenceMarkdown: string, staticGuideMarkdown?: string | null): string {
  const guideSection = staticGuideMarkdown 
    ? [
        "Use the existing documentation/architectural guide below as a primary source of truth.",
        "Synthesize this pre-written documentation with the verified facts. Do not invent details not present in either.",
        "",
        "--- START EXISTING DOCUMENTATION ---",
        staticGuideMarkdown,
        "--- END EXISTING DOCUMENTATION ---",
        "",
      ].join("\n")
    : "";

  return [
    "You are a principal software architect documenting one domain module of the Oddjob agentic-intelligence platform.",
    "Write a specification that lets an engineer new to this module FULLY UNDERSTAND it.",
    "",
    `Module: ${feature.name}`,
    `One-line description: ${feature.description}`,
    `Source directory: ${feature.directory_path}`,
    "",
    guideSection,
    "Use ONLY the verified facts below. You may infer purpose from route names, dependency names,",
    "resource types and tool descriptions, but clearly hedge inferences (\"appears to\", \"likely\")",
    "and never invent endpoints, files, tables, or capabilities that the facts do not imply.",
    "",
    referenceMarkdown,
    "",
    "Produce GitHub-flavored markdown beginning with the heading \"# " + feature.name + "\".",
    "Include these sections (skip one only if there is genuinely nothing grounded to say):",
    "- **Purpose** — what this module does and why it exists in the platform.",
    "- **Responsibilities** — its main capabilities as a bulleted list.",
    "- **API Surface** — how the endpoints are organized and what each group is for, grounded in the real routes.",
    "- **Dependencies & Integration** — how it relates to the domain modules it imports and what its resource types / MCP tools expose.",
    "- **Architecture & Data Flow** — a concise, hedged narrative of how a typical request flows through the module.",
    "- **Operational Notes** — auth, side effects, or scale considerations implied by the facts.",
    "",
    "Do not restate these instructions or add a preamble. Do not repeat the raw fact lists verbatim — explain them.",
  ].join("\n");
}

// Hard ceiling on how long we wait for AI enrichment. When the model is slow or
// rate-limited (e.g. an exhausted Gemini quota parks the call behind a multi-
// minute throttle), we don't block documentation regeneration — we fall back to
// the deterministic facts. Keeps "docs stay current" true even when AI is down.
const AI_ENRICHMENT_TIMEOUT_MS = 30_000;

// Run AI enrichment with a timeout. Returns the trimmed narrative, or null when
// the model is unavailable, errors, times out, or returns empty — in every such
// case callers fall back to the deterministic reference markdown.
async function enrichWithAi(prompt: string, label: string): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
    // .catch keeps the losing race branch from surfacing as an unhandled rejection.
    const aiPromise = systemAiService
      .generateText(prompt, { serviceKey: "architect", temperature: 0.2 })
      .catch((err: any) => {
        logger.warn(`AI enrichment failed for ${label}; using extracted facts only: ${err?.message ?? err}`);
        return null;
      });
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        logger.warn(`AI enrichment timed out for ${label} after ${AI_ENRICHMENT_TIMEOUT_MS}ms; using extracted facts only`);
        resolve(null);
      }, AI_ENRICHMENT_TIMEOUT_MS);
    });
    const narrative = await Promise.race([aiPromise, timeoutPromise]);
    return narrative && narrative.trim().length > 0 ? narrative.trim() : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateReleaseNoteSummary(input: {
  documentTitle: string;
  documentKey: string;
  kind: DocumentationChangeKind;
  previous: string;
  next: string;
  diff: string;
}): Promise<string> {
  const fallback = deterministicReleaseNoteSummary(input.documentTitle, input.kind, input.previous, input.next);
  const routeDelta = buildRouteDelta(input.previous, input.next);
  const uiRouteDelta = buildUiRouteDelta(input.previous, input.next);
  const structuredChanges = [
    ...routeDelta.addedRoutes.map((route) => `Added API route: ${route.method} ${route.path}${route.module ? ` (${route.module})` : ""}`),
    ...routeDelta.removedRoutes.map((route) => `Removed API route: ${route.method} ${route.path}${route.module ? ` (${route.module})` : ""}`),
    ...uiRouteDelta.addedUiRoutes.map((route) => `Added screen: ${route.path} renders ${route.component} (${route.section})`),
    ...uiRouteDelta.removedUiRoutes.map((route) => `Removed screen: ${route.path} rendered ${route.component} (${route.section})`),
    ...uiRouteDelta.updatedUiRoutes.map((route) => `Updated screen: ${route.path} renders ${route.afterComponent} instead of ${route.beforeComponent} (${route.section})`),
  ];
  const prompt = [
    "You write concise release notes for the Oddjob agentic-intelligence platform.",
    `Summarize this documentation ${input.kind} as exactly one user-facing sentence of at most 35 words.`,
    "Begin with a past-tense action verb such as Added, Expanded, Updated, Clarified, or Removed.",
    "Describe the capability or documented surface that changed. Do not mention line counts, diffs, regeneration, or documentation mechanics.",
    "Use only facts visible in the changed lines. Do not speculate or add a preamble, bullet, heading, or markdown.",
    "",
    `Document: ${input.documentTitle}`,
    ...(structuredChanges.length ? ["Structured route and interface changes:", ...structuredChanges.slice(0, 40), ""] : []),
    "Changed lines:",
    input.diff.slice(0, 12_000),
  ].join("\n");
  const generated = await enrichWithAi(prompt, `release-note summary for ${input.documentKey}`);
  if (!generated) return fallback;
  const sentence = generated.split("\n").find((line) => line.trim().length > 0)?.trim().replace(/^[-*]\s*/, "") ?? "";
  return sentence.length > 0 && sentence.length <= 320 ? sentence : fallback;
}

function buildReleaseMarkdown(title: string, version: string | null, createdAt: string, selected: DocumentationChange[]): string {
  const sections: Record<DocumentationChangeKind, string[]> = { addition: [], change: [], deletion: [] };
  for (const entry of selected) {
    const scope = [...entry.interfaces, ...entry.features].join(" · ");
    sections[entry.kind].push(`- ${scope ? `**${scope}** — ` : ""}${entry.explanation}`);
    for (const route of entry.addedRoutes) {
      sections[entry.kind].push(`  - Added route: \`${route.method} ${route.path}\`${route.module ? ` (${route.module})` : ""}`);
    }
    for (const route of entry.removedRoutes) {
      sections[entry.kind].push(`  - Removed route: \`${route.method} ${route.path}\`${route.module ? ` (${route.module})` : ""}`);
    }
    for (const route of entry.addedUiRoutes) {
      sections[entry.kind].push(`  - Added screen: \`${route.path}\` renders ${route.component} (${route.section})`);
    }
    for (const route of entry.removedUiRoutes) {
      sections[entry.kind].push(`  - Removed screen: \`${route.path}\` previously rendered ${route.component} (${route.section})`);
    }
    for (const route of entry.updatedUiRoutes) {
      sections[entry.kind].push(`  - Updated screen: \`${route.path}\` now renders ${route.afterComponent} instead of ${route.beforeComponent} (${route.section})`);
    }
  }
  return [
    `# ${title}`,
    version ? `\nVersion ${version}` : "",
    `\nCreated ${new Date(createdAt).toLocaleDateString("en-US")}`,
    ...(["addition", "change", "deletion"] as DocumentationChangeKind[]).flatMap((kind) =>
      sections[kind].length ? [`\n## ${kind === "addition" ? "Additions" : kind === "change" ? "Changes" : "Deletions"}`, ...sections[kind]] : [],
    ),
  ].filter(Boolean).join("\n");
}

// Generate the stored spec: an AI-written architectural narrative grounded in the
// extracted facts, with those facts appended as a verified reference. Falls back
// to the plain deterministic spec if AI generation is unavailable, slow, or fails.
async function generateSpecMarkdown(feature: Feature): Promise<string> {
  const reference = buildReferenceMarkdown(feature);
  
  let staticGuide: string | null = null;
  const staticPath = getStaticDocPath(feature.id);
  if (staticPath) {
    try {
      staticGuide = await fs.readFile(staticPath, "utf-8");
    } catch {}
  }

  // Authored feature guides are governing documentation. Preserve their full
  // structure and wording in the stored reference instead of asking a model to
  // summarize them (which can silently omit catalog requirements, lifecycle
  // states, or delivery boundaries). Extracted implementation facts remain
  // appended as the independently generated verification layer.
  if (staticGuide?.trim()) {
    return `${staticGuide.trim()}\n\n---\n\n${reference}`;
  }

  const narrative = await enrichWithAi(buildEnrichmentPrompt(feature, reference, staticGuide), `module ${feature.id}`);
  if (narrative) {
    logger.info(`AI-enriched documentation generated for ${feature.id} (${narrative.length} chars)`);
    return `${narrative}\n\n---\n\n${reference}`;
  }

  return [`# ${feature.name}`, "", feature.description, "", reference].join("\n");
}

const API_SPEC_TITLE = "Platform API Reference";

// Flatten every module's router-registered endpoints into a structured list.
function buildApiEndpoints(features: Feature[]): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  for (const feature of features) {
    for (const api of feature.apis) {
      const [method, ...rest] = api.split(" ");
      endpoints.push({ module: feature.name, method, path: rest.join(" ") });
    }
  }
  return endpoints;
}

// Deterministic platform-wide API reference: every endpoint, grouped by owning
// module then HTTP method. No title/prose, so it can sit beneath an AI overview.
function buildApiReferenceMarkdown(features: Feature[]): string {
  const withApis = features.filter((f) => f.apis.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  const total = withApis.reduce((n, f) => n + f.apis.length, 0);

  const lines: string[] = [
    "## Reference — all endpoints",
    "",
    `- **Total endpoints:** ${total}`,
    `- **Modules with endpoints:** ${withApis.length}`,
    "",
    "_Paths are router-relative (as registered in each module's `.route.ts` files)._",
  ];

  for (const feature of withApis) {
    lines.push("", `### ${feature.name} (\`${feature.directory_path}\`)`);
    const byMethod = new Map<string, string[]>();
    for (const api of feature.apis) {
      const [method, ...rest] = api.split(" ");
      const list = byMethod.get(method) ?? [];
      list.push(rest.join(" "));
      byMethod.set(method, list);
    }
    const methods = Array.from(byMethod.keys()).sort(
      (a, b) => (HTTP_METHOD_ORDER.indexOf(a) + 1 || 99) - (HTTP_METHOD_ORDER.indexOf(b) + 1 || 99),
    );
    for (const method of methods) {
      lines.push("", `#### ${method}`);
      for (const path of byMethod.get(method)!.sort()) lines.push(`- \`${path}\``);
    }
  }

  return lines.join("\n");
}

function buildApiEnrichmentPrompt(referenceMarkdown: string, totalEndpoints: number, moduleCount: number): string {
  return [
    "You are a principal API architect documenting the complete HTTP surface of the Oddjob agentic-intelligence platform.",
    `The platform exposes ${totalEndpoints} router-registered endpoints across ${moduleCount} domain modules.`,
    "Write an overview that helps an engineer understand the API as a whole.",
    "",
    "Use ONLY the verified endpoint list below. Infer conventions and groupings from the real method+path",
    "values, but clearly hedge inferences (\"appears to\", \"likely\") and never invent endpoints.",
    "",
    referenceMarkdown,
    "",
    "Produce GitHub-flavored markdown beginning with the heading \"# Platform API Reference\".",
    "Include these sections (skip one only if there is nothing grounded to say):",
    "- **Overview** — the scale and shape of the API surface.",
    "- **Conventions** — naming/verb patterns, resource-oriented structure, path parameter style observed across modules.",
    "- **Major Resource Groups** — the most significant module/endpoint clusters and what they appear to manage.",
    "- **Cross-cutting Concerns** — auth, pagination, or other patterns implied by the routes.",
    "Do not restate these instructions, add a preamble, or re-list every endpoint verbatim — the reference list follows separately.",
  ].join("\n");
}

// Generate the stored API spec: AI overview grounded in the endpoint list, with
// the deterministic per-module reference appended. Falls back to the plain
// reference if AI generation is unavailable.
async function generateApiSpecMarkdown(features: Feature[]): Promise<string> {
  const reference = buildApiReferenceMarkdown(features);
  const withApis = features.filter((f) => f.apis.length > 0);
  const total = withApis.reduce((n, f) => n + f.apis.length, 0);
  const narrative = await enrichWithAi(buildApiEnrichmentPrompt(reference, total, withApis.length), "API spec");
  if (narrative) {
    logger.info(`AI-enriched API spec generated (${narrative.length} chars)`);
    return `${narrative}\n\n---\n\n${reference}`;
  }
  return [`# ${API_SPEC_TITLE}`, "", `${total} endpoints across ${withApis.length} modules.`, "", reference].join("\n");
}

const UI_SPEC_TITLE = "Platform UI Reference";
const UI_ROUTING_DIR = path.join(process.cwd(), "server", "domain", "core", "ui", "components", "routing");

type UiRouteKind = "page" | "redirect" | "mount" | "unresolved";
interface UiRoute { path: string; component: string; sourceFile?: string; kind: UiRouteKind; }
interface UiSection { section: string; routes: UiRoute[]; }
interface UiSpecData { totalRoutes: number; totalPages: number; bySection: UiSection[]; lastSourceModifiedMs: number; }

const LAZY_IMPORT_RE = /const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(\s*["'`]([^"'`]+)["'`]/g;
const UI_ROUTE_RE = /<Route\s+path=["'`]([^"'`]+)["'`]([^>]*?)(\/?)>/g;

function classifyUiComponent(component: string, sourceFile?: string): UiRouteKind {
  if (component === "Redirect" || component === "ExternalRedirect") return "redirect";
  if (component === "Reload" || /Routing(Routes)?$/.test(component)) return "mount";
  return sourceFile ? "page" : "unresolved";
}

// Parse the platform's `*Routing.tsx` files into a URL → page route map. Models
// scanFeature: static analysis of the SPA's own routing source. Resolves each
// route's component to its lazy-import source file where statically possible.
async function scanUiRoutes(): Promise<UiSpecData> {
  let entries: string[];
  try {
    entries = (await fs.readdir(UI_ROUTING_DIR)).filter((f) => f.endsWith("Routing.tsx"));
  } catch {
    return { totalRoutes: 0, totalPages: 0, bySection: [], lastSourceModifiedMs: 0 };
  }

  const bySection: UiSection[] = [];
  const pageSources = new Set<string>();
  let totalRoutes = 0;
  let lastSourceModifiedMs = 0;

  for (const file of entries.sort()) {
    const full = path.join(UI_ROUTING_DIR, file);
    let content: string;
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs > lastSourceModifiedMs) lastSourceModifiedMs = stat.mtimeMs;
      content = await fs.readFile(full, "utf-8");
    } catch {
      continue;
    }

    const lazyMap = new Map<string, string>();
    for (const m of content.matchAll(LAZY_IMPORT_RE)) lazyMap.set(m[1], m[2]);

    const routes: UiRoute[] = [];
    for (const m of content.matchAll(UI_ROUTE_RE)) {
      const routePath = m[1];
      const attrs = m[2];
      const selfClosing = m[3] === "/";

      let component = "";
      const propMatch = attrs.match(/component=\{(\w+)\}/);
      if (propMatch) {
        component = propMatch[1];
      } else if (!selfClosing) {
        const after = content.slice((m.index ?? 0) + m[0].length);
        // Direct child element, or a render-prop child: `{(params) => <X …>}`.
        const childMatch = after.match(/^\s*<(\w+)/) ?? after.match(/^\s*\{[^}]*?<(\w+)/);
        if (childMatch) {
          component = childMatch[1];
          // <SuperAdminRoute … component={Real} /> wraps the real page.
          if (component === "SuperAdminRoute") {
            const inner = after.match(/component=\{(\w+)\}/);
            if (inner) component = inner[1];
          }
        }
      }

      const sourceFile = lazyMap.get(component);
      const kind = classifyUiComponent(component, sourceFile);
      if (kind === "page" && sourceFile) pageSources.add(sourceFile);
      routes.push({ path: routePath, component: component || "—", sourceFile, kind });
      totalRoutes++;
    }

    bySection.push({ section: file.replace(/Routing\.tsx$/, ""), routes });
  }

  return { totalRoutes, totalPages: pageSources.size, bySection, lastSourceModifiedMs };
}

// Deterministic SPA route map: per routing section, a table of page routes plus
// a redirect/mount summary. No title/prose, so it sits beneath an AI overview.
function buildUiReferenceMarkdown(data: UiSpecData): string {
  const lines: string[] = [
    "## Reference — SPA route map",
    "",
    `- **Total routes:** ${data.totalRoutes}`,
    `- **Unique page components (routed):** ${data.totalPages}`,
    `- **Routing sections:** ${data.bySection.length}`,
    "",
    "_Parsed from the platform's `*Routing.tsx` files. Redirects and nested mount points are summarized per section._",
  ];

  for (const sec of data.bySection) {
    const pages = sec.routes.filter((r) => r.kind === "page" || r.kind === "unresolved");
    const redirects = sec.routes.filter((r) => r.kind === "redirect").length;
    const mounts = sec.routes.filter((r) => r.kind === "mount").length;

    lines.push("", `### ${sec.section}`, "");
    const summary = [`${pages.length} page route(s)`];
    if (redirects) summary.push(`${redirects} redirect(s)`);
    if (mounts) summary.push(`${mounts} mount point(s)`);
    lines.push(`_${summary.join(", ")}_`);

    if (pages.length > 0) {
      lines.push("", "| Path | Page | Source |", "| --- | --- | --- |");
      for (const r of [...pages].sort((a, b) => a.path.localeCompare(b.path))) {
        lines.push(`| \`${r.path}\` | ${r.component} | ${r.sourceFile ? `\`${r.sourceFile}\`` : "_unresolved_"} |`);
      }
    }
  }

  return lines.join("\n");
}

function buildUiEnrichmentPrompt(referenceMarkdown: string, data: UiSpecData): string {
  return [
    "You are a principal front-end architect documenting the single-page application of the Oddjob agentic-intelligence platform.",
    `The SPA declares ${data.totalRoutes} routes across ${data.bySection.length} routing sections, rendering ${data.totalPages} distinct page components.`,
    "Write an overview that helps an engineer understand the navigation structure.",
    "",
    "Use ONLY the route map below. Infer the purpose of sections and pages from their URL paths and component",
    "names, but clearly hedge inferences (\"appears to\", \"likely\") and never invent routes or pages.",
    "",
    referenceMarkdown,
    "",
    "Produce GitHub-flavored markdown beginning with the heading \"# Platform UI Reference\".",
    "Include these sections (skip one only if there is nothing grounded to say):",
    "- **Overview** — the scale and shape of the SPA.",
    "- **Navigation Structure** — the major top-level areas and how routing is organized into sections.",
    "- **Key Screens** — the most significant pages and what they appear to do.",
    "- **Routing Conventions** — path patterns, nesting, and redirects observed across sections.",
    "Do not restate these instructions, add a preamble, or re-list every route verbatim — the route map follows separately.",
  ].join("\n");
}

async function generateUiSpecMarkdown(data: UiSpecData): Promise<string> {
  const reference = buildUiReferenceMarkdown(data);
  const narrative = await enrichWithAi(buildUiEnrichmentPrompt(reference, data), "UI spec");
  if (narrative) {
    logger.info(`AI-enriched UI spec generated (${narrative.length} chars)`);
    return `${narrative}\n\n---\n\n${reference}`;
  }
  return [`# ${UI_SPEC_TITLE}`, "", `${data.totalRoutes} routes across ${data.bySection.length} sections.`, "", reference].join("\n");
}

const CAPABILITY_SPEC_TITLE = "Platform Capability Reference";

// Cached facts scan. The extraction reads the tool registry and the golden-path
// fixtures, so it is far from free to repeat on every GET — and unlike the
// module scan there is no per-request input that could change the result.
let capabilityFactsCache: CapabilityFacts | null = null;
let capabilityFactsCachedAt: number | null = null;
const CAPABILITY_FACTS_CACHE_MS = 60_000;

async function getCapabilityFacts(force = false): Promise<CapabilityFacts> {
  if (!force && capabilityFactsCache && capabilityFactsCachedAt && Date.now() - capabilityFactsCachedAt < CAPABILITY_FACTS_CACHE_MS) {
    return capabilityFactsCache;
  }
  const facts = await scanCapabilityFacts({ mcpTools: ALL_MCP_TOOLS });
  capabilityFactsCache = facts;
  capabilityFactsCachedAt = Date.now();
  return facts;
}

function buildCapabilityEnrichmentPrompt(referenceMarkdown: string, facts: CapabilityFacts): string {
  return [
    "You are a principal product architect writing the definitive answer to the question \"What can Oddjob do?\"",
    "The audience is twofold: a technical operations buyer evaluating the platform, and the Oddjob Copilot,",
    "which will read this document to decide what it can offer a user and what it must refuse.",
    `Oddjob declares ${facts.counts.capabilities} capabilities across ${facts.counts.pillars} pillars,`,
    `backed by ${facts.totalAgentTools} agent tools in ${facts.counts.toolGroups} groups, ${facts.mcpToolCount} MCP tools,`,
    `and ${facts.counts.blueprints} app blueprints that turn recurring work into a durable interface.`,
    "",
    "Use ONLY the catalog below. Never invent a capability, tool, guarantee, or integration.",
    "Where a capability has no executable contract, say so plainly rather than implying it is production-proven.",
    "Distinguish carefully between what is contract-backed, what is demonstrated, and what is merely declared —",
    "over-claiming here directly causes the Copilot to promise work it cannot do.",
    "",
    referenceMarkdown,
    "",
    `Produce GitHub-flavored markdown beginning with the heading "# ${CAPABILITY_SPEC_TITLE}".`,
    "Include these sections (skip one only if there is nothing grounded to say):",
    "- **What Oddjob Does** — the platform's job, in the operator's language, in one short paragraph.",
    "- **Capability Pillars** — what each pillar promises and which capabilities deliver it.",
    "- **What You Can Ask For** — concrete requests a user can make today, grouped by pillar, drawn from the",
    "  capability buyer values, canonical demos, and Copilot commands.",
    "- **App Blueprints** — the internal apps a team can stand up, and what each one is for.",
    "- **Guarantees and Limits** — approval gates, guardrails, risk profiles, and what Oddjob explicitly is not.",
    "- **Maturity and Evidence** — which capabilities are contract-backed and demonstrated versus declared.",
    "Do not restate these instructions, add a preamble, or re-list every tool verbatim — the catalog follows separately.",
  ].join("\n");
}

async function generateCapabilitySpecMarkdown(facts: CapabilityFacts): Promise<string> {
  const reference = buildCapabilityReferenceMarkdown(facts);
  const narrative = await enrichWithAi(buildCapabilityEnrichmentPrompt(reference, facts), "capability spec");
  if (narrative) {
    logger.info(`AI-enriched capability spec generated (${narrative.length} chars)`);
    return `${narrative}\n\n---\n\n${reference}`;
  }
  return [
    `# ${CAPABILITY_SPEC_TITLE}`,
    "",
    `${facts.counts.capabilities} capabilities across ${facts.counts.pillars} pillars.`,
    "",
    reference,
  ].join("\n");
}

interface ScannedFeature {
  id: string;
  name: string;
  description: string;
  apis: string[];
  dependencies: string[];
  relatedResourceTypes: string[];
  mcpTools: string[];
  verifiedUiTests: VerifiedUiTest[];
  directory_path: string;
  lastSourceModifiedMs: number;
}

// Cross-cutting subsystems that don't map to a single `server/domain/<x>` dir —
// their code is interleaved inside shared modules — so the per-directory scan
// never surfaces them. Each is scanned from a curated file set (a directory plus
// a filename matcher), then flows through the same pipeline as a real module.
interface SupplementalFeature {
  id: string;
  name: string;
  description: string;
  /** Human-readable path label shown in the spec (not a single real dir). */
  directoryLabel: string;
  /** Source roots + a basename matcher selecting this subsystem's files. */
  sources: Array<{ dir: string; match: RegExp }>;
}

const SUPPLEMENTAL_FEATURES: SupplementalFeature[] = [
  {
    id: "cycles",
    name: "Cycles",
    description:
      "Operational Cycles: multi-mission orchestration installed from cycle blueprints — DAG dependency gates, rolling-wave execution, HIL coordination, and per-org forge workspaces.",
    directoryLabel: "server/domain/mission/core (cycle-*), server/domain/org/core (org-forge), server/cycles/*.yaml",
    sources: [
      { dir: "server/domain/mission/core", match: /cycle/i },
      { dir: "server/domain/mission/routes", match: /cycle/i },
      { dir: "server/domain/org/core", match: /cycle|forge/i },
    ],
  },
  {
    id: "workstreams",
    name: "Workstreams",
    description:
      "Workstreams: the provisioning and grouping layer that organizes missions and pipeline execution into coordinated streams of work.",
    directoryLabel: "server/domain/mission (workstreams.route), server/domain/pipeline (workstream-provisioner)",
    sources: [
      { dir: "server/domain/mission", match: /workstream/i },
      { dir: "server/domain/pipeline", match: /workstream/i },
    ],
  },
  {
    id: "e2e-testing",
    name: "E2E Testing",
    description:
      "Playwright End-to-End Testing & Incident Reporting Pipeline: integrates automated test runners, non-superadmin user seeding, and custom reporting to Dataset 71, triggering autonomous Bug Triage cycles and real-time Copilot alerts.",
    directoryLabel: "playwright-test-repo (tests, utils), server/domain/knowledge/core/dataset (item-service)",
    sources: [
      { dir: "playwright-test-repo/utils", match: /reporter/i },
      { dir: "playwright-test-repo/tests/smoke", match: /spec/i },
      { dir: "playwright-test-repo/tests", match: /auth/i },
      { dir: "server/domain/knowledge/core/dataset", match: /item-service/i },
    ],
  },
  {
    id: "transference-engine",
    name: "Transference Engine",
    description:
      "Transference Engine: shadow-to-active LLM call replacement via local Python handlers. Learns which cloud LLM prompt templates produce predictable outputs, then replaces those calls with local handlers when accuracy is proven to reduce cost and latency.",
    directoryLabel: "server/domain/agents/core (transference-router), server/workers (transference-worker), server/domain/ai/core (ai-client.service)",
    sources: [
      { dir: "server/domain/agents/core", match: /transference/i },
      { dir: "server/workers", match: /transference/i },
      { dir: "server/domain/ai/core", match: /transference/i },
    ],
  },
  {
    id: "evolution-engine",
    name: "Evolution Engine",
    description:
      "Evolution Engine: HIL skill code improvement from reliability signals (Flight Deck). Automatically evolves agent skills based on failure patterns and performance metrics.",
    directoryLabel: "server/domain/evolution (evolution.service), server/domain/mission/core (autoresearch), server/domain/pipeline/core (drift-detection)",
    sources: [
      { dir: "server/domain/evolution", match: /evolution/i },
      { dir: "server/domain/mission/core", match: /autoresearch/i },
      { dir: "server/domain/pipeline/core", match: /drift-detection/i },
    ],
  },
  {
    id: "self-healing-missions",
    name: "Self-Healing Missions",
    description:
      "Self-Healing Missions: automated mission recovery patterns. Detects failures, applies remedies, and retries missions with adaptive strategies.",
    directoryLabel: "server/domain/mission/core (self-healing.service, circuit-breaker.service), server/domain/testing/core (playwright-self-healing)",
    sources: [
      { dir: "server/domain/mission/core", match: /self-heal|circuit-breaker/i },
      { dir: "server/domain/testing/core", match: /self-heal/i },
    ],
  },
  {
    id: "multi-agent-coordination",
    name: "Multi-Agent Coordination",
    description:
      "Multi-Agent Coordination: swarm-based agent collaboration with consensus algorithms, role-based specialization, and shared blackboard for distributed problem solving.",
    directoryLabel: "server/domain/swarm (consensus.service, swarm-coordinator), server/domain/agents/core (swarm-roles)",
    sources: [
      { dir: "server/domain/swarm", match: /swarm|consensus/i },
      { dir: "server/domain/agents/core", match: /swarm/i },
    ],
  },
  {
    id: "mission-dependencies",
    name: "Mission Dependencies",
    description:
      "Mission Dependencies: dependency management for missions with DAG-based execution ordering, pre-creation validation, and circular dependency detection.",
    directoryLabel: "server/domain/mission/core (dependency.service), server/domain/mission/routes (dependency.route)",
    sources: [
      { dir: "server/domain/mission/core", match: /dependenc/i },
      { dir: "server/domain/mission/routes", match: /dependenc/i },
    ],
  },
  {
    id: "mission-correlation",
    name: "Mission Correlation",
    description:
      "Mission Correlation System: correlates related missions across runs, identifies patterns, and provides insights into mission relationships and outcomes.",
    directoryLabel: "server/domain/mission/core (correlation.service)",
    sources: [
      { dir: "server/domain/mission/core", match: /correlation/i },
    ],
  },
  {
    id: "mission-debug-mode",
    name: "Mission Debug Mode",
    description:
      "Mission Debug Mode: enhanced debugging capabilities for missions with step-by-step execution inspection, variable inspection, and breakpoint support.",
    directoryLabel: "server/domain/mission/core (debug.service), server/domain/mission/routes (debug.route)",
    sources: [
      { dir: "server/domain/mission/core", match: /debug/i },
      { dir: "server/domain/mission/routes", match: /debug/i },
    ],
  },
  {
    id: "mission-replay",
    name: "Mission Replay",
    description:
      "Mission Replay System: re-run past missions with original or modified inputs for testing, debugging, and validation purposes.",
    directoryLabel: "server/domain/mission/core (replay.service), server/domain/mission/routes (replay.route)",
    sources: [
      { dir: "server/domain/mission/core", match: /replay/i },
      { dir: "server/domain/mission/routes", match: /replay/i },
    ],
  },
  {
    id: "predictive-planning",
    name: "Predictive Planning",
    description:
      "Predictive Planning: AI-powered mission planning with failure prediction, resource forecasting, and adaptive strategy selection based on historical patterns.",
    directoryLabel: "server/domain/prediction-intelligence (prediction.service), server/domain/mission/core (planning.service)",
    sources: [
      { dir: "server/domain/prediction-intelligence", match: /prediction/i },
      { dir: "server/domain/mission/core", match: /planning/i },
    ],
  },
  {
    id: "circuit-breaker",
    name: "Circuit Breaker",
    description:
      "Circuit Breaker System: prevents cascading failures by automatically blocking calls to failing services after threshold, with automatic recovery and half-open state testing.",
    directoryLabel: "server/domain/mission/core (circuit-breaker.service), server/domain/core/infrastructure (circuit-breaker.service)",
    sources: [
      { dir: "server/domain/mission/core", match: /circuit-breaker/i },
      { dir: "server/domain/core/infrastructure", match: /circuit-breaker/i },
    ],
  },
  {
    id: "retry-system",
    name: "Retry System",
    description:
      "Retry System: configurable retry logic with exponential backoff, jitter, and failure classification for resilient operation of distributed services.",
    directoryLabel: "server/domain/tools/v1 (tool-composition.service), server/domain/mission/core (retry.service)",
    sources: [
      { dir: "server/domain/tools/v1", match: /retry/i },
      { dir: "server/domain/mission/core", match: /retry/i },
    ],
  },
  {
    // Lives inside the integrations module (integrations/trycua), so the domain scan
    // would only ever show it as part of "Integrations".
    id: "computer-use",
    name: "Computer Use",
    description:
      "Computer Use: agents operate a real desktop per organization (screenshots, clicks, typing, browsing) driven by Gemini Computer Use, with a login-protected live viewer for human takeover, and learned skills recorded from a person's browser actions, reviewed, approved and replayed for matching tasks.",
    directoryLabel: "server/domain/integrations/trycua, server/domain/integrations/routes (trycua), server/domain/tools/v1/capabilities (trycua-computer-use), docker/cua-desktop",
    sources: [
      { dir: "server/domain/integrations/trycua", match: /\.ts$/i },
      { dir: "server/domain/integrations/routes", match: /trycua/i },
      { dir: "server/domain/tools/v1/capabilities", match: /trycua/i },
    ],
  },
  {
    // The Android client is Kotlin in android/, which this TypeScript scan does
    // not read; what it documents is the server side the app depends on. The
    // client itself is described in docs/architecture/CREW_ANDROID_CLIENT.md.
    id: "crew-mobile",
    name: "CREW Mobile & Phone Push",
    description:
      "The native Android CREW client (android/) and the server surfaces built for it: phone push through Firebase Cloud Messaging alongside browser web push (push_devices, FCM v1 sender, device registration routes), and self-service profile and quiet-hours updates through an allow-listed PATCH /api/users/:id.",
    directoryLabel: "android/ (Kotlin client), server/domain/core/notifications (push, fcm), server/domain/org/core (self-profile), server/routes (users)",
    sources: [
      { dir: "server/domain/core/notifications", match: /push|fcm/i },
      { dir: "server/domain/org/core", match: /self-profile/i },
      { dir: "server/routes", match: /^users\.ts$/i },
    ],
  },
];

async function scanSupplementalFeatures(): Promise<ScannedFeature[]> {
  const out: ScannedFeature[] = [];
  for (const vf of SUPPLEMENTAL_FEATURES) {
    const files: string[] = [];
    for (const src of vf.sources) {
      const dirFiles = await listSourceFiles(path.join(process.cwd(), src.dir));
      files.push(...dirFiles.filter((f) => src.match.test(path.basename(f))));
    }
    if (files.length === 0) {
      logger.warn(`Supplemental feature "${vf.id}" matched no source files — skipping`);
      continue;
    }
    const { apis, dependencies, lastSourceModifiedMs } = await scanSourceFiles(files, vf.id);
    const resourceTypes = findRelatedResourceTypes(vf.id);
    const mcpTools = findRelatedMcpTools(vf.id);
    let verifiedUiTests: VerifiedUiTest[] = [];
    if (vf.id === "e2e-testing") {
      try {
        const { e2eTestIndexerService } = await import("../sdlc-pipeline/autonomous/e2e-test-indexer.service.js");
        verifiedUiTests = (await e2eTestIndexerService.loadManifest()).map((test) => ({
          id: test.id,
          testName: test.testName,
          filePath: test.filePath,
          suiteId: test.suiteId,
          behaviorIds: test.behaviorIds,
          startLine: test.startLine,
          endLine: test.endLine,
        }));
      } catch (err: any) {
        logger.warn(`Could not load indexed E2E behaviors for documentation: ${err?.message ?? err}`);
      }
    }
    out.push({
      id: vf.id,
      name: vf.name,
      description: vf.description,
      apis,
      dependencies,
      relatedResourceTypes: resourceTypes.map((r) => r.label),
      mcpTools: mcpTools.map((t) => t.name),
      verifiedUiTests,
      directory_path: vf.directoryLabel,
      lastSourceModifiedMs,
    });
    logger.info(`Found supplemental feature: ${vf.id} (${files.length} source file(s))`);
  }
  return out;
}

export class DocumentationService {
  private scanCache: ScannedFeature[] | null = null;
  private scanCachedAt: number | null = null;
  private uiScanCache: UiSpecData | null = null;
  private uiScanCachedAt: number | null = null;
  private readonly cacheMaxAgeMs = 60_000; // 1 minute

  clearCache(): void {
    this.scanCache = null;
    this.scanCachedAt = null;
    this.uiScanCache = null;
    this.uiScanCachedAt = null;
    capabilityFactsCache = null;
    capabilityFactsCachedAt = null;
  }

  private async recordDocumentationChange(input: {
    documentKey: string;
    documentTitle: string;
    specType: DocumentationSpecType;
    previous: string;
    next: string;
    organizationId: number;
    sourceEventKey?: string;
    explanation?: string;
    extraMetadata?: Record<string, unknown>;
  }): Promise<DocumentationChange | null> {
    const result = buildDocumentationDiff(input.previous, input.next);
    if (!result) return null;
    const routeDelta = buildRouteDelta(input.previous, input.next);
    const uiRouteDelta = buildUiRouteDelta(input.previous, input.next);
    const scope = deriveChangeScope(input, routeDelta, uiRouteDelta);

    const occurredAt = new Date().toISOString();
    const explanation = input.explanation ?? await generateReleaseNoteSummary({
      documentTitle: input.documentTitle,
      documentKey: input.documentKey,
      kind: result.kind,
      previous: input.previous,
      next: input.next,
      diff: result.diff,
    });
    const document = await knowledgeService.createDocument({
      title: input.sourceEventKey
        ? `[Documentation change] ${input.documentKey} ${input.sourceEventKey}`
        : `[Documentation change] ${occurredAt} ${input.documentKey} ${randomUUID()}`,
      summary: explanation,
      sourceType: "text",
      textContent: result.diff,
      metadata: {
        generatedFrom: CHANGE_REGISTER_SOURCE,
        documentKey: input.documentKey,
        documentTitle: input.documentTitle,
        specType: input.specType,
        kind: result.kind,
        explanation,
        occurredAt,
        addedLines: result.addedLines,
        removedLines: result.removedLines,
        addedRoutes: routeDelta.addedRoutes,
        removedRoutes: routeDelta.removedRoutes,
        addedUiRoutes: uiRouteDelta.addedUiRoutes,
        removedUiRoutes: uiRouteDelta.removedUiRoutes,
        updatedUiRoutes: uiRouteDelta.updatedUiRoutes,
        interfaces: scope.interfaces,
        features: scope.features,
        releaseIds: [],
        ...(input.sourceEventKey ? { sourceEventKey: input.sourceEventKey } : {}),
        ...(input.extraMetadata ?? {}),
      },
    }, getSystemOrgContext(input.organizationId));

    return {
      id: document.id,
      documentKey: input.documentKey,
      documentTitle: input.documentTitle,
      specType: input.specType,
      kind: result.kind,
      explanation,
      occurredAt,
      addedLines: result.addedLines,
      removedLines: result.removedLines,
      diff: result.diff,
      releaseIds: [],
      hidden: false,
      addedRoutes: routeDelta.addedRoutes,
      removedRoutes: routeDelta.removedRoutes,
      addedUiRoutes: uiRouteDelta.addedUiRoutes,
      removedUiRoutes: uiRouteDelta.removedUiRoutes,
      updatedUiRoutes: uiRouteDelta.updatedUiRoutes,
      interfaces: scope.interfaces,
      features: scope.features,
      capabilityVersion: input.extraMetadata?.capabilityVersion as string | undefined,
      revision: input.extraMetadata?.revision as number | undefined,
      changedFields: input.extraMetadata?.changedFields as DocumentationChange["changedFields"],
    };
  }

  /**
   * Git-driven change register population (Phase 1). Detects recent commits,
   * classifies each into a documentation SEVERITY, maps changed files to affected
   * features, and records each as a DRAFT change-register entry — the automated
   * alternative to manual change entry. Idempotent: keyed by commit SHA via a
   * deterministic title, so re-runs upsert instead of duplicating.
   *
   * Persistence embeds via the knowledge base; pass `dryRun` to preview the
   * planned entries without writing (useful while embeddings are unavailable).
   * Detection itself never touches the KB.
   */
  async syncGitChangesToRegister(opts: {
    since?: string;
    limit?: number;
    /**
     * Required: the documents this writes are org-scoped. It was optional and
     * defaulted to org 1, which would have filed every change record into the
     * first tenant. This method currently has no callers, so requiring the
     * organization costs nothing now and makes the compiler demand it from
     * whoever wires it up.
     */
    organizationId: number;
    dryRun?: boolean;
  }): Promise<{
    recorded: number;
    dryRun: boolean;
    planned: Array<{ documentKey: string; severity: string; features: string[]; explanation: string; sha: string }>;
  }> {
    const { detectChangesFromGit } = await import("./infrastructure/documentation-git-detector.js");
    const { organizationId } = opts;
    const detected = detectChangesFromGit({ since: opts.since, limit: opts.limit });

    const planned = detected.map((c) => ({
      documentKey: `git:${c.shortSha}`,
      severity: c.severity,
      features: c.features,
      explanation: `${c.type}${c.scope ? `(${c.scope})` : ""}${c.breaking ? "!" : ""}: ${c.subject}`,
      sha: c.sha,
    }));

    if (opts.dryRun) return { recorded: 0, dryRun: true, planned };

    let recorded = 0;
    for (const c of detected) {
      const documentKey = `git:${c.shortSha}`;
      const explanation = `${c.type}${c.scope ? `(${c.scope})` : ""}${c.breaking ? "!" : ""}: ${c.subject}`;
      await knowledgeService.createDocument({
        // Deterministic title keyed by SHA → the KB upserts, so re-runs dedup.
        title: `[Documentation change] ${documentKey}`,
        summary: explanation,
        sourceType: "text",
        textContent:
          `Commit ${c.sha} (${c.date})\n${explanation}\n\n` +
          `Affected features: ${c.features.join(", ") || "—"}\n\nFiles:\n${c.files.map((f) => "  " + f).join("\n")}`,
        metadata: {
          generatedFrom: CHANGE_REGISTER_SOURCE,
          documentKey,
          documentTitle: c.subject,
          specType: "module" as DocumentationSpecType,
          kind: "change" as DocumentationChangeKind,
          severity: c.severity, // the new axis the plan called for
          explanation,
          occurredAt: c.date,
          commitSha: c.sha,
          features: c.features, // from the git file→feature mapping
          interfaces: [],
          releaseIds: [],
          status: "draft",
          sourceEventKey: c.sha,
          source: "git-detector",
        },
      }, getSystemOrgContext(organizationId));
      recorded++;
    }
    return { recorded, dryRun: false, planned };
  }

  /**
   * Draft a versioned release from git-detected changes (Phase 1). Groups the
   * severity-tagged commits, suggests a semver bump (breaking→major, feature→
   * minor, else patch from the current package version), and renders grouped
   * markdown. Fully deterministic — no LLM/embeddings — so it works while
   * providers are down. Returns the draft; persisting it via createReleaseNotes
   * requires the (embedding-backed) register entries to exist first.
   */
  async draftReleaseFromGit(opts: {
    since?: string;
    limit?: number;
    baseVersion?: string;
  } = {}): Promise<{ suggestedVersion: string; bump: "major" | "minor" | "patch"; changeCount: number; markdown: string }> {
    const { detectChangesFromGit } = await import("./infrastructure/documentation-git-detector.js");
    const changes = detectChangesFromGit({ since: opts.since, limit: opts.limit });

    const groups = {
      breaking: changes.filter((c) => c.severity === "breaking"),
      feature: changes.filter((c) => c.severity === "feature"),
      fix: changes.filter((c) => c.severity === "fix"),
      chore: changes.filter((c) => c.severity === "chore"),
    };
    const bump: "major" | "minor" | "patch" =
      groups.breaking.length ? "major" : groups.feature.length ? "minor" : "patch";

    let base = opts.baseVersion;
    if (!base) {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const pkg = JSON.parse(await fs.default.readFile(path.default.resolve(process.cwd(), "package.json"), "utf-8"));
        base = pkg.version || "1.0.0";
      } catch { base = "1.0.0"; }
    }
    const [maj, min, pat] = (base ?? "1.0.0").split(".").map((n) => parseInt(n, 10) || 0);
    const suggestedVersion =
      bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

    const section = (title: string, items: typeof changes) =>
      items.length
        ? `\n## ${title}\n` +
          items.map((c) => `- ${c.subject}${c.features.length ? ` — _${c.features.join(", ")}_` : ""} (${c.shortSha})`).join("\n") +
          "\n"
        : "";

    const markdown =
      `# Release v${suggestedVersion}\n\n` +
      `_${changes.length} change${changes.length === 1 ? "" : "s"} since ${opts.since ?? `the last ${opts.limit ?? 50} commits`} · ${bump} bump from v${base}_\n` +
      section("⚠️ Breaking Changes", groups.breaking) +
      section("✨ Features", groups.feature) +
      section("🐛 Fixes", groups.fix) +
      section("🔧 Maintenance", groups.chore);

    return { suggestedVersion, bump, changeCount: changes.length, markdown };
  }

  /** Promote an applied capability document into Documentation and its register. */
  async publishCapabilityDocumentationChange(input: {
    organizationId: number;
    manifest: CapabilityManifest;
    markdown: string;
    revision: number;
    source: "code" | "docs";
    changeKind: "new" | "behavioral" | "documentation";
    changedFields: Array<{ path: string; changeType: string; old: unknown; new: unknown }>;
    contentHash: string;
    docPath?: string;
    gitCommit?: string | null;
  }): Promise<void> {
    const { manifest } = input;
    const title = `Capability ${manifest.capability_id} — Capability Reference`;
    const orgContext = getSystemOrgContext(input.organizationId);
    const previous = await knowledgeService.getDocumentByTitle(title, orgContext);
    const sourceEventKey = [input.organizationId, manifest.capability_id, input.revision, input.contentHash].join(":");
    const verb = input.changeKind === "new" ? "Added" : input.changeKind === "behavioral" ? "Changed" : "Updated documentation for";
    const fields = input.changedFields.map((field) => field.path).join(", ");
    const explanation = `${verb} capability ${manifest.metadata.display_name} v${manifest.capability_version}` +
      `${fields ? ` (${fields})` : ""}.`;

    // Record before upsert so a failed upsert can be retried without losing the
    // original before/after delta. sourceEventKey prevents duplicate records.
    await this.recordDocumentationChange({
      documentKey: `capability:${manifest.capability_id}`,
      documentTitle: title,
      specType: "capability",
      previous: previous?.textContent ?? "",
      next: input.markdown,
      organizationId: input.organizationId,
      sourceEventKey,
      explanation,
      extraMetadata: {
        capabilityId: manifest.capability_id,
        capabilityVersion: manifest.capability_version,
        schemaVersion: manifest.schema_version,
        revision: input.revision,
        source: input.source,
        changeKind: input.changeKind,
        changedFields: input.changedFields,
        contentHash: input.contentHash,
        docPath: input.docPath ?? null,
        gitCommit: input.gitCommit ?? null,
      },
    });

    await knowledgeService.createDocument({
      title,
      summary: manifest.documentation_meta.summary || manifest.metadata.description,
      sourceType: "text",
      textContent: input.markdown,
      metadata: {
        generatedFrom: "documentation-service",
        specType: "capability",
        featureId: `capability:${manifest.capability_id}`,
        capabilityId: manifest.capability_id,
        capabilityVersion: manifest.capability_version,
        schemaVersion: manifest.schema_version,
        revision: input.revision,
        riskProfile: manifest.runtime_context.risk_profile,
        fingerprint: input.contentHash,
        sourceEventKey,
        docPath: input.docPath ?? null,
        gitCommit: input.gitCommit ?? null,
      },
    }, orgContext);
  }

  async getChangeRegister(organizationId: number): Promise<DocumentationChange[]> {
    const rows = await knowledgeService.listDocumentsByGeneratedFrom(
      CHANGE_REGISTER_SOURCE,
      getSystemOrgContext(organizationId),
    );
    return rows.map((row: any) => {
      const meta = row.metadata ?? {};
      return {
        id: row.id,
        documentKey: meta.documentKey ?? "unknown",
        documentTitle: meta.documentTitle ?? row.title,
        specType: meta.specType ?? "module",
        kind: meta.kind ?? "change",
        explanation: meta.explanation ?? row.summary ?? "Documentation changed.",
        occurredAt: meta.occurredAt ?? row.createdAt?.toISOString?.() ?? String(row.createdAt),
        addedLines: Number(meta.addedLines ?? 0),
        removedLines: Number(meta.removedLines ?? 0),
        diff: row.textContent ?? "",
        releaseIds: Array.isArray(meta.releaseIds) ? meta.releaseIds : [],
        hidden: meta.hidden === true,
        addedRoutes: Array.isArray(meta.addedRoutes) ? meta.addedRoutes : [],
        removedRoutes: Array.isArray(meta.removedRoutes) ? meta.removedRoutes : [],
        addedUiRoutes: Array.isArray(meta.addedUiRoutes) ? meta.addedUiRoutes : [],
        removedUiRoutes: Array.isArray(meta.removedUiRoutes) ? meta.removedUiRoutes : [],
        updatedUiRoutes: Array.isArray(meta.updatedUiRoutes) ? meta.updatedUiRoutes : [],
        interfaces: Array.isArray(meta.interfaces) ? meta.interfaces : [],
        features: Array.isArray(meta.features) ? meta.features : [],
        capabilityVersion: typeof meta.capabilityVersion === "string" ? meta.capabilityVersion : undefined,
        revision: Number.isInteger(meta.revision) ? meta.revision : undefined,
        changedFields: Array.isArray(meta.changedFields) ? meta.changedFields : [],
      } satisfies DocumentationChange;
    });
  }

  // Toggle whether a register entry is hidden from the default register view.
  // Stored on the change document's metadata so it survives regeneration and can
  // always be reversed (it is not a delete).
  async setChangeVisibility(
    changeId: number,
    organizationId: number,
    hidden: boolean,
  ): Promise<{ id: number; hidden: boolean }> {
    const orgContext = getSystemOrgContext(organizationId);
    const changeDocument = await knowledgeService.getDocumentById(changeId, orgContext);
    const meta = changeDocument?.metadata ?? {};
    if (!changeDocument || meta.generatedFrom !== CHANGE_REGISTER_SOURCE) {
      throw new NotFoundError("Change register entry not found");
    }
    await knowledgeService.updateDocument(changeId, {
      metadata: { ...meta, hidden },
    }, orgContext);
    return { id: changeId, hidden };
  }

  async createReleaseNotes(
    organizationId: number,
    input: { title: string; version?: string | null; changeIds: number[]; hideAddedFromRegister?: boolean },
  ): Promise<DocumentationRelease> {
    const title = input.title?.trim();
    const uniqueIds = [...new Set(input.changeIds)].filter(Number.isInteger);
    if (!title) throw new BadRequestError("Release title is required");
    if (uniqueIds.length === 0) throw new BadRequestError("Select at least one documentation change");

    const register = await this.getChangeRegister(organizationId);
    const selected = uniqueIds.map((id) => register.find((entry) => entry.id === id)).filter(Boolean) as DocumentationChange[];
    if (selected.length !== uniqueIds.length) throw new BadRequestError("One or more selected changes are unavailable");

    const version = input.version?.trim() || null;
    validateSemanticVersion(version);
    if (version && (await this.getReleaseNotes(organizationId)).some((release) => release.version === version)) {
      throw new BadRequestError(`Release version ${version} already exists`);
    }
    const createdAt = new Date().toISOString();
    const markdown = buildReleaseMarkdown(title, version, createdAt, selected);

    const document = await knowledgeService.createDocument({
      title: `[Documentation release] ${title} ${randomUUID()}`,
      summary: `${selected.length} documentation change${selected.length === 1 ? "" : "s"}.`,
      sourceType: "text",
      textContent: markdown,
      metadata: {
        generatedFrom: RELEASE_NOTES_SOURCE,
        releaseTitle: title,
        version,
        status: "draft",
        createdAt,
        publishedAt: null,
        changeIds: uniqueIds,
      },
    }, getSystemOrgContext(organizationId));

    const orgContext = getSystemOrgContext(organizationId);
    // Sequential (not Promise.all): updateDocument holds a pooled connection for its
    // re-embed/reindex side-effects, so concurrent updates over many changes exhausted
    // the connection pool and failed the save. Counts are small, so sequential is fine.
    for (const changeId of uniqueIds) {
      const changeDocument = await knowledgeService.getDocumentById(changeId, orgContext);
      if (!changeDocument) continue;
      const changeMeta = changeDocument.metadata ?? {};
      const releaseIds = Array.isArray(changeMeta.releaseIds) ? changeMeta.releaseIds : [];
      await knowledgeService.updateDocument(changeId, {
        metadata: {
          ...changeMeta,
          releaseIds: [...new Set([...releaseIds, document.id])],
          // Optionally declutter the register by hiding changes as they are
          // folded into a release. Reversible via setChangeVisibility.
          ...(input.hideAddedFromRegister ? { hidden: true } : {}),
        },
      }, orgContext);
    }

    return { id: document.id, title, version, status: "draft", createdAt, publishedAt: null, changeIds: uniqueIds, markdown };
  }

  async updateReleaseNotes(
    releaseId: number,
    organizationId: number,
    input: { title: string; version?: string | null; changeIds: number[]; hideAddedFromRegister?: boolean },
  ): Promise<DocumentationRelease> {
    const title = input.title?.trim();
    const uniqueIds = [...new Set(input.changeIds)].filter(Number.isInteger);
    if (!title) throw new BadRequestError("Release title is required");
    if (uniqueIds.length === 0) throw new BadRequestError("Select at least one documentation change");

    const orgContext = getSystemOrgContext(organizationId);
    const document = await knowledgeService.getDocumentById(releaseId, orgContext);
    const meta = document?.metadata ?? {};
    if (!document || meta.generatedFrom !== RELEASE_NOTES_SOURCE) throw new NotFoundError("Release notes not found");
    if (meta.status === "published") throw new BadRequestError("Published release notes cannot be edited");

    const register = await this.getChangeRegister(organizationId);
    const selected = uniqueIds.map((id) => register.find((entry) => entry.id === id)).filter(Boolean) as DocumentationChange[];
    if (selected.length !== uniqueIds.length) throw new BadRequestError("One or more selected changes are unavailable");

    const version = input.version?.trim() || null;
    validateSemanticVersion(version);
    if (version && (await this.getReleaseNotes(organizationId)).some((release) => release.id !== releaseId && release.version === version)) {
      throw new BadRequestError(`Release version ${version} already exists`);
    }
    const createdAt = meta.createdAt ?? document.createdAt?.toISOString?.() ?? new Date().toISOString();
    const markdown = buildReleaseMarkdown(title, version, createdAt, selected);
    const previousIds = Array.isArray(meta.changeIds) ? meta.changeIds : [];
    const updated = await knowledgeService.updateDocument(releaseId, {
      summary: `${selected.length} documentation change${selected.length === 1 ? "" : "s"}.`,
      textContent: markdown,
      metadata: { ...meta, releaseTitle: title, version, changeIds: uniqueIds },
    }, orgContext);

    const affectedIds = [...new Set([...previousIds, ...uniqueIds])];
    // Update each affected change document's release links sequentially. updateDocument
    // holds a pooled connection while it runs its own side-effects (re-embed / reindex),
    // so firing all of these concurrently via Promise.all exhausted the connection pool
    // and made one of the reads time out ("Failed query" -> 500 -> "[object Object]" toast).
    // The counts here are small (selected changes), so sequential is fine.
    for (const changeId of affectedIds) {
      const changeDocument = await knowledgeService.getDocumentById(changeId, orgContext);
      if (!changeDocument) continue;
      const changeMeta = changeDocument.metadata ?? {};
      const releaseIds = Array.isArray(changeMeta.releaseIds) ? changeMeta.releaseIds : [];
      const isNowInRelease = uniqueIds.includes(changeId);
      const nextReleaseIds = isNowInRelease
        ? [...new Set([...releaseIds, releaseId])]
        : releaseIds.filter((id: number) => id !== releaseId);
      await knowledgeService.updateDocument(changeId, {
        metadata: {
          ...changeMeta,
          releaseIds: nextReleaseIds,
          ...(input.hideAddedFromRegister && isNowInRelease ? { hidden: true } : {}),
        },
      }, orgContext);
    }

    return { id: updated.id, title, version, status: "draft", createdAt, publishedAt: null, changeIds: uniqueIds, markdown };
  }

  async getReleaseNotes(organizationId: number): Promise<DocumentationRelease[]> {
    const rows = await knowledgeService.listDocumentsByGeneratedFrom(
      RELEASE_NOTES_SOURCE,
      getSystemOrgContext(organizationId),
    );
    return rows.map((row: any) => {
      const meta = row.metadata ?? {};
      return {
        id: row.id,
        title: meta.releaseTitle ?? row.title,
        version: meta.version ?? null,
        status: meta.status === "published" ? "published" : "draft",
        createdAt: meta.createdAt ?? row.createdAt?.toISOString?.() ?? String(row.createdAt),
        publishedAt: meta.publishedAt ?? null,
        changeIds: Array.isArray(meta.changeIds) ? meta.changeIds : [],
        markdown: row.textContent ?? "",
      } satisfies DocumentationRelease;
    });
  }

  async publishReleaseNotes(releaseId: number, organizationId: number): Promise<DocumentationRelease> {
    const orgContext = getSystemOrgContext(organizationId);
    const document = await knowledgeService.getDocumentById(releaseId, orgContext);
    const meta = document?.metadata ?? {};
    if (!document || meta.generatedFrom !== RELEASE_NOTES_SOURCE) throw new NotFoundError("Release notes not found");
    const version = typeof meta.version === "string" ? meta.version.trim() : "";
    if (!version) throw new BadRequestError("A semantic version is required before publishing release notes");
    validateSemanticVersion(version);
    if ((await this.getReleaseNotes(organizationId)).some((release) => release.id !== releaseId && release.status === "published" && release.version === version)) {
      throw new BadRequestError(`Published release version ${version} already exists`);
    }
    const publishedAt = new Date().toISOString();
    const updated = await knowledgeService.updateDocument(releaseId, {
      metadata: { ...meta, status: "published", publishedAt },
    }, orgContext);
    return {
      id: updated.id,
      title: meta.releaseTitle ?? updated.title,
      version: meta.version ?? null,
      status: "published",
      createdAt: meta.createdAt ?? updated.createdAt?.toISOString?.() ?? String(updated.createdAt),
      publishedAt,
      changeIds: Array.isArray(meta.changeIds) ? meta.changeIds : [],
      markdown: updated.textContent ?? "",
    };
  }

  // The expensive part — filesystem scan, route/import analysis, ontology and
  // MCP cross-referencing — is org-independent and cached. Per-org freshness is
  // overlaid cheaply from persisted-document timestamps in getFeatures().
  private async getScannedFeatures(): Promise<ScannedFeature[]> {
    if (this.scanCache && this.scanCachedAt && Date.now() - this.scanCachedAt < this.cacheMaxAgeMs) {
      return this.scanCache;
    }

    const domainDir = path.join(process.cwd(), "server", "domain");
    logger.info(`Scanning features in: ${domainDir}`);
    const scanned: ScannedFeature[] = [];

    try {
      const entries = await fs.readdir(domainDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const featureName = entry.name;
        const featurePath = path.join(domainDir, featureName);

        const hasIndex = await fs.access(path.join(featurePath, "index.ts")).then(() => true).catch(() => false);
        const files = await listSourceFiles(featurePath);
        const nonTestCount = files.filter((f) => !/\.(test|spec)\.tsx?$/.test(path.basename(f))).length;
        // A module qualifies as a documented feature if it exposes a public
        // surface (index.ts) OR carries substantive code (>= 4 non-test source
        // files). This surfaces real subsystems that never added an index.ts
        // (integrations, tools, org, schedules, swarm, system, ...) while still
        // excluding 1-3 file stubs.
        if (!hasIndex && nonTestCount < 4) {
          logger.debug(`Skipping ${featureName}: no index.ts and only ${nonTestCount} source file(s)`);
          continue;
        }

        const { apis, dependencies, lastSourceModifiedMs } = await scanFeature(featurePath, featureName, files);
        const resourceTypes = findRelatedResourceTypes(featureName);
        const mcpTools = findRelatedMcpTools(featureName);

        scanned.push({
          id: featureName,
          name: displayName(featureName),
          description:
            resourceTypes[0]?.description ??
            `Domain module exposing ${apis.length} route(s) with ${dependencies.length} internal dependenc${dependencies.length === 1 ? "y" : "ies"}.`,
          apis,
          dependencies,
          relatedResourceTypes: resourceTypes.map((r) => r.label),
          mcpTools: mcpTools.map((t) => t.name),
          verifiedUiTests: [],
          directory_path: `server/domain/${featureName}`,
          lastSourceModifiedMs,
        });
        logger.info(`Found feature: ${featureName}`);
      }
    } catch (err: any) {
      logger.error(`Failed to scan features: ${err.message}`);
    }

    // Cross-cutting subsystems that live inside shared modules (Cycles,
    // Workstreams) — added as first-class features so they're documented too.
    // Guard against id collisions: if a real server/domain/<id> module ever
    // exists, it wins and the supplemental of the same id is skipped, avoiding
    // duplicate rows and an ambiguous features.find(id).
    try {
      const existingIds = new Set(scanned.map((s) => s.id));
      for (const sf of await scanSupplementalFeatures()) {
        if (existingIds.has(sf.id)) {
          logger.warn(`Supplemental feature "${sf.id}" shadows a real server/domain/${sf.id} module — skipping`);
          continue;
        }
        scanned.push(sf);
        existingIds.add(sf.id);
      }
    } catch (err: any) {
      logger.error(`Failed to scan supplemental features: ${err.message}`);
    }

    this.scanCache = scanned;
    this.scanCachedAt = Date.now();
    return scanned;
  }

  async getFeatures(organizationId?: number): Promise<Feature[]> {
    const scanned = await this.getScannedFeatures();

    // Resolve real per-org documentation status from persisted spec metadata.
    let specMeta = new Map<string, { updatedAt: Date; fingerprint: string | null; summary?: string | null }>();
    if (organizationId != null) {
      try {
        specMeta = await knowledgeService.getGeneratedSpecMeta(getSystemOrgContext(organizationId));
      } catch (err: any) {
        logger.error(`Failed to load spec meta for org ${organizationId}: ${err.message}`);
      }
    }

    const features = await Promise.all(scanned.map(async (s) => {
      const staticDesc = await getStaticDescription(s.id);
      const feature: Feature = {
        id: s.id,
        name: s.name,
        description: staticDesc ?? s.description,
        version: "1.0.0",
        components: [],
        apis: s.apis,
        dependencies: s.dependencies,
        relatedResourceTypes: s.relatedResourceTypes,
        mcpTools: s.mcpTools,
        maintainers: ["System Architect"],
        verifiedUiTests: s.verifiedUiTests,
        directory_path: s.directory_path,
        last_updated: "",
        documentation_status: "missing",
      };

      // Outdated = the stored fingerprint no longer matches the current facts.
      const meta = specMeta.get(specDocumentTitle(s.name));
      const currentFp = fingerprint(buildReferenceMarkdown(feature));
      if (!meta) {
        feature.documentation_status = "missing";
        feature.last_updated = new Date(s.lastSourceModifiedMs || Date.now()).toISOString();
      } else {
        feature.documentation_status = meta.fingerprint === currentFp ? "up-to-date" : "outdated";
        feature.last_updated = meta.updatedAt.toISOString();
        if (meta.summary) {
          feature.description = meta.summary;
        }
      }

      return feature;
    }));

    return features;
  }

  async getStatus(organizationId?: number): Promise<DocumentationStatus> {
    const features = await this.getFeatures(organizationId);
    const now = Date.now();

    // Roll the singleton specs (API, UI, capability) into the same status model
    // as the per-module specs so Coverage / Total docs / Freshness account for all.
    const entries = features.map(f => ({
      feature_id: f.id,
      name: f.name,
      documentation_status: f.documentation_status,
      last_updated: f.last_updated,
      total_documents: 1,
      up_to_date: f.documentation_status === 'up-to-date',
    }));

    if (organizationId != null) {
      const [api, ui, capability] = await Promise.all([
        this.getApiSpec(organizationId),
        this.getUiSpec(organizationId),
        this.getCapabilitySpec(organizationId),
      ]);
      for (const s of [api, ui, capability]) {
        entries.push({
          feature_id: s.featureId,
          name: s.title,
          documentation_status: s.status,
          last_updated: s.generatedAt ?? new Date(now).toISOString(),
          total_documents: 1,
          up_to_date: s.status === 'up-to-date',
        });
      }
    }

    const total = entries.length;
    const missing = entries.filter(e => e.documentation_status === 'missing').length;
    const outdated = entries.filter(e => e.documentation_status === 'outdated').length;
    const upToDate = total - missing - outdated;

    // Ages derived from real persisted-document timestamps (entries that have a
    // generated spec, i.e. up-to-date or outdated).
    const ageDays = entries
      .filter(e => e.documentation_status !== 'missing')
      .map(e => (now - new Date(e.last_updated).getTime()) / 86_400_000);
    const averageAge = ageDays.length ? ageDays.reduce((a, b) => a + b, 0) / ageDays.length : 0;
    const oldestAge = ageDays.length ? Math.max(...ageDays) : 0;

    return {
      overall_status: {
        total_documents: total,
        up_to_date: upToDate,
        outdated: outdated,
        missing: missing,
        average_age_days: Math.round(averageAge),
        oldest_document_days: Math.round(oldestAge),
        freshness_score: Math.round((upToDate / total) * 100) || 0
      },
      features: entries,
      maintenance_status: {
        scheduler_running: getDocumentationMaintenanceStatus().running,
        last_maintenance_run: getDocumentationMaintenanceStatus().lastRunAt
      }
    };
  }

  async generateForFeature(featureId: string, organizationId: number): Promise<boolean> {
    logger.info(`Generating documentation for feature: ${featureId}`);

    const features = await this.getFeatures(organizationId);
    const feature = features.find(f => f.id === featureId);
    if (!feature) {
      throw new NotFoundError(`Unknown feature: ${featureId}`);
    }

    const markdown = await generateSpecMarkdown(feature);
    const orgContext = getSystemOrgContext(organizationId);
    const previous = await knowledgeService.getDocumentByTitle(specDocumentTitle(feature.name), orgContext);

    // The generated markdown has already had one bounded AI-enrichment pass.
    // Re-running AI for the card summary and then again for the change-register
    // sentence made a single click wait for as many as three serial timeouts.
    // The extracted/static feature description and deterministic change summary
    // are already grounded in the same implementation facts, so keep the
    // synchronous regeneration path to one optional AI call.
    const summary = feature.description;

    await knowledgeService.createDocument(
      {
        title: specDocumentTitle(feature.name),
        summary,
        sourceType: "text",
        textContent: markdown,
        metadata: {
          generatedFrom: "documentation-service",
          specType: "module",
          featureId,
          fingerprint: fingerprint(buildReferenceMarkdown(feature)),
        },
      },
      orgContext,
    );

    const change = buildDocumentationDiff(previous?.textContent ?? "", markdown);
    await this.recordDocumentationChange({
      documentKey: featureId,
      documentTitle: specDocumentTitle(feature.name),
      specType: "module",
      previous: previous?.textContent ?? "",
      next: markdown,
      organizationId,
      explanation: change
        ? deterministicReleaseNoteSummary(
            specDocumentTitle(feature.name),
            change.kind,
            previous?.textContent ?? "",
            markdown,
          )
        : undefined,
    });

    await queueExtractionJob({
      type: 'documentation',
      featureId,
      schemaId: 0, // Not used for documentation type
      organizationId,
    });

    return true;
  }

  async getFeatureSpec(featureId: string, organizationId: number): Promise<FeatureSpec> {
    const features = await this.getFeatures(organizationId);
    const feature = features.find(f => f.id === featureId);
    if (!feature) {
      throw new NotFoundError(`Unknown feature: ${featureId}`);
    }

    const orgContext = getSystemOrgContext(organizationId);
    const stored = await knowledgeService.getDocumentByTitle(specDocumentTitle(feature.name), orgContext);

    if (stored?.textContent) {
      return {
        featureId,
        title: stored.title,
        summary: stored.summary ?? feature.description,
        markdown: stored.textContent,
        status: feature.documentation_status,
        generatedAt: (stored.updatedAt ?? stored.createdAt)?.toISOString?.() ?? stored.updatedAt ?? null,
        persisted: true,
      };
    }

    // Never generated/persisted yet — build from current analysis so the reader
    // always gets a complete spec rather than an error.
    return {
      featureId,
      title: specDocumentTitle(feature.name),
      summary: feature.description,
      markdown: await buildFeatureMarkdown(feature),
      status: feature.documentation_status,
      generatedAt: null,
      persisted: false,
    };
  }

  async getApiSpec(organizationId: number): Promise<ApiSpecResponse> {
    const features = await this.getFeatures(organizationId);
    const endpoints = buildApiEndpoints(features);
    const orgContext = getSystemOrgContext(organizationId);
    const stored = await knowledgeService.getDocumentByTitle(API_SPEC_TITLE, orgContext);

    if (stored?.textContent) {
      const storedFp = (stored.metadata as { fingerprint?: string } | null)?.fingerprint ?? null;
      const status: Feature["documentation_status"] =
        storedFp === fingerprint(buildApiReferenceMarkdown(features)) ? "up-to-date" : "outdated";
      return {
        featureId: "api",
        title: stored.title,
        summary: stored.summary ?? `Platform-wide API reference — ${endpoints.length} endpoints.`,
        markdown: stored.textContent,
        status,
        generatedAt: (stored.updatedAt ?? stored.createdAt)?.toISOString?.() ?? null,
        persisted: true,
        endpoints,
      };
    }

    // Not generated yet — deterministic (no LLM) build so the GET stays fast.
    const withApis = features.filter((f) => f.apis.length > 0);
    const markdown = [
      `# ${API_SPEC_TITLE}`,
      "",
      `${endpoints.length} endpoints across ${withApis.length} modules.`,
      "",
      buildApiReferenceMarkdown(features),
    ].join("\n");
    return {
      featureId: "api",
      title: API_SPEC_TITLE,
      summary: `Platform-wide API reference — ${endpoints.length} endpoints.`,
      markdown,
      status: "missing",
      generatedAt: null,
      persisted: false,
      endpoints,
    };
  }

  async generateApiSpec(organizationId: number): Promise<boolean> {
    logger.info("Generating platform API spec");
    this.clearCache();
    const features = await this.getFeatures(organizationId);
    const endpoints = buildApiEndpoints(features);
    const markdown = await generateApiSpecMarkdown(features);
    const orgContext = getSystemOrgContext(organizationId);
    const previous = await knowledgeService.getDocumentByTitle(API_SPEC_TITLE, orgContext);

    await knowledgeService.createDocument(
      {
        title: API_SPEC_TITLE,
        summary: `Platform-wide API reference — ${endpoints.length} endpoints.`,
        sourceType: "text",
        textContent: markdown,
        metadata: {
          generatedFrom: "documentation-service",
          specType: "api",
          fingerprint: fingerprint(buildApiReferenceMarkdown(features)),
        },
      },
      orgContext,
    );
    await this.recordDocumentationChange({
      documentKey: "api",
      documentTitle: API_SPEC_TITLE,
      specType: "api",
      previous: previous?.textContent ?? "",
      next: markdown,
      organizationId,
    });
    return true;
  }

  private async getUiRoutes(): Promise<UiSpecData> {
    if (this.uiScanCache && this.uiScanCachedAt && Date.now() - this.uiScanCachedAt < this.cacheMaxAgeMs) {
      return this.uiScanCache;
    }
    const data = await scanUiRoutes();
    this.uiScanCache = data;
    this.uiScanCachedAt = Date.now();
    return data;
  }

  async getUiSpec(organizationId: number): Promise<FeatureSpec> {
    const data = await this.getUiRoutes();
    const orgContext = getSystemOrgContext(organizationId);
    const stored = await knowledgeService.getDocumentByTitle(UI_SPEC_TITLE, orgContext);

    if (stored?.textContent) {
      const storedFp = (stored.metadata as { fingerprint?: string } | null)?.fingerprint ?? null;
      const status: Feature["documentation_status"] =
        storedFp === fingerprint(buildUiReferenceMarkdown(data)) ? "up-to-date" : "outdated";
      return {
        featureId: "ui",
        title: stored.title,
        summary: stored.summary ?? `SPA route map — ${data.totalRoutes} routes.`,
        markdown: stored.textContent,
        status,
        generatedAt: (stored.updatedAt ?? stored.createdAt)?.toISOString?.() ?? null,
        persisted: true,
      };
    }

    // Not generated yet — deterministic (no LLM) build so the GET stays fast.
    const markdown = [
      `# ${UI_SPEC_TITLE}`,
      "",
      `${data.totalRoutes} routes across ${data.bySection.length} sections.`,
      "",
      buildUiReferenceMarkdown(data),
    ].join("\n");
    return {
      featureId: "ui",
      title: UI_SPEC_TITLE,
      summary: `SPA route map — ${data.totalRoutes} routes.`,
      markdown,
      status: "missing",
      generatedAt: null,
      persisted: false,
    };
  }

  async generateUiSpec(organizationId: number): Promise<boolean> {
    logger.info("Generating platform UI spec");
    this.clearCache();
    const data = await this.getUiRoutes();
    const markdown = await generateUiSpecMarkdown(data);
    const orgContext = getSystemOrgContext(organizationId);
    const previous = await knowledgeService.getDocumentByTitle(UI_SPEC_TITLE, orgContext);

    await knowledgeService.createDocument(
      {
        title: UI_SPEC_TITLE,
        summary: `SPA route map — ${data.totalRoutes} routes across ${data.bySection.length} sections.`,
        sourceType: "text",
        textContent: markdown,
        metadata: {
          generatedFrom: "documentation-service",
          specType: "ui",
          fingerprint: fingerprint(buildUiReferenceMarkdown(data)),
        },
      },
      orgContext,
    );
    await this.recordDocumentationChange({
      documentKey: "ui",
      documentTitle: UI_SPEC_TITLE,
      specType: "ui",
      previous: previous?.textContent ?? "",
      next: markdown,
      organizationId,
    });
    return true;
  }

  /**
   * The platform-wide answer to "What can Oddjob do?".
   *
   * Follows the API/UI singleton pattern exactly: freshness is decided by
   * comparing the stored fingerprint against a hash of the CURRENT extracted
   * facts, so shipping a new agent tool or capability contract flips the spec to
   * `outdated` on the next read — with no scheduler, watcher, or manual step.
   */
  async getCapabilitySpec(organizationId: number): Promise<CapabilitySpecResponse> {
    const facts = await getCapabilityFacts();
    const orgContext = getSystemOrgContext(organizationId);
    const stored = await knowledgeService.getDocumentByTitle(CAPABILITY_SPEC_TITLE, orgContext);
    const currentFingerprint = fingerprint(buildCapabilityReferenceMarkdown(facts));
    const summary = `Platform capability catalog — ${facts.counts.capabilities} capabilities across ${facts.counts.pillars} pillars.`;

    if (stored?.textContent) {
      const storedFp = (stored.metadata as { fingerprint?: string } | null)?.fingerprint ?? null;
      return {
        featureId: "capability",
        title: stored.title,
        summary: stored.summary ?? summary,
        markdown: stored.textContent,
        status: storedFp === currentFingerprint ? "up-to-date" : "outdated",
        generatedAt: (stored.updatedAt ?? stored.createdAt)?.toISOString?.() ?? null,
        persisted: true,
        fingerprint: currentFingerprint,
        catalog: facts,
      };
    }

    // Not generated yet — deterministic (no LLM) build so the GET stays fast.
    const markdown = [
      `# ${CAPABILITY_SPEC_TITLE}`,
      "",
      `${facts.counts.capabilities} capabilities across ${facts.counts.pillars} pillars.`,
      "",
      buildCapabilityReferenceMarkdown(facts),
    ].join("\n");
    return {
      featureId: "capability",
      title: CAPABILITY_SPEC_TITLE,
      summary,
      markdown,
      status: "missing",
      generatedAt: null,
      persisted: false,
      fingerprint: currentFingerprint,
      catalog: facts,
    };
  }

  async generateCapabilitySpec(organizationId: number): Promise<boolean> {
    logger.info("Generating platform capability spec");
    this.clearCache();
    // force=true: a regenerate must never be decided by a stale facts cache.
    const facts = await getCapabilityFacts(true);
    const markdown = await generateCapabilitySpecMarkdown(facts);
    const orgContext = getSystemOrgContext(organizationId);
    const previous = await knowledgeService.getDocumentByTitle(CAPABILITY_SPEC_TITLE, orgContext);

    await knowledgeService.createDocument(
      {
        title: CAPABILITY_SPEC_TITLE,
        summary: `Platform capability catalog — ${facts.counts.capabilities} capabilities, ${facts.totalAgentTools} agent tools, ${facts.mcpToolCount} MCP tools.`,
        sourceType: "text",
        textContent: markdown,
        metadata: {
          generatedFrom: "documentation-service",
          specType: "capability",
          featureId: "capability",
          fingerprint: fingerprint(buildCapabilityReferenceMarkdown(facts)),
        },
      },
      orgContext,
    );
    await this.recordDocumentationChange({
      documentKey: "capability",
      documentTitle: CAPABILITY_SPEC_TITLE,
      specType: "capability",
      previous: previous?.textContent ?? "",
      next: markdown,
      organizationId,
    });
    return true;
  }

  /**
   * The org overlay: which catalog entries this organization can actually use
   * right now. Deliberately NOT fingerprinted and NOT part of the stored spec —
   * it changes whenever a credential is added or an MCP server connects, and
   * folding that into the platform hash would fill the change register with
   * per-tenant noise that has nothing to do with what Oddjob can do.
   *
   * Every source degrades independently: a failing lookup reports `null` for
   * that section rather than failing the whole overlay, because a partial
   * availability answer is far more useful than none.
   */
  async getCapabilityAvailability(organizationId: number): Promise<CapabilityAvailabilityOverlay> {
    const [missions, credentialEntityTypes, connectedMcpTools, installedApps] = await Promise.all([
      (async () => {
        const { missionService } = await import("@domain/mission/index.js");
        const rows = await missionService.listMissions(organizationId);
        return rows
          .map((mission: any) => ({
            id: mission.id as number,
            name: String(mission.name ?? ""),
            status: String(mission.status ?? "unknown"),
            purpose: String(
              mission.capabilityContract?.purpose ?? mission.description ?? mission.objective ?? mission.name ?? "",
            ),
            hasStructuredContract: !!mission.capabilityContract?.purpose,
          }))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
      })().catch((error) => {
        logger.warn(`Capability availability: mission lookup failed — ${(error as Error).message}`);
        return null;
      }),
      (async () => {
        const { db } = await import("@server/db/index.js");
        const { encryptedCredentials } = await import("@shared/schema/encrypted-credentials.js");
        const { eq, sql: rawSql } = await import("drizzle-orm");
        const rows = await db
          .select({ entityType: encryptedCredentials.entityType, count: rawSql<number>`count(*)::int` })
          .from(encryptedCredentials)
          .where(eq(encryptedCredentials.organizationId, organizationId))
          .groupBy(encryptedCredentials.entityType);
        return rows
          .map((row) => ({ entityType: row.entityType, credentialCount: Number(row.count) }))
          .sort((a, b) => a.entityType.localeCompare(b.entityType));
      })().catch((error) => {
        logger.warn(`Capability availability: credential lookup failed — ${(error as Error).message}`);
        return null;
      }),
      (async () => {
        const { mcpClientService } = await import("@domain/integrations/core/mcp-client.service.js");
        return mcpClientService
          .getAllTools()
          .map((tool: { name: string }) => tool.name)
          .sort();
      })().catch((error) => {
        logger.warn(`Capability availability: connected MCP lookup failed — ${(error as Error).message}`);
        return null;
      }),
      (async () => {
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
        const deployments = await appRegistryService.listOrgDeployments(organizationId);
        return (deployments as Array<Record<string, any>>)
          .map((deployment) => ({
            name: String(deployment.name ?? deployment.appName ?? deployment.slug ?? ""),
            slug: String(deployment.slug ?? ""),
            status: String(deployment.status ?? "unknown"),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })().catch((error) => {
        logger.warn(`Capability availability: installed app lookup failed — ${(error as Error).message}`);
        return null;
      }),
    ]);

    return {
      organizationId,
      evaluatedAt: new Date().toISOString(),
      missions,
      configuredCredentials: credentialEntityTypes,
      connectedMcpTools,
      installedApps,
    };
  }

  async searchSpecs(query: string, organizationId: number): Promise<SpecSearchResult[]> {
    const q = query.trim();
    if (q.length === 0) return [];

    const orgContext = getSystemOrgContext(organizationId);
    const rows = await knowledgeService.searchGeneratedSpecs(orgContext, q, 25);

    return rows.map((row) => {
      const meta = row.metadata as { featureId?: string; specType?: DocumentationSpecType } | null;
      const featureId = meta?.featureId ?? "";
      const specType = meta?.specType ?? "module";
      return {
        featureId,
        featureName: featureId ? displayName(featureId) : row.title,
        title: row.title,
        snippet: buildSnippet(row.textContent ?? row.summary ?? "", q),
        specType,
      };
    });
  }

  // force=true rebuilds every feature (manual "Regenerate all" — lets users
  // upgrade existing specs to the enriched format). force=false (daily
  // maintenance) only rebuilds missing/outdated specs to avoid burning LLM
  // budget on specs that haven't changed.
  async generateAll(organizationId: number, force = false): Promise<{ scheduled: number }> {
    if (force) this.clearCache();
    const features = await this.getFeatures(organizationId);
    const targets = force ? features : features.filter(f => f.documentation_status !== 'up-to-date');
    logger.info(`Bulk documentation (force=${force}): regenerating ${targets.length}/${features.length} feature(s)`);
    for (const feature of targets) {
      await this.generateForFeature(feature.id, organizationId);
    }

    // Singleton specs (api, ui, capability): force rebuilds all; otherwise only when stale.
    let singletons = 0;
    const api = await this.getApiSpec(organizationId);
    if (force || api.status !== 'up-to-date') { await this.generateApiSpec(organizationId); singletons++; }
    const ui = await this.getUiSpec(organizationId);
    if (force || ui.status !== 'up-to-date') { await this.generateUiSpec(organizationId); singletons++; }
    const capability = await this.getCapabilitySpec(organizationId);
    if (force || capability.status !== 'up-to-date') { await this.generateCapabilitySpec(organizationId); singletons++; }

    return { scheduled: targets.length + singletons };
  }
}

export const documentationService = new DocumentationService();
