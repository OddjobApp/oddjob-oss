/**
 * Automated Drift Verification Gate for Oddjob Domain Taxonomy
 * 
 * Verifies that:
 * 1. Every directory in `server/domain/` is documented in `docs/developer-guides/DOMAIN_TAXONOMY_AND_BEST_PRACTICES.md`.
 * 2. All best practice guides referenced in the taxonomy exist on disk.
 * 3. The taxonomy does not contain ghost domains that no longer exist in `server/domain/`.
 * 
 * Usage: npx tsx scripts/check-domain-drift.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const domainDir = path.join(rootDir, "server", "domain");
const taxonomyFile = path.join(rootDir, "docs", "developer-guides", "DOMAIN_TAXONOMY_AND_BEST_PRACTICES.md");

interface DriftReport {
    missingDomains: string[];
    ghostDomains: string[];
    missingGuides: string[];
    totalDomains: number;
    documentedDomains: number;
}

function checkDomainTaxonomy(): DriftReport {
    if (!fs.existsSync(taxonomyFile)) {
        throw new Error(`Taxonomy file not found at: ${taxonomyFile}`);
    }

    const taxonomyContent = fs.readFileSync(taxonomyFile, "utf-8");

    // Discover all physical domain directories in server/domain/
    const physicalEntries = fs.readdirSync(domainDir, { withFileTypes: true });
    const physicalDomains = physicalEntries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
        .map(entry => entry.name)
        .sort();

    const missingDomains: string[] = [];
    for (const domain of physicalDomains) {
        // Look for domain in backticks e.g. `spatial`, `agents` or **`spatial`**
        const pattern = new RegExp(`\`${domain}\``, "i");
        if (!pattern.test(taxonomyContent)) {
            missingDomains.push(domain);
        }
    }

    // Ghost domains: a taxonomy row whose directory is gone.
    //
    // The docblock above has always promised this check, but no code computed
    // it - `documentedDomains` is just `physical - missing`, so the summary
    // read "100% parity" no matter how many stale rows the table carried. A
    // deleted domain left its row behind silently.
    // Only rows from tables whose first column is exactly "Domain" name a
    // directory. Cluster 6 uses a "Domain / Path" header whose rows are file
    // paths (packages/design-system, client/src/lib/tutorial-engine.ts) and
    // must not be read as domains.
    const documentedNames: string[] = [];
    let inDomainTable = false;
    for (const line of taxonomyContent.split(/\r?\n/)) {
        const header = line.match(/^\|\s*([^|]+?)\s*\|/);
        if (header && /^Domain$/i.test(header[1])) { inDomainTable = true; continue; }
        if (line.trim() === "" || line.startsWith("#")) { inDomainTable = false; continue; }
        if (!inDomainTable) continue;
        const row = line.match(/^\|\s*\*\*`([^`]+)`\*\*\s*\|/);
        if (row) documentedNames.push(row[1]);
    }
    const physicalSet = new Set(physicalDomains);
    const ghostDomains = [...new Set(documentedNames)]
        .filter(name => !physicalSet.has(name))
        .sort();

    // Check all referenced markdown guides exist on disk
    const missingGuides: string[] = [];
    const guideMatches = taxonomyContent.matchAll(/\[.*?\]\((file:\/\/\/.*?\.(?:md|tsx?))\)/g);
    for (const match of guideMatches) {
        const fileUrl = match[1];
        // Normalize file:/// URL to local filesystem path
        const relativeOrAbs = fileUrl.replace(/^file:\/\/\/(?:[a-zA-Z]:)?/, (m) => {
            const drive = m.slice(8);
            return drive ? `${drive}` : "";
        }).replace(/\//g, path.sep);

        // Find match in project
        let targetPath = relativeOrAbs;
        if (!fs.existsSync(targetPath)) {
            // Try relative from rootDir
            const fromDocs = path.join(rootDir, relativeOrAbs.replace(/^.*?Oddjob[\\/]/i, ""));
            if (!fs.existsSync(fromDocs)) {
                missingGuides.push(fileUrl);
            }
        }
    }

    return {
        missingDomains,
        ghostDomains,
        missingGuides,
        totalDomains: physicalDomains.length,
        documentedDomains: physicalDomains.length - missingDomains.length,
    };
}

function run() {
    console.log("🔍 [DOMAIN TAXONOMY] Auditing server/domain directories against taxonomy...");
    
    const report = checkDomainTaxonomy();

    console.log(`   Physical domains discovered: ${report.totalDomains}`);
    console.log(`   Documented domains:          ${report.documentedDomains}`);
    console.log(`   Taxonomy rows:               ${report.documentedDomains + report.ghostDomains.length}`);

    let hasErrors = false;

    if (report.missingDomains.length > 0) {
        hasErrors = true;
        console.error("\n❌ [DRIFT ERROR] The following domains in server/domain/ are NOT documented in DOMAIN_TAXONOMY_AND_BEST_PRACTICES.md:");
        for (const d of report.missingDomains) {
            console.error(`   - server/domain/${d}`);
        }
    }

    if (report.ghostDomains.length > 0) {
        hasErrors = true;
        console.error("\n[DRIFT ERROR] The taxonomy documents domains that no longer exist in server/domain/:");
        for (const d of report.ghostDomains) {
            console.error(`   - \`${d}\` (documented, but no such directory)`);
        }
    }

    if (report.missingGuides.length > 0) {
        hasErrors = true;
        console.error("\n❌ [DRIFT ERROR] The following referenced guides do NOT exist on disk:");
        for (const g of report.missingGuides) {
            console.error(`   - ${g}`);
        }
    }

    if (hasErrors) {
        console.error("\n💥 Domain taxonomy drift check FAILED. Update docs/developer-guides/DOMAIN_TAXONOMY_AND_BEST_PRACTICES.md.\n");
        process.exit(1);
    }

    console.log("✅ [DOMAIN TAXONOMY] 100% parity verified. Zero drift detected!\n");
}

run();
