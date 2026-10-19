import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@server/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const currentDir = path.dirname(__filename);
const logger = createLogger("BestPracticesService");

export type AudienceType = "HUMAN_PRIMARY" | "AGENT_PRIMARY" | "HYBRID" | "GOVERNANCE";

export interface BestPracticeArticle {
  id: string;
  title: string;
  audience: AudienceType[];
  badge: AudienceType;
  category: string;
  autonomyLevel: string;
  version: string;
  tags: string[];
  summary: string;
  markdown: string;
  agentMarkdown?: string;
  agentContract: AgentExecutionContract;
  filePath: string;
  lastUpdated: string;
}

export interface AgentExecutionContract {
  consumerRole: "human-reference" | "agent-executable" | "hybrid-collaboration" | "governance-control";
  appliesWhen: string[];
  doNotUseWhen: string[];
  requiredTools: string[];
  preconditions: string[];
  approvalRequirements: string[];
  successChecks: string[];
  stopConditions: string[];
  escalation: string[];
  implementationEvidence: string[];
  verificationStatus: "guidance" | "partially-verified" | "verified";
  precedence: string;
}

export interface CategorySummary {
  id: string;
  name: string;
  articleCount: number;
  tags: string[];
}

export class BestPracticesService {
  private cache: BestPracticeArticle[] | null = null;
  private lastScannedAt: number = 0;
  private readonly CACHE_TTL_MS = 10_000; // 10s TTL for fast local dev updates

