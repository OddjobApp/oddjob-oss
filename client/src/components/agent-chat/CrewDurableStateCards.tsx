import React, { useState } from 'react';
import {
  Scale,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Bot,
  User as UserIcon,
  FileCheck,
  CheckSquare,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import {
  CrewCard,
  CrewCardBody,
  CrewCardDisclosure,
  CrewCardFacts,
  CrewCardFooter,
  CrewCardHeader,
  CrewCardStatus,
  type CrewCardTone,
} from './CrewCard';

/** A failed save is said plainly in the footer, never left as a console line. */
const SAVE_FAILED = 'That did not save. Try again.';

// ============================================================================
// 1. DECISION RATIFICATION CARD
// ============================================================================

export interface DecisionRatificationPayload {
  id?: number;
  decisionId?: number;
  sessionId?: number;
  statement: string;
  rationale?: string | null;
  alternatives?: string[];
  evidenceTurnIds?: number[];
  confidence?: number | null;
  status?: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  createdBy?: string | null;
  round?: number;
}

const DECISION_STATUS: Record<string, { label: string; tone: CrewCardTone }> = {
  proposed: { label: 'Proposed', tone: 'default' },
  accepted: { label: 'Ratified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  superseded: { label: 'Superseded', tone: 'default' },
};

export function DecisionRatificationCard({
  payload,
  onArtifactSubmit,
}: {
  payload: DecisionRatificationPayload;
  onArtifactSubmit?: (message: string) => void;
}) {
  const [status, setStatus] = useState<string>(payload.status || 'proposed');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const decisionId = payload.decisionId ?? payload.id;
  const sessionId = payload.sessionId;
  const alternatives = payload.alternatives || [];
  const evidenceTurnIds = payload.evidenceTurnIds || [];
  const meta = DECISION_STATUS[status] ?? DECISION_STATUS.proposed;

  const statementText = payload.statement || (payload as any).title || (payload as any).proposalTitle || '';

  const handleUpdate = async (newStatus: 'accepted' | 'rejected') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFailed(false);
    try {
      if (sessionId && decisionId) {
        await apiRequest('PATCH', `/api/crew/${sessionId}/decisions/${decisionId}`, { status: newStatus });
      }
      setStatus(newStatus);
      if (onArtifactSubmit) {
        onArtifactSubmit(
          newStatus === 'accepted'
            ? `I ratified the decision: "${statementText}"`
            : `I rejected the decision proposal: "${statementText}"`
        );
      }
    } catch (err) {
      console.error('Failed to update decision:', err);
      setFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const provenance = [
    payload.createdBy && `Proposed by ${payload.createdBy}`,
    payload.round != null && `round ${payload.round}`,
  ].filter(Boolean).join(', ');

  return (
    <CrewCard testId="decision-ratification-card">
      <CrewCardHeader
        icon={<Scale />}
        tone={meta.tone}
        title={statementText}
        description={provenance ? `Decision. ${provenance}.` : 'Decision'}
        aside={<CrewCardStatus tone={meta.tone}>{meta.label}</CrewCardStatus>}
      />

      <CrewCardBody>
        {payload.rationale && (
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Why: </span>
            {payload.rationale}
          </p>
        )}

        {(payload.confidence != null || evidenceTurnIds.length > 0) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {payload.confidence != null && (
              <span>
                <span className="font-semibold tabular-nums text-foreground">{payload.confidence}%</span> confident
              </span>
            )}
            {evidenceTurnIds.length > 0 && (
              <span>
                Based on turn{evidenceTurnIds.length === 1 ? '' : 's'}{' '}
                <span className="font-mono text-[11px] text-foreground/80">
                  {evidenceTurnIds.map((tid) => `#${tid}`).join(', ')}
                </span>
              </span>
            )}
          </p>
        )}

        <CrewCardDisclosure
          summary={`${alternatives.length} ${alternatives.length === 1 ? 'alternative' : 'alternatives'} considered`}
          items={alternatives}
        />
      </CrewCardBody>

      <CrewCardFooter
        note={
          failed
            ? SAVE_FAILED
            : status === 'accepted'
              ? 'Ratified. The room now treats this as settled.'
              : status === 'rejected'
                ? 'Rejected. The room will not act on it.'
                : 'Nothing is settled until someone in the room ratifies it.'
        }
      >
        {status === 'proposed' && (
          <>
            <Button size="sm" disabled={isSubmitting} onClick={() => handleUpdate('accepted')} data-testid="decision-ratify-btn">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Ratify
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleUpdate('rejected')}
              data-testid="decision-reject-btn"
            >
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Reject
            </Button>
          </>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}

// ============================================================================
// 2. COMMITMENT CONTRACT CARD
// ============================================================================

export interface CommitmentContractPayload {
  id?: number;
  commitmentId?: number;
  sessionId?: number;
  title: string;
  detail?: string | null;
  ownerType?: 'user' | 'agent' | 'team';
  ownerId?: string | null;
  dueAt?: string | null;
  status?: 'open' | 'in_progress' | 'completed' | 'waived' | 'blocked';
  completionEvidence?: Array<{ label: string; uri?: string }>;
  createdBy?: string | null;
}

const COMMITMENT_STATUS: Record<string, { label: string; tone: CrewCardTone }> = {
  open: { label: 'Open', tone: 'default' },
  in_progress: { label: 'In progress', tone: 'default' },
  completed: { label: 'Done', tone: 'success' },
  waived: { label: 'Waived', tone: 'default' },
  blocked: { label: 'Blocked', tone: 'danger' },
};

export function CommitmentContractCard({
  payload,
  onArtifactSubmit,
}: {
  payload: CommitmentContractPayload;
  onArtifactSubmit?: (message: string) => void;
}) {
  const [status, setStatus] = useState<string>(payload.status || 'open');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const commitmentId = payload.commitmentId ?? payload.id;
  const sessionId = payload.sessionId;
  const meta = COMMITMENT_STATUS[status] ?? COMMITMENT_STATUS.open;
  const evidence = payload.completionEvidence ?? [];

  const titleText = payload.title || (payload as any).statement || '';

  const handleUpdate = async (newStatus: 'in_progress' | 'completed' | 'waived') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFailed(false);
    try {
      if (sessionId && commitmentId) {
        await apiRequest('PATCH', `/api/crew/${sessionId}/commitments/${commitmentId}`, { status: newStatus });
      }
      setStatus(newStatus);
      if (onArtifactSubmit) {
        const verb = newStatus === 'completed' ? 'completed' : newStatus === 'in_progress' ? 'started working on' : 'waived';
        onArtifactSubmit(`I ${verb} the commitment: "${titleText}"`);
      }
    } catch (err) {
      console.error('Failed to update commitment:', err);
      setFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCompleted = status === 'completed';

  return (
    <CrewCard testId="commitment-contract-card">
      <CrewCardHeader
        icon={<CheckSquare />}
        tone={meta.tone}
        title={titleText}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>Commitment</span>
            {payload.ownerId && (
              <span className="inline-flex items-center gap-1">
                {payload.ownerType === 'agent' ? (
                  <Bot className="h-3 w-3 text-primary" aria-hidden />
                ) : (
                  <UserIcon className="h-3 w-3" aria-hidden />
                )}
                <span className="font-medium text-foreground">{payload.ownerId}</span>
              </span>
            )}
            {payload.dueAt && <span>Due {new Date(payload.dueAt).toLocaleString()}</span>}
          </span>
        }
        aside={<CrewCardStatus tone={meta.tone}>{meta.label}</CrewCardStatus>}
      />

      {(payload.detail || evidence.length > 0) && (
        <CrewCardBody>
          {payload.detail && <p className="leading-relaxed text-foreground/90">{payload.detail}</p>}

          {evidence.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-foreground">Evidence it was done</p>
              <ul className="space-y-0.5">
                {evidence.map((ev, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <FileCheck className="h-3 w-3 shrink-0" aria-hidden />
                    {ev.uri ? (
                      <a href={ev.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {ev.label}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : (
                      <span>{ev.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CrewCardBody>
      )}

      <CrewCardFooter
        note={
          failed
            ? SAVE_FAILED
            : isCompleted
              ? 'Done, with its output recorded.'
              : status === 'waived'
                ? 'Waived. Nobody owes this any more.'
                : 'Tracked with the room’s commitments.'
        }
      >
        {!isCompleted && status !== 'waived' && (
          <>
            <Button size="sm" disabled={isSubmitting} onClick={() => handleUpdate('completed')} data-testid="commitment-complete-btn">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Mark done
            </Button>
            {status === 'open' && (
              <Button
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleUpdate('in_progress')}
                data-testid="commitment-start-btn"
              >
                Start
              </Button>
            )}
          </>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}

// ============================================================================
// 3. CLAIM VERIFICATION CARD
// ============================================================================

export interface ClaimVerificationPayload {
  id?: number;
  claimId?: number;
  sessionId?: number;
  claim: string;
  status?: 'unverified' | 'verified' | 'refuted' | 'contested';
  confidence?: number | null;
  agreementLevel?: number | null;
  evidence?: Array<{ label: string; uri?: string; retrievedAt?: string; excerpt?: string }>;
  positions?: Array<{ agentName: string; position: 'agree' | 'disagree' | 'neutral'; rationale?: string }>;
  createdBy?: string | null;
}

const CLAIM_STATUS: Record<string, { label: string; tone: CrewCardTone }> = {
  unverified: { label: 'Unverified', tone: 'default' },
  verified: { label: 'Verified', tone: 'success' },
  refuted: { label: 'Refuted', tone: 'danger' },
  contested: { label: 'Disputed', tone: 'attention' },
};

const STANCE: Record<string, { label: string; className: string }> = {
  agree: { label: 'agrees', className: 'text-emerald-700 dark:text-emerald-300' },
  disagree: { label: 'disagrees', className: 'text-red-700 dark:text-red-300' },
  neutral: { label: 'neutral', className: 'text-muted-foreground' },
};

export function ClaimVerificationCard({
  payload,
  onArtifactSubmit,
}: {
  payload: ClaimVerificationPayload;
  onArtifactSubmit?: (message: string) => void;
}) {
  const [status, setStatus] = useState<string>(payload.status || 'unverified');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const claimId = payload.claimId ?? payload.id;
  const sessionId = payload.sessionId;
  const positions = payload.positions || [];
  const evidence = payload.evidence || [];
  const meta = CLAIM_STATUS[status] ?? CLAIM_STATUS.unverified;

  const claimText = payload.claim || (payload as any).statement || '';

  const handleUpdate = async (newStatus: 'verified' | 'refuted' | 'contested') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFailed(false);
    try {
      if (sessionId && claimId) {
        await apiRequest('PATCH', `/api/crew/${sessionId}/claims/${claimId}`, { status: newStatus });
      }
      setStatus(newStatus);
      if (onArtifactSubmit) {
        onArtifactSubmit(`I marked the claim as ${newStatus}: "${claimText}"`);
      }
    } catch (err) {
      console.error('Failed to update claim:', err);
      setFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const agreement = payload.agreementLevel;
  const facts = [
    payload.confidence != null && { label: 'Confidence', value: `${payload.confidence}%` },
    agreement != null && {
      label: 'Room agreement',
      value: `${agreement}%`,
      tone: (agreement > 70 ? 'success' : agreement > 40 ? 'attention' : 'danger') as CrewCardTone,
    },
  ].filter(Boolean) as Array<{ label: string; value: string; tone?: CrewCardTone }>;

  return (
    <CrewCard testId="claim-verification-card">
      <CrewCardHeader
        icon={<ShieldAlert />}
        tone={meta.tone}
        title={claimText}
        description={payload.createdBy ? `Claim made by ${payload.createdBy}` : 'Claim'}
        aside={<CrewCardStatus tone={meta.tone}>{meta.label}</CrewCardStatus>}
      />

      <CrewCardBody>
        <CrewCardFacts facts={facts} />

        {positions.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Where each agent stands">
            {positions.map((pos, idx) => {
              const stance = STANCE[pos.position] ?? STANCE.neutral;
              return (
                <li
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[11px]"
                  title={pos.rationale || undefined}
                >
                  <Bot className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <span className="font-medium text-foreground">@{pos.agentName}</span>
                  <span className={stance.className}>{stance.label}</span>
                </li>
              );
            })}
          </ul>
        )}

        {evidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Sources</p>
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {evidence.map((ev, idx) => (
                <li key={idx} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground/90">{ev.label}</span>
                    {ev.uri && (
                      <a href={ev.uri} target="_blank" rel="noreferrer" className="shrink-0 text-primary hover:underline">
                        View source
                      </a>
                    )}
                  </div>
                  {ev.excerpt && <p className="mt-0.5 line-clamp-2 text-muted-foreground">“{ev.excerpt}”</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CrewCardBody>

      <CrewCardFooter
        note={
          failed
            ? SAVE_FAILED
            : status === 'unverified'
              ? 'Check the sources, then say whether it holds.'
              : `Marked ${meta.label.toLowerCase()}.`
        }
      >
        {status === 'unverified' && (
          <>
            <Button size="sm" disabled={isSubmitting} onClick={() => handleUpdate('verified')} data-testid="claim-support-btn">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Verify
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleUpdate('contested')}
              data-testid="claim-dispute-btn"
            >
              Dispute
            </Button>
          </>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}

// ============================================================================
// 4. GOVERNANCE BLAST RADIUS CARD
// ============================================================================

export interface GovernanceBlastRadiusPayload {
  checkpointId?: string;
  actionTitle: string;
  actionKey?: string;
  riskTier: 'low' | 'medium' | 'high' | 'critical';
  requestedBy: string;
  blastRadius?: {
    affectedServices?: string[];
    dataDestructionRisk?: boolean;
    estimatedCostUsd?: number;
    tenantsImpactedCount?: number;
    summary?: string;
  };
  requiresDualSignOff?: boolean;
  status?: 'pending' | 'approved' | 'rejected';
}

const RISK_TONE: Record<GovernanceBlastRadiusPayload['riskTier'], CrewCardTone> = {
  low: 'default',
  medium: 'default',
  high: 'attention',
  critical: 'danger',
};

export function GovernanceBlastRadiusCard({
  payload,
  onArtifactSubmit,
}: {
  payload: GovernanceBlastRadiusPayload;
  onArtifactSubmit?: (message: string) => void;
}) {
  const [status, setStatus] = useState<string>(payload.status || 'pending');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const blastRadius = payload.blastRadius || {};
  const riskTone = RISK_TONE[payload.riskTier] ?? 'default';
  const tone: CrewCardTone = status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : riskTone;
  const risk = payload.riskTier.charAt(0).toUpperCase() + payload.riskTier.slice(1);

  const handleAction = async (decision: 'approved' | 'rejected') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      setStatus(decision);
      if (onArtifactSubmit) {
        onArtifactSubmit(
          decision === 'approved'
            ? `I authorized high-risk execution for "${payload.actionTitle}" (${payload.riskTier} risk tier)`
            : `I blocked and rejected execution for "${payload.actionTitle}" (${payload.riskTier} risk tier)`
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Unknown is shown as unknown. A missing count is not "1".
  const facts = [
    {
      label: 'Deletes data',
      value: blastRadius.dataDestructionRisk == null ? '—' : blastRadius.dataDestructionRisk ? 'Yes' : 'No',
      tone: blastRadius.dataDestructionRisk ? ('danger' as const) : undefined,
    },
    { label: 'Estimated cost', value: blastRadius.estimatedCostUsd != null ? `$${blastRadius.estimatedCostUsd}` : '—' },
    { label: 'Tenants affected', value: blastRadius.tenantsImpactedCount ?? '—' },
    { label: 'Services', value: blastRadius.affectedServices?.length ?? '—' },
  ];

  return (
    <CrewCard testId="governance-blast-radius-card">
      <CrewCardHeader
        icon={<ShieldCheck />}
        tone={tone}
        title={payload.actionTitle}
        description={`Needs sign-off before it runs. Requested by ${payload.requestedBy}.`}
        aside={
          <div className="flex flex-col items-end gap-1">
            <CrewCardStatus tone={riskTone}>{risk} risk</CrewCardStatus>
            {payload.requiresDualSignOff && <CrewCardStatus tone="attention">Needs two sign-offs</CrewCardStatus>}
          </div>
        }
      />

      <CrewCardBody>
        {blastRadius.summary && <p className="leading-relaxed text-foreground/90">{blastRadius.summary}</p>}
        <CrewCardFacts facts={facts} />
        {blastRadius.affectedServices && blastRadius.affectedServices.length > 0 && (
          <p className="text-muted-foreground">
            Touches{' '}
            {blastRadius.affectedServices.map((service, index) => (
              <React.Fragment key={service}>
                {index > 0 && ', '}
                <code className="font-mono text-[11px] text-foreground/80">{service}</code>
              </React.Fragment>
            ))}
          </p>
        )}
      </CrewCardBody>

      <CrewCardFooter
        className={cn(status === 'pending' && payload.riskTier === 'critical' && 'bg-red-500/5')}
        note={
          status === 'approved'
            ? 'You authorized it. Your decision was posted to the room.'
            : status === 'rejected'
              ? 'You blocked it. Your decision was posted to the room.'
              : 'It does not run until someone authorizes it.'
        }
      >
        {status === 'pending' && (
          <>
            <Button size="sm" disabled={isSubmitting} onClick={() => handleAction('approved')} data-testid="governance-authorize-btn">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Authorize
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleAction('rejected')}
              data-testid="governance-block-btn"
            >
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Block
            </Button>
          </>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}
