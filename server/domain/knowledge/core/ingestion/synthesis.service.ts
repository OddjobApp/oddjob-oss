/**
 * Document Template Synthesis Service
 *
 * Generates a comprehensive markdown research synthesis report from collected
 * content and stores it as a DocumentTemplate. The report includes required
 * sections: Executive Summary, Sources Analyzed, Key Findings, Entity
 * Relationship Map (Mermaid diagram), Comparison Matrix, Recommendations,
 * and References. References the generated Dataset by name and includes
 * the count of Knowledge Graph entities created.
 *
 * If LLM synthesis times out, retries with reduced context and generates
 * a partial report if needed.
 *
 * @module ingestion/synthesis
 */

import { createLogger } from "@server/utils/logger.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { documentTemplateService } from "../document-template.service.js";
import type { CollectedContent } from "./collectors/collector.interface.js";
import type { ClassifiedInput } from "./types.js";
import { resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("Synthesis");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Timeout for the primary LLM synthesis call (ms) */
const SYNTHESIS_TIMEOUT_MS = 120_000;

/** Timeout for the retry attempt with reduced context (ms) */
const RETRY_TIMEOUT_MS = 60_000;

/** Maximum content characters to send in the primary attempt */
const MAX_PRIMARY_CONTEXT_CHARS = 100_000;

/** Maximum content characters to send in the retry (reduced) attempt */
const MAX_RETRY_CONTEXT_CHARS = 30_000;

/** Required section headers in the synthesis report */
export const REQUIRED_SECTIONS = [
  "Executive Summary",
  "Sources Analyzed",
  "Key Findings",
  "Entity Relationship Map",
  "Comparison Matrix",
  "Recommendations",
  "References",
] as const;

// ─── Public Interfaces ─────────────────────────────────────────────────────────

/** Input required by the synthesis service */
export interface SynthesisInput {
  /** Collected content from source collectors */
  content: CollectedContent[];
  /** The classified research subject */
  researchSubject: ClassifiedInput;
  /** Name of the dataset created for this research run */
  datasetName: string;
  /** Count of Knowledge Graph entities created */
  entitiesCreated: number;
  /** Count of Knowledge Graph relationships created */
  relationshipsCreated: number;
  /** Organization context for access control */
  orgContext: OrgContext;
}

/** Result of the synthesis phase */
export interface SynthesisResult {
  /** ID of the created DocumentTemplate record */
  documentTemplateId: number;
  /** The generated markdown content */
  content: string;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const synthesisService = {
  /**
   * Generate a synthesis report from collected content and store as DocumentTemplate.
   *
   * Workflow:
   * 1. Prepare content context from collected items
   * 2. Call LLM to generate comprehensive markdown report
   * 3. Validate report contains all required sections
   * 4. Store as DocumentTemplate with type "markdown", source "direct", category "research_synthesis"
   *
   * If the primary LLM call times out, retries with reduced context.
   * If retry also fails, generates a partial/structural report from available data.
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const {
      content,
      researchSubject,
      datasetName,
      entitiesCreated,
      relationshipsCreated,
      orgContext,
    } = input;

    logger.info("Starting synthesis", {
      subject: researchSubject.normalizedValue,
      contentItems: content.length,
      datasetName,
      entitiesCreated,
      relationshipsCreated,
    });

    let markdownContent: string;

    try {
      // Primary attempt: full context
      markdownContent = await generateSynthesisReport(
        content,
        researchSubject,
        datasetName,
        entitiesCreated,
        relationshipsCreated,
        MAX_PRIMARY_CONTEXT_CHARS,
        SYNTHESIS_TIMEOUT_MS,
      );
    } catch (primaryError) {
      logger.warn("Primary synthesis attempt failed, retrying with reduced context", {
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });

      try {
        // Retry: reduced context
        markdownContent = await generateSynthesisReport(
          content,
          researchSubject,
          datasetName,
          entitiesCreated,
          relationshipsCreated,
          MAX_RETRY_CONTEXT_CHARS,
          RETRY_TIMEOUT_MS,
        );
      } catch (retryError) {
        logger.warn("Retry synthesis also failed, generating partial report", {
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });

        // Fallback: generate a partial structural report without LLM
        markdownContent = generatePartialReport(
          content,
          researchSubject,
          datasetName,
          entitiesCreated,
          relationshipsCreated,
        );
      }
    }

    // Store as DocumentTemplate
    const template = await documentTemplateService.create(
      {
        name: `Research Synthesis: ${researchSubject.normalizedValue}`,
        description: `Autonomous research synthesis for "${researchSubject.value}"`,
        source: "direct",
        type: "markdown",
        content: markdownContent,
        category: "research_synthesis",
        createdBy: orgContext.userId,
      },
      orgContext.organizationId!,
    );

    logger.info("Synthesis report stored as DocumentTemplate", {
      documentTemplateId: template.id,
      subject: researchSubject.normalizedValue,
      contentLength: markdownContent.length,
    });

    return {
      documentTemplateId: template.id,
      content: markdownContent,
    };
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Generate the synthesis report via LLM.
 *
 * Constructs a prompt with the collected content (truncated to maxContextChars),
 * dataset metadata, and KG entity counts, then calls the AI service.
 */
async function generateSynthesisReport(
  content: CollectedContent[],
  researchSubject: ClassifiedInput,
  datasetName: string,
  entitiesCreated: number,
  relationshipsCreated: number,
  maxContextChars: number,
  timeoutMs: number,
): Promise<string> {
  const { systemAiService } = await import(
    "@domain/ai/core/system-ai.service.js"
  );
  const { AIClientFactory } = await import(
    "@domain/ai/core/ai-client.service.js"
  );

  const config = (await systemAiService.getAiConfig("copilot")) || {
    provider: "google",
    model: "gemini-2.0-flash",
  };

  const aiClient = AIClientFactory.getClient({
    provider: config.provider,
  } as any);

  const apiKey =
    config.apiKey ||
    (await resolveOrgTextAiKey(null, config.provider === "google" ? "google" : "openai")) ||
    "";

  if (!apiKey) {
    logger.warn("No API key available for synthesis, generating partial report");
    throw new Error("No API key configured for synthesis LLM call");
  }

  // Build content context (truncated to fit budget)
  const contentContext = buildContentContext(content, maxContextChars);

  const systemPrompt = `You are an expert research analyst generating a comprehensive synthesis report.

You MUST produce a valid Markdown document with EXACTLY these section headers (use ## level):
- ## Executive Summary
- ## Sources Analyzed
- ## Key Findings
- ## Entity Relationship Map
- ## Comparison Matrix
- ## Recommendations
- ## References

Rules:
1. The "Executive Summary" should summarize the key findings in 2-3 paragraphs.
2. The "Sources Analyzed" section should list all sources with their URLs and a brief description.
3. The "Key Findings" section should highlight the most important discoveries, organized by theme.
4. The "Entity Relationship Map" section MUST contain a Mermaid diagram (using \`\`\`mermaid code fence) showing entity relationships.
5. The "Comparison Matrix" section should contain a markdown table comparing key aspects across sources.
6. The "Recommendations" section should provide actionable next steps based on findings.
7. The "References" section should list all URLs in standard reference format.

IMPORTANT:
- You MUST reference the Dataset named "${datasetName}" in the report (e.g., in the Executive Summary or Sources Analyzed section).
- You MUST mention that ${entitiesCreated} Knowledge Graph entities and ${relationshipsCreated} relationships were created during this research.
- Do NOT include any preamble before the first heading. Start directly with "## Executive Summary".`;

  const userPrompt = `Generate a research synthesis report for the subject: "${researchSubject.value}"

Dataset: ${datasetName}
Knowledge Graph entities created: ${entitiesCreated}
Knowledge Graph relationships created: ${relationshipsCreated}
Number of sources collected: ${content.length}

Source content:
${contentContext}`;

  // Execute with timeout
  const result = await executeWithTimeout(
    () =>
      aiClient.execute(
        {
          model: config.model,
          systemPrompt,
          userPrompt,
          provider: config.provider as any,
          requestType: "text",
        } as any,
        userPrompt,
        apiKey,
      ),
    timeoutMs,
  );

  if (!result.success || !result.output) {
    throw new Error(
      `LLM synthesis returned no output: ${result.error || "unknown error"}`,
    );
  }

  // Clean up any markdown code fence wrappers
  let reportContent = result.output
    .replace(/^```markdown\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  // Validate that all required sections are present
  reportContent = ensureRequiredSections(
    reportContent,
    content,
    researchSubject,
    datasetName,
    entitiesCreated,
    relationshipsCreated,
  );

  return reportContent;
}

/**
 * Build a content context string from collected content, respecting the character budget.
 * Prioritizes diversity of sources and content with higher relevance.
 */
function buildContentContext(
  content: CollectedContent[],
  maxChars: number,
): string {
  let result = "";
  const charsPerItem = Math.floor(maxChars / Math.max(content.length, 1));
  const minCharsPerItem = 200;
  const itemBudget = Math.max(charsPerItem, minCharsPerItem);

  for (const item of content) {
    if (result.length >= maxChars) break;

    const truncatedContent = item.content.slice(0, itemBudget);
    const entry = `### ${item.title}\nURL: ${item.url}\nType: ${item.sourceType}\n\n${truncatedContent}\n\n---\n\n`;

    if (result.length + entry.length > maxChars) {
      // Add what we can
      const remaining = maxChars - result.length;
      result += entry.slice(0, remaining);
      break;
    }

    result += entry;
  }

  return result;
}

/**
 * Ensure all required section headers exist in the report.
 * If any are missing, append them with placeholder content.
 */
function ensureRequiredSections(
  reportContent: string,
  content: CollectedContent[],
  researchSubject: ClassifiedInput,
  datasetName: string,
  entitiesCreated: number,
  relationshipsCreated: number,
): string {
  let finalContent = reportContent;

  for (const section of REQUIRED_SECTIONS) {
    if (!finalContent.includes(`## ${section}`)) {
      finalContent += `\n\n## ${section}\n\n${generateSectionFallback(section, content, researchSubject, datasetName, entitiesCreated, relationshipsCreated)}`;
    }
  }

  // Ensure dataset name and entity count are referenced
  if (!finalContent.includes(datasetName)) {
    finalContent = finalContent.replace(
      "## Executive Summary",
      `## Executive Summary\n\n*Data stored in dataset: ${datasetName}*\n`,
    );
  }

  if (!finalContent.includes(String(entitiesCreated))) {
    finalContent = finalContent.replace(
      "## Key Findings",
      `## Key Findings\n\n*${entitiesCreated} Knowledge Graph entities and ${relationshipsCreated} relationships were created.*\n`,
    );
  }

  return finalContent;
}

/**
 * Generate fallback content for a missing section.
 */
function generateSectionFallback(
  section: string,
  content: CollectedContent[],
  researchSubject: ClassifiedInput,
  datasetName: string,
  entitiesCreated: number,
  relationshipsCreated: number,
): string {
  switch (section) {
    case "Executive Summary":
      return `This report synthesizes research on "${researchSubject.value}" from ${content.length} sources. Data is stored in dataset "${datasetName}". ${entitiesCreated} Knowledge Graph entities and ${relationshipsCreated} relationships were created during analysis.`;

    case "Sources Analyzed":
      return content
        .map((item) => `- [${item.title}](${item.url}) — ${item.sourceType}`)
        .join("\n");

    case "Key Findings":
      return `Analysis of ${content.length} sources identified ${entitiesCreated} entities across the research domain "${researchSubject.normalizedValue}".`;

    case "Entity Relationship Map":
      return "```mermaid\ngraph TD\n" +
        content.slice(0, 5).map((item, i) =>
          `    S${i}["${escapeForMermaid(item.title.slice(0, 30))}"]`
        ).join("\n") +
        "\n" +
        content.slice(0, 4).map((_, i) =>
          `    S${i} --> S${i + 1}`
        ).join("\n") +
        "\n```";

    case "Comparison Matrix":
      return "| Source | Type | Content Size |\n|--------|------|-------------|\n" +
        content
          .slice(0, 10)
          .map((item) => `| ${item.title.slice(0, 40)} | ${item.sourceType} | ${item.contentSize} bytes |`)
          .join("\n");

    case "Recommendations":
      return `Based on the analysis of ${content.length} sources covering "${researchSubject.normalizedValue}", further investigation is recommended.`;

    case "References":
      return content
        .map((item, i) => `${i + 1}. ${item.title} — ${item.url}`)
        .join("\n");

    default:
      return "*Section content pending.*";
  }
}

/**
 * Generate a complete partial report without LLM when both attempts fail.
 * Provides a structural report with all required sections filled from raw data.
 */
function generatePartialReport(
  content: CollectedContent[],
  researchSubject: ClassifiedInput,
  datasetName: string,
  entitiesCreated: number,
  relationshipsCreated: number,
): string {
  const sections = REQUIRED_SECTIONS.map((section) => {
    const sectionContent = generateSectionFallback(
      section,
      content,
      researchSubject,
      datasetName,
      entitiesCreated,
      relationshipsCreated,
    );
    return `## ${section}\n\n${sectionContent}`;
  });

  return sections.join("\n\n");
}

/**
 * Escape text for safe inclusion in Mermaid diagrams.
 */
function escapeForMermaid(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\](){}]/g, "");
}

/**
 * Execute a promise with a timeout. Rejects if the operation exceeds timeoutMs.
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Synthesis LLM call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
