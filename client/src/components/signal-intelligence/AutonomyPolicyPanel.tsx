/**
 * AutonomyPolicyPanel — Displays all active autonomous action policies,
 * pending approval requests with approve/reject actions, and regional
 * volatility indicators per jurisdiction.
 *
 * Requirements:
 * - 18.10: Display active policies with approval_gate status; highlight volatility-tightened policies
 * - 18.11: Display pending approvals with event details, proposed action, affected entities,
 *          elapsed time, and approve/reject buttons
 * - 18.12: Display regional volatility indicator per jurisdiction (7-day frequency + avg severity)
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Shield,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutonomyPolicyPanelProps {
  organizationId: number;
}

interface TriggerCondition {
  minSeverity: string;
  sectorFilter?: string[];
  jurisdictionFilter?: string[];
}

interface PolicyRecord {
  id: number;
  organizationId: number;
  name: string;
  triggerCondition: TriggerCondition;
  actionType: string;
  approvalGate: string;
  effectiveApprovalGate: string;
  volatilityOverride: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PendingApproval {
  id: number;
  organizationId: number;
  eventPrimitiveId: string;
  policyId: number;
  actionType: string;
  approvalStatus: string;
  executedAt: string | null;
  outcome: string | null;
  failureReason: string | null;
  createdAt: string;
  // Joined event details
  event?: {
    eventType: string;
    severity: string;
    jurisdiction: string;
    targetSector: string;
    confidenceScore: number;
  };
  // Computed fields
  affectedEntitiesCount?: number;
}

interface VolatilityMetrics {
  jurisdiction: string;
  eventCount7d: number;
  avgSeverity7d: number;
  threshold: number;
  exceeds: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

const APPROVAL_24H_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function postAction(path: string, body?: Record<string, unknown>): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Action failed: ${path}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getTimeRemaining(createdAt: string): { label: string; urgent: boolean } {
  const created = new Date(createdAt).getTime();
  const deadline = created + APPROVAL_24H_MS;
  const remaining = deadline - Date.now();

  if (remaining <= 0) return { label: 'Expired', urgent: true };

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 6) return { label: `${hours}h remaining`, urgent: false };
  if (hours > 0) return { label: `${hours}h ${minutes}m remaining`, urgent: true };
  return { label: `${minutes}m remaining`, urgent: true };
}

function getVolatilityLevel(metrics: VolatilityMetrics): 'green' | 'yellow' | 'red' {
  if (metrics.exceeds) return 'red';
  // Near threshold (80%+)
  const ratio = (metrics.eventCount7d * metrics.avgSeverity7d) / metrics.threshold;
  if (ratio >= 0.8) return 'yellow';
  return 'green';
}

const VOLATILITY_COLORS = {
  green: { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-300', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-300', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' },
  red: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AutonomyPolicyPanel({ organizationId }: AutonomyPolicyPanelProps) {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // --- Fetch policies ---
  const policiesQuery = useQuery<PolicyRecord[]>({
    queryKey: ['/api/autonomous-actions/policies', organizationId],
    queryFn: () => fetchJson('/api/autonomous-actions/policies'),
    refetchInterval: 30000,
  });

  // --- Fetch pending approvals (autonomous_action_logs with approvalStatus=pending) ---
  const pendingQuery = useQuery<PendingApproval[]>({
    queryKey: ['/api/autonomous-actions/pending', organizationId],
    queryFn: () => fetchJson('/api/autonomous-actions/policies?status=pending'),
    refetchInterval: 10000,
  });

  // --- Fetch event primitives for volatility computation ---
  const eventsQuery = useQuery<Array<{ jurisdiction: string; severity: string; createdAt: string }>>({
    queryKey: ['/api/event-primitives', 'volatility', organizationId],
    queryFn: () => {
      const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return fetchJson(`/api/event-primitives?startTime=${startTime}&limit=1000`);
    },
    refetchInterval: 60000,
  });

  // --- Approve mutation ---
  const approveMutation = useMutation({
    mutationFn: (id: number) => postAction(`/api/autonomous-actions/approve/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous-actions/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous-actions/policies'] });
    },
  });

  // --- Reject mutation ---
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      postAction(`/api/autonomous-actions/reject/${id}`, reason ? { reason } : undefined),
    onSuccess: () => {
      setRejectingId(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous-actions/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous-actions/policies'] });
    },
  });

  // --- Compute regional volatility from event primitives ---
  const volatilityMetrics = useMemo((): VolatilityMetrics[] => {
    const events = eventsQuery.data || [];
    if (events.length === 0) return [];

    // Group events by jurisdiction
    const byJurisdiction = new Map<string, { count: number; totalWeight: number }>();

    for (const event of events) {
      const existing = byJurisdiction.get(event.jurisdiction) || { count: 0, totalWeight: 0 };
      existing.count += 1;
      existing.totalWeight += SEVERITY_WEIGHTS[event.severity] || 1;
      byJurisdiction.set(event.jurisdiction, existing);
    }

    // Convert to metrics. Threshold is configurable per org; using a default here.
    const DEFAULT_THRESHOLD = 20; // freq × avg severity threshold
    return Array.from(byJurisdiction.entries())
      .map(([jurisdiction, { count, totalWeight }]) => {
        const avgSeverity = count > 0 ? totalWeight / count : 0;
        const compositeScore = count * avgSeverity;
        return {
          jurisdiction,
          eventCount7d: count,
          avgSeverity7d: Math.round(avgSeverity * 100) / 100,
          threshold: DEFAULT_THRESHOLD,
          exceeds: compositeScore >= DEFAULT_THRESHOLD,
        };
      })
      .sort((a, b) => {
        // Sort exceeded first, then by composite score desc
        if (a.exceeds !== b.exceeds) return a.exceeds ? -1 : 1;
        return (b.eventCount7d * b.avgSeverity7d) - (a.eventCount7d * a.avgSeverity7d);
      });
  }, [eventsQuery.data]);

  // --- Categorize policies ---
  const { activePolicies, volatilityTightenedPolicies } = useMemo(() => {
    const policies = policiesQuery.data || [];
    const active = policies.filter((p) => p.enabled);
    const tightened = active.filter((p) => p.volatilityOverride);
    return { activePolicies: active, volatilityTightenedPolicies: tightened };
  }, [policiesQuery.data]);

  const pendingApprovals = pendingQuery.data || [];

  // --- Reject handler ---
  const handleReject = useCallback((id: number) => {
    if (rejectingId === id) {
      // Submit the rejection
      rejectMutation.mutate({ id, reason: rejectReason || undefined });
    } else {
      setRejectingId(id);
      setRejectReason('');
    }
  }, [rejectingId, rejectReason, rejectMutation]);

  const cancelReject = useCallback(() => {
    setRejectingId(null);
    setRejectReason('');
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col rounded-lg border bg-card"
      data-testid="autonomy-policy-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Autonomy Policy Escalation</h3>
        </div>
        {pendingApprovals.length > 0 && (
          <Badge variant="warning" className="text-[10px]">
            {pendingApprovals.length} pending
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="policies" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="policies" className="text-xs">
            Policies ({activePolicies.length})
          </TabsTrigger>
          <TabsTrigger value="approvals" className="text-xs">
            Pending Approvals ({pendingApprovals.length})
          </TabsTrigger>
          <TabsTrigger value="volatility" className="text-xs">
            Volatility ({volatilityMetrics.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── Policies Tab ─── */}
        <TabsContent value="policies" className="flex-1 overflow-y-auto px-4 pb-4">
          {policiesQuery.isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Activity className="h-4 w-4 mr-2 animate-spin" />
              Loading policies...
            </div>
          )}
          {!policiesQuery.isLoading && activePolicies.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              No active policies configured.
            </div>
          )}
          {!policiesQuery.isLoading && activePolicies.length > 0 && (
            <div className="space-y-2 mt-2">
              {activePolicies.map((policy) => (
                <PolicyCard key={policy.id} policy={policy} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Pending Approvals Tab ─── */}
        <TabsContent value="approvals" className="flex-1 overflow-y-auto px-4 pb-4">
          {pendingQuery.isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Activity className="h-4 w-4 mr-2 animate-spin" />
              Loading pending approvals...
            </div>
          )}
          {!pendingQuery.isLoading && pendingApprovals.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              No pending approval requests.
            </div>
          )}
          {!pendingQuery.isLoading && pendingApprovals.length > 0 && (
            <div className="space-y-3 mt-2">
              {pendingApprovals.map((approval) => (
                <PendingApprovalCard
                  key={approval.id}
                  approval={approval}
                  isRejecting={rejectingId === approval.id}
                  rejectReason={rejectingId === approval.id ? rejectReason : ''}
                  onRejectReasonChange={setRejectReason}
                  onApprove={() => approveMutation.mutate(approval.id)}
                  onReject={() => handleReject(approval.id)}
                  onCancelReject={cancelReject}
                  isApproving={approveMutation.isPending}
                  isSubmittingReject={rejectMutation.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Volatility Tab ─── */}
        <TabsContent value="volatility" className="flex-1 overflow-y-auto px-4 pb-4">
          {eventsQuery.isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Activity className="h-4 w-4 mr-2 animate-spin" />
              Computing volatility...
            </div>
          )}
          {!eventsQuery.isLoading && volatilityMetrics.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              No active jurisdictions in the last 7 days.
            </div>
          )}
          {!eventsQuery.isLoading && volatilityMetrics.length > 0 && (
            <div className="space-y-2 mt-2">
              {volatilityMetrics.map((metric) => (
                <VolatilityCard key={metric.jurisdiction} metric={metric} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PolicyCard sub-component
// ---------------------------------------------------------------------------

function PolicyCard({ policy }: { policy: PolicyRecord }) {
  const trigger = policy.triggerCondition;
  const isTightened = policy.volatilityOverride;
  const gateChanged = policy.approvalGate !== policy.effectiveApprovalGate;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        isTightened
          ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20'
          : 'border-border'
      )}
      data-testid="policy-card"
      data-policy-id={policy.id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium truncate">{policy.name}</span>
            {isTightened && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0 flex items-center gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                Volatility Tightened
              </Badge>
            )}
          </div>

          {/* Action Type */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1.5">
            <span className="font-mono">
              {policy.actionType.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Approval Gate status */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Gate:</span>
            <Badge
              variant={policy.effectiveApprovalGate === 'auto_approve' ? 'success' : 'info'}
              className="text-[10px] px-1.5 py-0"
            >
              {policy.effectiveApprovalGate === 'auto_approve' ? 'Auto Approve' : 'Human Approval'}
            </Badge>
            {gateChanged && (
              <span className="text-[10px] text-muted-foreground line-through">
                {policy.approvalGate === 'auto_approve' ? 'Auto' : 'Human'}
              </span>
            )}
          </div>

          {/* Trigger condition details */}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">
              Min: {trigger.minSeverity}
            </span>
            {trigger.sectorFilter && trigger.sectorFilter.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                Sectors: {trigger.sectorFilter.join(', ')}
              </span>
            )}
            {trigger.jurisdictionFilter && trigger.jurisdictionFilter.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                Jurisdictions: {trigger.jurisdictionFilter.join(', ')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PendingApprovalCard sub-component
// ---------------------------------------------------------------------------

interface PendingApprovalCardProps {
  approval: PendingApproval;
  isRejecting: boolean;
  rejectReason: string;
  onRejectReasonChange: (reason: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onCancelReject: () => void;
  isApproving: boolean;
  isSubmittingReject: boolean;
}

function PendingApprovalCard({
  approval,
  isRejecting,
  rejectReason,
  onRejectReasonChange,
  onApprove,
  onReject,
  onCancelReject,
  isApproving,
  isSubmittingReject,
}: PendingApprovalCardProps) {
  const timeRemaining = getTimeRemaining(approval.createdAt);
  const event = approval.event;

  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      data-testid="pending-approval-card"
      data-approval-id={approval.id}
    >
      {/* Event details */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {event && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {event.eventType.replace(/_/g, ' ')}
                </span>
                <Badge
                  variant={
                    event.severity === 'Critical' ? 'critical' :
                    event.severity === 'High' ? 'warning' : 'info'
                  }
                  className="text-[10px] px-1.5 py-0"
                >
                  {event.severity}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>🌐 {event.jurisdiction}</span>
                <span>📊 {event.targetSector}</span>
                <span>🎯 {Math.round(event.confidenceScore * 100)}%</span>
              </div>
            </div>
          )}
          {!event && (
            <span className="text-sm text-muted-foreground">
              Event ID: {approval.eventPrimitiveId?.slice(0, 8)}...
            </span>
          )}
        </div>

        {/* Time remaining */}
        <div className={cn(
          'flex items-center gap-1 text-xs whitespace-nowrap',
          timeRemaining.urgent ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
        )}>
          <Clock className="h-3 w-3" />
          {timeRemaining.label}
        </div>
      </div>

      {/* Proposed action */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Proposed action:</span>
        <span className="font-medium font-mono">
          {approval.actionType.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Affected entities count */}
      {approval.affectedEntitiesCount !== undefined && approval.affectedEntitiesCount > 0 && (
        <div className="text-xs text-muted-foreground">
          💥 {approval.affectedEntitiesCount} entities affected
        </div>
      )}

      {/* Created time */}
      <div className="text-[10px] text-muted-foreground">
        Created {formatRelativeTime(approval.createdAt)}
      </div>

      {/* Reject reason input */}
      {isRejecting && (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="Rejection reason (optional)"
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground"
            data-testid="reject-reason-input"
            autoFocus
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          onClick={onApprove}
          disabled={isApproving || isRejecting}
          className="h-7 text-xs px-3"
          data-testid="approve-button"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onReject}
          disabled={isSubmittingReject}
          className="h-7 text-xs px-3"
          data-testid="reject-button"
        >
          <XCircle className="h-3 w-3 mr-1" />
          {isRejecting ? 'Confirm Reject' : 'Reject'}
        </Button>
        {isRejecting && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancelReject}
            className="h-7 text-xs px-3"
            data-testid="cancel-reject-button"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VolatilityCard sub-component
// ---------------------------------------------------------------------------

function VolatilityCard({ metric }: { metric: VolatilityMetrics }) {
  const level = getVolatilityLevel(metric);
  const colors = VOLATILITY_COLORS[level];

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        colors.border,
        colors.bg
      )}
      data-testid="volatility-card"
      data-jurisdiction={metric.jurisdiction}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', colors.dot)} />
          <span className={cn('text-sm font-medium', colors.text)}>
            {metric.jurisdiction}
          </span>
          {metric.exceeds && (
            <Badge variant="critical" className="text-[10px] px-1.5 py-0">
              Threshold Exceeded
            </Badge>
          )}
        </div>
        <TrendingUp className={cn('h-4 w-4', colors.text)} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground block">7d Events</span>
          <span className={cn('font-semibold', colors.text)}>
            {metric.eventCount7d}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block">Avg Severity</span>
          <span className={cn('font-semibold', colors.text)}>
            {metric.avgSeverity7d}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block">Threshold</span>
          <span className="font-semibold text-muted-foreground">
            {metric.threshold}
          </span>
        </div>
      </div>
    </div>
  );
}

export default AutonomyPolicyPanel;
