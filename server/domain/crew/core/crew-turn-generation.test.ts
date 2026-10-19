import { describe, expect, it } from "vitest";
import { stripProseToolCall, extractMarkdownJsonToolCalls } from "./crew-turn-generation.js";

const KNOWN = new Set(["propose_flow", "list_jobs", "render_intake_form"]);

describe("a tool call written as prose", () => {
  it("strips the turn observed in a room, and names the tool", () => {
    // Verbatim from crew session 464, turn 3117: the agent read the jobs,
    // composed the call correctly, and wrote it out because propose_flow was
    // not offered on the follow-up pass.
    const content = [
      'Based on the available jobs, I can propose a flow that uses the "Automated Service',
      'Dispatch Bot" for the initial triage and then leverages the "Service Dispatch',
      'Coordinator" to dispatch a provider.',
      "",
      "I propose the following tool:",
      "```tool_code",
      'print(propose_flow(name="Asset Problem Triage and Dispatch", description="Automated flow",',
      '  steps=[{"jobId": 218, "name": "Triage"}, {"jobId": 219, "name": "Dispatch"}]))',
      "```",
    ].join("\n");

    const { cleanedContent, toolName } = stripProseToolCall(content, KNOWN);

    expect(toolName).toBe("propose_flow");
    expect(cleanedContent).not.toContain("print(");
    expect(cleanedContent).not.toContain("jobId");
    // The reasoning above it is real and stays.
    expect(cleanedContent).toContain("Automated Service");
  });

  it("leaves prose that only mentions a tool completely alone", () => {
    // The false positive that matters: a detector eating ordinary discussion is
    // worse than the bug it fixes.
    const content =
      "Call propose_flow once you have the job names from list_jobs. " +
      "I would not use render_intake_form here.";

    expect(stripProseToolCall(content, KNOWN)).toEqual({
      cleanedContent: content,
      toolName: null,
    });
  });

  it("ignores an empty call, which is how a tool gets named in passing", () => {
    const content = "You can just run list_jobs() and read the result.";
    expect(stripProseToolCall(content, KNOWN).toolName).toBeNull();
  });

  it("does not match a name that is part of a longer identifier", () => {
    const content = "```\nmy_propose_flow(name=1)\n```";
    expect(stripProseToolCall(content, KNOWN).toolName).toBeNull();
  });

  it("leaves a tool it has never heard of to the room", () => {
    const content = "```tool_code\nprint(invent_a_tool(name=\"x\"))\n```";
    expect(stripProseToolCall(content, KNOWN)).toEqual({
      cleanedContent: content,
      toolName: null,
    });
  });

  it("takes a bare line that is the call", () => {
    const content = [
      "Here is what I would run.",
      'propose_flow(name="Lead triage", steps=[{"jobId": 4}])',
      "Let me know if that looks right.",
    ].join("\n");

    const { cleanedContent, toolName } = stripProseToolCall(content, KNOWN);
    expect(toolName).toBe("propose_flow");
    expect(cleanedContent).toContain("Here is what I would run.");
    expect(cleanedContent).toContain("Let me know");
    expect(cleanedContent).not.toContain("propose_flow(");
  });

  it("costs nothing when no known tool appears", () => {
    const content = "I think we should talk about the schedule first.";
    expect(stripProseToolCall(content, KNOWN).cleanedContent).toBe(content);
  });
});

describe("the JSON fallback still behaves", () => {
  it("keeps executing a fenced json call, which this does not disturb", () => {
    const content = '```json\n{"name": "render_intake_form", "arguments": {"a": 1}}\n```';
    const out = extractMarkdownJsonToolCalls(content, KNOWN);
    expect(out.toolCalls).toEqual([{ name: "render_intake_form", args: { a: 1 } }]);
  });

  it("is not tripped by the prose form it was never meant to catch", () => {
    const content = '```tool_code\nprint(propose_flow(name="x"))\n```';
    expect(extractMarkdownJsonToolCalls(content, KNOWN).toolCalls).toEqual([]);
  });

  it("recovers arguments written flat beside the name", () => {
    // The envelope models emit when the args are not nested under a recognized
    // key — observed as `fields: Required` while the model had supplied them.
    const content =
      '```json\n{"name": "render_intake_form", "title": "Mortgage Calculator", "fields": [{"key": "principal", "label": "Principal", "type": "number"}]}\n```';
    const out = extractMarkdownJsonToolCalls(content, KNOWN);
    expect(out.toolCalls).toEqual([
      {
        name: "render_intake_form",
        args: {
          title: "Mortgage Calculator",
          fields: [{ key: "principal", label: "Principal", type: "number" }],
        },
      },
    ]);
    expect(out.cleanedContent).toBe("");
  });

  it("does not invent args for a tool-shaped name that is not granted", () => {
    const content = '```json\n{"name": "not_a_tool", "foo": 1}\n```';
    const out = extractMarkdownJsonToolCalls(content, KNOWN);
    expect(out.toolCalls).toEqual([]);
    // Ungranted tool-shaped identifiers are still replaced with a correction.
    expect(out.cleanedContent).toContain("not_a_tool` is not available");
  });
});
