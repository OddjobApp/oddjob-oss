import { EmailSenderPicker, type EmailSenderChoice } from "./approvals/EmailSenderPicker";
import React, { useEffect, useState } from 'react';
import { Gavel, ShieldCheck, X, Mail, Hash, Send, Calendar, CalendarCheck, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardStatus, type CrewCardTone } from './CrewCard';
import { apiRequest } from '@/lib/queryClient';
import { AppForgeThemePicker, type AppForgeThemeChoice } from './AppForgeThemePicker';
import { AssemblyOutcomeCard, type AssemblyOutcome } from './AssemblyOutcomeCard';
import { formatApprovalValue } from '@shared/approval-args';
import { type ImageClick } from '@/lib/image-click-coordinates';
import { QuickBooksProposalDetails, quickBooksActionCopy } from './QuickBooksProposalDetails';
import {
  CalendarApprovalView,
  AmazonApprovalView,
  FlightHubApprovalView,
  PipelineRunApprovalView,
  CaptchaChallengeView,
  OutboundMessagePreview,
  AppActionApprovalView,
} from './approvals';

export { AssemblyOutcomeCard, type AssemblyOutcome };

export function InlineApprovalCard({
  payload,
  onArtifactSubmit,
  currentUserId = null,
}: {
  payload: Record<string, any>;
  onArtifactSubmit: (message: string) => void;
  /** The viewer, so a request routed to someone else's approval does not offer them Approve. */
  currentUserId?: string | null;
}) {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected'>(
    payload.status === 'approved' || payload.status === 'rejected' ? payload.status : 'pending',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarOutcome, setCalendarOutcome] = useState<Record<string, any> | null>(null);
  /** Real scaffold result from the decision response; null until one comes back. */
  const [assembly, setAssembly] = useState<AssemblyOutcome | null>(null);
  const [captchaSolution, setCaptchaSolution] = useState<string>('');
  const [clickCoordinates, setClickCoordinates] = useState<ImageClick | null>(null);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [themeChoice, setThemeChoice] = useState<AppForgeThemeChoice>({
    designStyleId: payload.designStyleId,
    aiEmbellishment: payload.aiEmbellishment,
  });

  const proposalId = payload.proposalId || payload.id;
  const context = (payload.context && typeof payload.context === 'object' ? payload.context : {}) as Record<string, any>;
  const isCaptcha = payload.type === 'captcha_solution' || context.type === 'captcha_solution' || payload.kind === 'captcha_solution';
  const isSecurityChallenge =
    isCaptcha ||
    payload.type === 'security_challenge' ||
    context.type === 'security_challenge' ||
    payload.type === '2fa' ||
    context.type === '2fa' ||
    payload.type === 'mfa' ||
    context.type === 'mfa' ||
    payload.type === 'two_factor_auth' ||
    context.type === 'two_factor_auth' ||
    payload.type === 'verification_code' ||
    context.type === 'verification_code' ||
    payload.kind === 'security_challenge';
  const isOtpChallenge =
    payload.type === '2fa' ||
    context.type === '2fa' ||
    payload.type === 'mfa' ||
    context.type === 'mfa' ||
    payload.type === 'two_factor_auth' ||
    context.type === 'two_factor_auth' ||
    payload.type === 'verification_code' ||
    context.type === 'verification_code';

  /** Result of an approved outbound send, from the decision response or the
   * persisted row's sendResult after a reload. */
  const [outboundOutcome, setOutboundOutcome] = useState<{ sent?: boolean; discarded?: boolean; outcomeUnknown?: boolean; error?: string } | null>(null);
  /** A proposed pipeline run: running, then succeeded or failed (pipeline-run-proposals.ts). */
  const [pipelineRunOutcome, setPipelineRunOutcome] = useState<{ state?: string; status?: string; executionId?: number | null; error?: string } | null>(null);
  /** App record action execution result */
  const [appActionOutcome, setAppActionOutcome] = useState<any>(payload.outcome ?? null);
  /** Edit & approve: the reviewer's draft changes. Only body/subject are sent —
   * recipients and channel are locked to the stored proposal server-side. */
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [editedSubject, setEditedSubject] = useState<string | null>(null);
  /** Draft fields as persisted on the approval row (post-edit), when fetched. */
  const [serverDraft, setServerDraft] = useState<{ body?: string | null; subject?: string | null; emailAccount?: EmailSenderChoice } | null>(null);

  const captchaScreenshot = context.screenshot || payload.screenshot;
  const kind = payload.kind || (isCaptcha ? 'captcha_solution' : (payload.type === 'mission_proposal' ? 'mission_proposal' : 'approval_request'));
  const isAppAction = kind === 'app_record_action' || payload.kind === 'app_record_action';
  // A void, refund or outgoing payment is routed to the project's Executives
  // (shared/finance-roles.ts); the person who asked for it cannot approve it.
  const awaitingExecutive = kind === 'quickbooks_action' && payload.needsExecutiveApproval === true;
  const isOwnExecutiveRequest = awaitingExecutive && currentUserId != null && String(payload.proposedBy ?? '') === String(currentUserId);
  const isOutboundMessage = kind === 'outbound_message';
  const isAuthoredEmail = isOutboundMessage && payload.channel !== 'slack' && !['send_agentmail', 'reply_agentmail'].includes(payload.sendTool ?? '');
  const [emailAccount, setEmailAccount] = useState<EmailSenderChoice | null>(null);
  const outboundChannel = payload.channel === 'slack' ? 'slack' : 'email';
  const sensitivityLabels: Record<string, string> = {
    routine: 'Routine',
    requested_review: 'Requested review',
    external_first_contact: 'First contact',
    customer_facing: 'Customer-facing',
    commitment_or_legal: 'Commitment / legal',
    broad_audience: 'Broad audience',
  };
  const outboundSensitivity = typeof payload.sensitivity === 'string' ? payload.sensitivity : null;
  const title = payload.title || (isSecurityChallenge ? (isOtpChallenge ? 'Two-Factor Authentication / Security Code' : 'Solve CAPTCHA / Security Challenge') : (payload.missionName ? `Launch Mission: ${payload.missionName}` : 'Approval Request'));
  const reason = payload.reason || payload.description || (isSecurityChallenge ? (context.goal ? `Agent was working on: "${context.goal}". Please solve the security verification to resume.` : 'Verification challenge detected during automation.') : '');
  const requestedBy = payload.requestedBy || 'assistant';

  // The turn artifact is a snapshot — if the card was approved in the Decision
  // Inbox or the room was reloaded after a decision, the frozen payload would
  // still read "Ready to send" with live buttons. Fetch the persisted row once
  // so the card reflects what actually happened.
  const persistedProposalId =
    typeof proposalId === 'number' && proposalId > 0 && proposalId <= 1000000000000
      ? proposalId
      : null;
  // The room's organization, which can differ from the viewer's current one now that
  // rooms are listed across every org they belong to.
  const approvalOrgId = Number.isInteger(payload.workflow?.organizationId) ? payload.workflow.organizationId
    : Number.isInteger(payload.organizationId) ? payload.organizationId : null;
  const approvalUrl = (suffix = '') => `/api/approvals/${persistedProposalId ?? proposalId}${suffix}${approvalOrgId != null ? `?organizationId=${approvalOrgId}` : ''}`;

  useEffect(() => {
    if ((!isOutboundMessage && !['calendar_action', 'google_workspace_action', 'amazon_purchase', 'flighthub_booking', 'quickbooks_action', 'pipeline_run'].includes(kind)) || persistedProposalId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('GET', approvalUrl());
        const detail = await res.json().catch(() => null);
        if (!detail || cancelled) return;
        if (detail.status === 'approved' || detail.status === 'rejected') {
          setDecision(detail.status);
        }
        const stored = (detail.modifiedOutput ?? detail.toolArgs) as Record<string, any> | null;
        if (stored && ['calendar_action', 'google_workspace_action', 'amazon_purchase', 'flighthub_booking', 'quickbooks_action'].includes(stored.kind) && stored.outcome) setCalendarOutcome(stored.outcome);
        if ((stored?.kind === 'calendar_action' || stored?.kind === 'google_workspace_action') && stored.outcome?.success === false && stored.outcome.error) setError('Google change failed: ' + stored.outcome.error);
        const sendResult = stored?.sendResult;
        if (sendResult) {
          setOutboundOutcome({
            sent: sendResult.sent,
            discarded: sendResult.discarded,
            error: sendResult.error ?? undefined,
          });
        }
        if (stored?.kind === 'pipeline_run' && stored.outcome) setPipelineRunOutcome(stored.outcome);
        if (stored?.kind === 'outbound_message') {
          setServerDraft({ body: stored.body, subject: stored.subject, emailAccount: stored.emailAccount });
        }
      } catch {
        // The artifact's frozen state is better than an error banner here.
      }
    })();
    return () => { cancelled = true; };
  }, [isOutboundMessage, kind, persistedProposalId, approvalOrgId]);

  const displayBody = serverDraft?.body ?? payload.body ?? '';
  const displaySubject = serverDraft?.subject ?? payload.subject ?? '';
  const draftEdited =
    (editedBody != null && editedBody !== displayBody) ||
    (editedSubject != null && editedSubject !== displaySubject);

  const handleDecision = async (dec: 'approved' | 'rejected') => {
    if (!proposalId) {
      setDecision(dec);
      onArtifactSubmit(`I ${dec} the proposal: "${title}".`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      if (typeof proposalId === 'number' && proposalId > 1000000000000) {
        setError('This proposal was never persisted, so it cannot be approved. Ask the room to raise it again.');
        return;
      }

      let modifiedOutput: Record<string, any> | undefined = undefined;
      if ((isCaptcha || isSecurityChallenge) && dec === 'approved') {
        const solutionText = captchaSolution.trim();
        if (!solutionText && !clickCoordinates) {
          setError(
            isOtpChallenge
              ? 'Please enter the verification code before approving.'
              : 'Please enter the challenge solution text or click a target location on the image before approving.'
          );
          setIsSubmitting(false);
          return;
        }
        modifiedOutput = {
          solution: solutionText,
          ...(clickCoordinates ? { coordinates: { x: clickCoordinates.x, y: clickCoordinates.y } } : {}),
        };
      } else if (kind === 'assembly_deployment' && dec === 'approved') {
        modifiedOutput = {
          ...payload,
          designStyleId: themeChoice.designStyleId,
          aiEmbellishment: themeChoice.aiEmbellishment,
        };
      } else if (isOutboundMessage && dec === 'approved' && (draftEdited || isAuthoredEmail)) {
        if (isAuthoredEmail && !emailAccount) { setError('Choose and confirm a connected sender before sending.'); setIsSubmitting(false); return; }
        modifiedOutput = {
          ...(isAuthoredEmail ? { emailAccount } : {}),
          ...(editedBody != null && editedBody !== displayBody ? { body: editedBody } : {}),
          ...(editedSubject != null && editedSubject !== displaySubject ? { subject: editedSubject } : {}),
        };
      }
      const res = await apiRequest('POST', approvalUrl('/decision'), { decision: dec, modifiedOutput });
      const body = await res.json().catch(() => null);
      setDecision(dec);
      const googleOutcome = body?.googleWorkspaceAction ?? body?.calendarAction;
      if (googleOutcome) setCalendarOutcome(googleOutcome);
      if (googleOutcome?.success === false && googleOutcome.error) setError((payload.kind === 'quickbooks_action' ? quickBooksActionCopy(payload.actionName).failed : payload.kind === 'amazon_purchase' ? 'Amazon handoff failed: ' : 'Google change failed: ') + googleOutcome.error);

      if (body?.pipelineRun) setPipelineRunOutcome(body.pipelineRun);
      if (isOutboundMessage && body?.outboundMessage) {
        setOutboundOutcome(body.outboundMessage);
      }
      if (body?.appRecordAction) {
        setAppActionOutcome(body.appRecordAction);
        if (body.appRecordAction.success === false && body.appRecordAction.error) {
          setError(`App action failed: ${body.appRecordAction.error}`);
        }
      }

      if (dec === 'approved') {
        const outcome: AssemblyOutcome | null = body?.assembly ?? null;
        if (outcome) setAssembly(outcome);

        if (outcome && !outcome.success) {
          onArtifactSubmit(
            `I approved proposal #${proposalId} ("${title}"), but the scaffold failed: ${outcome.error ?? 'unknown error'}.`,
          );
        } else if (payload.kind === 'quickbooks_action') {
          const copy = quickBooksActionCopy(payload.actionName);
          onArtifactSubmit(googleOutcome?.success
            ? copy.done(googleOutcome.result)
            : copy.failed + (googleOutcome?.error ?? 'No result received.'));
        } else if (payload.kind === 'flighthub_booking') {
          onArtifactSubmit(googleOutcome?.success ? 'FlightHub handoff is ready. Open FlightHub to review and book manually; nothing has been purchased.' : `FlightHub handoff failed: ${googleOutcome?.error ?? 'No execution result received.'}`);
        } else if (payload.kind === 'amazon_purchase') {
          onArtifactSubmit(googleOutcome?.success ? `Amazon cart handoff prepared for ${title}. Nothing has been ordered; a human completes checkout.` : `Amazon cart handoff failed: ${googleOutcome?.error ?? 'No execution result received.'}`);
        } else if (payload.kind === 'google_workspace_action') {
          onArtifactSubmit(body?.googleWorkspaceAction?.success ? 'Google Workspace change applied: ' + title + '. Result: ' + formatApprovalValue(body.googleWorkspaceAction.result) : 'Google Workspace change failed: ' + (body?.googleWorkspaceAction?.error ?? 'No execution result received.'));
        } else if (payload.kind === 'pipeline_run') {
          onArtifactSubmit(body?.pipelineRun?.success
            ? `I approved running the pipeline "${payload.pipelineName}". It has started; its result will be in the recent executions.`
            : `I approved running the pipeline "${payload.pipelineName}", but it did not start: ${body?.pipelineRun?.error ?? 'no result received.'}`);
        } else if (payload.kind === 'calendar_action') {
          // Persisted outcome renders below.
        } else if (isAppAction) {
          const actionResult = body?.appRecordAction;
          onArtifactSubmit(
            actionResult?.success
              ? `I approved the app action (${payload.action ? String(payload.action).replace(/_/g, ' ') : 'mutation'}) in "${payload.collection}" of ${payload.app?.name ?? 'App'}.`
              : `I approved the app action, but it failed: ${actionResult?.error ?? 'No result received.'}`,
          );
        } else if (isOutboundMessage) {
          const sendFailed = body?.outboundMessage && body.outboundMessage.sent === false;
          onArtifactSubmit(
            sendFailed
              ? `I approved sending the ${outboundChannel} message to ${(payload.to ?? []).join(', ')}, but delivery failed: ${body.outboundMessage.error ?? 'unknown error'}.`
              : `I sent the ${outboundChannel} message to ${(payload.to ?? []).join(', ')}.`,
          );
        } else if (outcome) {
          onArtifactSubmit(
            `I approved proposal #${proposalId} ("${title}"). Scaffolded ${outcome.appName} from ${outcome.executedPacks.join(', ')}.`,
          );
        } else {
          onArtifactSubmit(`I approved proposal #${proposalId} ("${title}").`);
        }
      } else {
        onArtifactSubmit(
          isOutboundMessage
            ? `I discarded the ${outboundChannel} message draft to ${(payload.to ?? []).join(', ')}.`
            : `I rejected proposal #${proposalId} ("${title}").`,
        );
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('403')
          ? 'You are not the designated approver for this request.'
          : `Could not record the decision: ${msg}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const kindLabel = String(kind).replace(/_/g, ' ');
  const isCalendarAction = kind === 'calendar_action' || payload.actionName?.startsWith('gcal_');

  let displayTitle = title;
  if (isCalendarAction) {
    const rawSummary = payload.args?.event?.summary || payload.event?.summary;
    if (rawSummary) {
      displayTitle = payload.actionName === 'gcal_create_event' ? `New event: ${rawSummary}` : rawSummary;
    } else if (typeof title === 'string') {
      if (/^create event:\s*/i.test(title)) {
        displayTitle = `New event: ${title.replace(/^create event:\s*/i, '')}`;
      } else if (/^gcal create event:\s*/i.test(title)) {
        displayTitle = `New event: ${title.replace(/^gcal create event:\s*/i, '')}`;
      }
    }
  } else if (isAppAction) {
    const actionLabel = payload.action ? String(payload.action).replace(/_/g, ' ') : 'action';
    const appName = payload.app?.name || payload.app || 'App';
    displayTitle = `App action: ${actionLabel} in ${payload.collection ?? appName}`;
  }

  const statusLabel = isOutboundMessage
    ? decision === 'pending'
      ? 'Ready to send'
      : decision === 'rejected'
        ? 'Discarded'
        : outboundOutcome?.outcomeUnknown
          ? 'Check Sent Items'
          : outboundOutcome?.sent === false
          ? 'Send failed'
          : 'Sent'
    : decision === 'pending'
      ? 'Needs approval'
      : decision === 'approved'
        ? 'Approved'
        : 'Rejected';
  const statusTone: CrewCardTone =
    decision === 'pending'
      ? 'default'
      : decision === 'approved'
        ? isOutboundMessage && outboundOutcome?.sent === false ? 'danger' : 'success'
        : isOutboundMessage ? 'default' : 'danger';

  return (
    <CrewCard testId="inline-approval-card">
      <CrewCardHeader
        icon={isOutboundMessage ? (outboundChannel === 'slack' ? <Hash /> : <Mail />) : isCalendarAction ? <Calendar /> : isAppAction ? <Layers /> : <Gavel />}
        tone={statusTone}
        title={isOutboundMessage ? (outboundChannel === 'slack' ? 'Slack message' : 'New email') : displayTitle}
        description={
          isOutboundMessage ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                Drafted by <strong className="font-medium text-foreground">@{requestedBy}</strong>
              </span>
              {outboundSensitivity && (
                <CrewCardStatus tone="attention">{sensitivityLabels[outboundSensitivity] ?? outboundSensitivity}</CrewCardStatus>
              )}
            </span>
          ) : isCalendarAction ? (
            <span>
              Calendar event proposal. Permissions inherited from{' '}
              <strong className="font-medium text-foreground">@{requestedBy}</strong>
            </span>
          ) : (
            <>
              <span className="capitalize">{kindLabel}</span>. Permissions inherited from{' '}
              <strong className="font-medium text-foreground">@{requestedBy}</strong>
            </>
          )
        }
        aside={<CrewCardStatus tone={statusTone}>{statusLabel}</CrewCardStatus>}
      />

      <CrewCardBody>
        {isAuthoredEmail && decision === 'pending' && persistedProposalId != null && <EmailSenderPicker key={`${persistedProposalId}:${approvalOrgId}:${currentUserId}`} url={approvalUrl('/email-accounts')} onChange={setEmailAccount} disabled={isSubmitting} />}
        {isOutboundMessage && (
          <OutboundMessagePreview
            payload={isAuthoredEmail ? { ...payload, from: emailAccount?.email ?? serverDraft?.emailAccount?.email ?? 'Choose a connected account' } : payload}
            outboundChannel={outboundChannel}
            decision={decision}
            displaySubject={displaySubject}
            displayBody={displayBody}
            editedSubject={editedSubject}
            setEditedSubject={setEditedSubject}
            editedBody={editedBody}
            setEditedBody={setEditedBody}
            isEditingDraft={isEditingDraft}
            setIsEditingDraft={setIsEditingDraft}
            isSubmitting={isSubmitting}
            reason={reason}
            outboundOutcome={outboundOutcome}
          />
        )}

        {(payload.kind === 'google_workspace_action' || payload.kind === 'calendar_action') && (
          <CalendarApprovalView
            payload={payload}
            decision={decision}
            calendarOutcome={calendarOutcome}
            onSetCalendarOutcome={setCalendarOutcome}
            onError={setError}
            approvalUrl={approvalUrl}
            persistedProposalId={persistedProposalId}
            isSubmitting={isSubmitting}
            setIsSubmitting={setIsSubmitting}
          />
        )}

        {kind === 'pipeline_run' && (
          <PipelineRunApprovalView
            payload={payload}
            decision={decision}
            pipelineRunOutcome={pipelineRunOutcome}
          />
        )}

        {kind === 'quickbooks_action' && (
          <QuickBooksProposalDetails payload={payload} outcome={calendarOutcome} awaitingExecutive={awaitingExecutive} />
        )}

        {kind === 'flighthub_booking' && (
          <FlightHubApprovalView payload={payload} calendarOutcome={calendarOutcome} />
        )}

        {payload.kind === 'amazon_purchase' && (
          <AmazonApprovalView payload={payload} calendarOutcome={calendarOutcome} />
        )}

        {isAppAction && (
          <AppActionApprovalView
            payload={payload}
            decision={decision}
            outcome={appActionOutcome ?? payload.outcome}
          />
        )}

        {reason && !isOutboundMessage && (
          <div className="leading-relaxed text-foreground/90">
            <span className="mr-1 font-medium text-foreground">Why:</span>
            {reason}
          </div>
        )}

        {payload.scaffoldPacks && Array.isArray(payload.scaffoldPacks) && payload.scaffoldPacks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">Scaffold packs:</span>
            {payload.scaffoldPacks.map((pack: string, idx: number) => (
              <span
                key={idx}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {pack}
              </span>
            ))}
          </div>
        )}

        {assembly && <AssemblyOutcomeCard outcome={assembly} />}

        {kind === 'assembly_deployment' && decision === 'pending' && (
          <div>
            <AppForgeThemePicker value={themeChoice} onChange={setThemeChoice} disabled={isSubmitting} />
          </div>
        )}

        {(isCaptcha || isSecurityChallenge) && decision === 'pending' && (
          <CaptchaChallengeView
            isOtpChallenge={isOtpChallenge}
            captchaScreenshot={captchaScreenshot}
            viewerUrl={context.viewerUrl}
            isZoomed={isZoomed}
            setIsZoomed={setIsZoomed}
            clickCoordinates={clickCoordinates}
            setClickCoordinates={setClickCoordinates}
            captchaSolution={captchaSolution}
            setCaptchaSolution={setCaptchaSolution}
            isSubmitting={isSubmitting}
          />
        )}

        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      </CrewCardBody>

      <CrewCardFooter
        note={
          decision === 'pending' && isOwnExecutiveRequest ? (
            <span data-testid="awaiting-executive-approval">Waiting for an Executive on this project to approve.</span>
          ) : decision === 'pending' ? (
            isOutboundMessage
              ? 'Nothing is sent until you send it.'
              : isCalendarAction
                ? 'Nothing is added to your calendar until you approve it.'
                : isAppAction
                  ? 'Nothing is modified in the app until you approve it.'
                  : 'Nothing runs until you approve it.'
          ) : (
            <>Decision recorded as {decision}.</>
          )
        }
      >
        {decision === 'pending' && !isOwnExecutiveRequest && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || (isAuthoredEmail && !emailAccount)}
              onClick={() => handleDecision('approved')}
              data-testid="approve-proposal-button"
            >
              {isOutboundMessage ? (
                <><Send className="mr-1 h-3.5 w-3.5" />{outboundChannel === 'slack' ? (draftEdited ? 'Post edited message' : 'Post message') : (draftEdited ? 'Send edited email' : 'Send email')}</>
              ) : isCalendarAction ? (
                <><CalendarCheck className="mr-1 h-3.5 w-3.5" />Approve and add to calendar</>
              ) : isAppAction ? (
                <><ShieldCheck className="mr-1 h-3.5 w-3.5" />Approve action</>
              ) : (
                <><ShieldCheck className="mr-1 h-3.5 w-3.5" />{(isCaptcha || isSecurityChallenge) ? 'Submit and resume' : 'Approve and run'}</>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => handleDecision('rejected')}
              data-testid="reject-proposal-button"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {isOutboundMessage ? 'Discard' : 'Reject'}
            </Button>
          </>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}

export default InlineApprovalCard;
