/**
 * Turn generation primitives shared across the crew.
 *
 * Every model call a round makes goes through generateForCard, and every
 * transcript rendered for a prompt goes through toGenerationMessages. Both the
 * speaker turns and the supervisor's directive follow-up use them, which is why
 * they live here rather than on the orchestrator: a helper reachable only
 * through `this` cannot be shared with a module that has no instance.
 */

import { crewGenerationService, type GenerationMessage } from "./crew-generation.service.js";
import type { AgentCardRecord, CrewTurnRecord } from "@shared/schema/index.js";
import type { CrewArtifact } from "./crew-tools.service.js";
import type { RoundCost } from "./crew-round-context.js";

/**
 * How many turns of transcript an agent is shown.
 *
 * A window, not the whole room: an unbounded transcript would grow every prompt
 * until the opening of the conversation crowded out the message being answered.
 */
export const TRANSCRIPT_WINDOW = 16;

/**
 * The escalation an agent should follow when it does not know something.
 *
 * The tools alone are not enough. Copilot held `list_instant_app_components` and
 * never called it, because the playbook that says to call it lives in the 1:1
 * copilot prompt and was never given to the crew — so it reached for a tool it
 * did know and answered from the wrong evidence. Granting research tools without
 * saying when to use them would repeat that exactly.
 *
 * Ordered cheapest-first, and it ends somewhere: "I could not find out" is a
 * legitimate answer, and proposing real work beats confident invention.
 */
export const RESEARCH_LADDER =
    `

CRITICAL RESEARCH PROTOCOL: If you do not know something — facts, entities, technical details, external information — do NOT guess or speculate. You MUST use research tools. Work in this EXACT order, stopping as soon as you can answer:
1. search_unified_knowledge (what this organisation already knows)
2. google_search (if knowledge base has no results)
3. browse_web for a specific page (if Google search is insufficient)
4. propose_research_mission (only if ALL above fail)

ALWAYS try at least one search before answering in prose. If search_unified_knowledge returns no results, explicitly state that and try google_search. If that also fails, try browse_web. Only if ALL research tools fail should you call propose_research_mission. Say plainly "I could not find information about X after searching the knowledge base and web" rather than filling the gap with plausible detail.`;

/**
 * Builds a dynamic research ladder reflecting only the tools the agent is
 * actually granted this turn, preventing the model from hallucinating or attempting
 * ungranted search tools.
 */
export function buildResearchLadder(availableToolNames?: string[] | Set<string>): string {
    if (!availableToolNames) return RESEARCH_LADDER;
    const names = availableToolNames instanceof Set ? availableToolNames : new Set(availableToolNames);
    const steps: string[] = [];
    if (names.has("search_unified_knowledge")) {
        steps.push(`${steps.length + 1}. search_unified_knowledge (what this organisation already knows)`);
    }
    if (names.has("google_search")) {
        steps.push(`${steps.length + 1}. google_search (for external web information)`);
    }
    if (names.has("browse_web")) {
        steps.push(`${steps.length + 1}. browse_web for reading a specific URL or page`);
    }
    if (names.has("propose_research_mission")) {
        steps.push(`${steps.length + 1}. propose_research_mission (only if all available lookups fail)`);
    }

    if (steps.length === 0) {
        return `\n\nFACTUAL INTEGRITY: You do not hold external web research tools this turn. Answer strictly from your verified domain knowledge and the transcript context. If a question requires external data or unverified facts, explicitly state what is missing rather than guessing or fabricating details.`;
    }

    return `\n\nCRITICAL RESEARCH PROTOCOL: If you do not know something — facts, entities, technical details, external information — do NOT guess or speculate. You MUST use research tools in this order, stopping as soon as you can answer:\n` +
        steps.join("\n") +
        `\n\nAlways call an available search tool before answering in prose. Say plainly "I could not find information about X after searching" rather than filling gaps with plausible speculation.`;
}

/**
 * Every model call in a round goes through here, so the count cannot drift from
 * reality by someone adding a generation and forgetting to tally it.
 *
 * `cost` is mutated deliberately: it is the round's running tally, and the
 * caller reads it after the round to report what the round spent.
 */
export async function generateForCard(
    cost: RoundCost,
    card: AgentCardRecord,
    orgId: number,
    messages: GenerationMessage[],
    options: Parameters<typeof crewGenerationService.generate>[3],
) {
    cost.modelCalls++;
    const result = await crewGenerationService.generate(card, orgId, messages, options);
    cost.generationMs += result.latencyMs ?? 0;
    return result;
}

/**
 * Fallback parser for when an LLM writes a tool call as a JSON markdown block
 * (e.g. ```json { "name": "render_intake_form", "arguments": { ... } } ```)
 * inside conversational content instead of emitting a native function call.
 */
