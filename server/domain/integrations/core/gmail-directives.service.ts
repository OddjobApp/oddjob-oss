import { and, eq, like, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { xrayOperationalConfigs, xrayOperationalEvents, xrayOperationalNotifications } from '@shared/schema/index.js';
import { getGoogleWorkspaceToken } from '../google-workspace-connector-bridge.js';
import { pushService } from '@domain/core/notifications/push.service.js';
import { createLogger } from '@server/utils/logger.js';
import { ValidationError } from '@server/utils/errors.js';
import { gmailAlertRoute } from '@shared/gmail-notification-handoff.js';
import { observeImportantSender, type ImportantSenderProfile } from '@shared/important-sender-profile.js';

const logger = createLogger('GmailDirectives');
const PREFIX = 'gmail_directive:';
const INTERVAL = 30_000;
export function parseGmailDirective(message: string) {
  if (!/^\/directives?\b/i.test(message.trim())) return null;
  if (/^\/directives(?:\s+list)?\s*$/i.test(message.trim()) || /^\/directive\s+list\s*$/i.test(message.trim())) return { sender: '', action: 'list' };
  const sender = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase();
  const action = /\b(?:remove|delete)\b/i.test(message) ? 'remove' : /\bstatus\b/i.test(message) ? 'status' : /\b(?:pause|disable|stop)\b/i.test(message) ? 'pause' : /\b(?:resume|enable)\b/i.test(message) ? 'resume' : 'create';
  if (!sender || (action === 'create' && !/\b(?:notify|notification|alert)\b/i.test(message))) throw new ValidationError('Use /directive Notify me when a new Gmail email arrives from sender@example.com. Use /directive pause sender@example.com or /directive resume sender@example.com to manage it.', { field: 'message' });
  return { sender, action };
}
export function senderAddress(value: string) { return (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase(); }
export function matchesGmailSender(message: any, sender: string, since: number) {
  const from = String(message.payload?.headers?.find((header: any) => String(header.name).toLowerCase() === 'from')?.value ?? '');
  return senderAddress(from) === sender.toLowerCase() && Number(message.internalDate) >= since && !message.labelIds?.some((label: string) => ['SENT', 'DRAFT', 'TRASH'].includes(label));
}
async function gmail(token: string, path: string): Promise<any> {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'Gmail history expired or the message was removed; resume the directive to reconnect monitoring.' : `Gmail monitoring failed (${response.status}). Check the project connection.`), { status: response.status });
  return response.json();
}
export async function saveGmailDirective(input: { orgId: number; userId: string; projectId: number | null; sessionKey: string; message: string }) {
  const rule = parseGmailDirective(input.message);
  if (!rule) return null;
  if (rule.action === 'list') {
    const rows = await db.select().from(xrayOperationalConfigs).where(and(eq(xrayOperationalConfigs.organizationId, input.orgId), like(xrayOperationalConfigs.scope, `${PREFIX}%`)));
    const browserPushReady = pushService.isConfigured() && await pushService.hasSubscription(input.userId);
    const items = rows.filter(row => row.config.userId === input.userId && row.config.projectId === input.projectId).map(row => ({ sender: row.config.sender, status: row.config.status, mailbox: row.config.mailbox, lastCheckedAt: row.config.lastCheckedAt ?? null, error: row.config.error ?? null }));
    return { type: 'gmail_directive_list', items, browserPushReady, message: items.length ? `You have ${items.length} Gmail directive${items.length === 1 ? '' : 's'} in this project.` : 'You have no Gmail directives in this project.' };
  }
  const scope = `${PREFIX}${input.userId}:${input.projectId ?? 'none'}:${rule.sender}`;
  const [existing] = await db.select().from(xrayOperationalConfigs).where(and(eq(xrayOperationalConfigs.organizationId, input.orgId), eq(xrayOperationalConfigs.scope, scope)));
  if (rule.action !== 'create' && !existing) throw new Error('No matching Gmail directive exists in this project.');
  if (rule.action === 'remove') {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gmail-directive:${input.orgId}:${input.projectId ?? 'none'}`}))`);
      await tx.delete(xrayOperationalConfigs).where(and(eq(xrayOperationalConfigs.organizationId, input.orgId), eq(xrayOperationalConfigs.scope, scope)));
    });
    return { type: 'gmail_directive', sender: rule.sender, status: 'removed', mailbox: existing!.config.mailbox, browserPushReady: false, intervalSeconds: INTERVAL / 1000, message: `Removed the Gmail directive for ${rule.sender}. Future emails will not trigger this rule. Previously delivered alerts remain in Notifications.` };
  }
  if (rule.action === 'status') {
    const config = existing!.config;
    const browserPushReady = pushService.isConfigured() && await pushService.hasSubscription(input.userId);
    return { type: 'gmail_directive', sender: rule.sender, status: config.status, mailbox: config.mailbox, browserPushReady, intervalSeconds: INTERVAL / 1000, lastCheckedAt: config.lastCheckedAt, message: `Gmail directive: ${config.status}. ${config.error ?? ''} Last check: ${config.lastCheckedAt ?? 'not checked yet'}. Browser push: ${browserPushReady ? 'ready' : 'needs setup'}.` };
  }
  const token = rule.action === 'pause' ? null : await getGoogleWorkspaceToken(input.orgId, input.projectId, 'gmail_read');
  let profile: any = null;
  if (token) profile = await gmail(token, '/profile');
  const config = { ...(existing?.config ?? {}), sender: rule.sender, userId: input.userId, projectId: input.projectId, sessionKey: input.sessionKey, active: rule.action !== 'pause', since: rule.action === 'resume' ? Date.now() : existing?.config?.since ?? Date.now(), historyId: rule.action === 'resume' ? profile?.historyId ?? null : existing?.config?.historyId ?? profile?.historyId ?? null, mailbox: profile?.emailAddress ?? existing?.config?.mailbox ?? null, status: rule.action === 'pause' ? 'paused' : token ? 'active' : 'needs_connection', error: null };
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gmail-directive:${input.orgId}:${input.projectId ?? 'none'}`}))`);
    await tx.insert(xrayOperationalConfigs).values({ organizationId: input.orgId, scope, schemaVersion: 'gmail-directive-v1', config, updatedBy: input.userId }).onConflictDoUpdate({ target: [xrayOperationalConfigs.organizationId, xrayOperationalConfigs.scope], set: { config, updatedBy: input.userId, updatedAt: new Date() } });
  });
  const browserPushReady = pushService.isConfigured() && await pushService.hasSubscription(input.userId);
  startGmailDirectiveMonitor();
  return { type: 'gmail_directive', sender: rule.sender, status: config.status, mailbox: config.mailbox, browserPushReady, intervalSeconds: INTERVAL / 1000, message: config.status === 'active' ? `Monitoring new email from ${rule.sender}. Checks run every 30 seconds without AI calls. In-app alerts are enabled. ${browserPushReady ? 'Browser push is ready.' : 'Enable browser push in notification settings to receive browser alerts.'}` : config.status === 'paused' ? `Monitoring ${rule.sender} is paused.` : 'Saved. Connect Gmail read access in this project to activate monitoring.' };
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startGmailDirectiveMonitor() {
  if (timer) return;
  const tick = () => void sweepGmailDirectives().catch(error => logger.error('Gmail directive sweep failed', { message: error.message }));
  timer = setInterval(tick, INTERVAL); timer.unref(); tick();
}
export async function sweepGmailDirectives() {
  if (running) return;
  running = true;
  try {
    const rules = await db.select().from(xrayOperationalConfigs).where(like(xrayOperationalConfigs.scope, `${PREFIX}%`));
    const groups = new Map<string, typeof rules>();
    for (const row of rules) if (row.config.active) {
      const key = `${row.organizationId}:${row.config.projectId ?? 'none'}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const initialRows of groups.values()) {
      // A transaction advisory lock prevents duplicate mailbox work across server processes.
      await db.transaction(async tx => {
        const locked = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`gmail-directive:${initialRows[0].organizationId}:${initialRows[0].config.projectId ?? 'none'}`})) as locked`);
        if (!(locked.rows[0] as any)?.locked) return;
        const rows = (await tx.select().from(xrayOperationalConfigs).where(and(eq(xrayOperationalConfigs.organizationId, initialRows[0].organizationId), like(xrayOperationalConfigs.scope, `${PREFIX}%`)))).filter(row => row.config.active && row.config.projectId === initialRows[0].config.projectId);
        if (!rows.length) return;
        const first = rows[0];
        try {
          const token = await getGoogleWorkspaceToken(first.organizationId, first.config.projectId as number | null, 'gmail_read');
          if (!token) throw new Error('Gmail read permission missing. Connect Gmail in this project.');
          const cursors = rows.map(row => String(row.config.historyId ?? '')).filter(Boolean);
          const cursor = cursors.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)[0];
          if (!cursor) {
            const profile = await gmail(token, '/profile');
            for (const row of rows) await tx.update(xrayOperationalConfigs).set({ config: { ...row.config, historyId: profile.historyId, mailbox: profile.emailAddress, status: 'active', lastCheckedAt: new Date().toISOString(), error: null }, updatedAt: new Date() }).where(and(eq(xrayOperationalConfigs.organizationId, row.organizationId), eq(xrayOperationalConfigs.id, row.id)));
            return;
          }
          const ids = new Set<string>(); let nextPage: string | undefined; let latest = cursor;
          do {
            const history = await gmail(token, `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded${nextPage ? `&pageToken=${encodeURIComponent(nextPage)}` : ''}`);
            latest = history.historyId ?? latest;
            for (const record of history.history ?? []) for (const added of record.messagesAdded ?? []) if (added.message?.id) ids.add(added.message.id);
            nextPage = history.nextPageToken;
          } while (nextPage);
          for (const id of ids) {
            let message: any;
            try { message = await gmail(token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`); }
            catch (error: any) { if (error.status === 404) continue; throw error; }
            const header = (name: string) => String(message.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '');
            for (const row of rows) {
              if (!matchesGmailSender(message, String(row.config.sender), Number(row.config.since))) continue;
              row.config.senderProfile = observeImportantSender(row.config.senderProfile as ImportantSenderProfile | undefined, String(row.config.sender), { id, from: header('From'), subject: header('Subject'), date: new Date(Number(message.internalDate)).toISOString(), preview: message.snippet });
              const scope = `${PREFIX}${row.config.userId}`;
              const route = `/workspace/chat/${encodeURIComponent(String(row.config.sessionKey))}?orgId=${row.organizationId}`;
              const title = `Important email: ${header('Subject') || '(No subject)'}`;
              const description = `New Gmail message from ${row.config.sender}. ${String(message.snippet ?? '').slice(0, 250)}`;
              const [event] = await tx.insert(xrayOperationalEvents).values({ organizationId: row.organizationId, scope, eventType: 'gmail_sender_match', severity: 'info', deduplicationKey: `${row.id}:${id}`, deduplicationBucket: 'permanent', evidence: { messageId: id, sender: row.config.sender }, evaluation: { route } }).onConflictDoNothing().returning();
              if (event) {
                const alertRoute = gmailAlertRoute(route, event.id);
                await tx.insert(xrayOperationalNotifications).values({ organizationId: row.organizationId, scope, eventId: event.id, ruleId: String(row.id), severity: 'info', title, description, recipientRoles: [], payload: { recipientUserId: row.config.userId, actionUrl: alertRoute, actionLabel: 'Review email in CREW', route: alertRoute, url: alertRoute, gmailUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.threadId || id)}`, messageId: id, senderProfile: row.config.senderProfile, threadId: message.threadId, platform: 'gmail' } }).onConflictDoNothing();
              }
            }
          }
          for (const row of rows) await tx.update(xrayOperationalConfigs).set({ config: { ...row.config, historyId: latest, status: 'active', lastCheckedAt: new Date().toISOString(), error: null }, updatedAt: new Date() }).where(and(eq(xrayOperationalConfigs.organizationId, row.organizationId), eq(xrayOperationalConfigs.id, row.id)));
        } catch (error: any) {
          for (const row of rows) await tx.update(xrayOperationalConfigs).set({ config: { ...row.config, status: 'needs_attention', error: error.message, lastCheckedAt: new Date().toISOString() }, updatedAt: new Date() }).where(and(eq(xrayOperationalConfigs.organizationId, row.organizationId), eq(xrayOperationalConfigs.id, row.id)));
        }
      });
    }
    // Browser or phone: someone with only the Android app is still alerted.
    if (!pushService.anyConfigured()) return;
    const pending = await db.select().from(xrayOperationalNotifications).where(and(like(xrayOperationalNotifications.scope, `${PREFIX}%`), eq(xrayOperationalNotifications.status, 'unread'), sql`not exists (select 1 from push_deliveries d where d.source = 'gmail_directive' and d.source_id = ${xrayOperationalNotifications.id}::text and d.user_id::text = ${xrayOperationalNotifications.payload}->>'recipientUserId')`));
    for (const notice of pending) if (typeof notice.payload.recipientUserId === 'string' && await pushService.canReach(notice.payload.recipientUserId)) {
      await pushService.sendOnce('gmail_directive', notice.id, notice.payload.recipientUserId, { title: notice.title, body: notice.description, url: gmailAlertRoute(notice.payload.route, notice.eventId), tag: `gmail-${notice.id}` });
    }
  } finally { running = false; }
}
