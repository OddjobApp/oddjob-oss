import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock youtubei.js
vi.mock('youtubei.js', () => {
    const mockPlaylist = {
        videos: [
            {
                id: 'vid1',
                title: { toString: () => 'Video 1' },
                description: { toString: () => 'Desc 1' },
                thumbnails: [{ url: 'thumb1' }],
                duration: { seconds: 120 },
                author: { name: 'Channel 1' }
            }
        ]
    };

    const mockBasicInfo = {
        basic_info: {
            id: 'vid1',
            title: 'Video 1',
            short_description: 'Desc 1',
            thumbnail: [{ url: 'thumb1' }],
            duration: 120,
            author: 'Channel 1'
        }
    };

    const mockInfo = {
        getTranscript: vi.fn().mockResolvedValue({ segments: [{ text: 'Hello' }] })
    };

    const mockInnertube = {
        getPlaylist: vi.fn().mockResolvedValue(mockPlaylist),
        getBasicInfo: vi.fn().mockResolvedValue(mockBasicInfo),
        getInfo: vi.fn().mockResolvedValue(mockInfo),
        download: vi.fn().mockResolvedValue({
            getReader: () => ({
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                    .mockResolvedValueOnce({ done: true })
            })
        })
    };

    return {
        Innertube: {
            create: vi.fn().mockResolvedValue(mockInnertube)
        }
    };
});

import { youtubeService } from "../../server/domain/media/youtube-service.js";
import { Innertube } from 'youtubei.js';

describe("YouTubeService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should fetch playlist videos", async () => {
        const videos = await youtubeService.getPlaylistVideos("playlist123");

        expect(videos).toHaveLength(1);
        expect(videos[0].id).toBe("vid1");
        expect(videos[0].title).toBe("Video 1");
        expect(videos[0].url).toBe("https://www.youtube.com/watch?v=vid1");
    });

    it("should fetch video metadata", async () => {
        const meta = await youtubeService.getVideoMetadata("vid1");

        expect(meta).not.toBeNull();
        expect(meta?.id).toBe("vid1");
        expect(meta?.title).toBe("Video 1");
    });

    it("should fetch transcript", async () => {
        const transcript = await youtubeService.getTranscript("vid1");
        expect(transcript).not.toBeNull();
        expect((transcript as any).segments[0].text).toBe("Hello");
    });

    it("should download audio as Buffer", async () => {
        const buffer = await youtubeService.downloadAudio("vid1");
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBe(3);
    });
});
