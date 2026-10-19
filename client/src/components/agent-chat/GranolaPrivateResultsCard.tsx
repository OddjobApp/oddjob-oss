import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardHeader, CrewCardStatus } from './CrewCard';

export interface GranolaPrivateResultsPayload {
  type: 'granola_private_results';
  ownerUserId: string;
  organizationId: number;
  sessionKey: string;
  query?: string;
  list?: Record<string, unknown>;
  count?: number;
}

interface MeetingSummary {
  id: string;
  title: string;
  meetingDate?: string;
  attendees?: string[];
  preview?: string;
}

export function isGranolaPrivateResults(p: any): p is GranolaPrivateResultsPayload {
  return p?.type === 'granola_private_results' && typeof p.ownerUserId === 'string' && typeof p.sessionKey === 'string';
}

/**
 * A room search of someone's Granola notes. The payload holds no meeting data:
 * in the asker's browser the card lists their matches from their own account,
 * each with Share, which posts that meeting's notes into the room. Everyone
 * else sees only that the matches are private.
 */
export function GranolaPrivateResultsCard({ payload, currentUserId }: { payload: GranolaPrivateResultsPayload; currentUserId: string | null }) {
  const isOwner = Boolean(currentUserId && currentUserId === payload.ownerUserId);
  const count = typeof payload.count === 'number' ? payload.count : null;
  const countLabel = count === null ? 'Private' : `${count} private`;

  if (!isOwner) {
    return (
      <CrewCard testId="granola-private-results" label="Granola meetings">
        <CrewCardHeader icon={<Lock />} title="Granola meetings"
          description="Only the person who asked can see which meetings matched. Their notes appear here only if they share them."
          aside={<CrewCardStatus>{countLabel}</CrewCardStatus>} />
      </CrewCard>
    );
  }
  return <OwnerView payload={payload} countLabel={countLabel} />;
}

function OwnerView({ payload, countLabel }: { payload: GranolaPrivateResultsPayload; countLabel: string }) {
  const [shared, setShared] = useState<Record<string, 'sharing' | 'shared' | string>>({});
  const params = new URLSearchParams({ orgId: String(payload.organizationId) });
  if (payload.query) params.set('query', payload.query);
  else for (const [k, v] of Object.entries(payload.list ?? {})) if (v != null) params.set(k, String(v));
  const url = `/api/me/connections/granola/meetings?${params}`;
  const meetings = useQuery<{ meetings: MeetingSummary[] }>({
    queryKey: [url],
    queryFn: async () => (await apiRequest('GET', url)).json(),
    staleTime: 60_000,
  });

  const share = async (meetingId: string) => {
    setShared((s) => ({ ...s, [meetingId]: 'sharing' }));
    try {
      const res = await apiRequest('POST', `/api/me/connections/granola/share?orgId=${payload.organizationId}`, { sessionKey: payload.sessionKey, meetingId });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'Could not share this meeting.');
      setShared((s) => ({ ...s, [meetingId]: 'shared' }));
    } catch (err: any) {
      setShared((s) => ({ ...s, [meetingId]: err?.message || 'Could not share this meeting.' }));
    }
  };

  const list = meetings.data?.meetings ?? [];
  return (
    <CrewCard testId="granola-private-results" label="Your Granola meetings">
      <CrewCardHeader icon={<Lock />} title="Your Granola meetings"
        description="Only you can see this list. Share a meeting to put its notes in this room, where everyone who can open the room can read them."
        aside={<CrewCardStatus>{countLabel}</CrewCardStatus>} />
      <CrewCardBody>
        {meetings.isLoading && <p className="text-xs text-muted-foreground">Loading your meetings…</p>}
        {meetings.isError && <p className="text-xs text-destructive">Your Granola meetings could not be loaded.</p>}
        {!meetings.isLoading && !meetings.isError && list.length === 0 && <p className="text-xs text-muted-foreground">No meetings matched.</p>}
        <ul className="divide-y divide-border/60">
          {list.map((m) => {
            const state = shared[m.id];
            return (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-foreground">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[m.meetingDate ? String(m.meetingDate).slice(0, 10) : '', (m.attendees ?? []).slice(0, 4).join(', ')].filter(Boolean).join(' · ')}
                  </p>
                  {state && state !== 'sharing' && state !== 'shared' && <p className="text-xs text-destructive">{state}</p>}
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs"
                  disabled={state === 'sharing' || state === 'shared'}
                  onClick={() => void share(m.id)}>
                  {state === 'shared' ? 'Shared' : state === 'sharing' ? 'Sharing…' : 'Share'}
                </Button>
              </li>
            );
          })}
        </ul>
      </CrewCardBody>
    </CrewCard>
  );
}
