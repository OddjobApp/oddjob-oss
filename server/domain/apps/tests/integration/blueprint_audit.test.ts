import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");
const SALES_BLUEPRINT_ROOT = path.join(BLUEPRINT_ROOT, "sales-opportunity-workbench");
const SALES_CYCLE_PATH = path.resolve("server/cycles/sales-opportunity-pipeline.cycle.yaml");

// Generated build output and dependencies are NOT source — a local `next build`
// drops non-ASCII framework artifacts (e.g. the "○" in .next/server/chunks/*.js)
// that would otherwise trip the source-file audits below.
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", ".git"]);

function readFilesRecursive(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRS.has(entry.name) ? [] : readFilesRecursive(fullPath);
    }
    return [fullPath];
  });
}

/**
 * Read the sources a page imports from the platform's own UI, so an assertion can see
 * through a page that only delegates. Only first-party paths are followed — a package
 * import has no file here to read, and following the whole graph would be a build.
 */
function importedSources(pageContent: string): string[] {
  const specifiers = Array.from(pageContent.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
  const sources: string[] = [];
  for (const spec of specifiers) {
    if (!spec.startsWith("@domain-ui/") && !spec.startsWith(".")) continue;
    const base = spec.startsWith("@domain-ui/")
      ? path.resolve("server/domain", spec.slice("@domain-ui/".length))
      : null;
    if (!base) continue; // relative imports resolve per-blueprint; not needed yet
    for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) {
      if (fs.existsSync(candidate)) {
        sources.push(fs.readFileSync(candidate, "utf-8"));
        break;
      }
    }
  }
  return sources;
}

/**
 * Automated Audit for Blueprint Compliance
 *
 * This test suite programmatically enforces styling and accessibility standards
 * across all existing and future blueprints.
 */
