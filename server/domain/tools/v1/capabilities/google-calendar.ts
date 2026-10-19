import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import type { ToolDefinition, ToolContext } from './types.js';
import { getGoogleWorkspaceToken } from '@domain/integrations/google-workspace-connector-bridge.js';
import { calendarSourceReceiptSchema, calendarWorkflowSchema } from '@shared/crew-calendar-workflow.js';

export class CalendarRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly uncertain = false) { super(message); }
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const calendarArgsHash = (args: unknown) => createHash('sha256').update(JSON.stringify(canonical(args))).digest('hex');
const approvedEventId = (approvalId: number, context: ToolContext) => {
  if (context.calendarWorkflow) {
    const workflow = calendarWorkflowSchema.parse(context.calendarWorkflow);
    return calendarArgsHash({ recipe: workflow.recipe, organizationId: workflow.organizationId, projectId: workflow.projectId,
      sessionKey: workflow.sessionKey, sources: workflow.sources.map(source => source.messageId).sort(), args: workflow.approvedArgsHash });
  }
  return createHash('sha256').update(`calendar-approval-${approvalId}`).digest('hex');
};
export function calendarFailure(error: any) {
  return { success: false, state: error instanceof CalendarRequestError && error.uncertain ? 'outcome_unknown' : 'failed', error: error?.message || String(error) };
}

const calendarId = z.string().min(1).default('primary');
const endpoint = (id: string) => `/calendars/${encodeURIComponent(id)}`;
const eventEndpoint = (p: any) => `${endpoint(p.calendar_id)}/events/${encodeURIComponent(p.event_id)}`;
async function request(context: ToolContext, path: string, method = 'GET', body?: unknown, etag?: string) {
  const token = await getGoogleWorkspaceToken(context.organizationId, context.projectId, method === 'GET' || path === '/freeBusy' ? 'calendar_read' : 'calendar_write');
  if (!token) throw new Error('Google Calendar permission is missing. Use connect_platform with platform google_calendar; approve Calendar editing access for changes.');
  let response: Response;
  try { response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    signal: AbortSignal.timeout(30_000),
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch { throw new CalendarRequestError('Google Calendar connection failed; verify the destination before retrying a change.', undefined, method !== 'GET'); }
  if (!response.ok) throw new CalendarRequestError(`Google Calendar API error ${response.status}: ${await response.text()}`, response.status, method !== 'GET' && response.status >= 500);
  try { return response.status === 204 ? { success: true } : await response.json(); }
  catch { throw new CalendarRequestError('Google Calendar returned an unreadable result; verify the destination before retrying.', response.status, method !== 'GET'); }
}
const time = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dateTime: z.string().datetime({ offset: true }).optional(), timeZone: z.string().optional() }).refine(p => Boolean(p.date) !== Boolean(p.dateTime), 'Specify exactly one of date (all-day) or dateTime.');
const event = z.object({
  summary: z.string().min(1), description: z.string().optional(), location: z.string().optional(), start: time, end: time,
  attendees: z.array(z.object({ email: z.string().email(), optional: z.boolean().optional() })).optional(),
  recurrence: z.array(z.string().regex(/^(RRULE|RDATE|EXDATE):/)).optional(),
  reminders: z.object({ useDefault: z.boolean(), overrides: z.array(z.object({ method: z.enum(['email', 'popup']), minutes: z.number().int().min(0).max(40320) })).max(5).optional() }).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(), visibility: z.enum(['default', 'public', 'private', 'confidential']).optional(),
}).refine(p => Boolean(p.start.date) === Boolean(p.end.date) && Date.parse(p.end.date ?? p.end.dateTime!) > Date.parse(p.start.date ?? p.start.dateTime!), 'End must follow start; all-day end date is exclusive.');
const notification = z.enum(['none', 'all', 'externalOnly']).default('none');
const eventRef = { calendar_id: calendarId, event_id: z.string().min(1) };
const schemas = {
  gcal_create_event: z.object({ calendar_id: calendarId, event, send_updates: notification, add_meet: z.boolean().default(false) }),
  gcal_update_event: z.object({ ...eventRef, event, etag: z.string().min(1), send_updates: notification }),
  gcal_delete_event: z.object({ ...eventRef, etag: z.string().min(1), send_updates: notification }),
  gcal_move_event: z.object({ ...eventRef, destination: z.string().min(1), send_updates: notification }),
  gcal_respond_event: z.object({ ...eventRef, response: z.enum(['accepted', 'declined', 'tentative']), etag: z.string().min(1), send_updates: notification }),
  gcal_create_calendar: z.object({ summary: z.string().min(1), description: z.string().optional(), timeZone: z.string().min(1) }),
  gcal_update_calendar: z.object({ calendar_id: z.string().min(1), summary: z.string().min(1), description: z.string().optional(), timeZone: z.string().optional() }),
  gcal_delete_calendar: z.object({ calendar_id: z.string().min(1).refine(id => id !== 'primary', 'Cannot delete primary calendar.') }),
};
export const CALENDAR_WRITE_NAMES = Object.keys(schemas);

