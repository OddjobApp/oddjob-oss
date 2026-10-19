import { describe, expect, it } from "vitest";
import { parseStudioDefinition, type StudioDefinition, type StudioField } from "@shared/form-studio";
import { changedFields, selectProposal } from "./proposal-selection";

const field = (key: string, label: string, extra: Partial<StudioField> = {}): StudioField =>
  ({ key, label, type: "text", ...extra }) as StudioField;

/** Parsed rather than cast, so the fixture carries every default a saved form has. */
const definition = (fields: StudioField[], pageTitle = "Page one"): StudioDefinition =>
  parseStudioDefinition({
    fields,
    studio: { version: 1, pages: [{ id: "p1", title: pageTitle, html: "" }] },
  });

describe("changedFields", () => {
  it("names each field the proposal adds, removes or edits, and nothing else", () => {
    const before = definition([field("name", "Name"), field("age", "Age"), field("city", "City")]);
    const after = definition([field("name", "Full name"), field("city", "City"), field("email", "Email")]);

    expect(changedFields(before, after)).toEqual([
      { key: "name", before: field("name", "Name"), after: field("name", "Full name") },
      { key: "age", before: field("age", "Age"), after: undefined },
      { key: "email", before: undefined, after: field("email", "Email") },
    ]);
  });

  it("ignores a field whose properties were only reordered", () => {
    const before = definition([field("name", "Name", { required: true, description: "Legal name" })]);
    const after = definition([{ description: "Legal name", required: true, label: "Name", key: "name", type: "text" } as StudioField]);

    expect(changedFields(before, after)).toEqual([]);
  });
});

describe("selectProposal", () => {
  it("takes the accepted edits and leaves a declined field exactly as saved", () => {
    const before = definition([field("name", "Name"), field("age", "Age")]);
    const after = definition([field("name", "Full name"), field("age", "Age in years")]);

    const picked = selectProposal(before, after, ["age"], true);

    expect(picked.fields).toEqual([field("name", "Full name"), field("age", "Age")]);
  });

  it("drops a field the proposal adds when that addition is declined", () => {
    const before = definition([field("name", "Name")]);
    const after = definition([field("name", "Name"), field("email", "Email")]);

    expect(selectProposal(before, after, ["email"], true).fields).toEqual([field("name", "Name")]);
  });

  it("keeps a field the proposal would delete when the deletion is declined, in its saved place", () => {
    const before = definition([field("name", "Name"), field("age", "Age"), field("city", "City")]);
    const after = definition([field("name", "Name"), field("city", "City")]);

    expect(selectProposal(before, after, ["age"], true).fields).toEqual([
      field("name", "Name"),
      field("age", "Age"),
      field("city", "City"),
    ]);
  });

  it("keeps the saved pages, rules and tests when only the fields are wanted", () => {
    const before = definition([field("name", "Name")], "Saved page");
    const after = definition([field("name", "Full name")], "Proposed page");

    const fieldsOnly = selectProposal(before, after, [], false);
    expect(fieldsOnly.studio.pages[0].title).toBe("Saved page");
    expect(fieldsOnly.fields).toEqual([field("name", "Full name")]);

    const everything = selectProposal(before, after, [], true);
    expect(everything.studio.pages[0].title).toBe("Proposed page");
  });
});
