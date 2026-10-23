/**
 * The generation-and-tool chain inside one speaker's turn.
 *
 * This had no direct coverage at all: the only nearby test exercised
 * extractMarkdownJsonToolCalls as a pure function, so nothing pinned the order
 * of the passes, the caps on each, or which calls survive the second pass. That
 * matters because the chain is bounded on purpose — a crew turn must stay fast,
 * and every stage here exists to stop a specific way turns used to be lost.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generate = vi.fn();
const execute = vi.fn();

vi.mock("../crew-generation.service.js", () => ({
    crewGenerationService: { generate },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { runToolPasses, buildTurnInstruction, resolveTurnTokenBudget, TRUNCATED_TOOLCALL_MAX_TOKENS } = await import("../crew-speaker-turn.service.js");
const { crewToolsService, MAX_TOOL_CALLS_PER_TURN } = await import("../crew-tools.service.js");
vi.spyOn(crewToolsService, "execute").mockImplementation(execute as any);

/** A generation result in the shape this.gen hands back. */
const gen = (content: string, toolCalls: Array<{ name: string; args?: any }> = [], truncatedOutput = false) => ({
    content,
    toolCalls: toolCalls.map((c) => ({ name: c.name, args: c.args ?? {} })),
    truncatedOutput,
    modelId: 1,
    latencyMs: 10,
});

const toolResult = (name: string, output = "ok", artifact: any = null, ok = true) => ({
    record: { name, ok, ms: 1 },
    output,
    artifact,
});

const CARD = { id: 1, name: "Copilot" } as any;

function runPasses(overrides: Record<string, unknown> = {}) {
    const cost = { modelCalls: 0, generationMs: 0, toolCalls: 0 };
    const scope = {
        cost,
        card: CARD,
        orgId: 7,
        message: "what is in the catalog?",
        messages: [{ role: "system", content: "you are copilot" }],
        availableTools: [
            { definition: { name: "list_installed_apps" } },
            { definition: { name: "google_search" } },
            { definition: { name: "send_agentmail" } },
            { definition: { name: "propose_research_mission" } },
        ],
        functionDeclarations: [{ name: "list_installed_apps" }],
        toolContext: { organizationId: 7 },
        turnMaxTokens: 600,
        ...overrides,
    } as any;
    return { cost, scope, run: runToolPasses(scope) };
}

