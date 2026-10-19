import React, { useState } from 'react';
import { Calendar, Clock, MapPin, Video, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { approvalArgFields } from '@shared/approval-args';
import { ExportCalendarOperationSkill } from '../CrewOperationSkillDraftView';

export function calendarTime(value: { dateTime?: string; date?: string; timeZone?: string }, zone?: string) {
  if (!value.dateTime) return value.date ?? '';
  const date = new Date(value.dateTime);
  if (Number.isNaN(date.getTime())) return value.dateTime;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) }).format(date);
}

export function calendarTimeRange(
  start?: { dateTime?: string; date?: string; timeZone?: string },
  end?: { dateTime?: string; date?: string; timeZone?: string },
  zone?: string
): string {
  if (!start) return '';
  if (!start.dateTime && start.date) {
    if (end?.date && end.date !== start.date) {
      return `${start.date} – ${end.date}`;
    }
    return start.date;
  }
  if (!start.dateTime) return '';
  const startDate = new Date(start.dateTime);
  if (Number.isNaN(startDate.getTime())) return start.dateTime;

  const startFormatted = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(zone ? { timeZone: zone } : {}),
  }).format(startDate);

  if (!end?.dateTime) return startFormatted;
  const endDate = new Date(end.dateTime);
  if (Number.isNaN(endDate.getTime())) return `${startFormatted} – ${end.dateTime}`;

  const sameDay = startDate.toDateString() === endDate.toDateString();
  if (sameDay) {
    const endFormatted = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(zone ? { timeZone: zone } : {}),
    }).format(endDate);
    return `${startFormatted} – ${endFormatted}`;
  }

  const endFormatted = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(zone ? { timeZone: zone } : {}),
  }).format(endDate);

  return `${startFormatted} – ${endFormatted}`;
}

export interface CalendarApprovalViewProps {
  payload: Record<string, any>;
  decision: 'pending' | 'approved' | 'rejected';
  calendarOutcome: Record<string, any> | null;
  onSetCalendarOutcome: (outcome: Record<string, any> | null) => void;
  onError: (err: string | null) => void;
  approvalUrl: (suffix?: string) => string;
  persistedProposalId: number | null;
  isSubmitting: boolean;
  setIsSubmitting: (submitting: boolean) => void;
}

