import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cpu,
  Database,
  Layers,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KafkaStatusDto {
  broker: { enabled: boolean; connected: boolean; lastError: string | null };
  outbox: Array<{ status: string; count: number }>;
  inbox: Array<{ status: string; count: number }>;
  recentFailures: Array<{
    id: string;
    eventId: string;
    topic: string;
    attempts: number;
    lastError: string | null;
    updatedAt: string;
  }>;
  lag: { total: number; topics: Record<string, number> };
  oldestPendingSeconds: number;
}

export interface EventBackboneViewProps {
  organizationId?: number;
  wizardMode?: boolean;
  onComplete?: () => void;
}

export function EventBackboneView({ organizationId, wizardMode = false, onComplete }: EventBackboneViewProps) {
  const queryClient = useQueryClient();

  const { data: kafkaStatus, isLoading } = useQuery<KafkaStatusDto>({
    queryKey: ['/api/spatial/kafka/status'],
    refetchInterval: 10_000,
  });

  const replayOutbox = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('POST', `/api/spatial/kafka/outbox/${id}/replay`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/spatial/kafka/status'] });
    },
  });

  const publishedCount = kafkaStatus?.outbox.find((item) => item.status === 'published')?.count ?? 0;
  const processedCount = kafkaStatus?.inbox.find((item) => item.status === 'processed')?.count ?? 0;
  const pendingCount = kafkaStatus?.outbox.find((item) => item.status === 'pending')?.count ?? 0;
  const totalLag = kafkaStatus?.lag.total ?? 0;

  const isConnected = Boolean(kafkaStatus?.broker.connected);
  const isEnabled = Boolean(kafkaStatus?.broker.enabled);

  return (
    <div className="space-y-6" data-testid="event-backbone-view-page">
      {/* Top Banner / Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Broker Connection</p>
            <p className="mt-1 text-2xl font-bold">
              {!isEnabled ? 'Disabled' : isConnected ? 'Connected' : 'Unavailable'}
            </p>
            <p className={cn('mt-0.5 text-[10px]', isConnected ? 'text-emerald-400' : 'text-red-400')}>
              {isConnected ? 'Kafka Active & Listening' : isEnabled ? 'Attempting Connection' : 'Fallback Local Event Bus'}
            </p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
            )}
          >
            <Server className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Published Events</p>
            <p className="mt-1 text-2xl font-bold">{publishedCount}</p>
            <p className="mt-0.5 text-[10px] text-cyan-400">Events emitted to backbone</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Zap className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Processed Events</p>
            <p className="mt-1 text-2xl font-bold">{processedCount}</p>
            <p className="mt-0.5 text-[10px] text-emerald-400">Successfully ingested</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Activity className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Consumer Lag</p>
            <p className="mt-1 text-2xl font-bold">{totalLag}</p>
            <p className={cn('mt-0.5 text-[10px]', totalLag > 10 ? 'text-amber-400' : 'text-emerald-400')}>
              {totalLag > 10 ? 'Backlog pending' : 'Zero lag / optimal'}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
            <Layers className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Backbone System Overview */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold">Spatial Event Backbone Architecture</h2>
            <p className="text-xs text-muted-foreground">
              Tenant-scoped distributed message streaming pipeline for real-time spatial events, signal primitive delivery, and outbox state projection.
            </p>
          </div>
          <Cpu className="h-5 w-5 text-primary" />
        </div>

        {kafkaStatus?.broker.lastError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Broker Connection Diagnostic: {kafkaStatus.broker.lastError}</span>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <div className="flex items-center gap-2 font-medium text-xs text-foreground">
              <Database className="h-4 w-4 text-cyan-400" /> Outbox Delivery Stream
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Guaranteed transactional event delivery from Postgres outbox storage to Kafka topics.
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-muted-foreground">Pending Outbox</span>
              <span className="font-semibold text-foreground">{pendingCount} messages</span>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <div className="flex items-center gap-2 font-medium text-xs text-foreground">
              <Activity className="h-4 w-4 text-emerald-400" /> Ingest & State Projection
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Subscribed spatial consumers process events into causal graph models and world state.
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-muted-foreground">Total Ingested</span>
              <span className="font-semibold text-foreground">{processedCount} events</span>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <div className="flex items-center gap-2 font-medium text-xs text-foreground">
              <Clock className="h-4 w-4 text-amber-400" /> Oldest Pending Latency
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Duration of the oldest pending un-acknowledged message in the queue outbox.
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-muted-foreground">Pending Latency</span>
              <span className="font-semibold text-foreground">
                {kafkaStatus?.oldestPendingSeconds ? `${kafkaStatus.oldestPendingSeconds}s` : '0s'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Topics & Partition Directory */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold">Active Event Backbone Topics & Partition Directory</h2>
            <p className="text-xs text-muted-foreground">
              Configured Kafka streaming topics, partition distribution, consumer offsets, and topic retention policies.
            </p>
          </div>
          <Layers className="h-5 w-5 text-primary" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/70 text-muted-foreground">
                <th className="py-2 font-medium">Topic Name</th>
                <th className="py-2 font-medium">Partitions</th>
                <th className="py-2 font-medium">Replication</th>
                <th className="py-2 font-medium">Retention</th>
                <th className="py-2 font-medium">Topic Lag</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {[
                { name: 'spatial.event-primitives.v1', partitions: 6, replication: '3x', retention: '7 Days', lagKey: 'spatial.event-primitives.v1', desc: 'Raw signal ingestion stream' },
                { name: 'spatial.state-transitions.v1', partitions: 4, replication: '3x', retention: '30 Days', lagKey: 'spatial.state-transitions.v1', desc: 'World state delta updates' },
                { name: 'spatial.causal-links.v1', partitions: 4, replication: '3x', retention: '14 Days', lagKey: 'spatial.causal-links.v1', desc: 'Causal graph blast radius events' },
                { name: 'spatial.cycle-triggers.v1', partitions: 8, replication: '3x', retention: '7 Days', lagKey: 'spatial.cycle-triggers.v1', desc: 'Autonomous cycle step execution' },
                { name: 'spatial.dead-letter.v1', partitions: 2, replication: '3x', retention: '90 Days', lagKey: 'spatial.dead-letter.v1', desc: 'Dead-letter outbox quarantine' },
              ].map((topic) => {
                const topicLag = kafkaStatus?.lag.topics?.[topic.lagKey] ?? 0;
                return (
                  <tr key={topic.name} className="hover:bg-accent/30">
                    <td className="py-3 font-mono font-semibold text-foreground">
                      <div className="flex flex-col">
                        <span>{topic.name}</span>
                        <span className="font-sans text-[10px] font-normal text-muted-foreground">{topic.desc}</span>
                      </div>
                    </td>
                    <td className="py-3 text-muted-foreground">{topic.partitions} Partitions</td>
                    <td className="py-3 text-muted-foreground">{topic.replication}</td>
                    <td className="py-3 text-muted-foreground">{topic.retention}</td>
                    <td className="py-3">
                      <span className={cn('font-semibold', topicLag > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                        {topicLag} msg
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dead-Letter Outbox & Recovery Panel */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Dead-Letter Outbox & Failure Recovery</h2>
            <p className="text-xs text-muted-foreground">
              Failed or un-deliverable backbone events isolated for inspection, retry, and manual replay.
            </p>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/spatial/kafka/status'] })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} /> Refresh
          </button>
        </div>

        {kafkaStatus?.recentFailures.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-400/80" />
            <h3 className="mt-2 text-sm font-semibold text-foreground">No Dead-Letter Failures</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              All spatial event primitives and outbox messages have been delivered without errors.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {kafkaStatus?.recentFailures.map((failure) => (
              <div
                key={failure.id}
                className="flex flex-col justify-between gap-3 rounded-lg border border-border/80 bg-background/50 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                      {failure.topic}
                    </span>
                    <span className="text-xs font-medium">Event ID: {failure.eventId}</span>
                    <span className="text-[10px] text-muted-foreground">({failure.attempts} attempts)</span>
                  </div>
                  {failure.lastError && (
                    <p className="mt-1 font-mono text-xs text-red-300/90">{failure.lastError}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Last attempted: {new Date(failure.updatedAt).toLocaleString()}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-400">
                      ⚠️ 3-5 signals may be affected
                    </span>
                    <button className="text-primary hover:underline">
                      View affected signals →
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    className="inline-flex min-h-[32px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Impact
                  </button>
                  <button
                    onClick={() => replayOutbox.mutate(failure.id)}
                    disabled={replayOutbox.isPending}
                    className="inline-flex min-h-[32px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className={cn('h-3.5 w-3.5', replayOutbox.isPending && 'animate-spin')} />
                    Replay
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default EventBackboneView;
