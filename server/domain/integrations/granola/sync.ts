import { and, eq, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { knowledgeDocuments, userSaasConnections, type UserSaasConnection } from '@shared/schema/index.js';
import { reindexKnowledgeDocument } from '@domain/knowledge/core/knowledge-store.js';
import { GranolaMcpClient } from './client.js';
import { granolaOAuthAdapter } from './granola-oauth.adapter.js';

function meetingsFrom(value: any): any[] {
    return Array.isArray(value) ? value : value?.meetings ?? value?.results ?? value?.items ?? [];
}
function value(value: unknown) { return typeof value === 'string' ? value : ''; }

export async function syncGranolaConnection(connection: UserSaasConnection) {
    if (connection.platform !== 'granola' || connection.status !== 'connected') throw new Error('Granola is not connected.');
    const config = connection.config as Record<string, any>;
    const sync = config.sync ?? {};
    if (sync.enabled !== true) throw new Error('Granola knowledge sync is disabled. Enable it explicitly before syncing meeting notes.');
    const client = new GranolaMcpClient(connection.id, () => granolaOAuthAdapter.getValidAccessToken(connection.id, connection.orgId, connection.userId));
    const listed = await client.listMeetings({ ...(sync.lookbackDays ? { start_date: new Date(Date.now() - Number(sync.lookbackDays) * 86_400_000).toISOString().slice(0, 10) } : {}) });
    const summaries = meetingsFrom(listed);
    let inserted = 0, updated = 0;
    for (const summary of summaries) {
        const meetingId = value(summary.id ?? summary.meeting_id ?? summary.document_id);
        if (!meetingId) continue;
        const detailResult = await client.getMeetings([meetingId]);
        const meeting = meetingsFrom(detailResult)[0] ?? detailResult?.meeting ?? detailResult;
        const transcript = sync.includeTranscripts === true ? await client.getTranscript(meetingId).catch(() => null) : null;
        const title = value(meeting.title ?? meeting.name ?? summary.title) || `Granola meeting ${meetingId}`;
        const meetingDate = value(meeting.date ?? meeting.start_time ?? summary.date);
        const notes = value(meeting.notes ?? meeting.summarized_notes ?? meeting.summary ?? meeting.content);
        const transcriptText = value(transcript?.text ?? transcript?.transcript);
        const textContent = [notes, transcriptText && `Transcript\n${transcriptText}`].filter(Boolean).join('\n\n');
        const attendees = (meeting.attendees ?? meeting.people ?? summary.attendees ?? []).map((person: any) => value(person?.name ?? person?.email ?? person)).filter(Boolean);
        const metadata = { source: 'granola', connectionId: connection.id, userId: connection.userId, attendees,
            folderName: value(meeting.folder_name ?? meeting.folder?.name), meetingDate, remoteUpdatedAt: value(meeting.updated_at) || null };
        // This user's copy only: a meeting two people attended is synced by each into
        // their own project, and one person's sync must never move the other's.
        const [existing] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, connection.orgId),
            eq(knowledgeDocuments.createdBy, connection.userId), eq(knowledgeDocuments.externalId, meetingId),
            sql`${knowledgeDocuments.metadata}->>'source' = 'granola'`)).limit(1);
        const fields = { title: meetingDate ? `${title} — ${meetingDate.slice(0, 10)}` : `${title} — Granola`, summary: value(meeting.summary ?? summary.summary) || null,
            textContent, url: value(meeting.url ?? meeting.note_url ?? summary.url) || null, sourceType: 'integration', externalId: meetingId,
            organizationId: connection.orgId, projectId: Number.isInteger(sync.projectId) ? sync.projectId : null, createdBy: connection.userId, metadata, updatedAt: new Date() };
        const [document] = existing
            ? await db.update(knowledgeDocuments).set(fields).where(eq(knowledgeDocuments.id, existing.id)).returning()
            : await db.insert(knowledgeDocuments).values(fields).returning();
        existing ? updated++ : inserted++;
        await reindexKnowledgeDocument(document);
    }
    const now = new Date();
    await db.update(userSaasConnections).set({ lastSyncAt: now, config: { ...config, sync: { ...sync, lastSyncAt: now.toISOString() } }, updatedAt: now }).where(eq(userSaasConnections.id, connection.id));
    return { success: true, listed: summaries.length, inserted, updated, lastSyncAt: now.toISOString() };
}
