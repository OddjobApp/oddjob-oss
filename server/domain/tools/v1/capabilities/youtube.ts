import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { ToolContext, ToolDefinition } from './types.js';
import { getGoogleWorkspaceToken } from '@domain/integrations/google-workspace-connector-bridge.js';

async function youtube(context: ToolContext, path: string, query: Record<string, unknown>, method = 'GET', body?: unknown) {
    const token = await getGoogleWorkspaceToken(context.organizationId, context.projectId, method === 'GET' ? 'youtube_read' : 'youtube_write');
    if (!token) throw new Error('YouTube permission is missing from this project’s Google connection. Use connect_platform with platform youtube. Enabling the API alone does not grant OAuth access.');
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]));
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${params}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
        let reason = '';
        try { reason = (await response.json()).error?.errors?.[0]?.reason ?? ''; } catch { /* No provider body is shown. */ }
        throw new Error(`YouTube request failed (HTTP ${response.status}${reason ? `, ${reason}` : ''}). Check API enablement, quota and the connected account’s permissions.`);
    }
    return response.json();
}
const id = z.string().min(1).max(200);
const page = { max_results: z.number().int().min(1).max(50).default(20), page_token: z.string().optional() };
/** search.list and playlistItems.list return snippets only; one videos.list call adds duration, captions and statistics. */
async function enrichVideos(context: ToolContext, items: any[]) {
    const videoId = (resource: any) => String(resource?.id?.videoId ?? resource?.contentDetails?.videoId ?? resource?.snippet?.resourceId?.videoId ?? '');
    const ids = items.map(videoId).filter(Boolean).slice(0, 50);
    if (!ids.length) return items;
    try {
        const details = await youtube(context, 'videos', { part: 'contentDetails,statistics', id: ids.join(',') });
        const byId = new Map<string, any>((details.items ?? []).map((video: any) => [video.id, video]));
        for (const resource of items) {
            const detail = byId.get(videoId(resource));
            if (detail) { resource.contentDetails = { ...(detail.contentDetails ?? {}), ...(resource.contentDetails ?? {}) }; resource.statistics = detail.statistics ?? resource.statistics; }
        }
    } catch { /* Stats enrichment is best-effort; the listing still renders without it. */ }
    return items;
}
const replySchema = z.object({ parent_comment_id: id, text: z.string().min(1).max(10000) });
/** Called only by the authenticated approval service, using persisted proposal arguments. */
export async function executeYouTubeApproval(action: string, args: unknown, context: ToolContext) {
    if (action !== 'youtube_reply_comment') throw new Error('Unsupported YouTube action.');
    const p = replySchema.parse(args);
    return youtube(context, 'comments', { part: 'snippet' }, 'POST', { snippet: { parentId: p.parent_comment_id, textOriginal: p.text } });
}
async function proposeReply(args: unknown, context: ToolContext) {
    const p = replySchema.parse(args);
    if (context.organizationId == null) throw new Error('Organization context is required.');
    if (!await getGoogleWorkspaceToken(context.organizationId, context.projectId, 'youtube_write')) throw new Error('YouTube comment permission is missing. Use connect_platform with platform youtube.');
    const { db } = await import('@server/database_service.js');
    const { approvalRequests } = await import('@shared/schema/index.js');
    const actor = String(context.userId ?? 'crew');
    const meta = { type: 'approval_request', kind: 'youtube_action', actionName: 'youtube_reply_comment', args: p, title: 'Reply to YouTube comment', reason: 'Publish this public reply: ' + p.text, projectId: context.projectId ?? null, sessionKey: context.sessionKey ?? null, status: 'pending' };
    const [row] = await db.insert(approvalRequests).values({ executionId: `youtube_${randomBytes(16).toString('hex')}`, toolName: 'youtube_reply_comment', toolArgs: meta, organizationId: context.organizationId, approverType: 'user', approverEmail: actor, ...(/^[0-9a-f-]{36}$/i.test(actor) ? { approverId: actor } : {}), token: randomBytes(24).toString('hex'), status: 'pending' }).returning({ id: approvalRequests.id });
    if (!row) throw new Error('YouTube approval could not be saved.');
    return JSON.stringify({ ...meta, proposalId: row.id, message: 'Pending approval; no comment has been published.' });
}
const read = (name: string, label: string, description: string, parameters: z.ZodTypeAny, execute: ToolDefinition['execute']): ToolDefinition => ({ name, label, description, group: 'YouTube', idempotency: 'read-safe', parameters, execute });
export const YOUTUBE_TOOLS: Record<string, ToolDefinition> = {
    youtube_search: read('youtube_search', 'Search YouTube', 'Search live YouTube videos. Returns metadata, not a transcript or evidence of watching. Prefer playlist reads for a known channel to conserve search quota.', z.object({ query: z.string().min(1).max(300), channel_id: id.optional(), ...page }), async (p, c) => {
        const data = await youtube(c, 'search', { part: 'snippet', type: 'video', q: p.query, channelId: p.channel_id, maxResults: p.max_results ?? 20, pageToken: p.page_token });
        await enrichVideos(c, data.items ?? []);
        return JSON.stringify(data);
    }),
    youtube_get_video: read('youtube_get_video', 'Read YouTube video details', 'Read a video’s title, description, duration, statistics and publication status. This is metadata only, not video analysis or a transcript.', z.object({ video_id: id }), async (p, c) => JSON.stringify(await youtube(c, 'videos', { part: 'snippet,contentDetails,statistics,status', id: p.video_id }))),
    youtube_get_channel: read('youtube_get_channel', 'Read YouTube channel', 'Read a named channel, or the authenticated user’s channel when channel_id is omitted. Returns the channel profile and its latest uploads.', z.object({ channel_id: id.optional() }), async (p, c) => {
        const data = await youtube(c, 'channels', { part: 'snippet,contentDetails,statistics', ...(p.channel_id ? { id: p.channel_id } : { mine: true }) });
        const uploadsPlaylist = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPlaylist) {
            try {
                const uploads = await youtube(c, 'playlistItems', { part: 'snippet,contentDetails', playlistId: uploadsPlaylist, maxResults: 12 });
                await enrichVideos(c, uploads.items ?? []);
                data.uploads = uploads.items ?? [];
            } catch { /* The channel profile still renders when its uploads listing fails. */ }
        }
        return JSON.stringify(data);
    }),
    youtube_list_playlists: read('youtube_list_playlists', 'List YouTube playlists', 'List playlists for channel_id, or the connected user when omitted. Reports pagination.', z.object({ channel_id: id.optional(), ...page }), async (p, c) => JSON.stringify(await youtube(c, 'playlists', { part: 'snippet,contentDetails', ...(p.channel_id ? { channelId: p.channel_id } : { mine: true }), maxResults: p.max_results ?? 20, pageToken: p.page_token }))),
    youtube_get_playlist: read('youtube_get_playlist', 'Read YouTube playlist', 'Read one playlist’s metadata.', z.object({ playlist_id: id }), async (p, c) => JSON.stringify(await youtube(c, 'playlists', { part: 'snippet,contentDetails', id: p.playlist_id }))),
    youtube_list_playlist_videos: read('youtube_list_playlist_videos', 'List YouTube playlist videos', 'List videos in a playlist, including a channel uploads playlist. Reports pagination. Does not watch videos.', z.object({ playlist_id: id, ...page }), async (p, c) => {
        const data = await youtube(c, 'playlistItems', { part: 'snippet,contentDetails', playlistId: p.playlist_id, maxResults: p.max_results ?? 20, pageToken: p.page_token });
        await enrichVideos(c, data.items ?? []);
        return JSON.stringify(data);
    }),
    youtube_list_comments: read('youtube_list_comments', 'Read YouTube comments', 'Read top-level comment threads on a video. Reply counts are supplied; the embedded replies may be incomplete. Reports pagination.', z.object({ video_id: id, ...page }), async (p, c) => JSON.stringify(await youtube(c, 'commentThreads', { part: 'snippet,replies', videoId: p.video_id, textFormat: 'plainText', maxResults: p.max_results ?? 20, pageToken: p.page_token }))),
    youtube_get_comment: read('youtube_get_comment', 'Read YouTube comment', 'Read one exact comment before discussing or replying to it.', z.object({ comment_id: id }), async (p, c) => JSON.stringify(await youtube(c, 'comments', { part: 'snippet', id: p.comment_id, textFormat: 'plainText' }))),
    youtube_get_transcript: read('youtube_get_transcript', 'Read YouTube transcript', 'Extract a video’s spoken content as text from its published captions. Use this to review what a video says before discussing it. When no captions exist, set transcribe_audio to convert the audio with the organization’s AI key.', z.object({ video_id: id, transcribe_audio: z.boolean().default(false), max_chars: z.number().int().min(500).max(120000).default(40000) }), async (p, c) => {
        const { youtubeService } = await import('@domain/media/youtube-service.js');
        const transcript = await youtubeService.getTranscript(p.video_id);
        const segments = transcript?.transcript?.content?.body?.initial_segments ?? [];
        const text = segments.map((segment: any) => String(segment?.snippet?.text ?? segment?.snippet ?? '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (text) return JSON.stringify({ video_id: p.video_id, source: 'captions', language: transcript?.selectedLanguage || undefined, text: text.slice(0, p.max_chars), truncated: text.length > p.max_chars });
        if (!p.transcribe_audio) throw new Error(`No published captions were found for video ${p.video_id}. Call again with transcribe_audio: true to convert the audio with the organization’s AI key, or report that the spoken content is unavailable.`);
        const { transcriptionService } = await import('@domain/media/transcription-service.js');
        const audio = await youtubeService.downloadAudio(p.video_id);
        const transcribed = await transcriptionService.transcribe(audio, `${p.video_id}.mp4`, c.organizationId);
        if (!transcribed.text.trim()) throw new Error(`Audio transcription produced no text for video ${p.video_id}.`);
        return JSON.stringify({ video_id: p.video_id, source: 'audio_transcription', text: transcribed.text.slice(0, p.max_chars), truncated: transcribed.text.length > p.max_chars });
    }),
    youtube_reply_comment: {
        name: 'youtube_reply_comment', label: 'Reply to YouTube comment', group: 'YouTube', idempotency: 'none',
        approvalPolicy: { requiresApproval: true, rationale: 'Publishes a public YouTube comment reply.' },
        description: 'Publish an approved reply to a specific YouTube parent comment. Requires write consent and human approval; do not call for a mere draft.',
        parameters: replySchema,
        execute: proposeReply,
    },
};
