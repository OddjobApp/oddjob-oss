/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { studioDefinitionSchema } from "./form-studio";
import { conflictDifferences, mergeDefinitions, resolveConflicts, summarizeChanges, type NamedDefinition } from "./form-studio-merge";

/**
 * Three-way merge for a Studio save that lost a revision race. Two authors'
 * edits to different parts of a form must both survive; the same part edited two
 * ways must be put to the author, not silently decided.
 */

function draft(name: string, fields: unknown[], studio: Record<string, unknown> = {}): NamedDefinition {
  return { name, schema: studioDefinitionSchema.parse({ fields, studio: { version: 2, pages: [{ id: "page_1", title: "Form" }], ...studio } }) };
}
const field = (key: string, label = key, extra: Record<string, unknown> = {}) => ({ key, label, type: "text", ...extra });
const labels = (d: NamedDefinition) => d.schema.fields.map((f) => `${f.key}:${f.label}`);

describe("mergeDefinitions", () => {
  const base = draft("Intake", [field("a", "A"), field("b", "B"), field("c", "C")]);

  it("keeps both authors' edits to different fields", () => {
    const mine = draft("Intake", [field("a", "A (mine)"), field("b", "B"), field("c", "C")]);
    const theirs = draft("Intake", [field("a", "A"), field("b", "B (theirs)"), field("c", "C")]);
    const { merged, conflicts } = mergeDefinitions(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(labels(merged)).toEqual(["a:A (mine)", "b:B (theirs)", "c:C"]);
  });

  it("puts the same field edited two ways to the author, holding the saved version meanwhile", () => {
    const mine = draft("Intake", [field("a", "Mine"), field("b", "B"), field("c", "C")]);
    const theirs = draft("Intake", [field("a", "Theirs"), field("b", "B"), field("c", "C")]);
    const { merged, conflicts } = mergeDefinitions(base, mine, theirs);
    expect(conflicts).toMatchObject([{ id: "fields:a", label: 'Field "Mine"', base: field("a", "A"), mine: field("a", "Mine"), theirs: field("a", "Theirs") }]);
    expect(labels(merged)[0]).toBe("a:Theirs");
    expect(labels(resolveConflicts(merged, conflicts, { "fields:a": "mine" }))[0]).toBe("a:Mine");
  });

  it("applies a delete the other side did not touch, and asks when the other side edited it", () => {
    const mine = draft("Intake", [field("a", "A"), field("b", "B (mine)")]);
    const theirs = draft("Intake", [field("a", "A"), field("c", "C")]);
    const { merged, conflicts } = mergeDefinitions(base, mine, theirs);
    expect(conflicts.map((c) => c.id)).toEqual(["fields:b"]);
    expect(labels(merged)).toEqual(["a:A"]);
    expect(labels(resolveConflicts(merged, conflicts, { "fields:b": "mine" }))).toEqual(["a:A", "b:B (mine)"]);
    expect(labels(resolveConflicts(merged, conflicts, { "fields:b": "theirs" }))).toEqual(["a:A"]);
  });

  it("keeps fields both authors added", () => {
    const mine = draft("Intake", [field("a", "A"), field("b", "B"), field("c", "C"), field("mine_new")]);
    const theirs = draft("Intake", [field("a", "A"), field("b", "B"), field("c", "C"), field("theirs_new")]);
    expect(labels(mergeDefinitions(base, mine, theirs).merged)).toEqual(["a:A", "b:B", "c:C", "mine_new:mine_new", "theirs_new:theirs_new"]);
  });

  it("keeps the author's page order when the saved version only renamed a page", () => {
    const pages = [{ id: "one", title: "One" }, { id: "two", title: "Two" }];
    const b = draft("Intake", [], { pages });
    const mine = draft("Intake", [], { pages: [pages[1], pages[0]] });
    const theirs = draft("Intake", [], { pages: [{ id: "one", title: "First" }, pages[1]] });
    expect(mergeDefinitions(b, mine, theirs).merged.schema.studio.pages.map((p) => p.title)).toEqual(["Two", "First"]);
  });

  it("merges settings and the form name as whole values", () => {
    const b = draft("Intake", [], { defaultStatus: "REVIEW" });
    const mine = draft("Intake (mine)", [], { defaultStatus: "HOLD" });
    const theirs = draft("Intake (theirs)", [], { defaultStatus: "REVIEW" });
    const { merged, conflicts } = mergeDefinitions(b, mine, theirs);
    expect(merged.schema.studio.defaultStatus).toBe("HOLD");
    expect(conflicts.map((c) => c.id)).toEqual(["name"]);
    expect(resolveConflicts(merged, conflicts, { name: "mine" }).name).toBe("Intake (mine)");
  });
});

describe("conflictDifferences", () => {
  it("lists only the properties the two versions set differently", () => {
    expect(conflictDifferences({ mine: { id: "page_1", title: "Mine", html: "" }, theirs: { id: "page_1", title: "Theirs", html: "" } }))
      .toEqual([{ property: "title", mine: "Mine", theirs: "Theirs" }]);
  });

  it("compares whole values for names, settings and removed units", () => {
    expect(conflictDifferences({ mine: "Intake (mine)", theirs: "Intake (theirs)" })).toEqual([{ property: "", mine: "Intake (mine)", theirs: "Intake (theirs)" }]);
    expect(conflictDifferences({ mine: undefined, theirs: { key: "a" } })).toEqual([{ property: "", mine: undefined, theirs: { key: "a" } }]);
  });
});

describe("summarizeChanges", () => {
  it("names added, removed and changed units by their labels", () => {
    const before = draft("x", [field("a", "Reason"), field("b", "Budget")], { decisionRules: [{ id: "r1", when: "true", status: "GO" }] }).schema;
    const after = draft("x", [field("a", "Reason for change"), field("c", "Approver")], { decisionRules: [{ id: "r1", when: "true", status: "GO" }] }).schema;
    expect(summarizeChanges(before, after)).toEqual([{ collection: "fields", noun: "Field", added: ["Approver"], removed: ["Budget"], changed: ["Reason for change"] }]);
  });
});
