// @vitest-environment node
import { describe, expect, it } from "vitest";
import { asStudioDefinition, evaluateStudio } from "./form-studio";
import { definitionFromLegacyForm, fillTemplate } from "./form-studio-legacy";

describe("definitionFromLegacyForm", () => {
  it("turns a plain field list into one page with no review step", () => {
    const { definition, legacy } = definitionFromLegacyForm({
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { id: "agree", label: "I agree", type: "checkbox" },
        { name: "secret", type: "password" },
        { key: "kind", label: "Kind", type: "radio", options: ["a", { value: "b", label: "B" }] },
        { key: "odd", label: "Odd", type: "hologram" },
      ],
    });

    expect(legacy).toBe(true);
    expect(definition.fields.map((f) => [f.key, f.type])).toEqual([["name", "text"], ["agree", "boolean"], ["secret", "text"], ["kind", "radio"], ["odd", "text"]]);
    expect(definition.fields[0]).toMatchObject({ required: true, pageId: "page_1" });
    expect(definition.fields[3].options).toEqual(["a", { value: "b", label: "B" }]);
    expect(definition.studio.pages).toEqual([{ id: "page_1", title: "Form", html: "" }]);
    expect(definition.studio.navigation).toEqual({ mode: "single", allowBack: true, reviewBeforeSubmit: false, showProgress: false });
  });

  it("fills defaults from the caller's context", () => {
    const { initialInputs } = definitionFromLegacyForm(
      { fields: [{ key: "vin", label: "VIN", defaultValue: "{{ vehicle.vin }}" }, { key: "count", label: "Count", type: "number", defaultValue: 3 }, { key: "empty", label: "Empty", defaultValue: "{{ missing.value }}" }] },
      { vehicle: { vin: "1HGCM82633A004352" } },
    );
    expect(initialInputs).toEqual({ vin: "1HGCM82633A004352", count: 3 });
  });

  it("keeps a calculator's formulas on the strict engine", () => {
    const { definition } = definitionFromLegacyForm({
      fields: [
        { key: "bill", label: "Bill", type: "number", required: true },
        { key: "tip", label: "Tip", type: "computed", formula: "round(bill * 0.2, 2)", format: "currency" },
      ],
    });
    const { values, errors } = evaluateStudio(definition, { bill: 50 }, true);
    expect(errors).toEqual({});
    expect(values.tip).toBe(10);
  });

  it("passes a Form Studio definition through with its own pages and navigation", () => {
    const studio = asStudioDefinition({ fields: [{ key: "mood", label: "Mood", type: "number" }], studio: { version: 2, pages: [{ id: "intro", title: "Intro" }, { id: "q", title: "Questions" }] } });
    const { definition, legacy } = definitionFromLegacyForm(studio);
    expect(legacy).toBe(false);
    expect(definition.studio.pages.map((p) => p.id)).toEqual(["intro", "q"]);
    expect(definition.studio.navigation.reviewBeforeSubmit).toBe(true);
  });

  it("fills a template path, leaving missing values empty", () => {
    expect(fillTemplate("Hi {{ user.name }}, {{ user.missing }}!", { user: { name: "Sam" } })).toBe("Hi Sam, !");
    expect(fillTemplate("{{ x }}", null)).toBe("{{ x }}");
  });

  it("converts multi-step schemas into Studio pages with paged navigation and top-level fields", () => {
    const { definition, initialInputs, legacy } = definitionFromLegacyForm({
      steps: [
        {
          id: "step_contact",
          title: "Contact Info",
          description: "Enter your contact details",
          fields: [
            { key: "fullName", label: "Full Name", type: "text", required: true, defaultValue: "{{ user.name }}" },
            { key: "email", label: "Email", type: "text" },
          ],
        },
        {
          id: "step_preferences",
          title: "Preferences",
          description: "Select your options",
          fields: [
            { key: "subscribe", label: "Subscribe to newsletter", type: "boolean", defaultValue: true },
            { key: "budget", label: "Budget", type: "number", defaultValue: 500 },
          ],
        },
      ],
    }, { user: { name: "Alice" } });

    expect(legacy).toBe(true);
    expect(definition.studio.pages).toHaveLength(2);
    expect(definition.studio.pages[0]).toMatchObject({
      id: "step_contact",
      title: "Contact Info",
      html: "<p>Enter your contact details</p>",
    });
    expect(definition.studio.pages[1]).toMatchObject({
      id: "step_preferences",
      title: "Preferences",
      html: "<p>Select your options</p>",
    });

    // Top-level fields are all aggregated with pageId
    expect(definition.fields).toHaveLength(4);
    expect(definition.fields.map(f => [f.key, f.pageId])).toEqual([
      ["fullName", "step_contact"],
      ["email", "step_contact"],
      ["subscribe", "step_preferences"],
      ["budget", "step_preferences"],
    ]);

    // Initial inputs extracted with context evaluation
    expect(initialInputs).toEqual({
      fullName: "Alice",
      subscribe: true,
      budget: 500,
    });

    // Paged navigation enabled
    expect(definition.studio.navigation).toEqual({
      mode: "paged",
      allowBack: true,
      reviewBeforeSubmit: true,
      showProgress: true,
    });
  });

  it("upgrades legacy reports into reviewer narrative result blocks", () => {
    const { definition } = definitionFromLegacyForm({
      fields: [{ key: "score", label: "Score", type: "number" }],
      reports: [
        { id: "exec_summary", title: "Executive Summary", html: "<p>Score: {{score}}</p>" },
      ],
    });

    expect(definition.studio.results).toHaveLength(1);
    expect(definition.studio.results[0]).toEqual({
      id: "exec_summary",
      title: "Executive Summary",
      type: "narrative",
      audience: "reviewer",
      html: "<p>Score: {{score}}</p>",
    });
  });

  it("passes structured results through directly", () => {
    const { definition } = definitionFromLegacyForm({
      fields: [{ key: "score", label: "Score", type: "number" }],
      results: [
        { id: "final_score", title: "Final Score", type: "score", field: "score", audience: "respondent", bands: [] },
      ],
    });

    expect(definition.studio.results).toHaveLength(1);
    expect(definition.studio.results[0]).toMatchObject({
      id: "final_score",
      type: "score",
      field: "score",
      audience: "respondent",
    });
  });

  it("preserves query connector attributes (url, params, jsonPath) on query fields", () => {
    const { definition } = definitionFromLegacyForm({
      fields: [
        { key: "city", label: "City", type: "text" },
        {
          key: "temp",
          label: "Current Temperature",
          type: "query",
          url: "https://api.open-meteo.com/v1/forecast",
          params: { latitude: "52.52", longitude: "13.41", current_weather: "true" },
          jsonPath: "current_weather.temperature",
          unit: "°C",
        },
      ],
    });

    const queryField = definition.fields.find((f) => f.key === "temp");
    expect(queryField).toBeDefined();
    expect(queryField?.type).toBe("query");
    expect(queryField?.url).toBe("https://api.open-meteo.com/v1/forecast");
    expect(queryField?.params).toEqual({ latitude: "52.52", longitude: "13.41", current_weather: "true" });
    expect(queryField?.jsonPath).toBe("current_weather.temperature");
    expect(queryField?.unit).toBe("°C");
  });
});