function validateWorkflow(p: any, context: ToolContext) {
  if (!context.calendarWorkflow) return;
  const workflow = calendarWorkflowSchema.parse(context.calendarWorkflow);
  if (workflow.organizationId !== context.organizationId || workflow.projectId !== (context.projectId ?? null) || workflow.sessionKey !== context.sessionKey || workflow.approvedArgsHash !== calendarArgsHash(p)) {
    throw new Error('Calendar proposal scope or arguments changed. Prepare a new approval.');
  }
}

/** Recovery is read-only. A missing event never causes a second create. */
export async function reconcileCalendarApproval(args: unknown, context: ToolContext, approvalId: number) {
  if (context.organizationId == null) throw new Error('Organization context is required.');
  const p = schemas.gcal_create_event.parse(args);
  validateWorkflow(p, context);
  const id = approvedEventId(approvalId, context);
  const result = await request(context, `${endpoint(p.calendar_id)}/events/${id}`);
  const marker = result.extendedProperties?.private;
  const matchingApproval = marker?.crewApprovalId === String(approvalId)
    || (Boolean(context.calendarWorkflow) && marker?.crewWorkflowId === id);
  if (result.id !== id || result.status === 'cancelled' || !matchingApproval || marker?.crewArgsHash !== calendarArgsHash(p)) {
    throw new Error('Calendar event does not match the approved action. Manual reconciliation is required.');
  }
  // Provider metadata and attendee response statuses may change independently.
  // The reviewed title and schedule must still identify the approved event.
  const matchesTime = (actual: any, expected: any) => expected.date
    ? actual?.date === expected.date
    : Date.parse(actual?.dateTime) === Date.parse(expected.dateTime)
      && (!expected.timeZone || actual?.timeZone === expected.timeZone);
  if (result.summary !== p.event.summary || !matchesTime(result.start, p.event.start) || !matchesTime(result.end, p.event.end)
    || (p.event.location !== undefined && result.location !== p.event.location)
    || (p.event.description !== undefined && result.description !== p.event.description)
    || calendarArgsHash((result.attendees ?? []).map((a: any) => ({ email: a.email.toLowerCase(), optional: Boolean(a.optional) })).sort((a: any, b: any) => a.email.localeCompare(b.email)))
      !== calendarArgsHash((p.event.attendees ?? []).map(a => ({ email: a.email.toLowerCase(), optional: Boolean(a.optional) })).sort((a, b) => a.email.localeCompare(b.email)))) {
    throw new Error('Calendar event changed after approval. Manual reconciliation is required.');
  }
  return result;
}

