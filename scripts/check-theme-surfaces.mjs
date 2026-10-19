#!/usr/bin/env node
/**
 * Theme-surface regression gate.
 *
 * Fails (exit 1) when a UI file introduces a hardcoded, single-theme OPAQUE
 * surface that breaks light or dark mode — i.e. a background/text class that is
 * fixed to one theme's value with no `dark:` counterpart. These are exactly the
 * classes the token pass eliminated (see project_light_mode_token_pass):
 *
 *   bg-white                          -> should be bg-card / bg-background
 *   bg-black                          -> should be bg-background (unless allow-listed media/scrim)
 *   bg-{slate,zinc,neutral,gray,stone}-{700..950} -> bg-muted / bg-card / bg-background
 *   bg-[#<cool near-black hex>]       -> bg-background / bg-card
 *   text-white                        -> text-foreground
 *
 * Lines that carry a `dark:` variant are dual-theme and exempt. Semi-transparent
 * overlays (bg-white/10, bg-black/50) are exempt — glass/scrim work in both themes.
 * Add `theme-lint-ignore` on a line to intentionally suppress (e.g. a deliberately
 * black media surface not covered by the allow-list).
 *
 * Deliberately NOT policed: mid-grey decoratives (gray/zinc-400/500/600),
 * bg-primary hero cards (already tokens), accent colors, and warm brand hexes
 * (#1A1412 etc.) — those are design decisions, not clear-cut regressions.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const SCAN_DIRS = ["client/src", "server/domain"];

// Cool near-black hexes that always mean "dark surface" -> bg-background/card.
// (Warm brand darks like #1A1412 are intentionally excluded.)
const COOL_DARK_HEX = new Set([
  "#09090b", "#0d0d0d", "#0a0a0a", "#18181b", "#27272a",
  "#0f172a", "#070b12", "#090d16", "#020617", "#0d1117",
  "#0c0f17", "#050816",
]);

// Files where an opaque bg-black is legitimate (video letterbox, iframe/embed
// loading backgrounds, modal scrim) and must stay black in both themes.
const BG_BLACK_ALLOW = [
  "client/src/components/ui/video-player.tsx",
  "client/src/modules/operations/components/CycleManagementInterface/AppDetailPanel.tsx",
  "server/domain/apps/ui/modules/apps/pages/AppMarketplace.tsx",
  "client/src/components/admin/ResearchDashboard.tsx",
  "client/src/modules/media/SceneReel.tsx",
  "client/src/modules/media/components/MediaProgramViewer.tsx",
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".git", "blueprints"].includes(entry.name)) out.push(...walk(full));
    } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

// Saturated accent backgrounds. White text on one of these is correct in BOTH
// themes — the surface is the same colour in light and dark — so `text-white`
// there is not a single-theme regression. Rewriting it to text-foreground would
// actively break it: near-black label on an emerald button in light mode. This
// matches the "accent colors are design decisions" carve-out documented above,
// which the flat text-white rule could not previously express.
const ACCENT_FAMILIES = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
// Covers plain accent backgrounds, state-variant accents, and gradient stops
// (`bg-gradient-to-r from-cyan-600 to-blue-600` is just as opaque an accent).
const ACCENT_BG = new RegExp(
  `\\b(?:bg|from|via|to)-(?:${ACCENT_FAMILIES})-(?:400|500|600|700|800)\\b` +
  `|\\b(?:data-\\[state=active\\]:|hover:|group-hover:)(?:bg|from|via|to)-(?:${ACCENT_FAMILIES})-(?:400|500|600|700|800)\\b` +
  `|\\bbg-primary\\b`
);

function lineViolations(line, rel) {
  if (/dark:/.test(line) || /theme-lint-ignore/.test(line)) return [];
  const hits = [];
  const push = (re) => { for (const m of line.matchAll(re)) hits.push(m[0]); };
  push(/\bbg-white\b(?!\/)/g);
  push(/\bbg-(?:slate|zinc|neutral|gray|stone)-(?:700|800|900|950)\b(?!\/)/g);
  // On a line that also carries an accent background, text-white is the accent's
  // foreground, not a themed surface. Neutral backgrounds on the same line are
  // still reported on their own.
  if (!ACCENT_BG.test(line)) push(/\btext-white\b(?!\/)/g);
  for (const m of line.matchAll(/\bbg-\[(#[0-9a-fA-F]{6})\]/g)) {
    if (COOL_DARK_HEX.has(m[1].toLowerCase())) hits.push(m[0]);
  }
  const blackAllowed = BG_BLACK_ALLOW.some((p) => rel.replace(/\\/g, "/").endsWith(p) || rel.replace(/\\/g, "/").includes(p));
  if (!blackAllowed) push(/\bbg-black\b(?!\/)/g);
  return hits;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(root, d)));
const violations = [];
for (const file of files) {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const hits = lineViolations(line, rel);
    if (hits.length) violations.push({ rel, line: i + 1, hits: [...new Set(hits)] });
  });
}

console.log("🎨 Theme-surface regression gate");
console.log(`   scanned ${files.length} .tsx files in ${SCAN_DIRS.join(", ")}`);
if (violations.length === 0) {
  console.log("   ✓ no hardcoded single-theme opaque surfaces\n");
  process.exit(0);
}
console.error(`\n   ✗ ${violations.length} hardcoded single-theme surface(s) found:\n`);
for (const v of violations) {
  console.error(`   ${v.rel}:${v.line}  ${v.hits.join(", ")}`);
}
console.error(
  "\n   These break light or dark mode. Use a semantic token (bg-card / bg-muted /" +
  "\n   bg-background / text-foreground) or a `light dark:` pair. If the surface is" +
  "\n   intentionally fixed (e.g. a media letterbox), add `theme-lint-ignore` on the" +
  "\n   line or add the file to BG_BLACK_ALLOW in scripts/check-theme-surfaces.mjs.\n"
);
process.exit(1);
