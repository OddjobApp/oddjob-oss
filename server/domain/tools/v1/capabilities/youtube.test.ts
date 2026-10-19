import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn(), insert: vi.fn(), values: vi.fn(), returning: vi.fn(), getTranscript: vi.fn(), downloadAudio: vi.fn(), transcribe: vi.fn() }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: mocks.token }));
vi.mock('@server/database_service.js', () => ({ db: { insert: mocks.insert } }));
vi.mock('@domain/media/youtube-service.js', () => ({ youtubeService: { getTranscript: mocks.getTranscript, downloadAudio: mocks.downloadAudio } }));
vi.mock('@domain/media/transcription-service.js', () => ({ transcriptionService: { transcribe: mocks.transcribe } }));
import { YOUTUBE_TOOLS, executeYouTubeApproval } from './youtube.js';
import { workspaceResultPayload } from '@domain/crew/core/crew-workspace-results.js';
const respond = (bodies: any[]) => vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(bodies.shift() ?? {}))));
beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue('test-token'); mocks.insert.mockReturnValue({ values: mocks.values }); mocks.values.mockReturnValue({ returning: mocks.returning }); mocks.returning.mockResolvedValue([{ id: 42 }]); });
afterEach(() => vi.unstubAllGlobals());
describe('YouTube integration', () => {
    it('uses the scoped Google OAuth token, enriches search results and carries pagination to cards', async () => {
        const fetcher = respond([
            { items: [{ id: { videoId: 'v1' }, snippet: { title: 'Tutorial', description: 'Description only', channelTitle: 'Creator', publishedAt: '2026-09-01T00:00:00Z' } }], nextPageToken: 'next' },
            { items: [{ id: 'v1', contentDetails: { duration: 'PT4M13S', caption: 'true' }, statistics: { viewCount: '12345' } }] },
        ]);
        vi.stubGlobal('fetch', fetcher);
        const args = { query: 'TypeScript', max_results: 5 };
        const data = JSON.parse(await YOUTUBE_TOOLS.youtube_search.execute(args, { organizationId: 342, projectId: 3 }));
        expect(mocks.token).toHaveBeenCalledWith(342, 3, 'youtube_read');
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
        expect(fetcher.mock.calls[1][0]).toContain('videos?part=contentDetails%2Cstatistics');
        const card = workspaceResultPayload('youtube_search', data, args);
        expect(card?.items[0]).toMatchObject({ id: 'v1', kind: 'video', platform: 'youtube', youtubeKind: 'video', title: 'Tutorial', preview: 'Description only', duration: 253, hasCaptions: true, viewCount: 12345, url: 'https://www.youtube.com/watch?v=v1' });
        expect(card?.nextPageToken).toBe('next');
    });
    it('returns the channel profile first followed by its enriched uploads', async () => {
        const fetcher = respond([
            { items: [{ id: 'chan1', snippet: { title: 'Studio', customUrl: '@studio', description: 'About the studio' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '4200', videoCount: '87', viewCount: '1000000' } }] },
            { items: [{ id: 'item1', contentDetails: { videoId: 'v9', videoPublishedAt: '2026-09-20T12:00:00Z' }, snippet: { title: 'Latest', resourceId: { videoId: 'v9' }, channelTitle: 'Studio' } }] },
            { items: [{ id: 'v9', contentDetails: { duration: 'PT10M', caption: 'false' }, statistics: { viewCount: '900' } }] },
        ]);
        vi.stubGlobal('fetch', fetcher);
        const data = JSON.parse(await YOUTUBE_TOOLS.youtube_get_channel.execute({}, { organizationId: 342, projectId: 3 }));
        const card = workspaceResultPayload('youtube_get_channel', data, {});
        expect(card?.items[0]).toMatchObject({ id: 'chan1', youtubeKind: 'channel', title: 'Studio', customUrl: '@studio', subscriberCount: 4200, videoCount: 87, viewCount: 1000000 });
        expect(card?.items[1]).toMatchObject({ id: 'v9', youtubeKind: 'video', title: 'Latest', duration: 600, viewCount: 900, date: '2026-09-20T12:00:00Z' });
    });
    it('reads a video’s spoken content from its published captions', async () => {
        mocks.getTranscript.mockResolvedValue({ selectedLanguage: 'English', transcript: { content: { body: { initial_segments: [{ snippet: { text: 'Welcome back' } }, { snippet: { text: 'to the channel' } }] } } } });
        const result = JSON.parse(await YOUTUBE_TOOLS.youtube_get_transcript.execute({ video_id: 'v1' }, { organizationId: 342 }));
        expect(result).toMatchObject({ source: 'captions', language: 'English', text: 'Welcome back to the channel', truncated: false });
    });
    it('only converts audio to text when explicitly asked, on the organization’s key', async () => {
        mocks.getTranscript.mockResolvedValue(null);
        await expect(YOUTUBE_TOOLS.youtube_get_transcript.execute({ video_id: 'v1' }, { organizationId: 342 })).rejects.toThrow('transcribe_audio');
        expect(mocks.downloadAudio).not.toHaveBeenCalled();
        mocks.downloadAudio.mockResolvedValue(Buffer.from('audio'));
        mocks.transcribe.mockResolvedValue({ text: 'spoken words', segments: [] });
        const result = JSON.parse(await YOUTUBE_TOOLS.youtube_get_transcript.execute({ video_id: 'v1', transcribe_audio: true }, { organizationId: 342 }));
        expect(result).toMatchObject({ source: 'audio_transcription', text: 'spoken words' });
        expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'v1.mp4', 342);
    });
    it('refuses a connection without YouTube consent before fetching anything', async () => {
        mocks.token.mockResolvedValue(null);
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        await expect(YOUTUBE_TOOLS.youtube_get_channel.execute({}, { organizationId: 342 })).rejects.toThrow('platform youtube');
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('saves a reviewable comment proposal without publishing it', async () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const result = JSON.parse(await YOUTUBE_TOOLS.youtube_reply_comment.execute({ parent_comment_id: 'comment1', text: 'Thank you!' }, { organizationId: 342, projectId: 3, userId: 'crew-user' }));
        expect(result).toMatchObject({ type: 'approval_request', kind: 'youtube_action', proposalId: 42, args: { parent_comment_id: 'comment1', text: 'Thank you!' } });
        expect(mocks.values.mock.calls[0][0].organizationId).toBe(342);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('publishes exactly the persisted reply only through the approval executor', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'reply1' }))); vi.stubGlobal('fetch', fetcher);
        await executeYouTubeApproval('youtube_reply_comment', { parent_comment_id: 'comment1', text: 'Approved text' }, { organizationId: 342, projectId: 3 });
        expect(mocks.token).toHaveBeenCalledWith(342, 3, 'youtube_write');
        expect(fetcher.mock.calls[0][1].method).toBe('POST');
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ snippet: { parentId: 'comment1', textOriginal: 'Approved text' } });
    });
    it('uses the actual parent comment ID rather than the thread ID for selected replies', () => {
        const card = workspaceResultPayload('youtube_list_comments', { items: [{ id: 'thread1', snippet: { topLevelComment: { id: 'comment1', snippet: { authorDisplayName: 'Viewer', videoId: 'v1', textDisplay: 'Question' } } } }] }, { video_id: 'v1' });
        expect(card?.items[0]).toMatchObject({ id: 'comment1', youtubeKind: 'comment', body: 'Question', url: 'https://www.youtube.com/watch?v=v1&lc=comment1' });
    });
    it('reports disabled APIs and quota failures without exposing raw provider envelopes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'raw provider details', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 })));
        await expect(YOUTUBE_TOOLS.youtube_get_video.execute({ video_id: 'v1' }, { organizationId: 342 })).rejects.toThrow('quotaExceeded');
    });
});
