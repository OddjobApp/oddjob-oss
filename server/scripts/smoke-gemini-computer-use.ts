/**
 * Live check of the Gemini computer-use loop against a real desktop:
 *
 *   npx tsx server/scripts/smoke-gemini-computer-use.ts --org 291 "Open example.com and tell me the page heading"
 *
 * Drives the provider directly (no session rows, no org_settings change), so it
 * exercises the model + action mapping + desktop, not the task service. Sends
 * screenshots of the desktop to Gemini. Stops at the first pause and prints it.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CuaComputerProvider } from "../domain/integrations/trycua/trycua-service.js";
import {
    computerUseModel,
    geminiInteractionClient,
    runComputerUseLoop,
    systemInstruction,
} from "../domain/integrations/trycua/gemini-computer-use.js";

const orgArg = process.argv.indexOf("--org");
const organizationId = orgArg > -1 ? Number(process.argv[orgArg + 1]) : undefined;
const goal = process.argv.slice(2).filter((arg, i, all) => arg !== "--org" && all[i - 1] !== "--org").join(" ")
    || "Open https://example.com in Firefox and tell me the page's main heading.";
process.env.TRYCUA_PROVIDER_TYPE = organizationId ? "org_desktop" : "local";
process.env.CUA_TELEMETRY_ENABLED ??= "false";
// No session rows are written here, so the idle sweep would stop the desktop mid-run.
process.env.TRYCUA_CLEANUP_DISABLED = "true";

async function main() {
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Set GEMINI_API_KEY");
    const model = computerUseModel();
    const outDir = path.resolve(".tmp/gemini-computer-use");
    mkdirSync(outDir, { recursive: true });

    const provider = new CuaComputerProvider();
    const created = await provider.createSession({ os: "linux", organizationId });
    const session = { organizationId, providerSessionId: created.providerSessionId, os: "linux", metadata: created.metadata } as any;
    console.log(`Model ${model} · goal: ${goal}`);

    let shots = 0;
    try {
        const outcome = await runComputerUseLoop(
            {
                createInteraction: geminiInteractionClient({ apiKey, model, systemInstruction: systemInstruction() }),
                screenshot: async () => {
                    const shot = await provider.getScreenshot(session);
                    writeFileSync(path.join(outDir, `${String(++shots).padStart(2, "0")}.png`), Buffer.from(shot.split(",")[1], "base64"));
                    return shot;
                },
                execute: (action) => provider.executeAction(session, action),
                recordStep: async (step) => {
                    const intent = step.call.arguments.intent ? ` — ${step.call.arguments.intent}` : "";
                    const err = step.result.error ? `  ✗ ${step.result.error}` : "";
                    console.log(`  ${step.call.name}${intent}${err}`);
                },
                isCancelled: async () => false,
            },
            { goal, maxTurns: Number(process.env.SMOKE_MAX_TURNS || 12), supervised: false },
            {},
        );
        console.log(`\n${outcome.status} after ${outcome.turns} turns`);
        if (outcome.status === "succeeded") console.log(`Summary: ${outcome.summary}`);
        if (outcome.status === "needs_confirmation" || outcome.status === "blocked") console.log(`Paused: ${outcome.explanation}`);
        if (outcome.status === "failed") console.log(`Error: ${outcome.error}`);
        console.log(`Screenshots: ${outDir}`);
        process.exitCode = outcome.status === "failed" ? 1 : 0;
    } finally {
        await provider.terminateSession(session);
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
        console.error("✗", error?.message ?? error);
        process.exit(1);
    });
