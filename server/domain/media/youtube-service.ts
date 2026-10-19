import { Innertube } from 'youtubei.js';

export interface YouTubeVideoMetadata {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    duration: number;
    channelTitle: string;
    url: string;
}

export class YouTubeService {
    private yt: Innertube | null = null;

    private async init() {
        if (!this.yt) {
            this.yt = await Innertube.create();
        }
        return this.yt;
    }

    async getPlaylistVideos(playlistId: string): Promise<YouTubeVideoMetadata[]> {
        const yt = await this.init();
        const playlist = await yt.getPlaylist(playlistId);

        return playlist.videos.map((v: any) => ({
            id: v.id,
            title: v.title?.toString() || 'Unknown Title',
            description: v.description?.toString() || '',
            thumbnailUrl: v.thumbnails?.[0]?.url || '',
            duration: v.duration?.seconds || 0,
            channelTitle: v.author?.name || 'Unknown Channel',
            url: `https://www.youtube.com/watch?v=${v.id}`
        }));
    }

    async getVideoMetadata(videoId: string): Promise<YouTubeVideoMetadata | null> {
        const yt = await this.init();
        const info = await yt.getBasicInfo(videoId);
        const meta = info.basic_info;

        return {
            id: meta.id || videoId,
            title: meta.title || 'Unknown Title',
            description: meta.short_description || '',
            thumbnailUrl: meta.thumbnail?.[0]?.url || '',
            duration: meta.duration || 0,
            channelTitle: meta.author || 'Unknown Channel',
            url: `https://www.youtube.com/watch?v=${meta.id}`
        };
    }

    async getTranscript(videoId: string) {
        const yt = await this.init();
        try {
            const info = await yt.getInfo(videoId);
            const transcriptData = await info.getTranscript();
            return transcriptData;
        } catch (e) {
            console.warn(`[YouTubeService] No transcript found for video ${videoId}`, e);
            return null;
        }
    }

    async downloadAudio(videoId: string): Promise<Buffer> {
        const yt = await this.init();
        const stream = await yt.download(videoId, {
            type: 'audio',
            quality: 'best',
            format: 'mp4'
        });

        const chunks: Uint8Array[] = [];
        const reader = stream.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }

        return Buffer.concat(chunks.map(c => Buffer.from(c)));
    }
}

export const youtubeService = new YouTubeService();
export default youtubeService;


