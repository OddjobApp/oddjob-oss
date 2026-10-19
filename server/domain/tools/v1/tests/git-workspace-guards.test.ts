import { describe, it, expect, vi } from "vitest";

// The module pulls in a logger at import time; stub it so the unit test stays hermetic.
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { findUnresolvedTemplateToken, isProtectedPath } from "../capabilities/git-workspace.js";

describe("findUnresolvedTemplateToken", () => {
  it("blocks bare unresolved pipeline tokens (the real cycle-95 corruption)", () => {
    expect(findUnresolvedTemplateToken("{{steps.2.output}}")).toBe("{{steps.2.output}}");
    expect(findUnresolvedTemplateToken("{{context.fixed_package_json_content}}")).toBe("{{context.fixed_package_json_content}}");
    // whitespace around a bare token still counts as an unrendered leak
    expect(findUnresolvedTemplateToken("  {{steps.1.output}}  ")).toBe("{{steps.1.output}}");
  });

  it("blocks a known interpolation namespace embedded in otherwise-real content", () => {
    expect(findUnresolvedTemplateToken("const x = {{context.foo}};")).toBe("{{context.foo}}");
    expect(findUnresolvedTemplateToken("prefix {{steps.3.output}} suffix")).toBe("{{steps.3.output}}");
  });

  it("allows GitHub Actions / CI expressions (${{ … }}) — not Oddjob's bare {{ }} syntax", () => {
    expect(findUnresolvedTemplateToken("run: echo ${{ steps.build.outputs.hash }}")).toBeNull();
    expect(findUnresolvedTemplateToken("value: ${{ env.NODE_ENV }}")).toBeNull();
    expect(findUnresolvedTemplateToken("token: ${{ secrets.GITHUB_TOKEN }}")).toBeNull();
  });

  it("allows legitimate source and templating content", () => {
    expect(findUnresolvedTemplateToken("module.exports = { divide };")).toBeNull();
    expect(findUnresolvedTemplateToken("const x = {{a:1}};")).toBeNull(); // object-in-block, no namespace
    expect(findUnresolvedTemplateToken("<h1>{{name}}</h1>")).toBeNull(); // handlebars, non-pipeline namespace
    expect(findUnresolvedTemplateToken('{ "name": "sdlc-workspace" }')).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("protects build / dependency / tooling contracts", () => {
    for (const p of [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "tsconfig.json",
      "tsconfig.build.json",
      "eslint.config.js",
      "vite.config.ts",
      ".eslintrc.json",
      ".npmrc",
      "Dockerfile",
      ".env.local",
      "src/app.config.mjs",
    ]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
  });

  it("leaves ordinary source, tests, and docs writable", () => {
    for (const p of [
      "src/calculator.js",
      "test/calculator.test.js",
      "README.md",
      "src/index.ts",
      "lib/utils.py",
    ]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });

  it("normalizes backslashes so nested config paths are still protected", () => {
    expect(isProtectedPath("server\\config\\tsconfig.json")).toBe(true);
    expect(isProtectedPath("apps\\web\\next.config.js")).toBe(true);
  });
});
