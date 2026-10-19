import { z } from "zod";
import type { ToolDefinition } from "./types.js";

export const VIDEO_TOOLS: Record<string, ToolDefinition> = {
    search_videos: {
        name: "search_videos",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Videos",
        group: "Video Content",
        description: "Search for relevant YouTube video clips, transcripts, and metadata. Use this when a user asks for video examples, visual tutorials, or topical clips.",
        parameters: z.object({
            query: z.string().describe("Search query for video content or transcript snippets"),
            limit: z.number().optional().default(5).describe("Max 10"),
        }),
        execute: async (params, context) => {
            try {
                const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
                const { videoFeedbackService } = await import("@domain/media/video-feedback-service.js");

                // 1. Fetch relevant cliques/instructions for this topic to improve precision
                const feedbackContext = await videoFeedbackService.getPromptInstructions(params.query, context?.organizationId || 0);

                // 2. Perform search filtered for YouTube content
                const results = await knowledgeService.searchUnified(params.query, { 
                    organizationId: context?.organizationId || null,
                    userId: 'system'
                } as any, {
                    limit: params.limit || 5,
                    types: ["youtube"]
                });

                if (results.length === 0) {
                    return `No relevant video clips found for "${params.query}".${feedbackContext ? "\n\n" + feedbackContext : ""}`;
                }

                const output = results.map(res => {
                    const videoId = res.metadata?.videoId;
                    const timestamp = res.metadata?.timestamp || 0;
                    const url = videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${timestamp}` : (res.url || 'No URL');

                    return `### ${res.title}\n` +
                        `- **Snippet**: ${res.description?.substring(0, 300)}...\n` +
                        `- **Link**: [Watch Clip](${url})\n` +
                        `- **Reasoning**: Recommended based on ${(res.score || 0) * 100}% relevance match.`;
                }).join("\n\n");

                return `## Video Recommendations for "${params.query}"\n${feedbackContext}\n\n${output}\n\n*Note: You can play these clips directly in the chat or provide feedback on their relevance.*`;
            } catch (e: any) {
                return `Error searching videos: ${e.message}`;
            }
        }
    }
};


