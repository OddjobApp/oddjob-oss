import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import type { ParsedTest } from "./e2e-test-indexer.service.js";

const logger = createLogger("UIBehaviorReconciler");

export type UIBehaviorKind = "navigation" | "action" | "submission" | "state";

export interface UIBehaviorContract {
  id: string;
  name: string;
  kind: UIBehaviorKind;
  route: string | null;
  actor: string;
  preconditions: string[];
  action: string;
  expectedOutcome: string;
  sourceFile: string;
  sourceRefs: string[];
  confidence: number;
  risk: "low" | "medium" | "high";
  needsClarification: boolean;
  introducedByVersionId: string;
  documentationContext?: string;
}

export interface BehaviorCoverage {
  behavior: UIBehaviorContract;
  tests: ParsedTest[];
  covered: boolean;
}

export interface ReconcileInput {
  versionId: string;
  changedFiles: string[];
  currentRoot: string;
  previousRoot?: string | null;
  changeSummary?: string;
  documentation?: string;
}

interface UiSignals {
  routes: Set<string>;
  controls: Set<string>;
  submissions: Set<string>;
  endpoints: Set<string>;
}

function stableSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "behavior";
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMatches(content: string, regex: RegExp, group = 1): Set<string> {
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const value = stripMarkup(match[group] ?? "");
    if (value.length >= 2 && value.length <= 120) values.add(value);
  }
  return values;
}