  private getDocsDir(): string {
    const candidates = [
      path.resolve(process.cwd(), "docs", "platform"),
      path.resolve(process.cwd(), "..", "docs", "platform"),
      path.resolve(currentDir, "../../../../docs/platform"),
      path.resolve(currentDir, "../../../docs/platform"),
      path.resolve(currentDir, "../../docs/platform"),
    ];
    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        return c;
      }
    }
    return path.resolve(process.cwd(), "docs", "platform");
  }

  private parseFrontmatter(rawContent: string): { data: Record<string, any>; content: string } {
    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return { data: {}, content: rawContent };
    }

    const yamlBlock = match[1];
    const content = match[2];
    const data: Record<string, any> = {};

    // Frontmatter here is authored in two YAML shapes: inline arrays
    // (`tags: [a, b]`) and block sequences (`required_tools:` followed by
    // `  - name` lines). Only the inline form used to parse, so every
    // block-sequence field — required_tools, preconditions, success_checks —
    // silently became an empty contract while `verification_status: verified`
    // still parsed, publishing "verified" docs that declared nothing.
    let blockKey: string | null = null;

    yamlBlock.split(/\r?\n/).forEach((line) => {
      const item = line.match(/^\s+-\s+(.*)$/);
      if (item && blockKey) {
        const entry = item[1].trim().replace(/^['"]|['"]$/g, "");
        if (!entry) return;
        const bucket = data[blockKey];
        if (Array.isArray(bucket)) bucket.push(entry);
        else data[blockKey] = [entry];
        return;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return;
      const key = line.slice(0, colonIdx).trim();
      let val: any = line.slice(colonIdx + 1).trim();

      // Handle simple arrays [a, b, c]
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""));
        blockKey = null;
      } else if (val === "") {
        // A bare `key:` opens a block sequence; its items follow, indented.
        blockKey = key;
        val = [];
      } else {
        val = val.replace(/^['"]|['"]$/g, "");
        blockKey = null;
      }

      data[key] = val;
    });

    return { data, content };
  }

  /**
   * Generates a token-optimized markdown representation for agents by
   * stripping out sections marked with [🧑 Human] while retaining algorithms,
   * schemas, checklists, and safety boundaries.
   */
  public filterAgentMarkdown(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const filtered: string[] = [];
    let skippingHumanSection = false;

    for (const line of lines) {
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) {
        const isHumanOnly = /\[🧑\s*Human\]/i.test(heading[1]);
        skippingHumanSection = isHumanOnly;
        if (isHumanOnly) continue;
      }
      if (!skippingHumanSection) {
        filtered.push(line);
      }
    }

    return filtered.join("\n").trim();
  }

  private stringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value !== "string" || !value.trim()) return [];
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }

  private buildAgentContract(data: Record<string, any>, badge: AudienceType): AgentExecutionContract {
    const status = String(data.verification_status || "guidance").toLowerCase();
    const verificationStatus = status === "verified" || status === "partially-verified" ? status : "guidance";
    const consumerRole = badge === "AGENT_PRIMARY"
      ? "agent-executable"
      : badge === "GOVERNANCE"
        ? "governance-control"
        : badge === "HYBRID"
          ? "hybrid-collaboration"
          : "human-reference";
    return {
      consumerRole,
      appliesWhen: this.stringArray(data.applies_when),
      doNotUseWhen: this.stringArray(data.do_not_use_when),
      requiredTools: this.stringArray(data.required_tools),
      preconditions: this.stringArray(data.preconditions),
      approvalRequirements: this.stringArray(data.approval_requirements),
      successChecks: this.stringArray(data.success_checks),
      stopConditions: this.stringArray(data.stop_conditions),
      escalation: this.stringArray(data.escalation),
      implementationEvidence: this.stringArray(data.implementation_evidence),
      verificationStatus,
      precedence: String(data.precedence || "User instructions, runtime safety policy, capability guardrails, and live tool schemas take precedence over this pattern."),
    };
  }

  private renderAgentContract(contract: AgentExecutionContract): string {
    const render = (label: string, values: string[]) => values.length
      ? `## ${label}\n${values.map((value) => `- ${value}`).join("\n")}`
      : `## ${label}\n- Not declared. Inspect live capability and tool contracts before acting.`;
    return [
      "# Agent execution contract",
      `- Consumer role: **${contract.consumerRole}**`,
      `- Verification status: **${contract.verificationStatus}**`,
      `- Precedence: ${contract.precedence}`,
      render("Applies when", contract.appliesWhen),
      render("Do not use when", contract.doNotUseWhen),
      render("Required tools", contract.requiredTools),
      render("Preconditions", contract.preconditions),
      render("Approval requirements", contract.approvalRequirements),
      render("Success checks", contract.successChecks),
      render("Stop conditions", contract.stopConditions),
      render("Escalation", contract.escalation),
      render("Implementation evidence", contract.implementationEvidence),
    ].join("\n\n");
  }

  private async scanDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".json") || entry.name.endsWith(".ts"))) {
          files.push(fullPath);
        }
      }
    } catch (err: any) {
      logger.warn(`Could not read directory ${dir}: ${err.message}`);
    }
    return files;
  }

  public async getArticles(forceRefresh = false): Promise<BestPracticeArticle[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.lastScannedAt < this.CACHE_TTL_MS) {
      return this.cache;
    }

    const docsDir = this.getDocsDir();
    const filePaths = await this.scanDirectory(docsDir);
    const articles: BestPracticeArticle[] = [];

    for (const filePath of filePaths) {
      try {
        const rawContent = await fs.readFile(filePath, "utf-8");
        const stats = await fs.stat(filePath);
        const { data, content } = this.parseFrontmatter(rawContent);

        const relPath = path.relative(docsDir, filePath);
        const folderCategory = path.dirname(relPath).replace(/\\/g, "/");

        const id = data.id || path.basename(filePath, path.extname(filePath));
        const title = data.title || id.replace(/-/g, " ");
        const audienceRaw = Array.isArray(data.audience) ? data.audience : [data.audience || "HYBRID"];
        const audience = audienceRaw.map((a: string) => a.toUpperCase() as AudienceType);
        const badge = (data.badge || audience[0] || "HYBRID").toUpperCase() as AudienceType;
        const category = data.category || (folderCategory !== "." ? folderCategory : "general");
        const autonomyLevel = data.autonomy_level || data.autonomyLevel || "L0-L4";
        const version = data.version || "1.0.0";
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const summary = data.summary || content.slice(0, 200).replace(/\r?\n/g, " ").trim();
        const agentContract = this.buildAgentContract(data, badge);
        const agentMarkdown = `${this.renderAgentContract(agentContract)}\n\n---\n\n${this.filterAgentMarkdown(content)}`;

        articles.push({
          id,
          title,
          audience,
          badge,
          category,
          autonomyLevel,
          version,
          tags,
          summary,
          markdown: content,
          agentMarkdown,
          agentContract,
          filePath: relPath.replace(/\\/g, "/"),
          lastUpdated: stats.mtime.toISOString(),
        });
      } catch (err: any) {
        logger.error(`Failed to parse article at ${filePath}: ${err.message}`);
      }
    }

    articles.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    this.cache = articles;
    this.lastScannedAt = now;
    return articles;
  }

  public async getArticleById(id: string): Promise<BestPracticeArticle | null> {
    const articles = await this.getArticles();
    return articles.find((a) => a.id === id || a.filePath === id) || null;
  }

  public async searchArticles(query: string, audience?: AudienceType): Promise<BestPracticeArticle[]> {
    const normalized = query.trim().toLowerCase();
    const articles = await this.getArticles();
    return articles.filter((article) => {
      if (audience && !article.audience.includes(audience) && article.badge !== audience) return false;
      if (!normalized) return true;
      const contractText = Object.values(article.agentContract).flat().join(" ");
      return [article.title, article.summary, article.tags.join(" "), article.markdown, contractText]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }

  public async getCategories(): Promise<CategorySummary[]> {
    const articles = await this.getArticles();
    const map = new Map<string, { count: number; tags: Set<string> }>();

    for (const art of articles) {
      const entry = map.get(art.category) || { count: 0, tags: new Set<string>() };
      entry.count += 1;
      art.tags.forEach((t) => entry.tags.add(t));
      map.set(art.category, entry);
    }

    return Array.from(map.entries()).map(([catId, info]) => {
      const formattedName = catId
        .replace(/^\d+-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

      return {
        id: catId,
        name: formattedName,
        articleCount: info.count,
        tags: Array.from(info.tags),
      };
    });
  }
}

export const bestPracticesService = new BestPracticesService();
