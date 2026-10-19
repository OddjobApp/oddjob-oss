/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import { generateDefinition, readProposal } from "./form-studio-proposal.js";

/**
 * Generated proposals. The first live "New from documents" run returned a
 * definition whose result block named a field by an invalid key, and the whole
 * proposal was discarded with "studio.results.0.field: Invalid".
 */

const valid = JSON.stringify({
  fields: [{ key: "pii_redacted", label: "PII redacted", type: "boolean" }],
  studio: { version: 2, pages: [{ id: "page_1", title: "Review" }] },
});
const invalid = JSON.stringify({
  fields: [{ key: "pii_redacted", label: "PII redacted", type: "boolean" }],
  studio: { version: 2, pages: [{ id: "page_1", title: "Review" }], results: [{ id: "summary", title: "Summary", type: "score", field: "PII redacted?" }] },
});

// The live proposal's mistake: a stage listing a field key where it names the
// earlier stages it may see. It parses, and Publish refuses it.
const staged = (secopsSees: string[], ownerPages = ["intake"]) => JSON.stringify({
  fields: [{ key: "system_name", label: "System name", type: "text", pageId: "intake" }],
  studio: {
    version: 2,
    pages: [{ id: "intake", title: "Intake" }, { id: "review", title: "Review" }],
    stages: [
      { id: "owner", title: "Data owner", pageIds: ownerPages, assignee: { type: "respondent" } },
      { id: "secops", title: "SecOps review", pageIds: ["review"], assignee: { type: "role", role: "SecOps" }, sees: secopsSees },
    ],
  },
});
const flawed = staged(["system_name"]);
const fixed = staged(["owner"]);
const worse = staged(["system_name"], ["intake", "review"]);

describe("readProposal", () => {
  it("reads a definition inside a code fence", () => {
    const reading = readProposal("```json\n" + valid + "\n```");
    expect("definition" in reading && reading.definition.fields[0].key).toBe("pii_redacted");
  });

  it("says what is wrong in terms the model can fix", () => {
    expect(readProposal(invalid)).toEqual({ problems: "studio.results.0.field: must start with a letter and use only letters, digits and underscores" });
    expect(readProposal("Here is your form!")).toMatchObject({ problems: expect.stringMatching(/^The reply was not JSON/) });
  });

  it("lists the checks a definition fails", () => {
    expect(readProposal(valid)).toMatchObject({ issues: [] });
    expect(readProposal(flawed)).toMatchObject({ issues: ["Stage secops: can only see earlier stages, and system_name is not one."] });
  });
});

describe("generateDefinition", () => {
  it("uses a valid first reply without asking again", async () => {
    const generate = vi.fn().mockResolvedValue(valid);
    await expect(generateDefinition(generate, "PROMPT")).resolves.toMatchObject({ fields: [{ key: "pii_redacted" }] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("asks once more with the problems, and keeps the corrected reply", async () => {
    const generate = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid);
    await expect(generateDefinition(generate, "PROMPT")).resolves.toMatchObject({ fields: [{ key: "pii_redacted" }] });
    const retryPrompt = generate.mock.calls[1][0] as string;
    expect(retryPrompt.startsWith("PROMPT")).toBe(true);
    expect(retryPrompt).toContain("studio.results.0.field: must start with a letter");
    expect(retryPrompt).toContain("<previous_reply>");
  });

  it("refuses with a 422 naming the problems when the correction is also invalid", async () => {
    const generate = vi.fn().mockResolvedValue(invalid);
    const error = await generateDefinition(generate, "PROMPT").catch((e) => e);
    expect(error.statusCode).toBe(422);
    expect(error.message).toContain("studio.results.0.field");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("sends the checks a definition fails back to the model, and keeps the corrected reply", async () => {
    const generate = vi.fn().mockResolvedValueOnce(flawed).mockResolvedValueOnce(fixed);
    const definition = await generateDefinition(generate, "PROMPT");
    expect(definition.studio.stages[1].sees).toEqual(["owner"]);
    const retryPrompt = generate.mock.calls[1][0] as string;
    expect(retryPrompt).toContain("cannot be published");
    expect(retryPrompt).toContain("Stage secops: can only see earlier stages, and system_name is not one.");
  });

  it("keeps a definition with checks when the correction is not a definition", async () => {
    const generate = vi.fn().mockResolvedValueOnce(flawed).mockResolvedValueOnce("Sorry, I cannot do that.");
    const definition = await generateDefinition(generate, "PROMPT");
    expect(definition.studio.stages[1].sees).toEqual(["system_name"]);
  });

  it("keeps whichever reply fails fewer checks", async () => {
    const generate = vi.fn().mockResolvedValueOnce(flawed).mockResolvedValueOnce(worse);
    const definition = await generateDefinition(generate, "PROMPT");
    expect(definition.studio.stages[0].pageIds).toEqual(["intake"]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("reports an empty first reply as a failed generation, not an invalid proposal", async () => {
    await expect(generateDefinition(vi.fn().mockResolvedValue(""), "PROMPT")).rejects.toThrow("AI generation failed to produce a response.");
  });
});
