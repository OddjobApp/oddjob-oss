import { describe, it, expect } from "vitest";
import React from "react";
import {
  synthesizeProps,
  resolveExport,
  checkComponent,
  checkComponents,
} from "./component-render-check.js";

describe("synthesizeProps", () => {
  it("omits optional props (trailing ? on the key)", () => {
    const props = synthesizeProps({ "appId?": "number", "showDiff?": "boolean" });
    expect(props).toEqual({});
  });

  it("synthesizes required props by type", () => {
    const props = synthesizeProps({
      blueprintId: "string",
      count: "number",
      enabled: "boolean",
    });
    expect(props).toEqual({ blueprintId: "test", count: 1, enabled: false });
  });

  it("synthesizes callables for function types", () => {
    const props = synthesizeProps({ onSend: "(content: string) => void" });
    expect(typeof props.onSend).toBe("function");
  });

  it("synthesizes empty arrays for array types", () => {
    expect(synthesizeProps({ items: "Message[]" }).items).toEqual([]);
    expect(synthesizeProps({ items: "Array<Foo>" }).items).toEqual([]);
  });

  it("picks the first member of a string-literal union", () => {
    expect(synthesizeProps({ trend: "'up' | 'down'" }).trend).toBe("up");
  });

  it("falls back to an object for unrecognised shapes", () => {
    expect(synthesizeProps({ config: "SomeInterface" }).config).toEqual({});
  });

  it("tolerates a null or non-object schema", () => {
    expect(synthesizeProps(null)).toEqual({});
    expect(synthesizeProps(undefined)).toEqual({});
  });
});

describe("resolveExport", () => {
  const Named = () => null;
  const Default = () => null;

  it("prefers the default export when exportType is default", () => {
    const mod = { default: Default, Widget: Named };
    expect(resolveExport(mod, { componentName: "Widget", importPath: "x", exportType: "default" }))
      .toBe(Default);
  });

  it("prefers the named export when exportType is named", () => {
    const mod = { default: Default, Widget: Named };
    expect(resolveExport(mod, { componentName: "Widget", importPath: "x", exportType: "named" }))
      .toBe(Named);
  });

  it("falls back across conventions when the recorded type is wrong", () => {
    // The index is script-populated, so exportType drifts from reality.
    const mod = { Widget: Named };
    expect(resolveExport(mod, { componentName: "Widget", importPath: "x", exportType: "default" }))
      .toBe(Named);
  });

  it("returns undefined for an empty module", () => {
    expect(resolveExport({}, { componentName: "Widget", importPath: "x", exportType: "named" }))
      .toBeUndefined();
  });
});

describe("checkComponent", () => {
  const base = { componentName: "Widget", importPath: "@pkg/widget", exportType: "default" };

  it("passes for a component that mounts cleanly", async () => {
    const result = await checkComponent(base, {
      importModule: async () => ({ default: () => React.createElement("div", null, "ok") }),
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBeUndefined();
  });

  it("reports an import failure distinctly", async () => {
    const result = await checkComponent(base, {
      importModule: async () => { throw new Error("Cannot find module"); },
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("import");
    expect(result.error).toContain("Cannot find module");
  });

  it("reports a missing export distinctly", async () => {
    const result = await checkComponent(base, { importModule: async () => ({}) });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("export");
  });

  it("reports a render-time throw distinctly", async () => {
    const result = await checkComponent(base, {
      importModule: async () => ({
        default: () => { throw new Error("Cannot read properties of undefined"); },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("render");
    expect(result.error).toContain("Cannot read properties of undefined");
  });

  it("passes required props through to the component", async () => {
    let seen: any = null;
    const result = await checkComponent(
      { ...base, propSchema: { blueprintId: "string", "optional?": "number" } },
      {
        importModule: async () => ({
          default: (props: any) => { seen = props; return React.createElement("div"); },
        }),
      },
    );
    expect(result.ok).toBe(true);
    expect(seen.blueprintId).toBe("test");
    expect(seen).not.toHaveProperty("optional");
    expect(result.propsUsed).toEqual({ blueprintId: "test" });
  });
});

describe("unmeasurable components are skipped, not failed", () => {
  const base = { componentName: "Widget", importPath: "@pkg/widget", exportType: "default" };

  it("skips a component whose module chain imports a stylesheet", async () => {
    const result = await checkComponent(base, {
      importModule: async () => { throw new Error('Unknown file extension ".css" for /x/Foo.css'); },
    });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("skips when the component chokes on our own object placeholder", async () => {
    const result = await checkComponent(
      { ...base, propSchema: { config: "SomeInterface" } },
      {
        importModule: async () => ({
          default: () => { throw new Error("Objects are not valid as a React child (found: object with keys {})"); },
        }),
      },
    );
    // The placeholder is the harness's doing; the component is not proven broken.
    expect(result.skipped).toBe(true);
  });

  it("does NOT skip that error when no object placeholder was passed", async () => {
    const result = await checkComponent(
      { ...base, propSchema: { label: "string" } },
      {
        importModule: async () => ({
          default: () => { throw new Error("Objects are not valid as a React child"); },
        }),
      },
    );
    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(false);
  });

  it("does not skip a genuine missing-module failure", async () => {
    const result = await checkComponent(base, {
      importModule: async () => { throw new Error("Cannot find module '@pkg/widget'"); },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.stage).toBe("import");
  });
});

describe("checkComponents", () => {
  it("continues past a failing component and returns one result each", async () => {
    const descriptors = [
      { componentName: "Good", importPath: "a", exportType: "default" },
      { componentName: "Bad", importPath: "b", exportType: "default" },
      { componentName: "AlsoGood", importPath: "c", exportType: "default" },
    ];

    const results = await checkComponents(descriptors, {
      importModule: async (path: string) => {
        if (path === "b") throw new Error("boom");
        return { default: () => React.createElement("div") };
      },
    });

    expect(results).toHaveLength(3);
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
  });
});
