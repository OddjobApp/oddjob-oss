import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, YouTubeSyncConfig, EntityRule, RelationshipRule } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { youtubeService } from "@domain/media/youtube-service.js";
import { transcriptionService } from "@domain/media/transcription-service.js";
import { ingestFileToKnowledgeStore, storeJobOutputAsKnowledge } from "@domain/knowledge/core/knowledge-store.js";
import { extractAndCreateKnowledgeGraph } from "@domain/knowledge/core/extraction/knowledge-graph-extractor.js";
import { db } from "@server/database_service.js";
import { documentService } from "@domain/knowledge/core/extraction/document-service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { and, eq, sql } from "drizzle-orm";

export class YouTubeSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "youtube_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: YouTubeSyncConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { playlistId, knowledgeTopicId, datasetId, transcriptionEnabled, maxVideos } = resolvedConfig;

        if (!knowledgeTopicId) {
            throw new Error("Knowledge Topic ID is required for YouTube Sync jobs.");
        }

        const logs: string[] = [];
        let processedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        try {
            logs.push(`Starting sync for playlist: ${playlistId}`);
            const videos = await youtubeService.getPlaylistVideos(playlistId);

            const videosToProcess = maxVideos ? videos.slice(0, maxVideos) : videos;
            logs.push(`Found ${videos.length} videos. Processing ${videosToProcess.length}.`);

            // Rules for Knowledge Graph extraction from YouTube Metadata
            const entityRules: EntityRule[] = [
                {
                    entityType: "YouTubeVideo",
                    label: "Video",
                    mappings: {
                        name: "title",
                        externalId: "id",
                        data: {
                            url: "url",
                            channel: "channelTitle",
                            duration: "duration",
                            domain: "video"
                        }
                    }
                }
            ];

            for (const video of videosToProcess) {
                try {
                    // 1. Check for idiempotency (Avoid duplicate ingestion)
                    const existingDocs = await documentService.findDocumentsByMetadata(
                        getSystemOrgContext(job.organizationId!),
                        'videoId',
                        video.id
                    );
                    const existing = existingDocs[0];

                    if (existing) {
                        skippedCount++;
                        continue;
                    }

                    logs.push(`Processing video: ${video.title} (${video.id})`);

                    // 2. Fetch Transcript if enabled
                    let transcript = null;
                    if (transcriptionEnabled !== false) {
                        transcript = await youtubeService.getTranscript(video.id);

                        // FALLBACK: transcribe the audio (Gemini, on the org's key) if no native transcript
                        if (!transcript) {
                            try {
                                console.log(`[YouTubeSync] No native transcript for ${video.id}, transcribing audio...`);
                                const audioBuffer = await youtubeService.downloadAudio(video.id);
                                const transcribed = await transcriptionService.transcribe(audioBuffer, `${video.id}.mp3`, job.organizationId);
                                transcript = {
                                    text: transcribed.text,
                                    segments: transcribed.segments
                                };
                            } catch (transcribeErr) {
                                console.warn(`[YouTubeSync] Audio transcription failed for ${video.id}:`, transcribeErr);
                            }
                        }
                    }

                    const combinedContent = `
# ${video.title}
Channel: ${video.channelTitle}
URL: ${video.url}

## Description
${video.description}

## Transcript
${transcript ? (typeof transcript === 'string' ? transcript : JSON.stringify(transcript, null, 2)) : "No transcript available."}
                    `.trim();

                    // 3. Ingest to Knowledge Store
                    const knowledgeDocumentId = await ingestFileToKnowledgeStore({
                        content: combinedContent,
                        title: video.title,
                        sourceType: "text",
                        topicId: knowledgeTopicId,
                        organizationId: job.organizationId!,
                        createdBy: job.createdBy,
                        metadata: {
                            source: 'youtube',
                            videoId: video.id,
                            url: video.url,
                            channel: video.channelTitle,
                            duration: video.duration,
                            thumbnail: video.thumbnailUrl,
                            syncedAt: new Date().toISOString(),
                            jobId: job.id
                        }
                    });

                    // 4. Extract to Knowledge Graph
                    await extractAndCreateKnowledgeGraph({
                        data: video,
                        entityRules,
                        relationshipRules: [],
                        organizationId: job.organizationId!,
                        createdBy: job.createdBy,
                        knowledgeDocumentId,
                        jobId: job.id,
                        extractionSource: "pipeline"
                    });

                    // 5. If Dataset ID is provided, store as dataset item
                    if (datasetId) {
                        await storeJobOutputAsKnowledge({
                            output: JSON.stringify({
                                ...video,
                                transcript: transcript
                            }),
                            job: job,
                            stepExecution: {
                                id: -1, // No pipeline step for direct sync
                                status: "success",
                                executedAt: new Date()
                            },
                            topicId: null,
                            datasetId: datasetId,
                            tags: ['youtube', 'sync'],
                            settings: { storeOnStatus: "success", requireNonEmpty: true }
                        });
                    }

                    processedCount++;
                } catch (err: any) {
                    console.error(`Failed to process video ${video.id}:`, err);
                    errorCount++;
                    logs.push(`Error processing video ${video.id}: ${err.message}`);
                }
            }

        } catch (err: any) {
            console.error(`Fatal error in YouTube sync:`, err);
            return {
                success: false,
                status: "failed",
                error: err.message,
                output: JSON.stringify({ logs })
            };
        }

        return {
            success: errorCount === 0,
            status: errorCount === 0 ? "success" : "failed",
            output: JSON.stringify({
                message: `YouTube Sync Completed. Processed: ${processedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
                logs: logs
            })
        };
    }
}


