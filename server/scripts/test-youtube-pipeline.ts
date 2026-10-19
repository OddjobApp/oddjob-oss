import { youtubeService } from "../domain/media/youtube-service.js";
import { transcriptionService } from "../domain/media/transcription-service.js";
import { videoFeedbackService } from "../domain/media/video-feedback-service.js";

async function testYouTubePipeline() {
    console.log("--- Testing YouTube Service ---");
    const playlistId = "PLMC9KNkIncVtALu6SME9oAAnit83p731N"; // Computerphile
    const videos = await youtubeService.getPlaylistVideos(playlistId);
    console.log(`Fetched ${videos.length} videos`);

    if (videos.length > 0) {
        console.log("--- Testing Transcription ---");
        // Note: For real tests, we'd need audio but we can mock or check logic
        console.log(`Video: ${videos[0].title}`);
    }

    console.log("--- Testing Feedback Service ---");
    await videoFeedbackService.recordCritique({
        videoId: "test-video",
        topic: "React",
        rating: 1,
        feedback: "Great intro",
        organizationId: 1,
        createdBy: "test-user"
    });

    const instructions = await videoFeedbackService.getPromptInstructions("React", 1);
    console.log("Generated Instructions:", instructions);
}

testYouTubePipeline().catch(console.error);

