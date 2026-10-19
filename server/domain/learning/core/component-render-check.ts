/**
 * Component Render Check
 *
 * Headless smoke-render for indexed UI components. This is the measurement that
 * makes `component_index.verification_success_rate` mean something: until a
 * component has actually been mounted, its score is a seeded default and the
 * Gallery shows it as "Unrated".
 *
 * Scope of the signal, stated plainly: a pass means the module resolved, the
 * named export existed, and the component mounted without throwing given
 * minimal props. It does not mean the component looks right, and it cannot
 * exercise interaction or data-dependent states. A failure, however, is always
 * real — a component that cannot mount cannot be assembled.
 */

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ComponentRenderCheck");

/**
 * tsconfig/vite path aliases, longest prefix first.
 *
 * A dynamic `import(someVariable)` is opaque to the bundler and to tsx's path
 * rewriting — only statically written specifiers get mapped. Since the harness
 * imports paths read from the database, it has to resolve aliases itself or
 * every component fails at import regardless of whether it works.
 */
const PATH_ALIASES: Array<[string, string]> = [
  ["@oddjob/shared-utils/", "packages/shared-utils/src/"],
  // Forged app workspaces define a MORE SPECIFIC alias than the repo's generic
  // "@domain-ui/*" one (see forge-workspace.service.ts, which maps
  // "@domain-ui/packaged/*" to "./src/domain/core/ui/components/packaged/*").
  // Packaged-block import paths in component_index are written for that
  // consumer and are correct there; resolving them with the generic repo alias
  // yields server/domain/packaged/*, which has never existed. Longest prefix
  // must win, so this entry precedes "@domain-ui/".
  ["@domain-ui/packaged/", "server/domain/core/ui/components/packaged/"],
  ["@domain-ui/", "server/domain/"],
  ["@domain/", "server/domain/"],
  ["@shared/", "shared/"],
  ["@server/", "server/"],
  ["@/", "client/src/"],
];

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

/**
 * Turn an alias-bearing import specifier into an importable file URL.
 * Returns null for bare package specifiers, which Node resolves on its own.
 */
export function resolveImportSpecifier(specifier: string, repoRoot = process.cwd()): string | null {
  let relative: string | null = null;
  for (const [alias, target] of PATH_ALIASES) {
    if (specifier.startsWith(alias)) {
      relative = target + specifier.slice(alias.length);
      break;
    }
  }
  if (!relative) return null;

  const base = path.resolve(repoRoot, relative);
  for (const ext of ["", ...SOURCE_EXTENSIONS]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  // Alias matched but nothing exists on disk — surface the resolved path so the
  // failure names the location that was actually looked for.
  return pathToFileURL(base).href;
}

export interface ComponentDescriptor {
  componentName: string;
  importPath: string;
  /** "default" | "named" | "macro" */
  exportType: string;
  /** Map of `propName` / `propName?` → TypeScript type string. */
  propSchema?: Record<string, unknown> | null;
}

export interface RenderCheckResult {
  componentName: string;
  ok: boolean;
  /**
   * True when the harness could not evaluate the component at all (e.g. it
   * pulls in a stylesheet Node cannot load). Distinct from a failure: an
   * unmeasurable component must not be recorded as a broken one, or the score
   * becomes wrong in the opposite direction.
   */
  skipped?: boolean;
  /** Coarse failure classification, for triage. */
  stage?: "import" | "export" | "render";
  error?: string;
  /** Props synthesized for the attempt, useful when a failure is prop-driven. */
  propsUsed?: Record<string, unknown>;
}

/**
 * Build the smallest prop set that satisfies a component's required props.
 *
 * The index stores props as `{"appId?": "number", "blueprintId": "string"}` —
 * a trailing `?` on the *key* marks it optional. Only required props are
 * synthesized: passing extras risks tripping strict prop validation, and the
 * point is to test the component, not our guesses about it.
 */
export function synthesizeProps(
  propSchema?: Record<string, unknown> | null,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (!propSchema || typeof propSchema !== "object") return props;

  for (const [rawKey, rawType] of Object.entries(propSchema)) {
    if (rawKey.endsWith("?")) continue; // optional — leave it out
    props[rawKey] = synthesizeValue(String(rawType ?? ""));
  }
  return props;
}

function synthesizeValue(type: string): unknown {
  const t = type.trim();

  // Function types, e.g. "(content: string) => void"
  if (t.includes("=>")) return () => {};
  // Array types: "Message[]" or "Array<Foo>"
  if (t.endsWith("[]") || t.startsWith("Array<")) return [];
  // Union of string literals: "'up' | 'down'" — pick the first literal.
  const literal = t.match(/^'([^']*)'/);
  if (literal) return literal[1];

  switch (t) {
    case "string": return "test";
    case "number": return 1;
    case "boolean": return false;
    case "Date": return new Date(0);
    default:
      // Object/interface shapes and anything unrecognised: an empty object is
      // the least-assuming value that still satisfies a required slot.
      return {};
  }
}

