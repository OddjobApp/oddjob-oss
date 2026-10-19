import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ASTRuleEngine } from "../ast-rule-engine.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("ASTRuleEngine", () => {
  let tmpDir: string;
  let engine: ASTRuleEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-ast-test-"));
    engine = new ASTRuleEngine();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should inject named imports without duplicating existing imports", async () => {
    const appPath = path.join(tmpDir, "app.ts");
    const initialContent = `import { express } from 'express';\n\nconst app = express();\n`;
    await fs.writeFile(appPath, initialContent, "utf-8");

    await engine.applyRule(appPath, {
      target: "app.ts",
      action: "AST_ADD_IMPORT",
      import: "import { authMiddleware } from './middleware/auth.js'"
    });

    const updated = await fs.readFile(appPath, "utf-8");
    expect(updated).toContain('import { authMiddleware } from "./middleware/auth.js"');
  });

  it("should inject middleware statements after app instantiation", async () => {
    const appPath = path.join(tmpDir, "app.ts");
    const initialContent = `import express from 'express';\nconst app = express();\napp.listen(3000);\n`;
    await fs.writeFile(appPath, initialContent, "utf-8");

    await engine.applyRule(appPath, {
      target: "app.ts",
      action: "AST_ADD_MIDDLEWARE",
      import: "import { authMiddleware } from './middleware/auth.js'",
      use: "app.use('/api', authMiddleware);"
    });

    const updated = await fs.readFile(appPath, "utf-8");
    expect(updated).toContain('import { authMiddleware } from "./middleware/auth.js"');
    expect(updated).toContain("app.use('/api', authMiddleware);");
  });

  it("should deep merge JSON dependencies into package.json", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    const initialPkg = {
      name: "test-app",
      dependencies: {
        express: "^4.18.2"
      }
    };
    await fs.writeFile(pkgPath, JSON.stringify(initialPkg, null, 2), "utf-8");

    await engine.applyRule(pkgPath, {
      target: "package.json",
      action: "MERGE_JSON",
      path: "dependencies",
      content: {
        jsonwebtoken: "^9.0.0"
      }
    });

    const updated = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    expect(updated.dependencies.express).toBe("^4.18.2");
    expect(updated.dependencies.jsonwebtoken).toBe("^9.0.0");
  });
});
