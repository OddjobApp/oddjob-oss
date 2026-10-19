import { Project } from "ts-morph";
import type { TargetRule } from "@shared/schema/scaffold.js";
import fs from "node:fs/promises";
import path from "node:path";

function deepMerge(target: any, source: any): any {
  if (typeof target !== "object" || target === null) return source;
  if (typeof source !== "object" || source === null) return target;

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key in target) {
      if (typeof target[key] === "object" && typeof source[key] === "object") {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export class ASTRuleEngine {
  private project: Project;
  private snapshots: Map<string, string> = new Map();

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true
    });
  }

  public async createSnapshot(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      this.snapshots.set(absolutePath, content);
    } catch {
      // File doesn't exist yet, store marker for deletion on rollback
      this.snapshots.set(absolutePath, "__DELETE_MARKER__");
    }
  }

  public async rollback(): Promise<void> {
    for (const [filePath, content] of this.snapshots.entries()) {
      if (content === "__DELETE_MARKER__") {
        try {
          await fs.unlink(filePath);
        } catch {
          // File may already be absent
        }
      } else {
        await fs.writeFile(filePath, content, "utf-8");
      }
    }
    this.snapshots.clear();
  }

  public async applyRule(targetFilePath: string, rule: TargetRule): Promise<void> {
    const absolutePath = path.resolve(targetFilePath);

    if (rule.action === "AST_ADD_IMPORT" || rule.action === "AST_ADD_MIDDLEWARE") {
      await this.applyTsMorphRule(absolutePath, rule);
    } else if (rule.action === "MERGE_JSON") {
      await this.applyMergeJson(absolutePath, rule);
    }
  }

  private async applyTsMorphRule(filePath: string, rule: TargetRule): Promise<void> {
    let sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      sourceFile = this.project.addSourceFileAtPath(filePath);
    }

    if (rule.import) {
      this.injectImport(sourceFile, rule.import);
    }

    if (rule.action === "AST_ADD_MIDDLEWARE" && rule.use) {
      this.injectMiddleware(sourceFile, rule.use);
    }

    await sourceFile.save();
  }

  private injectImport(sourceFile: any, importStatement: string): void {
    const match = importStatement.match(/import\s+\{(.+)\}\s+from\s+['"](.+)['"]/);
    if (!match) return;

    const [, importsRaw, moduleSpecifier] = match;
    const namedImports = importsRaw.split(",").map(s => s.trim());

    const existing = sourceFile.getImportDeclaration(
      (id: any) => id.getModuleSpecifierValue() === moduleSpecifier
    );

    if (existing) {
      const currentNamed = existing.getNamedImports().map((n: any) => n.getName());
      for (const imp of namedImports) {
        if (!currentNamed.includes(imp)) {
          existing.addNamedImport(imp);
        }
      }
    } else {
      sourceFile.addImportDeclaration({
        moduleSpecifier,
        namedImports
      });
    }
  }

  private injectMiddleware(sourceFile: any, useStatement: string): void {
    const fullText = sourceFile.getFullText();
    if (fullText.includes(useStatement)) return;

    const statements = sourceFile.getStatements();
    let insertIndex = -1;

    for (let i = 0; i < statements.length; i++) {
      const text = statements[i].getText();
      if (text.includes("express()") || text.includes("app.use(")) {
        insertIndex = i + 1;
      }
    }

    if (insertIndex !== -1) {
      sourceFile.insertStatements(insertIndex, useStatement);
    } else {
      sourceFile.addStatements(useStatement);
    }
  }

  private async applyMergeJson(filePath: string, rule: TargetRule): Promise<void> {
    let existingContent: Record<string, any> = {};
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      existingContent = JSON.parse(raw);
    } catch {
      existingContent = {};
    }

    if (rule.path) {
      const currentSub = existingContent[rule.path] || {};
      existingContent[rule.path] = deepMerge(currentSub, rule.content || {});
    } else {
      existingContent = deepMerge(existingContent, rule.content || {});
    }

    await fs.writeFile(filePath, JSON.stringify(existingContent, null, 2), "utf-8");
  }
}
