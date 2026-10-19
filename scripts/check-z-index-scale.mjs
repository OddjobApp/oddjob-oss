#!/usr/bin/env node
/**
 * Keep stacking order a design decision instead of an argument.
 *
 * Before the named scale there were z-10/20/30/40/50, four separate things at
 * z-[100], and a tutorial at z-[99999] and z-[100000]. Nobody picks 100000
 * except to outrank someone else's 9999 — and four components sharing z-[100]
 * means their real order is whichever CSS rule the bundler emitted last.
 *
 * So arbitrary values are refused. If a new surface needs to sit somewhere, it
 * gets a name in tailwind.config.ts, which makes "should this outrank a modal?"
 * a question someone answers rather than a number someone escalates.
 *
 * Run from `npm run lint:z-index`, and inside `npm run verify`.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOTS = ["client/src", "server/domain"];

/**
 * Vendored third-party primitives that manage their own local stacking context.
 * navigation-menu's z-[1] positions an arrow inside the menu itself; it is not
 * competing with anything on the page.
 */
const ALLOWED = new Set(["client/src/components/ui/navigation-menu.tsx"]);

const files = execFileSync(
    "git",
    ["ls-files", ...ROOTS.map((r) => `${r}/**/*.tsx`), ...ROOTS.map((r) => `${r}/**/*.ts`)],
    { encoding: "utf8" },
)
    .split("\n")
    .filter(Boolean);

const ARBITRARY_Z = /\bz-\[(\d+)\]/g;
const offences = [];

for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (ALLOWED.has(normalized)) continue;

    let text;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        continue;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        // Skip comments: a line explaining the old numbering is not a use of it.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

        for (const match of line.matchAll(ARBITRARY_Z)) {
            offences.push({ file: normalized, line: i + 1, value: match[0] });
        }
    });
}

console.log("🧱 Z-index scale gate");
console.log(`   scanned ${files.length} files in ${ROOTS.join(", ")}`);

if (offences.length === 0) {
    console.log("   ✓ no arbitrary z-index values");
    process.exit(0);
}

console.error(`\n   ✗ ${offences.length} arbitrary z-index value(s):\n`);
for (const o of offences) {
    console.error(`     ${o.file}:${o.line}  ${o.value}`);
}
console.error(
    "\n   Use a named tier from tailwind.config.ts instead:\n" +
        "     z-raised    within a component (sticky headers, ribbons)\n" +
        "     z-popover   anchored to a control (dropdowns, menus)\n" +
        "     z-chrome    site furniture above page content\n" +
        "     z-overlay   a modal's backdrop\n" +
        "     z-modal     dialogs, sheets, palettes\n" +
        "     z-toast     transient feedback, readable during a modal\n" +
        "     z-tutorial  coach marks that point at the UI\n\n" +
        "   If none of them fit, add a tier — that is a design decision worth\n" +
        "   making explicitly, which is the whole point of this gate.\n",
);
process.exit(1);