describe("Blueprint Library Compliance Audit", () => {
  const blueprints = fs.readdirSync(BLUEPRINT_ROOT);

  blueprints.forEach((blueprint) => {
    describe(`Blueprint: ${blueprint}`, () => {
      const pagePath = path.join(BLUEPRINT_ROOT, blueprint, "pages", "index.tsx");
      
      if (!fs.existsSync(pagePath)) {
        it.skip("Has no index.tsx, skipping", () => {});
        return;
      }

      const content = fs.readFileSync(pagePath, "utf-8");

      it("Should not use inline 'style' attributes for direct styling", () => {
        // We look for style={{ width/display/etc }} patterns
        // But we ALLOW style={{ '--var': ... }} as it's the bridge to CSS variables
        const inlineStyleRegex = /style=\{\{\s*['"]?[a-zA-Z]/g;
        // The above regex matches style={{ followed by a letter (start of a property name)
        // If it starts with '--', it's a CSS variable and we allow it.
        
        const lines = content.split('\n');
        lines.forEach((line, index) => {
            const matches = line.match(/style=\{\{\s*([^}]*)\}\}/);
            if (matches) {
                const styleContent = matches[1].trim();
                // Check if any property in the object does NOT start with '--'
                // This is a rough check.
                const props = styleContent.split(',').map(p => p.trim());
                props.forEach(prop => {
                    const name = prop.split(':')[0].trim().replace(/['"]/g, '');
                    if (name && !name.startsWith('--')) {
                        throw new Error(`Line ${index + 1}: Found direct inline style '${name}' in ${blueprint}. Please use CSS variables.`);
                    }
                });
            }
        });
      });

      it("Should use semantic headers and descriptive titles", () => {
        // Basics: h1, buttons with titles or aria-labels
        const declaresHeader = (source: string) =>
            source.includes("<h1") || source.includes("<h2") || source.includes("<h3") ||
            source.includes("<SheetTitle") || source.includes("<CardTitle") || source.includes("<DialogTitle") ||
            source.includes("AIAgentChat") || source.includes("IndustrialDashboardHero") ||
            source.includes("PlatformAgentChatBlock") ||
            // A page-level layout wrapper with a `title` prop renders the semantic
            // <h1> (e.g. `<Layout title="…">`), so it satisfies the header requirement.
            /<Layout\b[^>]*\btitle=/.test(source);

        // A page whose whole body is one imported component renders that component's
        // header, so read through the import before calling the page headerless —
        // rescue-dispatch is five lines delegating to a dashboard that opens with an
        // <h1>, and judging it on its own text failed a page that is perfectly fine.
        const hasHeader = declaresHeader(content) || importedSources(content).some(declaresHeader);
        expect(hasHeader, `Blueprint ${blueprint} missing a primary header component.`).toBe(true);
      });

      it("Should not have empty interactive elements (accessibility)", () => {
        // Common violation: <button><Icon /></button> without title or aria-label
        // We search for buttons that might be missing descriptive attributes
        const buttonRegex = /<button(?![^>]*[title|aria-label])[^>]*>/g;
        const matches = content.match(buttonRegex);
        
        // We allow some if they have text children, but this is a rough check
        if (matches) {
            matches.forEach(m => {
                // If it doesn't have an icon inside but has text, it might be fine, 
                // but usually blueprints use icons.
                // For now, we enforce titles on all buttons in blueprints.
                expect(m).toMatch(/title=|aria-label=/);
            });
        }
      });
    });
  });
});

describe("Sales Opportunity Workbench blueprint contract", () => {
  const sourceFiles = readFilesRecursive(SALES_BLUEPRINT_ROOT).filter((file) =>
    [".ts", ".tsx", ".js", ".css", ".json"].includes(path.extname(file)),
  );

  const expectedRoutes = [
    "app/page.tsx",
    "app/pipeline/page.tsx",
    "app/opportunities/page.tsx",
    "app/forecast/page.tsx",
    "app/alerts/page.tsx",
    "app/advisor/page.tsx",
  ];

  const expectedCollections = [
    "leads",
    "accounts",
    "opportunities",
    "activities",
    "stage_history",
    "opportunity_windows",
    "window_snapshots",
    "forecasts",
    "quotas",
    "sales_recommendations",
  ];

  const expectedMissionTriggers = [
    "Qualify Lead",
    "Opportunity Window Decay Sweep",
    "Deal Risk Scan",
    "Generate Revenue Forecast",
    "Publish Forecast",
  ];

  it("has the expected Next app route surfaces", () => {
    expectedRoutes.forEach((route) => {
      expect(fs.existsSync(path.join(SALES_BLUEPRINT_ROOT, route))).toBe(true);
    });
  });

  it("does not contain mojibake artifacts in checked source files", () => {
    // Detect genuine encoding CORRUPTION only: the U+FFFD replacement character
    // and the tell-tale UTF-8-decoded-as-CP1252 lead sequences (Ã… / Â… / â€…,
    // e.g. "Ã©", "â€™"). Intentional symbols (→ · ✦ ▾ ✉, em dashes, CJK, emoji)
    // are legitimate UI content and must NOT be flagged — this audit is about
    // mojibake, not ASCII purity.
    const MOJIBAKE = /\uFFFD|\u00C3[\u00A0-\u00BF]|\u00C2[\u00A0-\u00BF]|\u00E2\u20AC/;
    sourceFiles.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(MOJIBAKE);
      expect(
        match,
        `${path.relative(SALES_BLUEPRINT_ROOT, file)} contains mojibake near "${match?.[0] ?? ""}"`,
      ).toBeNull();
    });
  });

  it("keeps the TypeScript collection client aligned with the cycle datasets", () => {
    const client = fs.readFileSync(path.join(SALES_BLUEPRINT_ROOT, "lib", "platform-client.ts"), "utf-8");
    const cycle = fs.readFileSync(SALES_CYCLE_PATH, "utf-8");

    expectedCollections.forEach((collection) => {
      expect(client, `SalesCollections is missing ${collection}`).toContain(`"${collection}"`);
      expect(cycle, `sales cycle knowledge_datasets is missing ${collection}`).toContain(`id: "${collection}"`);
    });
  });

  it("keeps workbench mission triggers present in the cycle manifest", () => {
    const cycle = fs.readFileSync(SALES_CYCLE_PATH, "utf-8");

    expectedMissionTriggers.forEach((missionName) => {
      expect(cycle, `sales cycle is missing mission trigger ${missionName}`).toContain(`name: "${missionName}"`);
    });
  });
});
