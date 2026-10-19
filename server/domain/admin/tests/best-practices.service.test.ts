import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BestPracticesService } from "../best-practices.service.js";

describe("BestPracticesService", () => {
  it("removes only explicitly human sections from agent markdown", () => {
    const service = new BestPracticesService();
    const markdown = [
      "# Pattern",
      "## Builder context [🧑 Human]",
      "human prose",
      "## Unmarked operational section",
      "must remain",
      "## Runtime steps [🤖 Agent]",
      "execute this",
    ].join("\n");

    const result = service.filterAgentMarkdown(markdown);

    expect(result).not.toContain("human prose");
    expect(result).toContain("## Unmarked operational section");
    expect(result).toContain("must remain");
    expect(result).toContain("execute this");
  });

  it("builds consumer-aware contracts and searches full article content", async () => {
    const service = new BestPracticesService();
    const results = await service.searchArticles("SQL_MISSING_ORG_FILTER", "AGENT_PRIMARY");

    expect(results.some((article) => article.id === "autonomous-sql-generation-and-safety")).toBe(true);
    const sqlPattern = results.find((article) => article.id === "autonomous-sql-generation-and-safety");
    expect(sqlPattern?.agentContract.consumerRole).toBe("agent-executable");
    expect(sqlPattern?.agentContract.stopConditions).toContain("Tenant filter cannot be proven");
    expect(sqlPattern?.agentMarkdown).toContain("User instructions, runtime safety policy");
  });

  it("routes human-primary articles as reference rather than executable runbooks", async () => {
    const service = new BestPracticesService();
    const article = await service.getArticleById("oddjob-core-concepts");

    expect(article?.agentContract.consumerRole).toBe("human-reference");
  });

  it("reads block-sequence frontmatter, not only inline arrays", async () => {
    const service = new BestPracticesService();
    const article = await service.getArticleById("knowledge-graph-linking");

    // This doc declares `required_tools:` as an indented YAML list. The parser
    // once handled only `[a, b]`, so every list field collapsed to empty while
    // `verification_status: verified` still parsed — a doc that claimed to be
    // verified and declared nothing.
    expect(article?.agentContract.requiredTools).toContain("create_entity");
    expect(article?.agentContract.appliesWhen.length).toBeGreaterThan(0);
    expect(article?.agentContract.implementationEvidence.length).toBeGreaterThan(0);
    expect(article?.agentMarkdown).toContain("create_entity");
  });

  it("keeps every block-sequence required_tools declaration reaching the contract", async () => {
    const service = new BestPracticesService();
    const articles = await service.getArticles(true);

    const declaredInFile = (raw: string): string[] => {
      const lines = raw.split(/\r?\n/);
      const start = lines.findIndex((line) => line.trim() === "required_tools:");
      if (start === -1) return [];
      const declared: string[] = [];
      for (const line of lines.slice(start + 1)) {
        const item = line.match(/^\s+-\s+(.*)$/);
        if (!item) break;
        declared.push(item[1].trim());
      }
      return declared.filter(Boolean);
    };

    const dropped: string[] = [];
    for (const article of articles) {
      // filePath is relative to the docs/platform root the service scanned.
      const raw = await readFile(path.resolve("docs/platform", article.filePath), "utf-8");
      const declared = declaredInFile(raw);
      if (!declared.length) continue;
      const missing = declared.filter((tool) => !article.agentContract.requiredTools.includes(tool));
      if (missing.length) dropped.push(`${article.id}: ${missing.join(", ")}`);
    }

    expect(dropped).toEqual([]);
  });
});