/**
 * Resolve the component export from a loaded module.
 * Falls back across conventions rather than trusting `exportType` blindly —
 * the index is populated by scripts and the recorded type can drift.
 */
export function resolveExport(mod: any, descriptor: ComponentDescriptor): unknown {
  if (!mod) return undefined;

  // Index names are display strings ("Metric Summary Card") and cannot be
  // export identifiers, so try a de-spaced form alongside the literal name.
  const pascal = descriptor.componentName.replace(/[^A-Za-z0-9]/g, "");
  const byName = [mod[descriptor.componentName], mod[pascal]];

  const candidates =
    descriptor.exportType === "default"
      ? [mod.default, ...byName]
      : [...byName, mod.default];

  return candidates.find(c => typeof c === "function" || (c && typeof c === "object"));
}

/**
 * Import, resolve, and mount one component.
 *
 * `importModule` is injectable so the harness can be tested without touching
 * the real module graph.
 */
export async function checkComponent(
  descriptor: ComponentDescriptor,
  deps: {
    importModule?: (path: string) => Promise<any>;
    renderToString?: (element: any) => string;
  } = {},
): Promise<RenderCheckResult> {
  const { componentName } = descriptor;

  let mod: any;
  try {
    const importModule =
      deps.importModule ??
      ((p: string) => {
        const resolved = resolveImportSpecifier(p) ?? p;
        return import(/* @vite-ignore */ resolved);
      });
    mod = await importModule(descriptor.importPath);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    // Node cannot import stylesheets or other bundler-only assets. A component
    // that transitively imports one is unmeasurable here, not broken.
    if (/Unknown file extension|\.(css|scss|sass|less|svg|png|jpe?g|webp|gif)['"]?$/i.test(message)) {
      return { componentName, ok: false, skipped: true, stage: "import", error: message };
    }
    return { componentName, ok: false, stage: "import", error: message };
  }

  const Component = resolveExport(mod, descriptor);
  if (typeof Component !== "function") {
    return {
      componentName,
      ok: false,
      stage: "export",
      error: `No callable export found for "${componentName}" (exportType=${descriptor.exportType})`,
    };
  }

  const props = synthesizeProps(descriptor.propSchema);

  try {
    if (typeof (globalThis as any).location === "undefined") {
      (globalThis as any).location = { pathname: "/", search: "", hash: "", href: "http://localhost/" };
    }
    const React = await import("react");
    const renderToString =
      deps.renderToString ?? (await import("react-dom/server")).renderToString;

    renderToString(React.createElement(Component as any, props));
    return { componentName, ok: true, propsUsed: props };
  } catch (err: any) {
    const message = err?.message ?? String(err);

    // If the component choked on one of OUR placeholder objects, that is the
    // harness's prop synthesis being too crude for this component's interface,
    // not a defect in the component. Only treated as unmeasurable when a plain
    // object placeholder was actually passed.
    const passedObjectPlaceholder = Object.values(props).some(
      v => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0,
    );
    if (passedObjectPlaceholder && /Objects are not valid as a React child/i.test(message)) {
      return { componentName, ok: false, skipped: true, stage: "render", error: message, propsUsed: props };
    }

    return { componentName, ok: false, stage: "render", error: message, propsUsed: props };
  }
}

/** Run the check across many components, sequentially to keep failures legible. */
export async function checkComponents(
  descriptors: ComponentDescriptor[],
  deps?: Parameters<typeof checkComponent>[1],
): Promise<RenderCheckResult[]> {
  const results: RenderCheckResult[] = [];
  for (const descriptor of descriptors) {
    const result = await checkComponent(descriptor, deps);
    if (!result.ok) {
      logger.warn(`[RenderCheck] ${result.componentName} failed at ${result.stage}: ${result.error}`);
    }
    results.push(result);
  }
  return results;
}
