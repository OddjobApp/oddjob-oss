/**
 * Workspace Cleanup Script
 * Relocates ad-hoc root ops scripts into `scripts/ops/` and safely purges transient build/debug files.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT_DIR = process.cwd();
const OPS_DIR = path.join(ROOT_DIR, "scripts", "ops");

if (!fs.existsSync(OPS_DIR)) {
    fs.mkdirSync(OPS_DIR, { recursive: true });
}

// Scripts to relocate to scripts/ops/
const OPS_SCRIPTS = [
    "query-recent.ts",
    "query_apps.ts",
    "restart_stopped_apps.ts",
    "restart_stopped_final.ts",
    "restart_techhead7_apps.ts",
    "sync_final_containers.ts",
    "reassign_ports_and_deploy.ts",
    "test-login.ts",
    "verify-password.ts",
];

// Transient dump patterns to remove safely
const TRANSIENT_PATTERNS = [
    /^tsc_output_.*\.txt$/,
    /^_tmp_.*\.ts$/,
    /^tmp-.*\.mjs$/,
    /^tmp-.*\.log$/,
    /^_underscore_tmp\.mjs$/,
    /^utf8\.diff$/,
];

console.log("--- Oddjob Workspace Cleanup ---");

// 1. Relocate ops scripts
for (const script of OPS_SCRIPTS) {
    const src = path.join(ROOT_DIR, script);
    const dest = path.join(OPS_DIR, script);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        console.log(`[RELOCATED] ${script} -> scripts/ops/${script}`);
    }
}

// 2. Safely remove transient files
const rootFiles = fs.readdirSync(ROOT_DIR);
for (const file of rootFiles) {
    for (const pattern of TRANSIENT_PATTERNS) {
        if (pattern.test(file)) {
            const targetPath = path.join(ROOT_DIR, file);
            try {
                fs.unlinkSync(targetPath);
                console.log(`[REMOVED TRANSIENT] ${file}`);
            } catch (err) {
                console.warn(`[WARN] Could not remove ${file}:`, err);
            }
            break;
        }
    }
}

console.log("Workspace cleanup complete.");
