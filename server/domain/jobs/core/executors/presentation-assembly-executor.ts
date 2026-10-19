import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./executor-types.js";
import { presentationAssemblyService } from "@domain/knowledge/core/presentation-assembly.service.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { resolveVariables } from "@server/core/variable-resolver.js";

const logger = createLogger("PresentationAssemblyExecutor");

export interface PresentationAssemblyJobParams {
  title?: string;
  formatCategory?: "presentation_deck" | "magazine_ad" | "whitepaper" | "executive_brief";
  themeId?: string;
  rawContent?: string;
  organizationId?: number;
  /**
   * A saved query, by name or id, to build the document from.
   *
   * Preferred over rawContent when the document is about data: the query runs
   * and its result table becomes the content, so the deck reports rows rather
   * than a paragraph describing them. rawContent still wins if both are given,
   * since an explicit body is a deliberate override.
   */
  savedQuery?: string | number;
}

export class PresentationAssemblyExecutor implements JobExecutor {
  static metadata = {
    name: "presentation_document_assembly",
    description: "Assembles visual presentation deliverables (slide decks, magazine ads, documents) using the blocking & assembly engine.",
  };

  canExecute(jobType: string): boolean {
    return jobType === "presentation_document_assembly" || jobType === "presentation_deck";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: Pipeline,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    logger.info(`Executing Presentation Assembly Executor for Job #${job.id}`);

    const params: PresentationAssemblyJobParams = resolvedConfig || {};
    const title = params.title || job.name || `Presentation Deliverable (Job #${job.id})`;
    const formatCategory = params.formatCategory || "presentation_deck";
    const themeId = params.themeId || "dark_cyberpunk";
    // No `|| 1`: the deliverable this produces is written into the org's KB, so
    // an unresolvable org would file another tenant's document. Sibling executors
    // throw for a missing required input; do the same rather than guess.
    const orgId = params.organizationId || job.organizationId;
    if (orgId == null) {
        throw new Error(
            `Presentation assembly for Job #${job.id} has no organization: set organizationId on the step or the job`,
        );
    }

    // Resolve raw content from job config, context variables, or fallback
    // VariableContext is a plain data bag — it has no `evaluate` method, so this
    // threw at runtime the moment rawContent was absent. resolveVariables is the
    // function that expands templates against it.
    // A saved query is a better source than prose when the document is about
    // data. Resolved before the fallbacks so a query-backed deck does not
    // silently fall through to the previous step's text if the query is empty.
    let queryContent: string | null = null;
    if (params.savedQuery !== undefined && params.savedQuery !== null && params.savedQuery !== "") {
      try {
        const { queryAssemblyService } = await import("@domain/knowledge/core/query-assembly.service.js");
        const resultSet = await queryAssemblyService.run(params.savedQuery as any, {
          userId: "presentation-assembly",
          organizationId: orgId,
          isAdmin: false,
          isSuperAdmin: false,
          isOrgAdmin: false,
        } as any);
        queryContent = queryAssemblyService.toMarkdown(resultSet);
      } catch (queryErr: any) {
        // Say so in the document rather than quietly producing one built from
        // something else — a deck that silently changed its source is worse
        // than one that reports the failure.
        logger.warn(`Saved query "${params.savedQuery}" failed for Job #${job.id}: ${queryErr.message}`);
        queryContent = `### Data unavailable

The saved query "${params.savedQuery}" could not be run: ${queryErr.message}
`;
      }
    }

    const rawContent = params.rawContent
      || queryContent
      || resolveVariables("{{previousStep.output}}", context)
      || job.description
      || "Executive summary & mission strategic deliverables synthesized.";

    // 1. Distill raw content into DocumentBlockAST
    const ast = presentationAssemblyService.distillContentToBlockAST(
      rawContent,
      title,
      formatCategory,
      themeId
    );

    // 2. Compile standalone HTML web deck & markdown summary
    const htmlWebDeck = presentationAssemblyService.compileToWebDeck(ast);
    const markdownSummary = presentationAssemblyService.compileToMarkdownSummary(ast);

    // 3. Persist output document into knowledge_documents
    let createdDocId: number | null = null;
    try {
      const [createdDoc] = await db.insert(knowledgeDocuments).values({
        organizationId: orgId,
        title,
        sourceType: "text",
        // knowledge_documents has no sourceRef/content: the body lives in
        // textContent, and the originating job is recorded as externalId.
        externalId: `job:${job.id}`,
        textContent: markdownSummary,
        metadata: {
          jobId: job.id,
          formatCategory,
          themeId,
          blockCount: ast.blocks.length,
          htmlWebDeck,
          ast,
        },
      }).returning();

      if (createdDoc) {
        createdDocId = createdDoc.id;
      }
    } catch (err: any) {
      logger.warn(`Failed to persist knowledge document record for Job #${job.id}: ${err.message}`);
    }

    // StepExecutionResult.output is a string, as every other executor treats it.
    // Returning an object here made the value unusable by the pipeline runner,
    // which passes step output around as text.
    const output = {
      documentId: createdDocId,
      blockCount: ast.blocks.length,
      themeId: ast.designSystem.id,
      themeName: ast.designSystem.name,
      formatCategory,
      htmlWebDeck,
      markdownSummary,
      ast,
    };

    return {
      success: true,
      output: JSON.stringify(output),
      status: "success",
    };
  }
}
