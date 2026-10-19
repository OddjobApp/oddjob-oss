import { and, eq, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { xrayOperationalNotifications } from '@shared/schema/index.js';
import type { CrewSessionRecord } from '@shared/schema/crew.js';
import { NotFoundError } from '@server/utils/errors.js';
import { GOOGLE_WORKSPACE_TOOLS } from '@domain/tools/v1/capabilities/google-workspace.js';
import { workspaceResultPayload } from './crew-workspace-results.js';
import type { WorkspaceResultPayload } from '@shared/crew-workspace-results.js';
import { crewRepository } from './crew-repository.js';
import { observeImportantSender, type ImportantSenderProfile } from '@shared/important-sender-profile.js';

/** Private alert identity, rather than client-supplied message IDs, determines the source. */
export async function prepareGmailNotification(input: { orgId: number; userId: string; eventId: number; room: CrewSessionRecord }) {
    if (input.room.organizationId !== input.orgId) throw new NotFoundError('This email alert is unavailable.');
    return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gmail-handoff:${input.orgId}:${input.eventId}`}))`);
        const [notice] = await tx.select().from(xrayOperationalNotifications).where(and(
            eq(xrayOperationalNotifications.organizationId, input.orgId),
            eq(xrayOperationalNotifications.eventId, input.eventId),
            eq(xrayOperationalNotifications.scope, `gmail_directive:${input.userId}`),
        ));
        if (!notice || notice.organizationId !== input.orgId || notice.payload.recipientUserId !== input.userId || typeof notice.payload.messageId !== 'string') throw new NotFoundError('This email alert is unavailable.');
        const target = new URL(String(notice.payload.route ?? ''), 'http://oddjob.local');
        if (target.origin !== 'http://oddjob.local' || target.pathname !== `/workspace/chat/${encodeURIComponent(input.room.sessionKey)}`) throw new NotFoundError('This email alert belongs to another room.');
        const savedId = Number(notice.payload.contextTurnId);
        if (Number.isInteger(savedId) && savedId > 0) {
            const turn = await crewRepository.findRoomTurn(input.orgId, input.room.id, savedId);
            const artifact = (turn?.artifacts ?? []).find(a => a.tool === 'gmail_get_message');
            const payload = artifact?.payload as WorkspaceResultPayload | undefined;
            if (turn && payload && payload.items?.[0]?.id === notice.payload.messageId) return { turn, payload, title: notice.title, reason: notice.description };
        }
        const started = Date.now();
        const data = JSON.parse(await GOOGLE_WORKSPACE_TOOLS.gmail_get_message.execute({ message_id: notice.payload.messageId }, { organizationId: input.orgId, projectId: input.room.projectId }));
        const payload = workspaceResultPayload('gmail_get_message', data, { message_id: notice.payload.messageId });
        if (!payload?.items.length) throw new Error('The triggering email could not be read. It may have been removed or Gmail access may need reconnecting.');
        const item = payload.items[0];
        if (item.sender) {
            const email = (item.sender.match(/<([^<>]+)>/)?.[1] ?? item.sender).trim().toLowerCase();
            item.senderProfile = observeImportantSender(notice.payload.senderProfile as ImportantSenderProfile | undefined, email, { id: item.id, from: item.sender, subject: item.title, date: item.date, preview: item.preview, body: item.body });
        }
        const turn = await crewRepository.postTurn(input.orgId, input.room.id, {
            speakerType: 'supervisor', speakerName: 'Room', userId: input.userId,
            content: `You arrived from an important-email alert. ${notice.description}\nThe triggering message is selected for this discussion. Review its contents below; summarize it or draft a reply when ready. Nothing has been sent.`,
            toolsUsed: [{ name: 'gmail_get_message', ok: true, ms: Date.now() - started }],
            artifacts: [{ tool: 'gmail_get_message', payload }],
        }, tx);
        if (!turn) throw new Error('Could not prepare the email discussion.');
        await tx.update(xrayOperationalNotifications).set({ payload: { ...notice.payload, contextTurnId: turn.id, senderProfile: item.senderProfile }, updatedAt: new Date() }).where(and(eq(xrayOperationalNotifications.organizationId, input.orgId), eq(xrayOperationalNotifications.id, notice.id)));
        return { turn, payload, title: notice.title, reason: notice.description };
    });
}