export function extractUiSignals(content: string): UiSignals {
  const routes = new Set<string>([
    ...collectMatches(content, /(?:href|to)\s*=\s*["'`]([^"'`]+)["'`]/g),
    ...collectMatches(content, /setLocation\(\s*["'`]([^"'`]+)["'`]\s*\)/g),
  ]);
  const visibleControls = collectMatches(
    content,
    /<(?:button|Button)\b[^>]*>([\s\S]{1,240}?)<\/(?:button|Button)>/g,
  );
  const ariaControls = collectMatches(content, /aria-label\s*=\s*["'`]([^"'`]+)["'`]/g);
  const controls = new Set<string>([...visibleControls, ...ariaControls]);
  const submissions = collectMatches(content, /<form\b[^>]*[\s\S]{0,200}?onSubmit\s*=\s*\{?([^}\s>]+)/g);
  const endpoints = new Set<string>([
    ...collectMatches(content, /fetch\(\s*["'`]([^"'`]+)["'`]/g),
    ...collectMatches(content, /apiRequest\(\s*["'`]([^"'`]+)["'`]/g),
  ]);
  return { routes, controls, submissions, endpoints };
}

function addedValues(current: Set<string>, previous: Set<string>): string[] {
  return [...current].filter((value) => !previous.has(value));
}

function safeFile(root: string, relativeFile: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, relativeFile);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedFile.startsWith(prefix) ? resolvedFile : null;
}

async function readOptional(filePath: string | null): Promise<string> {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function nearestRoute(signals: UiSignals, relativeFile: string): string | null {
  const route = [...signals.routes].find((candidate) => candidate.startsWith("/"));
  if (route) return route;
  const moduleMatch = relativeFile.replace(/\\/g, "/").match(/client\/src\/modules\/([^/]+)/);
  return moduleMatch ? `/${moduleMatch[1]}` : null;
}

function contractId(route: string | null, kind: UIBehaviorKind, value: string): string {
  const signature = `${route ?? "unknown"}:${kind}:${value}`;
  const digest = createHash("sha1").update(signature).digest("hex").slice(0, 8);
  return `ui.${stableSlug(route ?? "unknown")}.${kind}.${stableSlug(value)}.${digest}`;
}

export function deriveBehaviorContracts(args: {
  versionId: string;
  sourceFile: string;
  current: UiSignals;
  previous: UiSignals;
  changeSummary?: string;
  documentation?: string;
}): UIBehaviorContract[] {
  const route = nearestRoute(args.current, args.sourceFile);
  const addedRoutes = addedValues(args.current.routes, args.previous.routes);
  const addedControls = addedValues(args.current.controls, args.previous.controls);
  const addedSubmissions = addedValues(args.current.submissions, args.previous.submissions);
  const addedEndpoints = addedValues(args.current.endpoints, args.previous.endpoints);
  const contextRefs = [
    `code:${args.sourceFile}`,
    args.changeSummary ? `change:${args.changeSummary.slice(0, 160)}` : "",
    args.documentation ? "documentation:ui-spec" : "",
  ].filter(Boolean);

  const contracts: UIBehaviorContract[] = [];
  for (const newRoute of addedRoutes) {
    contracts.push({
      id: contractId(newRoute, "navigation", newRoute),
      name: `Navigate to ${newRoute}`,
      kind: "navigation",
      route: newRoute,
      actor: "authenticated user",
      preconditions: ["The user has an active session"],
      action: `Navigate to ${newRoute}`,
      expectedOutcome: `The ${newRoute} screen is rendered without an application error`,
      sourceFile: args.sourceFile,
      sourceRefs: contextRefs,
      confidence: 0.9,
      risk: "low",
      needsClarification: false,
      introducedByVersionId: args.versionId,
      documentationContext: args.documentation?.slice(0, 2000),
    });
  }

  for (const control of addedControls) {
    const endpoint = addedEndpoints[0];
    contracts.push({
      id: contractId(route, "action", control),
      name: `${control} action`,
      kind: "action",
      route,
      actor: "authenticated user",
      preconditions: ["The related screen is loaded", `The ${control} control is available`],
      action: `Activate ${control}`,
      expectedOutcome: endpoint
        ? `The UI completes its request to ${endpoint} and presents the resulting state without an application error`
        : `The UI presents the resulting state without an application error`,
      sourceFile: args.sourceFile,
      sourceRefs: endpoint ? [...contextRefs, `api:${endpoint}`] : contextRefs,
      confidence: endpoint ? 0.9 : 0.76,
      risk: endpoint && /(?:delete|remove|publish|send|run)/i.test(`${control} ${endpoint}`) ? "medium" : "low",
      needsClarification: !endpoint,
      introducedByVersionId: args.versionId,
      documentationContext: args.documentation?.slice(0, 2000),
    });
  }

  for (const submission of addedSubmissions) {
    const endpoint = addedEndpoints[0];
    contracts.push({
      id: contractId(route, "submission", submission),
      name: `${stableSlug(submission)} submission`,
      kind: "submission",
      route,
      actor: "authenticated user",
      preconditions: ["The form is visible", "Required test data is available"],
      action: "Submit the form with valid test data",
      expectedOutcome: endpoint
        ? `The request to ${endpoint} succeeds and a visible confirmation or resulting state is shown`
        : "A visible confirmation or resulting state is shown",
      sourceFile: args.sourceFile,
      sourceRefs: endpoint ? [...contextRefs, `api:${endpoint}`] : contextRefs,
      confidence: endpoint ? 0.88 : 0.72,
      risk: "medium",
      needsClarification: !endpoint,
      introducedByVersionId: args.versionId,
      documentationContext: args.documentation?.slice(0, 2000),
    });
  }

  return contracts;
}

function coverageTokens(behavior: UIBehaviorContract): string[] {
  return [behavior.id, behavior.route ?? "", behavior.name, behavior.action]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9/]+/))
    .filter((value) => value.length >= 4);
}

export function mapBehaviorCoverage(
  behaviors: UIBehaviorContract[],
  tests: ParsedTest[],
): BehaviorCoverage[] {
  return behaviors.map((behavior) => {
    const tokens = coverageTokens(behavior);
    const matched = tests.filter((test) => {
      const haystack = `${test.id} ${test.testName} ${test.filePath} ${test.code}`.toLowerCase();
      if (haystack.includes(`@behavior ${behavior.id.toLowerCase()}`)) return true;
      const meaningful = tokens.filter((token) => token !== "action" && token !== "authenticated");
      return meaningful.length > 0 && meaningful.filter((token) => haystack.includes(token)).length >= Math.min(2, meaningful.length);
    });
    return { behavior, tests: matched, covered: matched.length > 0 };
  });
}

async function reconcile(input: ReconcileInput, tests: ParsedTest[]): Promise<BehaviorCoverage[]> {
  const behaviors: UIBehaviorContract[] = [];
  for (const relativeFile of input.changedFiles) {
    if (!/\.(tsx|jsx)$/.test(relativeFile)) continue;
    const currentFile = safeFile(input.currentRoot, relativeFile);
    const previousFile = input.previousRoot ? safeFile(input.previousRoot, relativeFile) : null;
    const currentContent = await readOptional(currentFile);
    if (!currentContent) continue;
    const previousContent = await readOptional(previousFile);
    behaviors.push(...deriveBehaviorContracts({
      versionId: input.versionId,
      sourceFile: relativeFile.replace(/\\/g, "/"),
      current: extractUiSignals(currentContent),
      previous: extractUiSignals(previousContent),
      changeSummary: input.changeSummary,
      documentation: input.documentation,
    }));
  }
  logger.info(`Reconciled ${behaviors.length} UI behavior candidate(s) for ${input.versionId}`);
  return mapBehaviorCoverage(behaviors, tests);
}

export const uiBehaviorReconcilerService = {
  reconcile,
  extractUiSignals,
  deriveBehaviorContracts,
  mapBehaviorCoverage,
};