/** Only the authorized approval service calls this; tool invocation always proposes. */
export async function executeCalendarApproval(action: string, args: unknown, context: ToolContext, approvalId: number) {
  if (context.organizationId == null) throw new Error('Organization context is required.');
  if (!Object.hasOwn(schemas, action)) throw new Error('Unsupported calendar action.');
  const p = schemas[action as keyof typeof schemas].parse(args) as any;
  validateWorkflow(p, context);
  const updates = `sendUpdates=${p.send_updates ?? 'none'}`;
  switch (action) {
    case 'gcal_create_event': {
      const id = approvedEventId(approvalId, context);
      if (context.calendarWorkflow) {
        try { return await reconcileCalendarApproval(p, context, approvalId); }
        catch (error) {
          // Only an authoritative not-found permits creation. Network failures,
          // changed events and inaccessible calendars must not trigger a write.
          if (!(error instanceof CalendarRequestError && error.status === 404)) throw error;
        }
      }
      try {
        const result = await request(context, `${endpoint(p.calendar_id)}/events?${updates}&conferenceDataVersion=1`, 'POST', { ...p.event, id,
          extendedProperties: { private: { crewApprovalId: String(approvalId), crewArgsHash: calendarArgsHash(p),
            ...(context.calendarWorkflow ? { crewWorkflowId: id } : {}) } },
          ...(p.add_meet ? { conferenceData: { createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}) });
        if (result.id !== id) throw new CalendarRequestError('Calendar create returned an unverified event ID.', undefined, true);
        return result;
      } catch (error) {
        if (error instanceof CalendarRequestError && (error.uncertain || error.status === 409)) {
          try { return await reconcileCalendarApproval(p, context, approvalId); }
          catch { throw new CalendarRequestError('Calendar outcome is unknown. Use Check calendar outcome; do not submit another create.', undefined, true); }
        }
        throw error;
      }
    }
    case 'gcal_update_event': return request(context, `${eventEndpoint(p)}?${updates}`, 'PATCH', p.event, p.etag);
    case 'gcal_delete_event': return request(context, `${eventEndpoint(p)}?${updates}`, 'DELETE', undefined, p.etag);
    case 'gcal_move_event': return request(context, `${eventEndpoint(p)}/move?${updates}&destination=${encodeURIComponent(p.destination)}`, 'POST');
    case 'gcal_respond_event': {
      const current = await request(context, eventEndpoint(p));
      if (current.etag !== p.etag) throw new Error('Event changed. Read it again before proposing a response.');
      if (!current.attendees?.some((a: any) => a.self)) throw new Error('Connected account is not an attendee.');
      return request(context, `${eventEndpoint(p)}?${updates}`, 'PATCH', { attendees: current.attendees.map((a: any) => a.self ? { ...a, responseStatus: p.response } : a) }, p.etag);
    }
    case 'gcal_create_calendar': return request(context, '/calendars', 'POST', p);
    case 'gcal_update_calendar': { const { calendar_id, ...body } = p; return request(context, endpoint(calendar_id), 'PATCH', body); }
    case 'gcal_delete_calendar': return request(context, endpoint(p.calendar_id), 'DELETE');
  }
}
async function propose(action: string, args: any, context: ToolContext) {
  if (context.organizationId == null) throw new Error('Organization context is required.');
  if (!await getGoogleWorkspaceToken(context.organizationId, context.projectId, 'calendar_write')) throw new Error('Google Calendar editing permission is missing. Use connect_platform with platform google_calendar and approve editing access before proposing changes.');
  const { db } = await import('@server/database_service.js');
  const { approvalRequests } = await import('@shared/schema/index.js');
  const title = `${action.replace('gcal_', '').replaceAll('_', ' ')}: ${args.event?.summary ?? args.summary ?? args.event_id ?? args.calendar_id}`;
  let workflow;
  if (action === 'gcal_create_event' && context.calendarSourceReceipts?.length) {
    if (!context.sessionKey) throw new Error('Email scheduling requires an originating CREW room.');
    const sources = z.array(calendarSourceReceiptSchema).min(1).parse(context.calendarSourceReceipts);
    const destination = context.calendarDestination?.calendarId === args.calendar_id
      ? context.calendarDestination.metadata : await request(context, endpoint(args.calendar_id));
    if (!destination?.timeZone) throw new Error('Calendar time zone is unavailable. Read calendar metadata before proposing.');
    try { new Intl.DateTimeFormat('en-US', { timeZone: destination.timeZone }); }
    catch { throw new Error('Calendar time zone is invalid. Resolve it before proposing.'); }
    workflow = calendarWorkflowSchema.parse({ version: 1, recipe: 'email_to_calendar', organizationId: context.organizationId,
      projectId: context.projectId ?? null, sessionKey: context.sessionKey, sources, calendarId: args.calendar_id,
      calendarTimeZone: destination.timeZone, approvedArgsHash: calendarArgsHash(args), state: 'awaiting_approval' });
  }
  const meta = { type: 'approval_request', kind: 'calendar_action', actionName: action, args, title, ...(workflow ? { workflow } : {}), projectId: context.projectId ?? null, sessionKey: context.sessionKey ?? null, reason: 'Apply this Google Calendar change. Attendee notifications: ' + (args.send_updates ?? 'none'), status: 'pending' };
  const actor = String(context.userId ?? 'crew');
  const [row] = await db.insert(approvalRequests).values({ executionId: `calendar_${randomBytes(16).toString('hex')}`, toolName: action, toolArgs: meta, organizationId: context.organizationId, approverType: 'user', approverEmail: actor, ...(/^[0-9a-f-]{36}$/i.test(actor) ? { approverId: actor } : {}), token: randomBytes(24).toString('hex'), status: 'pending' }).returning({ id: approvalRequests.id });
  if (!row) throw new Error('Calendar approval could not be saved.');
  return JSON.stringify({ ...meta, proposalId: row.id, message: 'Pending approval; the calendar has not changed.' });
}
export const GOOGLE_CALENDAR_TOOLS: Record<string, ToolDefinition> = {
  ...Object.fromEntries(Object.entries(schemas).map(([name, parameters]) => [name, { name, parameters, idempotency: 'none', riskLevel: 'medium', label: name.replaceAll('_', ' '), group: 'Google Workspace', description: 'Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master changes affect the series; instance IDs affect one occurrence. End dates for all-day events are exclusive.', execute: (p: any, c: ToolContext) => propose(name, parameters.parse(p), c) }] as [string, ToolDefinition])),
  gcal_get_event: { name: 'gcal_get_event', idempotency: 'read-safe', description: 'Read full Google event details, recurrence, attendees and etag before editing.', parameters: z.object(eventRef), execute: async (p, c) => JSON.stringify(await request(c, eventEndpoint(p))) },
  gcal_get_calendar: { name: 'gcal_get_calendar', idempotency: 'read-safe', description: 'Read calendar metadata and its authoritative time zone.', parameters: z.object({ calendar_id: calendarId }), execute: async (p, c) => JSON.stringify(await request(c, endpoint(p.calendar_id))) },
  gcal_free_busy: { name: 'gcal_free_busy', idempotency: 'read-safe', description: 'Check availability across Google calendars. Calendar-specific errors are not availability.', parameters: z.object({ calendar_ids: z.array(z.string().min(1)).min(1).max(50), time_min: z.string().datetime({ offset: true }), time_max: z.string().datetime({ offset: true }), time_zone: z.string().optional() }), execute: async (p, c) => { if (Date.parse(p.time_max) <= Date.parse(p.time_min)) throw new Error('End must follow start.'); return JSON.stringify(await request(c, '/freeBusy', 'POST', { timeMin: p.time_min, timeMax: p.time_max, timeZone: p.time_zone, items: p.calendar_ids.map((id: string) => ({ id })) })); } },
  gcal_event_instances: { name: 'gcal_event_instances', idempotency: 'read-safe', description: 'List occurrences of a recurring event; use an occurrence ID to change only that occurrence.', parameters: z.object({ ...eventRef, page_token: z.string().optional() }), execute: async (p, c) => JSON.stringify(await request(c, `${eventEndpoint(p)}/instances?maxResults=100${p.page_token ? `&pageToken=${encodeURIComponent(p.page_token)}` : ''}`)) },
};
