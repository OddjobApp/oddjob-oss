#!/usr/bin/env node
/**
 * Refuse window.alert / confirm / prompt in application UI.
 *
 * They look like a cheap dialog and are not one. A native dialog blocks the
 * whole page and every timer on it, cannot be themed or translated, is
 * unreachable from a component test, and — the reason this matters here — it
 * freezes browser automation outright: an agent driving the app stops receiving
 * commands until a human dismisses the box by hand.
 *
 * They are also silently lossy. The prompt that used to collect a link URL fed
 * whatever was typed straight to execCommand, so a "javascript:" address became
 * a link in the manuscript; a real dialog has somewhere to put validation and
 * an error message.
 *
 * Use Dialog for input and AlertDialog for a destructive confirmation. Both trap
 * focus, handle Escape, and can be tested.
 *
 * Run from `npm run lint:dialogs`, and inside `npm run verify`.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOTS = ["client/src", "server/domain"];

/** window.print is a legitimate browser API and shares no behaviour with these. */
const NATIVE = /\bwindow\s*\.\s*(alert|confirm|prompt)\s*\(/g;

const files = execFileSync(
    "git",
    ["ls-files", ...ROOTS.map((r) => `${r}/**/*.tsx`), ...ROOTS.map((r) => `${r}/**/*.ts`)],
    { encoding: "utf8" },
)
    .split("\n")
    .filter(Boolean)
    // A test may legitimately stub or assert on them.
    .filter((f) => !/\.test\.tsx?$/.test(f));

const offences = [];

for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    let text;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        continue;
    }

    text.split(/\r?\n/).forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const match of line.matchAll(NATIVE)) {
            offences.push({ file: normalized, line: i + 1, call: `window.${match[1]}()` });
        }
    });
}

console.log("🪟 Native dialog gate");
console.log(`   scanned ${files.length} files in ${ROOTS.join(", ")}`);

if (offences.length === 0) {
    console.log("   ✓ no blocking browser dialogs");
    process.exit(0);
}

console.error(`\n   ✗ ${offences.length} blocking browser dialog(s):\n`);
for (const o of offences) {
    console.error(`     ${o.file}:${o.line}  ${o.call}`);
}
console.error(
    "\n   These block the page, cannot be themed or tested, and freeze browser\n" +
        "   automation until a human dismisses them. Use:\n\n" +
        "     Dialog       (@/components/ui/dialog)        to collect input\n" +
        "     AlertDialog  (@/components/ui/alert-dialog)  to confirm something destructive\n\n" +
        "   Both trap focus and handle Escape, which the native ones only appear to.\n",
);
process.exit(1);
