import React, { useState } from 'react';
import { Bot, Calendar, CalendarCheck, Check, Clock, User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardStatus } from './CrewCard';

export function CrewSchedulingPollCard({
  payload,
  currentUserId,
  onArtifactSubmit,
}: {
  payload: any;
  currentUserId: string | null;
  onArtifactSubmit?: (text: string) => void;
}) {
  const [schedule, setSchedule] = useState(payload);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleVote = async (slotId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiRequest('POST', `/api/crew/schedules/${schedule.scheduleId || schedule.id}/vote`, { slotId });
      if (res.ok) {
        const data = await res.json();
        setSchedule((prev: any) => ({ ...prev, ...data.schedule }));
      }
    } catch (err) {
      console.error('Failed to vote:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (slotId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiRequest('POST', `/api/crew/schedules/${schedule.scheduleId || schedule.id}/confirm`, { slotId });
      if (res.ok) {
        const data = await res.json();
        setSchedule((prev: any) => ({ ...prev, ...data.schedule, status: 'confirmed' }));
        if (onArtifactSubmit) {
          onArtifactSubmit(`Confirmed meeting "${schedule.title}" for ${new Date((data.schedule.confirmedSlot || {}).startsAt).toLocaleString()}`);
        }
      }
    } catch (err) {
      console.error('Failed to confirm meeting:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const slots = (schedule.candidateSlots || []) as any[];
  const attendees = (schedule.requestedAttendees || []) as any[];
  const isHost = !schedule.hostUserId || schedule.hostUserId === currentUserId;

  return (
    <CrewCard testId="scheduling-poll-card">
      <CrewCardHeader
        icon={<Calendar />}
        title={schedule.title}
        description={isHost ? 'Pick the times that work. As host, you confirm the one everyone gets.' : 'Pick the times that work for you.'}
      />

      <CrewCardBody>
        {schedule.agenda && (
          <p className="leading-relaxed text-foreground/90">
            <span className="font-medium text-foreground">Agenda: </span>
            {schedule.agenda}
          </p>
        )}

        <ul className="divide-y divide-border/60 rounded-lg border border-border/60" aria-label="Proposed times">
          {slots.map((slot: any) => {
            const hasVoted = currentUserId && (slot.votes || []).includes(currentUserId);
            const voteCount = (slot.votes || []).length;
            const startDate = new Date(slot.startsAt);
            const endDate = new Date(slot.endsAt);
            const dateStr = startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

            return (
              <li
                key={slot.id}
                className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2', hasVoted && 'bg-primary/5')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium text-foreground">{dateStr}</span>
                  <span className="tabular-nums text-muted-foreground">{timeStr}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">
                    {voteCount} {voteCount === 1 ? 'vote' : 'votes'}
                  </span>
                  <Button
                    size="sm"
                    variant={hasVoted ? 'secondary' : 'outline'}
                    onClick={() => handleVote(slot.id)}
                    disabled={isSubmitting}
                    aria-pressed={Boolean(hasVoted)}
                    className="h-7 px-2.5 text-xs"
                  >
                    {hasVoted && <Check className="mr-1 h-3 w-3" aria-hidden />}
                    {hasVoted ? 'Available' : 'I’m available'}
                  </Button>
                  {isHost && (
                    <Button
                      size="sm"
                      onClick={() => handleConfirm(slot.id)}
                      disabled={isSubmitting}
                      className="h-7 px-2.5 text-xs"
                      title="Book this time for everyone invited"
                    >
                      Confirm
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {attendees.length > 0 && (
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Invited</p>
            <ul className="flex flex-wrap gap-1.5">
              {attendees.map((a: any) => (
                <li
                  key={a.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
                    a.status === 'accepted'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-border/60 text-muted-foreground',
                  )}
                >
                  {a.type === 'agent' ? <Bot className="h-3 w-3" aria-hidden /> : <UserIcon className="h-3 w-3" aria-hidden />}
                  {a.name}
                  {a.status === 'accepted' && <Check className="h-3 w-3" aria-label="accepted" />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CrewCardBody>
    </CrewCard>
  );
}

export function CrewMeetingConfirmedCard({ payload }: { payload: any }) {
  const slot = payload.confirmedSlot || {};
  // No start time means none was recorded; never show "now" as if it were booked.
  const startDate = slot.startsAt ? new Date(slot.startsAt) : null;
  const endDate = slot.endsAt ? new Date(slot.endsAt) : startDate ? new Date(startDate.getTime() + 45 * 60 * 1000) : null;
  const icsUrl = payload.icsDownloadUrl || `/api/crew/schedules/${payload.scheduleId}/ics`;
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <CrewCard testId="meeting-confirmed-card">
      <CrewCardHeader
        icon={<CalendarCheck />}
        tone="success"
        title={payload.title}
        description={
          startDate && endDate ? (
            <>
              {startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })},{' '}
              <span className="tabular-nums">
                {time(startDate)}–{time(endDate)}
              </span>
            </>
          ) : (
            'Confirmed, but no time was recorded.'
          )
        }
        aside={<CrewCardStatus tone="success">Confirmed</CrewCardStatus>}
      />

      {payload.agenda && (
        <CrewCardBody>
          <p className="leading-relaxed text-foreground/90">
            <span className="font-medium text-foreground">Agenda: </span>
            {payload.agenda}
          </p>
        </CrewCardBody>
      )}

      <CrewCardFooter note="Added to the Project Space calendar. The room opens at the start time.">
        <Button asChild size="sm" variant="outline">
          <a href={icsUrl} download data-testid="download-ics-btn">
            <Calendar className="mr-1 h-3.5 w-3.5" aria-hidden />
            Add to my calendar
          </a>
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