describe("speaker turn tool passes", () => {
    it("preserves a YouTube description draft without inventing a Scribe failure", async () => {
        generate.mockResolvedValueOnce(gen("Here is the proposed channel description. No channel update has been published."));
        const names=["youtube_get_channel","search_unified_knowledge","scribe_get_document","scribe_replace_text"];
        const {run}=runPasses({message:"Yes, draft and update it.",hasActiveDocument:false,
          availableTools:names.map(name=>({definition:{name}})),functionDeclarations:names.map(name=>({name}))});
        const {result}=await run;
        expect(result.content).toContain("proposed channel description");
        expect(result.content).not.toContain("Scribe write");
        expect(execute).not.toHaveBeenCalled();
        expect(buildTurnInstruction("Yes, draft and update it.",[],"Copilot",false,[],names)).toContain("Never reuse sample percentages");
    });

    it("offers only app evidence readers for an explicit read-only app audit", async () => {
        generate.mockResolvedValueOnce(gen("", [{ name: 'read_app_records', args: { app: 'sdlc-workbench-org342' } }]))
            .mockResolvedValueOnce(gen("The app has no saved collections; execution is unverified."));
        execute.mockResolvedValueOnce(toolResult('read_app_records', '{"collections":[]}'));
        const names = ['read_app_records', 'read_app_activity', 'list_installed_apps', 'get_document_content', 'get_agent_personality', 'create_app_record'];
        const { run } = runPasses({
            message: 'Perform a read-only review of the loaded app.',
            availableTools: names.map(name => ({ definition: { name } })),
            functionDeclarations: names.map(name => ({ name })),
        });
        const result = await run;
        expect(generate.mock.calls[0][3].tools.map((tool: any) => tool.name)).toEqual(names.slice(0, 3));
        expect(execute.mock.calls[0][2].map((tool: any) => tool.definition.name)).toEqual(names.slice(0, 3));
        expect(result.toolsUsed).toEqual([expect.objectContaining({ name: 'read_app_records', ok: true })]);
    });
    it("does not read a Scribe document for a 'check' message in a room without one", async () => {
        // "check email/calendar/drive" classifies as 'review' in
        // scribeConversationIntent, which once injected scribe_get_document
        // into every one of those turns — a wasted call that also showed up
        // as a failing tool chip whenever the read errored.
        generate.mockResolvedValueOnce(gen("Checked your inbox."));

        const { run } = runPasses({
            message: "Can you check email for me",
            availableTools: [{ definition: { name: "scribe_get_document" } }],
            functionDeclarations: [],
        });
        const out = await run;

        expect(execute).not.toHaveBeenCalled();
        expect(out.result.content).toBe("Checked your inbox.");
    });

    it("still injects the document read for a review message when a manuscript exists", async () => {
        generate.mockResolvedValueOnce(gen("The draft reads well."));
        execute.mockResolvedValueOnce(toolResult("scribe_get_document", "current manuscript text"));

        const { run } = runPasses({
            message: "Can you check the draft",
            hasActiveDocument: true,
            availableTools: [{ definition: { name: "scribe_get_document" } }],
            functionDeclarations: [],
        });
        await run;

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toBe("scribe_get_document");
    });

    it("requests approval instead of partially applying a whole-document edit", async () => {
        generate.mockResolvedValueOnce(gen("Applying it now.", [{ name: "scribe_update_node", args: { nodeId: 4, content: "partial" } }]));
        const { run } = runPasses({
            message: "Rewrite the entire document completely",
            availableTools: [{ definition: { name: "scribe_update_node" } }],
            functionDeclarations: [{ name: "scribe_update_node" }],
        });
        const out = await run;
        expect(execute).not.toHaveBeenCalled();
        expect(out.result.content).toContain("A. Complete update");
        expect(out.result.content).toContain("B. Update in batches");
        expect(out.result.content).toContain("C. Condensed update");
    });

    it("expands the generation budget after complete-update approval", () => {
        expect(resolveTurnTokenBudget({ message: "A (Option A: Complete update — expanded output budget)", card: CARD }).turnMaxTokens)
            .toBe(TRUNCATED_TOOLCALL_MAX_TOKENS);
    });

    it("puts the approval gate in the prompt for a large document edit", () => {
        const instruction = buildTurnInstruction("Update the whole document", [], "Scribe", true);
        expect(instruction).toContain("LARGE DOCUMENT EDIT APPROVAL REQUIRED");
        expect(instruction).toContain("Do not change the manuscript on this turn");
        expect(instruction).not.toContain("then execute the requested result");
    });

    it('executes an external lookup after the model initially only promises to visit', async () => {
        generate.mockResolvedValueOnce(gen('I will visit the website.'))
            .mockResolvedValueOnce(gen('', [{ name: 'browse_web', args: { url: 'https://example.com' } }]))
            .mockResolvedValueOnce(gen('The page lists property records.'));
        execute.mockResolvedValueOnce(toolResult('browse_web', 'Verified page content'));
        const { run } = runPasses({ message: 'Visit https://example.com',
            availableTools: [{ definition: { name: 'browse_web' } }], functionDeclarations: [{ name: 'browse_web' }] });
        const out = await run;
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toBe('browse_web');
        expect(out.result.content).toContain('page lists');
    });
    it('does not publish invented website findings when no lookup runs', async () => {
        generate.mockResolvedValue(gen('I visited the website and found no tax records.'));
        const { run } = runPasses({ message: 'Visit the county website',
            availableTools: [{ definition: { name: 'browse_web' } }], functionDeclarations: [{ name: 'browse_web' }] });
        const out = await run;
        expect(execute).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(2);
        expect(out.result.content).toContain('No website content or search findings have been verified');
    });
    it('keeps a property-discovery goal through an old scaffold confirmation', () => {
        const instruction = buildTurnInstruction('I confirmed stage "stage-intake" with configuration: {"selectedPacks":[]}', [], 'Copilot', false,
            [{ speakerType: 'user', content: 'Identifying distressed properties?' }] as any);
        expect(instruction).toContain('RESIDENTIAL REAL ESTATE DISTRESS ASSEMBLY DIRECTIVE');
    });

    it('repairs a rejected build instead of stopping at a prose promise', async () => {
        generate.mockResolvedValueOnce(gen('', [{ name: 'scaffold_multistep_app' }]))
            .mockResolvedValueOnce(gen('I will fix the inputs later.'))
            .mockResolvedValueOnce(gen('', [{ name: 'scaffold_multistep_app', args: { stages: [] } }]))
            .mockResolvedValueOnce(gen('Blueprint created.'));
        execute.mockResolvedValueOnce({ record: { name: 'scaffold_multistep_app', ok: false, ms: 1, error: 'invalid arguments — inputs: Expected object' }, output: 'Expected object', artifact: null })
            .mockResolvedValueOnce(toolResult('scaffold_multistep_app', 'created'));
        const { run } = runPasses({ availableTools: [{ definition: { name: 'scaffold_multistep_app' } }], functionDeclarations: [{ name: 'scaffold_multistep_app' }] });
        const out = await run;
        expect(execute).toHaveBeenCalledTimes(2);
        expect(out.result.content).toBe('Blueprint created.');
        expect(generate.mock.calls[2][3].tools).toEqual([{ name: 'scaffold_multistep_app' }]);
    });

    it('reports an incomplete build when the bounded repair also fails', async () => {
        generate.mockResolvedValueOnce(gen('', [{ name: 'scaffold_multistep_app' }]))
            .mockResolvedValueOnce(gen('', [{ name: 'scaffold_multistep_app' }]))
            .mockResolvedValueOnce(gen('All good, the team agrees.'));
        execute.mockResolvedValue({ record: { name: 'scaffold_multistep_app', ok: false, ms: 1, error: 'invalid arguments — inputs: Expected object' }, output: 'Expected object', artifact: null });
        const { run } = runPasses({ availableTools: [{ definition: { name: 'scaffold_multistep_app' } }], functionDeclarations: [{ name: 'scaffold_multistep_app' }] });
        const out = await run;
        expect(execute).toHaveBeenCalledTimes(2);
        expect(out.result.content).toContain('was not created');
        expect(out.result.content).not.toContain('All good');
    });
    beforeEach(() => {
        generate.mockReset();
        execute.mockReset();
    });

    it("runs a single generation when the agent just talks", async () => {
        generate.mockResolvedValueOnce(gen("Here is my view."));

        const { cost, run } = runPasses();
        const out = await run;

        expect(generate).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
        expect(out.result.content).toBe("Here is my view.");
        expect(out.toolsUsed).toEqual([]);
        expect(cost.modelCalls).toBe(1);
        expect(cost.toolCalls).toBe(0);
    });

    it("executes the call, then generates again with tools still offered", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("You have two apps."));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "app-a, app-b"));

        const { cost, run } = runPasses();
        const out = await run;

        expect(execute).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledTimes(2);
        // The second pass keeps tools available so the agent can render what it found.
        expect(generate.mock.calls[1][3]).toMatchObject({ tools: [{ name: "list_installed_apps" }] });
        expect(out.result.content).toBe("You have two apps.");
        expect(out.toolsUsed.map((t: any) => t.name)).toEqual(["list_installed_apps"]);
        expect(cost.toolCalls).toBe(1);
    });

    it("feeds the tool output back under its own tool name", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("done"));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "app-a, app-b"));

        const { scope, run } = runPasses();
        await run;

        const handedBack = scope.messages.find((m: any) => m.content.includes("app-a, app-b"));
        expect(handedBack.content).toContain("list_installed_apps →\napp-a, app-b");
    });

    it("caps the first pass at MAX_TOOL_CALLS_PER_TURN", async () => {
        const overBudget = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 2 }, () => ({ name: "list_installed_apps" }));
        generate.mockResolvedValueOnce(gen("", overBudget)).mockResolvedValueOnce(gen("done"));
        execute.mockResolvedValue(toolResult("list_installed_apps"));

        const { cost, run } = runPasses();
        await run;

        expect(execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN);
        expect(cost.toolCalls).toBe(MAX_TOOL_CALLS_PER_TURN);
    });

    it("intercepts a markdown tool block emitted instead of a native call", async () => {
        const fenced =
            'Calling it now.\n\n```json\n{"name":"list_installed_apps","arguments":{}}\n```';
        generate.mockResolvedValueOnce(gen(fenced)).mockResolvedValueOnce(gen("Two apps."));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "app-a"));

        const { run } = runPasses();
        const out = await run;

        // Without interception this turn is prose describing a tool it never ran.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toBe("list_installed_apps");
        expect(out.result.content).toBe("Two apps.");
    });

    it("allows one bounded follow-up, then answers with tools withdrawn", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("", [{ name: "google_search" }]))
            .mockResolvedValueOnce(gen("Found it upstream."));
        execute
            .mockResolvedValueOnce(toolResult("list_installed_apps", "nothing"))
            .mockResolvedValueOnce(toolResult("google_search", "a result"));

        const { cost, run } = runPasses();
        const out = await run;

        expect(execute).toHaveBeenCalledTimes(2);
        expect(generate).toHaveBeenCalledTimes(3);
        // The last pass must not offer tools, so the turn has to end in prose.
        expect(generate.mock.calls[2][3].tools).toBeUndefined();
        expect(out.result.content).toBe("Found it upstream.");
        expect(out.toolsUsed.map((t: any) => t.name)).toEqual(["list_installed_apps", "google_search"]);
        expect(cost.modelCalls).toBe(3);
    });

    it("discards a second-pass call that is not a follow-up tool", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("I will propose a mission.", [{ name: "propose_research_mission" }]));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "nothing"));

        const { run } = runPasses();
        const out = await run;

        // Only the first-pass call ran; the mission proposal is not a follow-up.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledTimes(2);
        expect(out.toolsUsed.map((t: any) => t.name)).toEqual(["list_installed_apps"]);
    });

    it("regenerates a tool call the provider truncated mid-arguments", async () => {
        // Anthropic cut the tool_use input at max_tokens: generate_word's args
        // arrived as {path, title} — `content` was dropped before validation
        // ever saw it. Retrying inside the same budget would truncate again.
        generate
            .mockResolvedValueOnce(gen("", [{ name: "generate_word", args: { path: "paper.docx", title: "Dots" } }], true))
            .mockResolvedValueOnce(gen("", [{ name: "generate_word", args: { path: "paper.docx", content: "# OpenAI Dots\n..." } }]))
            .mockResolvedValueOnce(gen("Document generated."));
        execute.mockResolvedValueOnce(toolResult("generate_word", "saved to reports/paper.docx"));

        const { run } = runPasses({
            availableTools: [{ definition: { name: "generate_word" } }],
            functionDeclarations: [{ name: "generate_word" }],
        });
        const out = await run;

        expect(generate).toHaveBeenCalledTimes(3);
        expect(generate.mock.calls[1][3].maxTokens).toBe(TRUNCATED_TOOLCALL_MAX_TOKENS);
        // The retry's complete call ran — not the truncated one.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][1]).toMatchObject({ content: "# OpenAI Dots\n..." });
        expect(out.toolsUsed.map((t: any) => t.name)).toEqual(["generate_word"]);
    });

    it("executes the truncated call when the retry emits no calls", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }], true))
            .mockResolvedValueOnce(gen("No call this time."))
            .mockResolvedValueOnce(gen("Two apps."));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "app-a"));

        const { run } = runPasses();
        const out = await run;

        // Keeping the original call beats dropping it because the retry talked.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toBe("list_installed_apps");
        expect(out.result.content).toBe("Two apps.");
    });

    it("does not spend a retry on a non-truncated tool pass", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("Two apps."));
        execute.mockResolvedValueOnce(toolResult("list_installed_apps", "app-a"));

        const { run } = runPasses();
        await run;

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls.every((c: any[]) => c[3]?.maxTokens !== TRUNCATED_TOOLCALL_MAX_TOKENS)).toBe(true);
    });

    it("keeps artifacts from every pass, not just the last", async () => {
        const artifactA = { tool: "list_installed_apps", payload: { type: "app_surface" } };
        const artifactB = { tool: "google_search", payload: { type: "search" } };
        generate
            .mockResolvedValueOnce(gen("", [{ name: "list_installed_apps" }]))
            .mockResolvedValueOnce(gen("", [{ name: "google_search" }]))
            .mockResolvedValueOnce(gen("done"));
        execute
            .mockResolvedValueOnce(toolResult("list_installed_apps", "x", artifactA))
            .mockResolvedValueOnce(toolResult("google_search", "y", artifactB));

        const { run } = runPasses();
        const out = await run;

        expect(out.artifacts).toEqual([artifactA, artifactB]);
    });

    it("falls back to a plain generation when offering tools fails", async () => {
        generate
            .mockRejectedValueOnce(new Error("provider rejected function declaration"))
            .mockResolvedValueOnce(gen("Answered anyway."));

        const { run } = runPasses();
        const out = await run;

        // Losing the whole contribution to a rejected declaration once silenced
        // an entire round.
        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1][3].tools).toBeUndefined();
        expect(out.result.content).toBe("Answered anyway.");
    });

    it("sends the email a turn drafted in prose but never dispatched", async () => {
        generate.mockResolvedValueOnce(gen("Subject: Welcome\n\nGlad to have you."));
        execute.mockResolvedValueOnce(toolResult("send_agentmail", "queued as msg-1"));

        const { run } = runPasses({ message: "send it to ada@example.com please" });
        const out = await run;

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0]).toBe("send_agentmail");
        expect(execute.mock.calls[0][1]).toMatchObject({
            to: "ada@example.com",
            subject: "Welcome",
        });
        expect(out.result.content).toContain("Delivery Status:** queued as msg-1");
    });

    it("does not re-send when the agent already sent successfully", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "send_agentmail" }]))
            .mockResolvedValueOnce(gen("Sent."));
        execute.mockResolvedValueOnce(toolResult("send_agentmail", "queued as msg-1"));

        const { run } = runPasses({ message: "send it to ada@example.com please" });
        await run;

        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("does re-send when the agent's own send failed", async () => {
        generate
            .mockResolvedValueOnce(gen("", [{ name: "send_agentmail" }]))
            .mockResolvedValueOnce(gen("Subject: Welcome\n\nBody."));
        execute
            .mockResolvedValueOnce(toolResult("send_agentmail", "smtp refused", null, false))
            .mockResolvedValueOnce(toolResult("send_agentmail", "queued as msg-2"));

        const { run } = runPasses({ message: "send it to ada@example.com please" });
        await run;

        expect(execute).toHaveBeenCalledTimes(2);
    });

    it("leaves an ordinary turn alone when no address was asked for", async () => {
        generate.mockResolvedValueOnce(gen("Subject: Welcome\n\nNo address here."));

        const { run } = runPasses({ message: "draft a welcome note" });
        await run;

        expect(execute).not.toHaveBeenCalled();
    });

    it("includes role-differentiated contribution directive for subsequent speakers", () => {
        const instruction = buildTurnInstruction(
            "How should we build the caching layer?",
            [{ id: 1, speakerType: "agent", speakerName: "Coder", content: "Use Redis." } as any],
            "Security Auditor",
            false,
            [],
            ["search_platform_patterns"],
        );
        expect(instruction).toContain("ROLE-DIFFERENTIATED CONTRIBUTION");
        expect(instruction).toContain("DO NOT restate what Coder already answered");
        expect(instruction).toContain("Focus exclusively on your unique role and designated specialty");
    });

    it("omits external search tools from research ladder when agent has no web tools", () => {
        const instruction = buildTurnInstruction(
            "What is the system uptime?",
            [],
            "SRE",
            false,
            [],
            ["get_health_dashboard"],
        );
        expect(instruction).toContain("FACTUAL INTEGRITY: You do not hold external web research tools this turn");
        expect(instruction).not.toContain("google_search");
        expect(instruction).not.toContain("browse_web");
    });
});