export function extractMarkdownJsonToolCalls(
    content: string,
    availableToolNames: Set<string>,
): {
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
    cleanedContent: string;
} {
    if (!content || !content.includes("{")) {
        return { toolCalls: [], cleanedContent: content };
    }

    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let cleaned = content;

    // Matches ```json ... ``` or ``` ... ```
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        const blockText = match[1].trim();
        if (blockText.startsWith("{") && blockText.endsWith("}")) {
            try {
                const parsed = JSON.parse(blockText);
                const name = parsed.name || parsed.tool || parsed.function || parsed.action;
                let args = parsed.arguments || parsed.parameters || parsed.args || parsed.params || parsed.input;
                if ((!args || typeof args !== "object") && typeof name === "string" && availableToolNames.has(name)) {
                    // The model wrote the call flat — {"name": "render_intake_form",
                    // "title": "...", "fields": [...]} — with the arguments beside the
                    // name rather than under a recognized args key. Reading only the
                    // known keys handed the executor {} and every required field was
                    // reported missing even though the block specified them fully.
                    const {
                        name: _n, tool: _t, function: _f, action: _a,
                        arguments: _g, parameters: _p, args: _r, params: _s, input: _i,
                        ...rest
                    } = parsed;
                    if (Object.keys(rest).length > 0) args = rest;
                }
                if (typeof name === "string") {
                    if (availableToolNames.has(name)) {
                        toolCalls.push({
                            name,
                            args: typeof args === "object" && args !== null ? args : {},
                        });
                    } else if (/^[a-z][a-z0-9_]{2,}$/.test(name)) {
                        // The block names a tool-shaped identifier that isn't in the granted set.
                        // Strip it and replace with a corrective note so the agent doesn't keep
                        // repeating the hallucinated call in subsequent turns.
                        const correction =
                            `\n\n*Note: \`${name}\` is not available in this room. ` +
                            `Use \`search_unified_knowledge\`, \`google_search\`, or \`browse_web\` to find the information instead.*`;
                        cleaned = cleaned.replace(match[0], correction).trim();
                        continue;
                    }
                    // Always strip markdown tool invocation blocks from conversational prose
                    cleaned = cleaned.replace(match[0], "").trim();
                }
            } catch {
                // Not valid JSON — leave as code block
            }
        }
    }

    return { toolCalls, cleanedContent: cleaned };
}

/**
 * A tool call the model wrote out as text instead of calling.
 *
 * Observed in a room, verbatim: an agent asked to build a flow read the jobs,
 * composed the call correctly, and then said "I propose the following tool:
 * tool_code print(propose_flow(name=..., steps=[{"jobId": 218}, ...]))". The
 * tool was real and the arguments were right; it simply was not offered on that
 * pass, so there was nothing to call. What reached the room was confident prose
 * containing pseudo-code, with no sign anything had failed.
 *
 * Detected and removed, never executed. The JSON form above parses
 * unambiguously and is worth running; this one is Python-ish kwargs and nested
 * dicts, so turning it into arguments means guessing -- and a misparse would
 * call a real tool with arguments nobody wrote. Prose does not reach a write
 * here, which is the same reason every card approval is an anchored string.
 *
 * The caller says so plainly instead, and logs which tool was reached for. That
 * log is the diagnosis: a name the registry knows but the card was not offered
 * means a grant or follow-up-pass gap, which is exactly the bug that produced
 * the turn above.
 */
export function stripProseToolCall(
    content: string,
    knownToolNames: Set<string>,
): { cleanedContent: string; toolName: string | null } {
    if (!content || !content.includes("(")) return { cleanedContent: content, toolName: null };

    const names = [...knownToolNames].filter((n) => content.includes(`${n}(`));
    if (names.length === 0) return { cleanedContent: content, toolName: null };

    let found: string | null = null;

    /** A call shape: the tool name, a balanced paren, and at least one argument. */
    const callsATool = (text: string): string | null => {
        for (const name of names) {
            let from = 0;
            for (;;) {
                const at = text.indexOf(`${name}(`, from);
                if (at === -1) break;
                // Not a call when the name is part of a longer identifier.
                const before = at === 0 ? "" : text[at - 1];
                if (before && /[A-Za-z0-9_]/.test(before)) {
                    from = at + name.length;
                    continue;
                }
                let depth = 0;
                for (let i = at + name.length; i < text.length; i++) {
                    if (text[i] === "(") depth++;
                    else if (text[i] === ")") {
                        depth--;
                        if (depth === 0) {
                            const args = text.slice(at + name.length + 1, i);
                            // An argument, not `someTool()` mentioned in passing.
                            if (args.includes("=") || args.includes("{")) return name;
                            break;
                        }
                    }
                }
                from = at + name.length;
            }
        }
        return null;
    };

    // Fenced blocks first: tool_code, python, or untagged. The whole block goes.
    let cleaned = content.replace(/```[a-zA-Z_]*\s*[\s\S]*?```/g, (block) => {
        const hit = callsATool(block);
        if (!hit) return block;
        found = found ?? hit;
        return "";
    });

    // Then a bare line that is the call, optionally wrapped in print(...).
    cleaned = cleaned
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim().replace(/^print\(/, "");
            if (!trimmed) return true;
            const hit = callsATool(trimmed);
            // Only when the line IS the call -- prose that mentions one stays.
            if (!hit || !trimmed.startsWith(hit)) return true;
            found = found ?? hit;
            return false;
        })
        .join("\n");

    if (!found) return { cleanedContent: content, toolName: null };
    return { cleanedContent: cleaned.replace(/\n{3,}/g, "\n\n").trim(), toolName: found };
}

