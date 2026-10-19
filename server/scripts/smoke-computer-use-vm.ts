/**
 * Smoke test for the local computer-use VM.
 *
 *   docker compose --profile computer-use up -d
 *   npx tsx server/scripts/smoke-computer-use-vm.ts
 *
 * or, for the per-org desktops (creates/starts oddjob-desktop-org-<id>):
 *   npx tsx server/scripts/smoke-computer-use-vm.ts --org 291
 *
 * Drives the real `cua` provider against the container directly: no org, no
 * session rows, no org_settings change. Screenshots land in
 * .tmp/computer-use-smoke/ so you can look at what the agent would see.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CuaComputerProvider, resolveLocalCuaHost } from "../domain/integrations/trycua/trycua-service.js";

const orgArg = process.argv.indexOf("--org");
const organizationId = orgArg > -1 ? Number(process.argv[orgArg + 1]) : undefined;
process.env.TRYCUA_PROVIDER_TYPE = organizationId ? "org_desktop" : "local";
process.env.CUA_TELEMETRY_ENABLED ??= "false";
// No session rows are written here, so the idle sweep would stop the desktop mid-run.
process.env.TRYCUA_CLEANUP_DISABLED = "true";

const outDir = path.resolve(".tmp/computer-use-smoke");

function saveScreenshot(name: string, dataUrl: string): number {
    const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error(`${name}: screenshot is not a base64 data URL (starts with ${JSON.stringify(dataUrl.slice(0, 30))})`);
    const bytes = Buffer.from(match[1], "base64");
    if (bytes.subarray(1, 4).toString() !== "PNG") throw new Error(`${name}: screenshot bytes are not a PNG`);
    writeFileSync(path.join(outDir, `${name}.png`), bytes);
    return bytes.length;
}

async function main() {
    mkdirSync(outDir, { recursive: true });
    const provider = new CuaComputerProvider();
    console.log(organizationId
        ? `Provisioning the desktop for org ${organizationId} ...`
        : `Connecting to ws://${resolveLocalCuaHost()}/ws ...`);

    const created = await provider.createSession({ os: "linux", sandboxName: "oddjob-smoke", organizationId });
    const session = {
        organizationId,
        providerSessionId: created.providerSessionId,
        sandboxName: created.sandboxName,
        os: "linux",
        metadata: created.metadata,
    } as any;
    console.log("✓ connected", created.metadata);

    try {
        const before = await provider.getScreenshot(session);
        console.log(`✓ before.png (${saveScreenshot("before", before)} bytes)`);

        await provider.executeAction(session, { action: "browser_navigate", params: { url: "https://example.com" } });
        await provider.executeAction(session, { action: "wait", params: { ms: 6000 } });
        await provider.executeAction(session, { action: "mouse_move", params: { x: 200, y: 200 } });
        await provider.executeAction(session, { action: "scroll", params: { deltaX: 0, deltaY: 2 } });
        // A freshly started Firefox may not own keyboard focus yet; without this click the
        // Ctrl+L below can land in quick-find instead of the address bar.
        await provider.executeAction(session, { action: "click", params: { x: 640, y: 450 } });
        await provider.executeAction(session, { action: "hotkey", params: { keys: ["ctrl", "l"] } });
        await provider.executeAction(session, { action: "type_text", params: { text: "https://example.org" } });
        await provider.executeAction(session, { action: "key_press", params: { key: "enter" } });
        await provider.executeAction(session, { action: "wait", params: { ms: 3000 } });
        console.log("✓ browser_navigate, mouse_move, scroll, hotkey, type_text, key_press executed");

        const after = await provider.getScreenshot(session);
        console.log(`✓ after.png (${saveScreenshot("after", after)} bytes)`);
        if (after === before) throw new Error("screen did not change after the actions");
        console.log("✓ screen changed (proves the browser opened; check after.png shows example.org for the typing)");

        const tree = await provider.getAccessibilityTree(session);
        console.log(`  accessibility tree: ${tree.available ? `${tree.nodes.length} nodes` : `unavailable (${tree.error})`}`);
    } finally {
        await provider.terminateSession(session);
    }

    const viewer = organizationId ? "" : `, or watch live at http://127.0.0.1:${process.env.TRYCUA_VIEWER_PORT || 6901}`;
    console.log(`\nDone. Compare ${path.join(outDir, "before.png")} and after.png${viewer}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("✗ smoke test failed:", error?.message ?? error, error?.cause ?? "");
        process.exit(1);
    });
