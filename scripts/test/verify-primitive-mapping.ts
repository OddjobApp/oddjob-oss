/**
 * Live check that the representative primitive blocks are indexed and that every
 * indexed forge-ui row points at a module that actually exists.
 *
 * The source-side assertions this script used to carry (does the file contain
 * string X) moved to real tests:
 *   - server/domain/apps/ui/.../visual-editor/canvas-layout.test.ts
 *   - server/domain/apps/ui/.../visual-editor/canvas-palette.test.ts
 *   - server/domain/apps/ui/.../subcomponents/drop-placement.test.ts
 *   - server/domain/apps/tests/unit/app_builder_edits.test.ts
 *
 * Note the index is only refreshed by `npm run component-index:sync` — it has no
 * other caller, so a fresh environment needs that run before this passes.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:5000";
const ORG_ID = process.env.VERIFY_ORG_ID || "473";
const PACKAGED_DIR = path.resolve("server/domain/core/ui/components/packaged");

/** Blocks this check covers, and the props each must expose. */
const EXPECTED = [
    { name: "Platform Metric Gauge", module: "PlatformMetricGaugeBlock", props: ["metrics?"] },
    { name: "Platform Media Player", module: "PlatformMediaPlayerBlock", props: ["videoSrc?", "audioSrc?"] },
    { name: "Platform Interactive Modal", module: "PlatformInteractiveModalBlock", props: ["dialogTitle?", "sheetTitle?"] },
];

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e: any) {
        fail++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

async function main() {
    console.log("=".repeat(70));
    console.log("🔍 COMPONENT INDEX INTEGRITY — REPRESENTATIVE PRIMITIVE BLOCKS");
    console.log("=".repeat(70));

    const loginRes = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
    });
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status}`);
    const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
    console.log("✅ Authenticated with Admin Session\n");

    const res = await fetch(
        `${BASE}/api/capabilities/component-index/search?limit=500&orgId=${ORG_ID}`,
        { headers: { cookie } },
    );
    if (!res.ok) throw new Error(`component-index search: HTTP ${res.status}`);
    const components = (await res.json()) as any[];
    console.log(`📦 Component Index Catalog Size: ${components.length} components\n`);

    for (const expected of EXPECTED) {
        check(`${expected.name} is indexed with its prop schema`, () => {
            const comp = components.find((c) => c.name === expected.name);
            if (!comp) {
                throw new Error(`not in the index — run "npm run component-index:sync"`);
            }
            if (comp.importPath !== `@domain-ui/packaged/${expected.module}`) {
                throw new Error(`importPath is ${comp.importPath}, expected @domain-ui/packaged/${expected.module}`);
            }
            const missing = expected.props.filter((p) => !comp.propSchema?.[p]);
            if (missing.length) throw new Error(`propSchema missing ${missing.join(", ")}`);
            console.log(`     → ${comp.exportType} export, props: ${Object.keys(comp.propSchema).join(", ")}`);
        });
    }

    // A row whose module is gone is a phantom: the builder would emit an import
    // that cannot resolve. Non-empty index rows prove nothing on their own.
    check("every indexed forge-ui block resolves to a file on disk", () => {
        const phantoms = components
            .filter((c) => c.packageSource === "forge-ui" && typeof c.importPath === "string")
            .map((c) => ({ name: c.name, module: String(c.importPath).split("/").pop()! }))
            .filter(({ module }) => !fs.existsSync(path.join(PACKAGED_DIR, `${module}.tsx`)));
        if (phantoms.length) {
            throw new Error(`${phantoms.length} phantom row(s): ${phantoms.map((p) => p.module).join(", ")}`);
        }
    });

    check("each block is re-exported from the packaged barrel", () => {
        const barrel = fs.readFileSync(path.join(PACKAGED_DIR, "index.ts"), "utf-8");
        const missing = EXPECTED.filter((e) => !barrel.includes(`${e.module}.js`));
        if (missing.length) {
            throw new Error(`not exported from index.ts: ${missing.map((m) => m.module).join(", ")}`);
        }
    });

    console.log("\n" + "=".repeat(70));
    console.log(`🏁 RESULT: ${pass} PASS, ${fail} FAIL out of ${pass + fail} checks`);
    console.log("=".repeat(70));
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
});
