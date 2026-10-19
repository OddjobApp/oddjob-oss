import { Job, Pipeline } from "@shared/schema/index.js";
import type { ScribePublishConfig } from "@shared/schema/index.js";
import { type VariableContext } from "@server/core/variable-resolver.js";
import { type StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { type JobExecutor } from "./index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScribePublishExecutor");

/**
 * ScribePublishExecutor
 *
 * Publishes an existing Scribe document as a pipeline step. Optionally feeds a
 * resolved context paragraph (templated from prior step outputs) through
 * crystallizeFromContext first, so a workflow can hand the document what
 * upstream steps produced, then publishes the manuscript as Markdown — and,
 * when format is "word", also attaches a DOCX export to the same room.
 */
export class ScribePublishExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "scribe_publish";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as ScribePublishConfig;
        const organizationId = pipeline.organizationId ?? job.organizationId;
        if (organizationId == null) {
            return {
                success: false,
                output: "",
                status: "failed",
                error: "scribe_publish requires an organization on the pipeline or job",
            };
        }

        const userId = (context as any).userId ?? "workflow-runtime";
        // resolvedConfig is template-resolved, not schema-parsed — apply the
        // schema default here so an unset format still means markdown.
        const format = config.format ?? "markdown";

        try {
            const { scribeService } = await import("@domain/scribe/core/scribe.service.js");

            const contextParagraph = (config.contextParagraph ?? "").trim();
            if (contextParagraph) {
                // extractedEntities only accepts string values for {{key}}
                // placeholder replacement; context.data can carry anything.
                const entities = Object.fromEntries(
                    Object.entries(context.data ?? {}).filter(([, v]) => typeof v === "string")
                ) as Record<string, string>;
                await scribeService.crystallizeFromContext(
                    config.documentId,
                    organizationId,
                    contextParagraph,
                    entities
                );
            }

            const published = await scribeService.publishDocument(config.documentId, organizationId, {
                branchId: config.branchId,
                versionTag: config.versionTag,
                releaseNotes: config.releaseNotes,
                userId,
            });

            let wordAttachmentId: number | undefined;
            if (format === "word") {
                const { buildExportFile } = await import("@domain/scribe/core/scribe-export.service.js");
                const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
                const file = await buildExportFile(published.compiled, "word");
                // Same room the markdown deliverable landed in — publishDocument
                // resolves and binds the session's project before attaching.
                const { attachment } = await attachmentService.attachToRoom({
                    orgId: organizationId,
                    projectId: published.attachment.projectId,
                    sessionId: published.document.sessionId,
                    buffer: file.body,
                    originalName: file.filename,
                    mimeType: file.mimeType,
                    uploadedBy: userId,
                });
                wordAttachmentId = attachment.id;
            }

            const output = {
                _type: "scribe_publication",
                documentId: config.documentId,
                title: published.compiled.title,
                wordCount: published.compiled.wordCount,
                versionTag: published.versionTag,
                format,
                attachmentId: published.attachment.id,
                blobId: published.attachment.blobId,
                downloadUrl: published.downloadUrl,
                ...(wordAttachmentId != null ? { wordAttachmentId } : {}),
            };

            return { success: true, output: JSON.stringify(output), status: "success" };
        } catch (error: any) {
            logger.error(`[ScribePublish] Document ${config.documentId} publish failed: ${error?.message ?? error}`);
            return {
                success: false,
                output: "",
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
