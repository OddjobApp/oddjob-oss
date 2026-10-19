/**
 * Learned computer-use skills, inside the Computer Use settings card.
 *
 * Record: a person works in the org's desktop browser ("Open desktop") while recording;
 * tasks that hand control to a person (yield_to_user) are recorded automatically.
 * Review: a stopped recording becomes a draft skill (named inputs, secret slots, a written
 * procedure). Approve: only active skills are matched to new tasks and replayed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, Square, Sparkles, CheckCircle2, Archive, Trash2 } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { apiRequest } from '@/lib/queryClient';

interface Recording {
  id: string;
  status: string;
  trigger: string;
  stepCount: number;
  startUrl: string | null;
  createdAt: string;
}

interface SkillInput {
  name: string;
  description?: string;
}

interface Skill {
  id: string;
  name: string;
  description: string | null;
  site: string | null;
  status: 'draft' | 'active' | 'archived';
  riskClass: string;
  inputs: SkillInput[];
  steps: unknown[];
  procedure: string;
  successCount: number;
  failureCount: number;
}

const RECORDINGS_KEY = ['/api/integrations/trycua/desktop/recordings'];
const SKILLS_KEY = ['/api/integrations/trycua/skills'];

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function ComputerUseSkillsPanel({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: RECORDINGS_KEY });
    queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
  };

  const recordings = useQuery({
    queryKey: RECORDINGS_KEY,
    queryFn: () => json<{ recordings: Recording[]; activeRecordingId: string | null }>('GET', RECORDINGS_KEY[0]),
    enabled,
    refetchInterval: (query) => (query.state.data?.activeRecordingId ? 3000 : false),
  });
  const skills = useQuery({
    queryKey: SKILLS_KEY,
    queryFn: () => json<{ skills: Skill[] }>('GET', SKILLS_KEY[0]),
    enabled,
  });

  const start = useMutation({ mutationFn: () => json('POST', RECORDINGS_KEY[0], {}), onSettled: refresh });
  const stop = useMutation({ mutationFn: (id: string) => json('POST', `${RECORDINGS_KEY[0]}/${id}/stop`), onSettled: refresh });
  const discard = useMutation({ mutationFn: (id: string) => json('DELETE', `${RECORDINGS_KEY[0]}/${id}`), onSettled: refresh });
  const toSkill = useMutation({ mutationFn: (id: string) => json('POST', `${RECORDINGS_KEY[0]}/${id}/skill`, {}), onSettled: refresh });
  const approve = useMutation({ mutationFn: (id: string) => json('POST', `${SKILLS_KEY[0]}/${id}/approve`), onSettled: refresh });
  const archive = useMutation({ mutationFn: (id: string) => json('POST', `${SKILLS_KEY[0]}/${id}/archive`), onSettled: refresh });

  if (!enabled) return null;
  const activeId = recordings.data?.activeRecordingId ?? null;
  const pending = (recordings.data?.recordings ?? []).filter((r) => r.status === 'stopped' && r.stepCount > 0);
  const visibleSkills = (skills.data?.skills ?? []).filter((s) => s.status !== 'archived');
  const error = [start, stop, discard, toSkill, approve, archive].map((m) => m.error).find(Boolean) as Error | undefined;

  return (
    <div className="space-y-4" data-testid="computer-use-skills-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Learned skills</p>
          <p className="text-sm text-muted-foreground">
            Record what you do in the desktop browser; approved skills are replayed for matching tasks.
          </p>
        </div>
        {activeId ? (
          <Button type="button" variant="destructive" size="sm" onClick={() => stop.mutate(activeId)} disabled={stop.isPending} data-testid="button-stop-recording">
            <Square className="w-3.5 h-3.5 mr-1.5" /> Stop recording
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-start-recording">
            <Circle className="w-3.5 h-3.5 mr-1.5 text-red-500" /> {start.isPending ? 'Starting…' : 'Record'}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {activeId && (
        <p className="text-sm text-muted-foreground">
          Recording… open the desktop and work in its browser. Password and one-time-code fields are never recorded.
        </p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recordings to review</p>
          {pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm" data-testid={`recording-${r.id}`}>
              <span className="truncate">
                {r.stepCount} steps {r.startUrl ? `on ${safeHost(r.startUrl)}` : ''} · {r.trigger === 'takeover' ? 'task takeover' : 'manual'}
              </span>
              <span className="flex gap-1 shrink-0">
                <Button type="button" size="sm" variant="outline" onClick={() => toSkill.mutate(r.id)} disabled={toSkill.isPending}>
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Make skill
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => discard.mutate(r.id)} title="Discard recording">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
        {visibleSkills.length === 0 && <p className="text-sm text-muted-foreground">No skills yet.</p>}
        {visibleSkills.map((s) => (
          <details key={s.id} className="rounded-md border p-2 text-sm" data-testid={`skill-${s.id}`}>
            <summary className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{s.name}</span>
                <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
                <Badge variant="outline">{s.riskClass}</Badge>
                {s.site && <span className="truncate text-muted-foreground">{s.site}</span>}
              </span>
              <span className="flex shrink-0 gap-1">
                {s.status === 'draft' && (
                  <Button type="button" size="sm" variant="outline" onClick={(e) => { e.preventDefault(); approve.mutate(s.id); }} disabled={approve.isPending}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={(e) => { e.preventDefault(); archive.mutate(s.id); }} title="Archive skill">
                  <Archive className="w-3.5 h-3.5" />
                </Button>
              </span>
            </summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              {s.description && <p>{s.description}</p>}
              {s.inputs.length > 0 && (
                <p>Inputs: {s.inputs.map((i) => i.name).join(', ')}</p>
              )}
              <p>{s.steps.length} steps · used {s.successCount + s.failureCount}× ({s.successCount} succeeded)</p>
              <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{s.procedure}</pre>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
