/**
 * Mock Link Sandboxing (Extension 3 — apply_edits phase)
 *
 * Scans generated code for calls into external API registries (Salesforce,
 * Slack, Twilio, …) and proposes a stub strategy — a Mock Service Worker (MSW)
 * handler for known SaaS registries, or a sandbox schema for generic HTTP — so
 * verification never fails on a remote network timeout.
 *
 * Pure, deterministic detection. Producing the actual MSW handlers / sandbox is
 * left to the verifier's runner integration; this module identifies the call
 * sites and the strategy, and assembles the Sandboxing telemetry block.
 */

import type {
  DetectedIntegration,
  IntegrationCallSite,
  ExternalRegistry,
  StubStrategy,
  Sandboxing,
} from "../core/types.js";

interface RegistrySignature {
  registry: ExternalRegistry;
  re: RegExp;
  stubStrategy: StubStrategy;
}

// Ordered: specific SaaS registries first, generic HTTP last (fallback only).
const REGISTRY_SIGNATURES: RegistrySignature[] = [
  { registry: "salesforce", re: /jsforce|salesforce|force\.com|\bsfdc\b/i, stubStrategy: "msw" },
  { registry: "slack", re: /@slack\/|\bWebClient\b|slack\.com\/api|chat\.postMessage/i, stubStrategy: "msw" },
  { registry: "twilio", re: /\btwilio\b|api\.twilio\.com/i, stubStrategy: "msw" },
  { registry: "stripe", re: /\bstripe\b|api\.stripe\.com/i, stubStrategy: "msw" },
  { registry: "github", re: /@octokit|api\.github\.com|\boctokit\b/i, stubStrategy: "msw" },
  { registry: "http_generic", re: /\b(fetch|axios|got|node-fetch)\s*\(|https?:\/\/[^\s"'`]+/i, stubStrategy: "sandbox_schema" },
];

/**
 * Detect external integrations in a single file's code. Returns at most one
 * entry per registry; the generic HTTP fallback is only reported when no
 * specific SaaS registry matched (avoids double-counting the same call).
 */
export function detectIntegrations(filePath: string, code: string): DetectedIntegration[] {
  if (!code || !code.trim()) return [];
  const lines = code.split("\n");
  const out: DetectedIntegration[] = [];
  let matchedSpecific = false;

  for (const sig of REGISTRY_SIGNATURES) {
    if (sig.registry === "http_generic" && matchedSpecific) continue;

    const callSites: IntegrationCallSite[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(sig.re);
      if (m) {
        callSites.push({ filePath, symbol: m[0].slice(0, 60), line: i + 1 });
      }
    }
    if (callSites.length > 0) {
      out.push({ registry: sig.registry, callSites, stubStrategy: sig.stubStrategy });
      if (sig.registry !== "http_generic") matchedSpecific = true;
    }
  }

  return out;
}

/** Merge detections for the same registry across multiple files/steps. */
export function mergeIntegrations(all: DetectedIntegration[]): DetectedIntegration[] {
  const byRegistry = new Map<ExternalRegistry, DetectedIntegration>();
  for (const det of all) {
    const existing = byRegistry.get(det.registry);
    if (existing) {
      existing.callSites.push(...det.callSites);
    } else {
      byRegistry.set(det.registry, { registry: det.registry, callSites: [...det.callSites], stubStrategy: det.stubStrategy });
    }
  }
  return [...byRegistry.values()];
}

/** Assemble the Sandboxing telemetry block from merged detections. */
export function buildSandboxing(detected: DetectedIntegration[]): Sandboxing {
  const merged = mergeIntegrations(detected);
  const stubbable = merged.filter((d) => d.stubStrategy !== "none");
  const stubbedCallCount = stubbable.reduce((n, d) => n + d.callSites.length, 0);

  const mswHandlersGenerated = merged
    .filter((d) => d.stubStrategy === "msw")
    .map((d) => `msw:${d.registry}`);

  const sandboxSchemaRef = merged.some((d) => d.stubStrategy === "sandbox_schema")
    ? "sandbox:http-generic"
    : undefined;

  const unstubbedExternalCalls = merged
    .filter((d) => d.stubStrategy === "none")
    .flatMap((d) =>
      d.callSites.map((cs) => ({
        filePath: cs.filePath,
        symbol: cs.symbol,
        reason: `No stub strategy for registry "${d.registry}"`,
      }))
    );

  return {
    enabled: merged.length > 0,
    detectedIntegrations: merged,
    stubbedCallCount,
    mswHandlersGenerated,
    sandboxSchemaRef,
    networkIsolationApplied: stubbable.length > 0,
    unstubbedExternalCalls,
  };
}