/**
 * Renders the transcript as chat messages from one agent's point of view:
 * its own turns are assistant messages, everyone else's are user messages
 * tagged with the speaker so it can address them by name.
 */
export function toGenerationMessages(turns: CrewTurnRecord[], selfName: string): GenerationMessage[] {
    return turns.slice(-TRANSCRIPT_WINDOW).map((t) => {
        const cleaned = extractMarkdownJsonToolCalls(t.content, new Set()).cleanedContent;
        return t.speakerName === selfName
            ? { role: "assistant" as const, content: cleaned }
            : { role: "user" as const, content: `${t.speakerName}: ${cleaned}` };
    });
}

/**
 * Splits an agent's theory-of-mind prediction off the end of its turn.
 *
 * The prediction rides along in the turn the agent was already taking, so it
 * costs no extra model call — but it must never reach the transcript, or the
 * next agent would read the prediction about itself and the test would be
 * worthless.
 */
export function splitPrediction(content: string): { visible: string; prediction: string | null } {
    let cleaned = content.trim();

    // Unwrap JSON string if model returned raw JSON object like {"answer": "..."}
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
        try {
            const parsed = JSON.parse(cleaned);
            if (typeof parsed.answer === "string" && parsed.answer) {
                cleaned = parsed.answer.trim();
            } else if (typeof parsed.content === "string" && parsed.content) {
                cleaned = parsed.content.trim();
            } else if (typeof parsed.response === "string" && parsed.response) {
                cleaned = parsed.response.trim();
            }
        } catch {}
    }

    const match = cleaned.match(/^[ \t]*PREDICTION[ \t]*\(([^)]*)\)[ \t]*:[ \t]*(.+?)[ \t]*$/im);
    if (!match) return { visible: cleaned, prediction: null };

    const visible = cleaned.replace(match[0], "").trim();
    const prediction = match[2].trim();
    return { visible, prediction: prediction.length > 0 ? prediction : null };
}

/**
 * Removes prose copies of surfaces the client is already rendering.
 *
 * A turn that mounted a diagram or an instant app often also pastes the source
 * or the raw payload into its text, so the room shows the surface and a
 * verbatim transcript of it side by side.
 *
 * The JSON walk counts braces rather than matching a regex: a lazy
 * `\{[\s\S]*?\}` stops at the first nested closing brace and truncates the
 * envelope mid-payload, leaving a fragment on screen instead of removing it.
 */
export function stripRenderedArtifactEchoes(visible: string, artifacts: CrewArtifact[]): string {
    let out = visible;

    if (artifacts.some((a) => a.tool === "render_workflow_diagram" || a.payload?.type === "workflow_diagram")) {
        out = out.replace(/```mermaid[\s\S]*?```/gi, "").trim();
    }

    const hasInstantApp = artifacts.some((a) =>
        a.payload?.type === "instant_app" || a.payload?.type === "instant_app_surface",
    );
    if (!hasInstantApp) return out;

    // Mirrors extractBalancedJson from crew-tools.service.ts.
    const candidate = /"type"\s*:\s*"(instant_app|instant_app_surface)"/;
    let cleaned = out;
    let idx = 0;
    while (idx < cleaned.length) {
        const openIdx = cleaned.indexOf('{', idx);
        if (openIdx === -1) break;

        let depth = 0, escaped = false, inStr = false;
        let endIdx = -1;
        for (let i = openIdx; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { endIdx = i + 1; break; }
            }
        }
        if (endIdx === -1 || endIdx <= openIdx) {
            idx = openIdx + 1;
            continue;
        }

        if (candidate.test(cleaned.slice(openIdx, endIdx))) {
            cleaned = cleaned.slice(0, openIdx) + cleaned.slice(endIdx);
            idx = openIdx; // Re-scan from where the block was removed.
        } else {
            idx = openIdx + 1;
        }
    }
    return cleaned.trim();
}
