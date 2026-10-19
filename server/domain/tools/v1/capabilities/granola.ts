import { z } from 'zod';
import type { ToolContext, ToolDefinition } from './types.js';
import { getGranolaForContext } from '@domain/integrations/granola/service.js';
import { findRoom, GRANOLA_PRIVATE_RESULTS, sharedMeetings } from '@domain/integrations/granola/rooms.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const meetingId = z.string().min(1).max(500);

/**
 * The CREW room this call runs in, if any. In a room, Granola content is
 * private to the person who asked until they share a meeting (see
 * integrations/granola/rooms.ts); outside one, the tools read their account.
 */
async function roomOf(context: ToolContext) {
    const sessionKey = typeof context?.sessionKey === 'string' ? context.sessionKey : '';
    const organizationId = Number(context?.organizationId);
    if (!sessionKey || !Number.isInteger(organizationId) || organizationId <= 0) return null;
    const room = await findRoom(organizationId, sessionKey);
    // A room key that resolves to nothing is still a room: fail closed.
    if (!room) throw new Error('Granola cannot be read in this room: the room was not found.');
    return room;
}

function meetingCount(value: any): number {
    const list = Array.isArray(value) ? value : value?.meetings ?? value?.results ?? value?.items ?? [];
    return Array.isArray(list) ? list.length : 0;
}

/**
 * In a room: run the search on the asker's account so the count is real, and
 * return a card that carries no meeting data. The asker's browser lists the
 * matches from their own account; the agent and everyone else see a count.
 */
async function privateResults(context: ToolContext, sessionKey: string, search: { query?: string; list?: Record<string, unknown> }) {
    const { client } = await getGranolaForContext(context);
    const found = search.query != null ? await client.searchMeetings(search.query) : await client.listMeetings(search.list ?? {});
    const count = meetingCount(found);
    return JSON.stringify({
        type: GRANOLA_PRIVATE_RESULTS,
        title: 'Granola meetings',
        private: true,
        ownerUserId: String(context.userId),
        organizationId: Number(context.organizationId),
        sessionKey,
        ...(search.query != null ? { query: search.query } : { list: search.list ?? {} }),
        count,
        note: `${count} meeting${count === 1 ? '' : 's'} matched. Only the person who asked can see which; nothing from them is in this room until they share one.`,
    });
}

export const GRANOLA_TOOLS: Record<string, ToolDefinition> = {
    granola_get_account: {
        name: 'granola_get_account', label: 'Granola account', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Confirm the current user has connected Granola. Outside a CREW room it also returns which account and workspace.', parameters: z.object({}),
        execute: async (_, context) => {
            const { client } = await getGranolaForContext(context);
            // Account email and workspace are the person's own details; a room shows only that it is connected.
            if (await roomOf(context)) return JSON.stringify({ connected: true });
            return JSON.stringify(await client.accountInfo());
        },
    },
    granola_search_meetings: {
        name: 'granola_search_meetings', label: 'Search Granola meetings', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Search the current user’s Granola meeting notes for discussions, decisions, commitments, action items, or topics. In a CREW room the matches are shown privately to that user, who chooses which meetings to share into the room; answer only from shared meetings.',
        parameters: z.object({ query: z.string().min(1).max(2000) }),
        execute: async (params, context) => {
            const room = await roomOf(context);
            if (room) return privateResults(context, room.sessionKey, { query: params.query });
            return JSON.stringify(await (await getGranolaForContext(context)).client.searchMeetings(params.query));
        },
    },
    granola_list_meetings: {
        name: 'granola_list_meetings', label: 'List Granola meetings', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'List meetings the current user can access in their active Granola workspace, optionally filtered by folder or date range. In a CREW room the list is shown privately to that user, who chooses which meetings to share.',
        parameters: z.object({ folder_id: z.string().min(1).max(500).optional(), start_date: date, end_date: date, limit: z.number().int().min(1).max(100).optional() }),
        execute: async (params, context) => {
            const room = await roomOf(context);
            if (room) return privateResults(context, room.sessionKey, { list: params });
            return JSON.stringify(await (await getGranolaForContext(context)).client.listMeetings(params));
        },
    },
    granola_list_meeting_folders: {
        name: 'granola_list_meeting_folders', label: 'List Granola folders', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'List folders available to the current user in their active Granola workspace. Not available in a CREW room; search there instead.', parameters: z.object({}),
        execute: async (_, context) => {
            if (await roomOf(context)) throw new Error('Granola folder names are private and are not listed in a room. Use granola_search_meetings; the person picks which meetings to share.');
            return JSON.stringify(await (await getGranolaForContext(context)).client.listFolders());
        },
    },
    granola_get_meeting: {
        name: 'granola_get_meeting', label: 'Read Granola meeting', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read full notes, attendees and metadata for Granola meetings. In a CREW room this reads only meetings someone has shared into the room, as they were shared.',
        parameters: z.object({ meeting_ids: z.array(meetingId).min(1).max(20) }),
        execute: async (params, context) => {
            const room = await roomOf(context);
            if (room) {
                const shared = await sharedMeetings(room.id, params.meeting_ids);
                const missing = params.meeting_ids.filter((id: string) => !shared.some((s) => s.meetingId === id));
                if (missing.length) {
                    throw new Error(`Not shared into this room: ${missing.join(', ')}. Granola notes reach a room only when their owner shares them from the private Granola card.`);
                }
                // `shared` marks a snapshot already shown in the room, so it renders no second card.
                return JSON.stringify({ shared: true, meetings: shared.map((s) => ({ ...s.item, sharedBy: s.sharedBy })) });
            }
            return JSON.stringify(await (await getGranolaForContext(context)).client.getMeetings(params.meeting_ids));
        },
    },
    granola_get_meeting_transcript: {
        name: 'granola_get_meeting_transcript', label: 'Read Granola transcript', group: 'Meetings', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read the raw speaker-attributed transcript for one Granola meeting. Use only when exact wording is needed; prefer summarized meeting notes otherwise. Not available in a CREW room: sharing a meeting shares its notes, not its transcript.',
        parameters: z.object({ meeting_id: meetingId }),
        execute: async (params, context) => {
            if (await roomOf(context)) throw new Error('Granola transcripts are not read in a room: sharing a meeting shares its notes, not its transcript.');
            return JSON.stringify(await (await getGranolaForContext(context)).client.getTranscript(params.meeting_id));
        },
    },
};
