/**
 * Live check of learned computer-use skills on an org's desktop:
 *
 *   npx tsx server/scripts/smoke-computer-use-skills.ts --org 291
 *
 * 1. starts a recording, 2. a "person" searches Wikipedia for Honolulu through the
 * desktop's real keyboard input (computer-server, as the viewer would), 3. stops and lets
 * Gemini draft a skill, 4. approves it, 5. matches it to "Search Wikipedia for Paris",
 * 6. extracts the input and replays it over CDP, 7. checks the browser ends on Paris.
 * Writes recording and skill rows for the org (the skill is archived at the end). Needs
 * TRYCUA_PROVIDER=cua, TRYCUA_PROVIDER_TYPE=org_desktop and a Gemini key.
 */
import "dotenv/config";
import { CuaComputerProvider } from "../domain/integrations/trycua/trycua-service.js";
import { learnedSkillsService } from "../domain/integrations/trycua/learned-skills.service.js";

const orgArg = process.argv.indexOf("--org");
const organizationId = Number(orgArg > -1 ? process.argv[orgArg + 1] : NaN);
process.env.TRYCUA_PROVIDER = "cua";
process.env.TRYCUA_PROVIDER_TYPE = "org_desktop";
process.env.CUA_TELEMETRY_ENABLED ??= "false";
process.env.TRYCUA_CLEANUP_DISABLED = "true"; // no session rows: the idle sweep would stop the desktop

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error("Pass --org <id>");
    const userId = "smoke-test";

    // The "person": real X input through computer-server, like someone in the viewer.
    const provider = new CuaComputerProvider();
    const created = await provider.createSession({ os: "linux", organizationId });
    const session = { organizationId, providerSessionId: created.providerSessionId, os: "linux", metadata: created.metadata } as any;

    try {
        console.log("1. recording");
        const recording = await learnedSkillsService.startRecording({ organizationId, userId, trigger: "manual" });

        console.log("2. person searches Wikipedia for Honolulu");
        await provider.executeAction(session, { action: "browser_navigate", params: { url: "https://www.wikipedia.org/" } });
        await sleep(6000); // page load; the portal autofocuses its search box
        await provider.executeAction(session, { action: "type_text", params: { text: "Honolulu" } });
        await sleep(500);
        await provider.executeAction(session, { action: "key_press", params: { key: "Enter" } });
        await sleep(5000);

        console.log("3. stop + draft skill");
        const stopped = await learnedSkillsService.stopRecording(organizationId, recording.id);
        console.log("   person landed on", (stopped?.steps as any[] ?? []).at(-1)?.url);
        console.log("   recorded steps:", JSON.stringify((stopped?.steps as any[] ?? []).map((s) => ({ kind: s.kind, value: s.value, key: s.key, direct: s.direct, target: s.target?.placeholder ?? s.target?.name ?? s.target?.id }))));
        const draft = await learnedSkillsService.createSkillFromRecording({ organizationId, userId, recordingId: recording.id, goal: "Search Wikipedia for Honolulu" });
        console.log("   draft:", JSON.stringify({ name: draft.name, site: draft.site, inputs: draft.inputs, steps: (draft.steps as any[]).map((s) => `${s.kind}${s.value ? `=${s.value}` : ""}`), risk: draft.riskClass }));
        console.log("   procedure:\n" + draft.procedure.split("\n").map((l) => "     " + l).join("\n"));

        console.log("4. approve");
        const skill = await learnedSkillsService.approveSkill({ organizationId, userId, isAdmin: true }, draft.id);

        console.log("5. match");
        const goal = "Search Wikipedia for Paris";
        const matched = await learnedSkillsService.findSkillForGoal(organizationId, goal);
        console.log("   matched:", matched?.id === skill.id ? "yes" : `NO (${matched?.name ?? "none"})`);
        if (matched?.id !== skill.id) throw new Error("the new skill did not match its own kind of goal");

        console.log("6. resolve inputs + replay");
        const values = await learnedSkillsService.resolveInputs(organizationId, skill, goal);
        console.log("   inputs:", JSON.stringify(values));
        if (!values) throw new Error("inputs could not be resolved");
        const result = await learnedSkillsService.replay(organizationId, skill, values, (i, s) => console.log(`   replayed ${i + 1}: ${s.kind}`));
        console.log("   result:", JSON.stringify(result));
        const url = result.finalUrl ?? "";
        console.log("7. replay tab is on", url);
        const ok = result.completed && /\/wiki\/Paris/i.test(url);
        await learnedSkillsService.recordOutcome(skill.id, ok);
        await learnedSkillsService.archiveSkill(organizationId, skill.id);
        console.log(ok ? "\nPASS: recorded Honolulu, replayed as Paris" : "\nFAIL");
        process.exitCode = ok ? 0 : 1;
    } finally {
        await learnedSkillsService.stopRecording(organizationId).catch(() => undefined);
        await provider.terminateSession(session);
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
        console.error("✗", error?.message ?? error);
        process.exit(1);
    });