export function CalendarApprovalView({
  payload,
  decision,
  calendarOutcome,
  onSetCalendarOutcome,
  onError,
  approvalUrl,
  persistedProposalId,
  isSubmitting,
  setIsSubmitting,
}: CalendarApprovalViewProps) {
  const [calendarVerification, setCalendarVerification] = useState<string | null>(null);

  const event = payload.args?.event || payload.event;
  const hasEvent = Boolean(event && typeof event === 'object' && (event.summary || event.start || event.end || event.description));
  const calendarId = payload.args?.calendar_id || payload.workflow?.calendarId || payload.calendar_id;
  const addMeet = Boolean(payload.args?.add_meet || payload.add_meet);
  const sendUpdates = payload.args?.send_updates || payload.send_updates;
  const attendees: any[] = Array.isArray(event?.attendees) ? event.attendees : [];

  if (payload.kind === 'google_workspace_action') {
    return (
      <div className="space-y-2">
        <p className="font-medium text-foreground">Review the Google Workspace change</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2">
          {approvalArgFields(payload.args).map(field => (
            <React.Fragment key={field.label}>
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="break-words whitespace-pre-wrap">{field.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        {calendarOutcome?.success && !calendarOutcome.discarded && (
          <p className="text-emerald-700 dark:text-emerald-300">Google Workspace change applied.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!calendarOutcome?.success && <p className="font-medium text-foreground">Review calendar change</p>}
      {!calendarOutcome?.success && payload.workflow?.recipe === 'email_to_calendar' && (
        <p className="mt-2 text-muted-foreground">
          Verified email → {payload.workflow.calendarId} · {payload.workflow.calendarTimeZone}
          {' · '}{payload.workflow.sources?.length ?? 0} source message(s)
        </p>
      )}
      {!calendarOutcome?.success && hasEvent && (
        <div
          className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3.5"
          data-testid="calendar-event-proposal"
        >
          {event.summary && (
            <h4 className="text-sm font-semibold text-foreground">{event.summary}</h4>
          )}

          <div className="space-y-2">
            {(event.start || event.end) && (
              <div className="flex items-start gap-2.5 text-xs text-foreground/90">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="space-y-0.5">
                  <span className="font-medium">
                    {calendarTimeRange(event.start, event.end, event.start?.timeZone || payload.workflow?.calendarTimeZone)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </div>
              </div>
            )}

            {event.location && (
              <div className="flex items-center gap-2.5 text-xs text-foreground/90">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{event.location}</span>
              </div>
            )}

            {addMeet && (
              <div className="flex items-center gap-2.5 text-xs text-foreground/90">
                <Video className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span>Google Meet video conference will be attached</span>
              </div>
            )}

            {calendarId && (
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Destination calendar: <span className="font-mono text-[11px] text-foreground">{calendarId}</span>
                </span>
              </div>
            )}

            {attendees.length > 0 && (
              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span>Attendees ({attendees.length}):</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-5">
                  {attendees.map((att: any, idx: number) => {
                    const email = typeof att === 'string' ? att : att?.email || '';
                    const name = typeof att === 'object' && att?.displayName ? att.displayName : null;
                    if (!email) return null;
                    return (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 text-[11px] text-foreground"
                      >
                        {name ? `${name} <${email}>` : email}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {event.description && (
            <div className="space-y-1 pt-1 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground">Description / Notes:</span>
              <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background/50 p-2.5 text-xs leading-relaxed text-foreground/80">
                {event.description}
              </div>
            </div>
          )}

          {sendUpdates && sendUpdates !== 'none' && (
            <p className="text-[11px] text-muted-foreground">
              Guest notifications: <span className="font-medium capitalize text-foreground">{sendUpdates}</span>
            </p>
          )}
        </div>
      )}
      {!calendarOutcome?.success && !hasEvent && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2">
          {approvalArgFields(payload.args).map(field => (
            <React.Fragment key={field.label}>
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="break-words whitespace-pre-wrap">{field.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {decision === 'approved' && payload.actionName === 'gcal_create_event' && !calendarOutcome?.success &&
        (!calendarOutcome || ['executing', 'outcome_unknown'].includes(calendarOutcome.state)) && (
          <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <p>{calendarOutcome?.state === 'executing' ? 'Calendar change is executing.' : 'Calendar outcome is unconfirmed. Check the existing event before creating another.'}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={isSubmitting}
              onClick={async () => {
                if (persistedProposalId == null) return;
                setIsSubmitting(true);
                try {
                  const response = await apiRequest('POST', approvalUrl('/decision'), { decision: 'approved' });
                  const body = await response.json();
                  if (!response.ok || !body.calendarAction) throw new Error(body.message ?? 'Calendar outcome could not be checked.');
                  onSetCalendarOutcome(body.calendarAction);
                  onError(body.calendarAction.success ? null : body.calendarAction.error ?? 'Calendar outcome remains unconfirmed.');
                } catch (failure: any) {
                  onError(failure.message);
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              Check calendar outcome
            </Button>
          </div>
        )}
      {calendarOutcome?.success && !calendarOutcome.discarded && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5" data-testid="calendar-event-confirmation">
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">
            {payload.actionName === 'gcal_create_event' ? 'Calendar event added' : 'Calendar change applied'}
          </p>
          {calendarOutcome.result?.summary && <p className="mt-1 font-medium">{calendarOutcome.result.summary}</p>}
          <dl className="mt-2 space-y-1">
            {(calendarOutcome.result?.organizer?.email || payload.workflow?.calendarId || payload.args?.calendar_id) && (
              <div>
                <dt className="inline text-muted-foreground">Calendar: </dt>
                <dd className="inline">{calendarOutcome.result?.organizer?.email || payload.workflow?.calendarId || payload.args?.calendar_id}</dd>
              </div>
            )}
            {calendarOutcome.result?.start && (
              <div>
                <dt className="inline text-muted-foreground">Starts: </dt>
                <dd className="inline">{calendarTime(calendarOutcome.result.start)}</dd>
              </div>
            )}
            {calendarOutcome.result?.end && (
              <div>
                <dt className="inline text-muted-foreground">Ends: </dt>
                <dd className="inline">{calendarTime(calendarOutcome.result.end)}</dd>
              </div>
            )}
            {calendarOutcome.result?.start?.dateTime && (
              <div className="text-muted-foreground">Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
            )}
            {calendarOutcome.result?.location && (
              <div>
                <dt className="inline text-muted-foreground">Location: </dt>
                <dd className="inline">{calendarOutcome.result.location}</dd>
              </div>
            )}
          </dl>
          {typeof calendarOutcome.result?.htmlLink === 'string' && /^https:\/\/(?:calendar\.google\.com|www\.google\.com)\//.test(calendarOutcome.result.htmlLink) && (
            <a className="mt-2 inline-block font-medium text-primary underline-offset-2 hover:underline" href={calendarOutcome.result.htmlLink} target="_blank" rel="noopener noreferrer">
              Open calendar event
            </a>
          )}
          {payload.actionName === 'gcal_create_event' && persistedProposalId != null && (
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              disabled={isSubmitting}
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  const response = await apiRequest('GET', approvalUrl('/calendar-verification'));
                  const verification = await response.json();
                  setCalendarVerification(verification.found ? `Verified in Google at ${new Date(verification.verifiedAt).toLocaleTimeString()}. If the link fails, open the destination calendar and search for this title.` : 'Google reports this event was cancelled. No new event was created.');
                } catch {
                  setCalendarVerification('Could not verify this event. Check Calendar access and the destination account before creating another event.');
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              Verify in Google
            </Button>
          )}
          {calendarVerification && <p role="status" className="mt-2">{calendarVerification}</p>}
          {payload.actionName === 'gcal_create_event' && calendarOutcome.state === 'succeeded' && payload.workflow?.organizationId && payload.workflow?.sessionKey && persistedProposalId != null && (
            <details className="mt-3">
              <summary>More options</summary>
              <ExportCalendarOperationSkill key={`${payload.workflow.organizationId}:${payload.workflow.sessionKey}:${persistedProposalId}`} proposalId={persistedProposalId} organizationId={payload.workflow.organizationId} roomKey={payload.workflow.sessionKey} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}
