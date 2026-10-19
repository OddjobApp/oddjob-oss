import { formatCrewMoney } from '@shared/crew-money';
import { CrewGuidanceReceiptView } from './CrewGuidanceReceiptView';
import { CrewImportedSkillReceiptView } from './CrewImportedSkillReceiptView';
import { CrewOperationSkillDraftView } from './CrewOperationSkillDraftView';
import { GoogleWorkspaceIcon } from './GoogleWorkspaceIcon';
import { crewCardCopyText } from './crew-card-copy';
import { PushNotificationsCard } from '@domain-ui/core/ui/components/settings/PushNotificationsCard';
import { WorkspaceResultCard } from './WorkspaceResultCard';
import { crewProviderError } from '@shared/crew-provider-error';
import { splitWorkspaceContext, type SelectedWorkspaceItem, type WorkspaceContextRef } from '@shared/crew-workspace-results';
import React, { useState, useMemo, Fragment, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { remarkLinkifyBareUrls } from './turn-linkify';
import {
  User as UserIcon,
  AlertTriangle,
  Plug,
  Gavel,
  Wrench,
  Sparkles,
  Layers,
  ArrowRight,
  ArrowUpToLine,
  FileText,
  GitBranch,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionRequiredCard } from './PermissionRequiredCard';
import { GranolaPrivateResultsCard, isGranolaPrivateResults } from './GranolaPrivateResultsCard';
import { isPermissionRequiredPayload } from '@shared/crew-permission';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardQuote, CrewCardStatus } from './CrewCard';
import { apiRequest } from '@/lib/queryClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { InstantAppRenderer } from '@domain-ui/core/ui/components/shared/InstantAppRenderer';
import {
  TurnPresentationDeckCard,
  TurnBreakoutRoomCard,
  TurnAssistantChartCard,
  TurnAssistantProgressCard,
  TurnAssistantFormCard,
  TurnWorkflowDiagramCard,
  TurnAssistantTableCard,
  TurnAssistantListCard,
  TurnAssistantTimelineCard,
  TurnAssistantTreeCard,
  TurnAssistantComparisonCard,
  TurnAssistantCarouselCard,
} from './turns';
import { TokenizedAppSurface } from './TokenizedAppSurface';
import { ScribeConfirmationCard } from './ScribeConfirmationCard';
import { ForgeConfirmationCard } from './ForgeConfirmationCard';
import { FormChangeProposalCard } from './FormChangeProposalCard';
import { AgentChangeProposalCard } from './AgentChangeProposalCard';
import { FormCreateProposalCard } from './FormCreateProposalCard';
import { FlowCreateProposalCard } from './FlowCreateProposalCard';
import { PredictionJobProposalCard } from './PredictionJobProposalCard';
import { MediaChangeProposalCard } from './MediaChangeProposalCard';
import { MediaStoryProposalCard } from './MediaStoryProposalCard';
import { StyleBibleProposalCard } from './StyleBibleProposalCard';
import { StudioContributionProposalCard } from './StudioContributionProposalCard';
import { splitStudioScope } from '@shared/studio-scope';
import { draftableFrom, DISCLAIMER_OR_NOTICE_PATTERN } from '@/modules/scribe/insertable-draft';
import { forgeRequirementFrom } from '@/modules/apps/insertable-requirement';
import { StudioMountNotice, studioMountKind } from './StudioMountNotice';
import { type AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import { accentFor } from './crew-style-helpers';
import { CrewAgentHat } from './CrewAgentHat';
import { normalizeCrewSourceHref } from './crew-source-link';
import { type AssistantAppPayload } from '@/lib/assistant-app-href';
import { AppLaunchCard } from './AppLaunchCard';
import { CrewReviewCard } from './CrewReviewCard';
import { InlineApprovalCard } from './InlineApprovalCard';
import { CalendarChangeReceiptCard, parseCalendarReceipt } from './CalendarChangeReceipt';
import { GeneratedImageCard } from './GeneratedImageCard';
import { OntologyUnitSurface } from './OntologyUnitSurface';
import { CrewSchedulingPollCard, CrewMeetingConfirmedCard } from './CrewSchedulingCards';
import {
  DecisionRatificationCard,
  CommitmentContractCard,
  ClaimVerificationCard,
  GovernanceBlastRadiusCard,
} from './CrewDurableStateCards';
import { CrewDecisionMatrixRail } from './rails/CrewDecisionMatrixRail';
import { CrewForensicTimelineRail } from './rails/CrewForensicTimelineRail';
import { type CrewTurn, type CrewTurnTopic } from './AgentChatPanel';
import { DiverseIntakeCard, parseDiverseIntake } from './DiverseIntakeCard';
import { stageConfirmationDisplay } from './stage-confirmation-display';

const MediaConfigPod = React.lazy(() => import('@domain-ui/core/ui/components/packaged/MediaConfigPod'));
const MapSurface = React.lazy(() => import('@domain-ui/core/ui/components/shared/MapSurface').then(m => ({ default: m.MapSurface })));
const MermaidRenderer = React.lazy(() => import('@domain-ui/admin/ui/modules/admin/components/MermaidRenderer').then(m => ({ default: m.MermaidRenderer })));

export interface TurnRowProps {
  turn: CrewTurn;
  /** Declared-topic tags this turn carries (crew_turn_topics rows). */
  topics?: CrewTurnTopic[];
  /**
   * Room owner / admin: may decide 'pending' agent-declared tags.
   * Combined with onTopicDecision to render approve/dismiss on those chips.
   */
  canDecideTopics?: boolean;
  onTopicDecision?: (turnTopicId: number, status: 'applied' | 'rejected') => void;
  /** Clicking a chip's label filters the transcript to that topic. */
  onTopicFilter?: (label: string) => void;
  names?: string[];
  onArtifactSubmit: (message: string) => void;
  currentUserId: string | null;
  selectedWorkspaceItems?: WorkspaceContextRef[];
  onSelectWorkspaceItems?: (items: SelectedWorkspaceItem[], tool: string, turnId: number, visibleIds: string[], resultIndex?: number) => void;
  onDiscussWorkspaceItems?: (items: SelectedWorkspaceItem[], action: 'discuss' | 'respond' | 'summarize') => void;
  isHighlighted?: boolean;
  hasScribeActive?: boolean;
  hasAppStudioActive?: boolean;
  selectedAssemblyUnit?: AssemblyUnitSelection | null;
  /** Proposal ids the room has already applied, so their cards stop offering Apply. */
  appliedAgentProposals?: Set<string>;
}

export function AgentPill({ name, inUserTurn = false }: { name: string; inUserTurn?: boolean }) {
  const accent = accentFor(name);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md text-xs font-medium shadow-xs align-baseline transition-all',
        inUserTurn
          ? 'bg-primary-foreground/20 text-primary-foreground border border-primary-foreground/30'
          : 'bg-card/80 text-foreground border border-border/60 backdrop-blur-xs'
      )}
      data-testid="crew-agent-pill"
      data-agent-name={name}
    >
      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded', accent.tile)}>
        <CrewAgentHat name={name} className="h-3.5 w-3.5" />
      </span>
      <span>@{name}</span>
    </span>
  );
}

/**
 * A declared-topic chip. 'pending' agent tags render dashed and offer the
 * room owner approve/dismiss controls; 'rejected' rows are filtered by the
 * caller and never reach here.
 */
function TopicChip({
  t,
  inUserTurn = false,
  canDecide = false,
  onDecision,
  onFilter,
}: {
  t: CrewTurnTopic;
  inUserTurn?: boolean;
  canDecide?: boolean;
  onDecision?: (turnTopicId: number, status: 'applied' | 'rejected') => void;
  /** Click the label to filter the transcript to this topic. */
  onFilter?: (label: string) => void;
}) {
  const pending = t.status === 'pending';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium',
        inUserTurn
          ? 'border-primary-foreground/30 bg-primary-foreground/15'
          : 'border-primary/30 bg-primary/10 text-primary',
        pending && 'border-dashed opacity-80',
      )}
      title={pending
        ? 'Agent-declared topic · awaiting room approval'
        : `Declared topic · filed in knowledge base${onFilter ? ' · click to filter the transcript' : ''}${t.topicId ? ` (topic #${t.topicId})` : ''}`}
      data-testid="crew-topic-chip"
      data-topic-id={t.topicId ?? undefined}
      data-status={t.status}
    >
      {onFilter ? (
        <button
          type="button"
          className="hover:underline"
          aria-label={`Filter transcript by topic ${t.label}`}
          onClick={() => onFilter(t.label)}
        >
          #{t.label}
        </button>
      ) : (
        <>#{t.label}</>
      )}
      #{t.label}
      {pending && <span className="opacity-70">· pending</span>}
      {pending && canDecide && onDecision && (
        <span className="inline-flex items-center gap-0.5" data-testid="crew-topic-decision">
          <button
            type="button"
            aria-label={`Approve topic ${t.label}`}
            className="rounded p-0.5 hover:bg-emerald-500/20 hover:text-emerald-500"
            onClick={(e) => { e.stopPropagation(); onDecision(t.id, 'applied'); }}
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={`Dismiss topic ${t.label}`}
            className="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDecision(t.id, 'rejected'); }}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </span>
  );
}

export function renderPillMentions(text: string, knownNames: string[] = [], inUserTurn = false): React.ReactNode {
  if (!text || typeof text !== 'string') return text;
  if (!text.includes('@')) return text;

  const validNames = (knownNames || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (validNames.length === 0) return text;

  const escapedNames = validNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?<=^|[\\s(\\[])(@(?:${escapedNames}))(?=[\\s,.:;!?)\\]]|$)`, 'g');

  const parts = text.split(pattern);
  if (parts.length <= 1) return text;

  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const agentName = part.slice(1);
      if (validNames.some((n) => n.toLowerCase() === agentName.toLowerCase())) {
        return <AgentPill key={index} name={agentName} inUserTurn={inUserTurn} />;
      }
    }
    return part;
  });
}

function renderPillChildren(children: React.ReactNode, names: string[], inUserTurn = false): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderPillMentions(child, names, inUserTurn);
    }
    return child;
  });
}

function TurnRowView({
  turn,
  topics,
  canDecideTopics = false,
  onTopicDecision,
  onTopicFilter,
  names = [],
  onArtifactSubmit,
  currentUserId,
  isHighlighted = false,
  hasScribeActive = false,
  hasAppStudioActive = false,
  selectedAssemblyUnit = null,
  appliedAgentProposals,
  selectedWorkspaceItems, onSelectWorkspaceItems, onDiscussWorkspaceItems,
}: TurnRowProps) {
  if (turn.speakerType === 'user') {
    const isCurrentUser = Boolean(currentUserId && turn.userId === currentUserId);
    const diverseIntake = parseDiverseIntake(turn.content);
    // A message scoped to something marked in a studio shows it as a chip, not as the JSON the agents read.
    const workspaceScope = splitWorkspaceContext(turn.content);
    const scope = splitStudioScope(workspaceScope.message);
    const scopeLabel = scope.selection && typeof scope.selection.label === 'string' ? scope.selection.label : null;
    const calendarReceipt = parseCalendarReceipt(workspaceScope.message, workspaceScope.items);

    if (diverseIntake) {
      return (
        <div
          id={`turn-${turn.id}`}
          data-turn-id={turn.id}
          className={cn(
            'flex gap-2 transition-all duration-500 rounded-xl my-2',
            isCurrentUser && 'justify-end',
            isHighlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg p-1 bg-primary/5 animate-pulse'
          )}
          data-testid="crew-turn-user"
        >
          <DiverseIntakeCard
            intake={diverseIntake}
            speakerName={turn.speakerName}
            isCurrentUser={isCurrentUser}
          />
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
            <UserIcon className="h-4 w-4" />
          </span>
        </div>
      );
    }

    return (
      <div
        id={`turn-${turn.id}`}
        data-turn-id={turn.id}
        className={cn(
          'flex gap-2 transition-all duration-500 rounded-xl',
          isCurrentUser && 'justify-end',
          isHighlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg p-1 bg-primary/5 animate-pulse'
        )}
        data-testid="crew-turn-user"
      >
        <div
          className={cn(
            'rounded-lg rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-soft',
            workspaceScope.labels.length > 0 ? 'w-full sm:min-w-[340px] max-w-[78%]' : 'max-w-[78%]'
          )}
        >
          {!isCurrentUser && <div className="mb-1 text-xs font-semibold opacity-75">{turn.speakerName}</div>}
          {workspaceScope.labels.length > 0 && (
            <div className="mb-2 flex flex-col gap-1.5 w-full">
              {workspaceScope.labels.map((label, i) =>
                // The calendar item is the receipt below, not context to re-read.
                calendarReceipt?.item === workspaceScope.items[i] ? null : (
                <div
                  key={i}
                  className="flex items-center gap-2 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-xs"
                >
                  <GoogleWorkspaceIcon
                    kind={workspaceScope.kinds[i] ?? 'document'}
                    platform={workspaceScope.platforms?.[i]}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="truncate flex-1 min-w-0 text-left">{label}</span>
                </div>
              ))}
            </div>
          )}
          {scope.studio && scopeLabel ? (
            <>
              <div className="mb-1.5 flex w-fit max-w-full items-center gap-1 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-xs font-medium" data-testid="turn-scope-chip">
                <span className="shrink-0 opacity-75">{scope.studio} ·</span>{' '}
                <span className="truncate">{scopeLabel}</span>
              </div>
              {renderPillMentions(scope.text, names, true)}
            </>
          ) : calendarReceipt ? (
            <CalendarChangeReceiptCard receipt={calendarReceipt} details={renderPillMentions(workspaceScope.message, names, true)} />
          ) : (
            renderPillMentions(stageConfirmationDisplay(workspaceScope.message) ?? workspaceScope.message, names, true)
          )}
          {topics && topics.some((t) => t.status !== 'rejected') && (
            <div className="mt-1.5 flex flex-wrap gap-1" data-testid="crew-topic-chips">
              {topics.filter((t) => t.status !== 'rejected').map((t) => (
                <TopicChip key={t.id} t={t} inUserTurn canDecide={canDecideTopics} onDecision={onTopicDecision} onFilter={onTopicFilter} />
              ))}
            </div>
          )}
          {/* Files the person uploaded: image thumbnails (server-sized WebP) and document cards. */}
          {turn.artifacts?.filter(a => a.tool === 'room_attachments').map((a, i) => {
            const p = (a.payload ?? {}) as any;
            const key = encodeURIComponent(String(p.sessionKey ?? ''));
            const items: any[] = Array.isArray(p.items) ? p.items : [];
            const base = (id: number) => `/api/crew/${key}/attachments/${id}`;
            const size = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
            return (
              <div key={`files-${i}`} className="mt-2 grid grid-cols-2 gap-2" data-testid="turn-attachments">
                {items.map((item) => item.kind === 'image' ? (
                  <a key={item.id} href={`${base(item.id)}/download`} className="block overflow-hidden rounded-md bg-card" title={item.name}>
                    <img
                      src={`${base(item.id)}/thumbnail?w=320`}
                      srcSet={`${base(item.id)}/thumbnail?w=320 1x, ${base(item.id)}/thumbnail?w=640 2x`}
                      alt={item.name}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                ) : (
                  <a key={item.id} href={`${base(item.id)}/download`} className="col-span-2 block rounded-md bg-card p-3 text-left text-card-foreground">
                    <div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{item.name}</span></div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{size(item.byteSize ?? 0)}{item.parseStatus !== 'parsed' ? ` · ${item.parseStatus === 'pending' ? 'reading…' : "couldn't read"}` : ''}</div>
                    {item.preview && <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{item.preview}</p>}
                  </a>
                ))}
              </div>
            );
          })}
          {/* A location beacon a person raised (from the Android app): their pin on the room's map. */}
          {turn.artifacts?.filter(a => a.tool === 'location_beacon').map((a, i) => {
            const p = (a.payload ?? {}) as any;
            return (
              <div key={`beacon-${i}`} className="mt-2 overflow-hidden rounded-md bg-card text-card-foreground" data-testid="turn-beacon-map">
                <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading map...</div>}>
                  <MapSurface title={p.title} description={p.description} markers={Array.isArray(p.markers) ? p.markers : []} center={p.center} zoom={typeof p.zoom === 'number' ? p.zoom : undefined} mapStyle={p.mapStyle} />
                </Suspense>
              </div>
            );
          })}
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
          <UserIcon className="h-4 w-4" />
        </span>
      </div>
    );
  }

  const isSupervisor = turn.speakerType === 'supervisor';
  const providerError = isSupervisor ? crewProviderError(turn.content) : null;
  const displayContent = providerError ? `${providerError.title}\n\n${providerError.message}\n\n${providerError.nextStep}` : turn.content;
  const calendarCommentary = turn.toolsUsed?.some(tool => tool.name === 'gcal_create_event' && tool.ok);
  const CommentaryContainer = calendarCommentary ? 'details' : 'div';
  const copyContent = [displayContent, ...(turn.artifacts ?? []).map(artifact => crewCardCopyText(artifact.payload ?? {}))].filter(Boolean).join('\n\n');
  const accent = accentFor(turn.speakerName);
  const scribeDraft = hasScribeActive ? draftableFrom(turn.content) : null;
  const forgeSpec = hasAppStudioActive ? forgeRequirementFrom(turn.content) : null;

  return (
    <div
      id={`turn-${turn.id}`}
      data-turn-id={turn.id}
      className={cn(
        'flex gap-2 transition-all duration-500 rounded-xl',
        isHighlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg p-1 bg-primary/5 animate-pulse'
      )}
      data-testid={isSupervisor ? 'crew-turn-supervisor' : 'crew-turn-agent'}
    >
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-md',
          isSupervisor ? 'bg-amber-500/15 text-amber-500' : accent.tile,
        )}
      >
        {isSupervisor ? <Gavel className="h-4 w-4" /> : <CrewAgentHat name={turn.speakerName} className="h-6 w-6" />}
      </span>

      {/* No frame around the turn itself: the cards it carries are the only boxes,
          so a card never sits inside another card. */}
      <div className="min-w-0 flex-1 pt-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{turn.speakerName}</span>
          {isSupervisor && <CrewCardStatus>Supervisor</CrewCardStatus>}
          {!isSupervisor && (turn.intent === 'direct_action' || (turn.speakerType === 'agent' && turn.resolvedModelId == null && (turn.artifacts?.length ?? 0) > 0)) && (
            <CrewCardStatus>Direct action</CrewCardStatus>
          )}
          {turn.wasFallback === true && (
            <span title={`Provider failover${turn.servedProvider ? ` — served by ${turn.servedProvider}` : ''}${turn.servedModel ? ` (${turn.servedModel})` : ''}`}>
              <CrewCardStatus tone="attention">Fallback model</CrewCardStatus>
            </span>
          )}
          {turn.inReplyToTurnId && !isSupervisor && (
            <span className="text-xs text-muted-foreground">in thread</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {Number.isFinite(turn.latencyMs) && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {(turn.latencyMs! / 1000).toFixed(1)}s
              </span>
            )}
            <CopyButton value={copyContent} size="sm" tooltipText="Copy response" />
          </div>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground/90 font-normal">
          <CommentaryContainer>
          {calendarCommentary && <summary className="cursor-pointer text-sm text-muted-foreground">Original agent commentary · use the calendar card for current status</summary>}
          {providerError ? <div role="alert" className="not-prose">
            <CrewCard className="mt-1">
              <CrewCardHeader icon={<AlertTriangle />} tone="attention" title={providerError.title} description={providerError.message}
                aside={<CrewCardStatus tone="attention">Action needed</CrewCardStatus>} />
              <CrewCardBody className="text-sm"><p><span className="font-medium">Next step: </span>{providerError.nextStep}</p></CrewCardBody>
            </CrewCard>
          </div> : <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkLinkifyBareUrls]}
            rehypePlugins={[rehypeRaw, rehypeSanitize]}
            components={{
              p({ children }) {
                return <p className="mb-2 last:mb-0 leading-relaxed">{renderPillChildren(children, names)}</p>;
              },
              li({ children }) {
                return <li className="leading-relaxed">{renderPillChildren(children, names)}</li>;
              },
              a({ href, children, ...props }) {
                const normalizedHref = normalizeCrewSourceHref(href);
                const external = !!normalizedHref && /^https?:\/\//i.test(normalizedHref) && !normalizedHref.startsWith(window.location.origin);
                return <a href={normalizedHref} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>{children}</a>;
              },
              code({ inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                if (!inline && match && match[1] === "mermaid") {
                  return (
                    <div className="my-3 overflow-hidden rounded-xl border border-border/70 bg-card">
                      <Suspense fallback={<div className="p-3 text-xs text-muted-foreground animate-pulse">Rendering diagram...</div>}>
                        <MermaidRenderer chart={String(children).replace(/\n$/, "")} />
                      </Suspense>
                    </div>
                  );
                }
                return (
                  <code className={cn("rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-foreground", className)} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {turn.content}
          </ReactMarkdown>}
          </CommentaryContainer>
        </div>

        {topics && topics.some((t) => t.status !== 'rejected') && (
          <div className="mt-2 flex flex-wrap gap-1" data-testid="crew-topic-chips">
            {topics.filter((t) => t.status !== 'rejected').map((t) => (
              <TopicChip key={t.id} t={t} canDecide={canDecideTopics} onDecision={onTopicDecision} onFilter={onTopicFilter} />
            ))}
          </div>
        )}

        {turn.artifacts
          ?.filter(
            (artifact, idx, self) =>
              artifact.payload?.type === 'google_workspace_results' || artifact.payload?.type === 'crew_operation_skill_draft' || idx ===
              self.findIndex(
                (a) =>
                  a.tool === artifact.tool &&
                  (a.payload?.module === artifact.payload?.module ||
                    a.payload?.title === artifact.payload?.title ||
                    a.payload?.chart === artifact.payload?.chart ||
                    a.payload?.type === artifact.payload?.type),
              ),
          )
          .map((artifact, i) => {
          const p = artifact.payload ?? {};
          if (p.type === 'crew_operation_skill_draft' && p.version === 1 && p.status === 'draft') {
            const workflow = turn.artifacts?.find(source => source.payload?.kind === 'calendar_action' && source.payload?.workflow)?.payload?.workflow as any;
            return <CrewOperationSkillDraftView key={`operation-skill-${i}`} draft={p as any} reviewScope={workflow?.sessionKey && workflow?.organizationId ? { roomKey: workflow.sessionKey, organizationId: workflow.organizationId } : undefined} />;
          }
          if (p.type === 'crew_guidance_receipt' && p.version === 1 && p.status === 'loaded_into_prompt' && Array.isArray(p.entries)) return <CrewGuidanceReceiptView key={`guidance-${i}`} receipt={p as any} />;
          if (p.type === 'crew_imported_skill_receipt' && p.version === 1 && Array.isArray(p.entries)) return <CrewImportedSkillReceiptView key={`imported-skills-${i}`} receipt={p as any} />;
          if (p.type === 'gmail_directive_list') return <section key={`directives-${i}`} className="mt-3 rounded-xl border border-border bg-card p-4" aria-label="Saved Gmail directives">
            <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><GoogleWorkspaceIcon kind="email" />Your Gmail directives</h3><CopyButton value={crewCardCopyText(p)} size="sm" tooltipText="Copy card" /></div>
            {!p.items?.length && <p className="mt-2 text-sm text-muted-foreground">No directives saved in this project.</p>}
            {(p.items ?? []).map((rule: any) => <div key={rule.sender} className="mt-3 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm">{rule.sender}</span><Badge variant="outline">{String(rule.status).replaceAll('_', ' ')}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Last checked: {rule.lastCheckedAt ? new Date(rule.lastCheckedAt).toLocaleString() : 'Not yet'}</p>{rule.error && <p className="mt-1 text-xs text-destructive">{rule.error}</p>}<div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => onArtifactSubmit(`/directive ${rule.status === 'paused' ? 'resume' : 'pause'} ${rule.sender}`)}>{rule.status === 'paused' ? 'Resume' : 'Pause'}</Button><Button size="sm" variant="ghost" onClick={() => onArtifactSubmit(`/directive remove ${rule.sender}`)}>Remove</Button></div></div>)}
          </section>;
          if (p.type === 'gmail_directive') return <section key={`directive-${i}`} className="mt-3 rounded-xl border border-border bg-card p-4" aria-label="Gmail directive">
            <div className="flex items-center gap-2"><GoogleWorkspaceIcon kind="email" /><strong className="text-sm">Gmail sender alert</strong><Badge variant="outline">{String(p.status).replaceAll('_', ' ')}</Badge><div className="ml-auto"><CopyButton value={crewCardCopyText(p)} size="sm" tooltipText="Copy card" /></div></div>
            <p className="mt-2 text-sm">From: {String(p.sender)}</p>
            {p.mailbox && <p className="mt-1 text-xs text-muted-foreground">Connected mailbox: {String(p.mailbox)}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Checks every {String(p.intervalSeconds)} seconds · No recurring AI calls · Notifications enabled when active</p>
            <p className="mt-1 text-xs text-muted-foreground">Browser push: {p.browserPushReady ? 'Ready' : 'Needs setup'}</p>
            {!p.browserPushReady && p.status !== 'removed' && <details className="mt-3"><summary className="cursor-pointer text-xs text-primary">Set up browser push</summary><div className="mt-2"><PushNotificationsCard /></div></details>}
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={p.status === 'removed'} onClick={() => onArtifactSubmit(`/directive ${p.status === 'paused' ? 'resume' : 'pause'} ${p.sender}`)}>{p.status === 'paused' ? 'Resume' : 'Pause'}</Button><Button variant="ghost" size="sm" onClick={() => onArtifactSubmit(`/directive status ${p.sender}`)}>Check status</Button><Button variant="ghost" size="sm" disabled={p.status === 'removed'} onClick={() => onArtifactSubmit(`/directive remove ${p.sender}`)}>Remove</Button><a href="/settings?tab=notifications" className="text-xs text-primary">Notification settings</a></div>
          </section>;

          if (p.type === 'google_workspace_results') return <WorkspaceResultCard key={artifact.tool + '-' + i} payload={p as any} turnId={turn.id} tool={artifact.tool} resultIndex={i} selected={selectedWorkspaceItems} onSelect={onSelectWorkspaceItems ? items => onSelectWorkspaceItems(items, artifact.tool, turn.id, p.items.map((item: any) => item.id), i) : undefined} onDiscuss={onDiscussWorkspaceItems} onMore={onArtifactSubmit} />;
          if (p.type === 'crew_work_product') {
            return <div key={`${artifact.tool}-${i}`} className="mt-3 rounded-lg border border-border bg-card p-3 text-sm"><strong>{String(p.title || 'Work product')}</strong><p className="text-muted-foreground">{String(p.changeSummary || 'A work product version was added to the room workspace.')}</p><a href="#crew-workspace" onClick={event => { event.preventDefault(); document.dispatchEvent(new Event('crew-open-work-product')); }} className="text-primary underline">Open work product</a></div>;
          }

          if (p.type === 'performance_scorecard' || p.type === 'gate_review') {
            return <CrewReviewCard key={`${artifact.tool}-${i}`} payload={p} />;
          }

          if (String(p.type ?? '').startsWith('ontology_')) {
            return <OntologyUnitSurface key={`${artifact.tool}-${i}`} payload={p} />;
          }

          if (
            p.type === 'decision_ratification' ||
            p.type === 'crew_decision' ||
            p.kind === 'crew_decision' ||
            artifact.tool === 'ratify_decision' ||
            artifact.tool === 'propose_crew_decision'
          ) {
            return (
              <DecisionRatificationCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (
            p.type === 'crew_decision_matrix_pod' ||
            p.module === 'CrewDecisionMatrixRail' ||
            p.module === 'DecisionMatrixPod' ||
            artifact.tool === 'propose_decision_matrix'
          ) {
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                <CrewDecisionMatrixRail
                  data={p as any}
                  onAdoptRecommendation={(cand) =>
                    onArtifactSubmit(
                      `We adopt "${cand.name}" as the leading choice. Please ratify this decision formally.`
                    )
                  }
                  onDiscussInChat={(context) => onArtifactSubmit(context)}
                />
              </div>
            );
          }

          if (
            p.type === 'crew_forensic_timeline_pod' ||
            p.module === 'CrewForensicTimelineRail' ||
            artifact.tool === 'pin_forensic_event'
          ) {
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                <CrewForensicTimelineRail
                  incidentTitle={typeof p.incidentTitle === 'string' ? p.incidentTitle : undefined}
                  events={Array.isArray(p.events) ? p.events : []}
                  onSelectEvent={(evt) =>
                    onArtifactSubmit(`Please inspect forensic event: ${evt.description}`)
                  }
                />
              </div>
            );
          }

          if (
            p.type === 'commitment_contract' ||
            p.type === 'crew_commitment' ||
            p.kind === 'crew_commitment' ||
            artifact.tool === 'record_commitment' ||
            artifact.tool === 'propose_crew_commitment'
          ) {
            return (
              <CommitmentContractCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (
            p.type === 'claim_verification' ||
            p.type === 'crew_claim' ||
            p.kind === 'crew_claim' ||
            artifact.tool === 'verify_claim' ||
            artifact.tool === 'propose_crew_claim'
          ) {
            return (
              <ClaimVerificationCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (
            p.type === 'governance_blast_radius' ||
            p.type === 'governance_checkpoint' ||
            p.type === 'crew_governance_gate_pod' ||
            artifact.tool === 'request_governance_approval'
          ) {
            return (
              <GovernanceBlastRadiusCard
                key={`${artifact.tool}-${i}`}
                payload={((p as any).checkpoint || p) as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'forge_confirmation_card') {
            return (
              <ForgeConfirmationCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'media_change_proposal') {
            return (
              <MediaChangeProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'media_story_proposal') {
            return (
              <MediaStoryProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'media_style_bible_proposal') {
            return (
              <StyleBibleProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'media_config_surface' || p.type === 'media_config' || p.type === 'media_take_proposal') {
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3">
                <Suspense fallback={<p className="text-xs text-muted-foreground p-3">Loading media configuration…</p>}>
                  <MediaConfigPod
                    initialConfig={(p.config as any) ?? (p as any)}
                    sceneTitle={(p.sceneTitle as string) || 'Scene 1'}
                    shotNumber={(p.shotNumber as number) || 1}
                    onComplete={(cfg) =>
                      onArtifactSubmit(
                        `I applied the shot configuration for ${cfg.sceneTitle ?? 'Scene 1'} (Shot #${cfg.shotNumber ?? 1}): Recipe ${cfg.recipeId}, Camera ${cfg.cameraMotion}, Aspect ${cfg.aspectRatio}, Steps ${cfg.steps}, CFG ${cfg.cfgScale}`
                      )
                    }
                    onMountRail={(sceneId) =>
                      onArtifactSubmit(
                        sceneId ? `Please open Media Studio for scene ${sceneId}` : 'Please open Media Studio in the workspace rail'
                      )
                    }
                    onOpenFormStudio={(formId) =>
                      onArtifactSubmit(
                        `Please open Form Studio for the ComfyUI parameter schema: ${formId}`
                      )
                    }
                  />
                </Suspense>
              </div>
            );
          }

          if (p.type === 'agent_change_proposal') {
            return (
              <AgentChangeProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
                applied={typeof (p as any).proposalId === 'string' && (appliedAgentProposals?.has((p as any).proposalId) ?? false)}
              />
            );
          }

          if (p.type === 'form_change_proposal') {
            return (
              <FormChangeProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'form_create_proposal') {
            return (
              <FormCreateProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'prediction_model_proposal') {
            return (
              <PredictionJobProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          // The record that a prediction card was used, and the marker that stops
          // a second press creating a twin.
          if (p.type === 'prediction_inference_result') {
            return (
              <a
                key={`${artifact.tool}-${i}`}
                href={`/jobs/${p.jobId}`}
                className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs hover:border-primary/40"
                data-testid="prediction-job-created-card"
              >
                <span className="font-medium">{String(p.name)}</span>
                <span className="text-muted-foreground">prediction job · open it</span>
              </a>
            );
          }

          if (p.type === 'flow_create_proposal') {
            return (
              <FlowCreateProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'studio_contribution_proposal') {
            return (
              <StudioContributionProposalCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
                applied={typeof (p as any).proposalId === 'string' && (appliedAgentProposals?.has((p as any).proposalId) ?? false)}
              />
            );
          }

          // Applied marker — stays on screen as a receipt (mirrors flow_created).
          if (p.type === 'studio_contribution_applied') {
            return (
              <div
                key={`${artifact.tool}-${i}`}
                className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs"
                data-testid="contribution-applied-card"
              >
                <span className="text-emerald-500">✓</span>
                <span className="font-medium">Contribution applied</span>
                <span className="text-muted-foreground">· {String((p as any).proposalId)}</span>
              </div>
            );
          }

          // The record that a flow card was used. It doubles as the marker that
          // stops a second press creating a twin, so it is rendered rather than
          // dropped -- a payload type with no branch here vanishes from the room.
          if (p.type === 'flow_created') {
            return (
              <a
                key={`${artifact.tool}-${i}`}
                href={`/operations/workstreams/${p.pipelineId}`}
                className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs hover:border-primary/40"
                data-testid="flow-created-card"
              >
                <span className="font-medium">{String(p.name)}</span>
                <span className="text-muted-foreground">
                  {Number(p.stepCount)} step{Number(p.stepCount) === 1 ? '' : 's'} · open it
                </span>
              </a>
            );
          }

          if (p.type === 'scribe_confirmation_card' && p.resolution) {
            return (
              <ScribeConfirmationCard
                key={`${artifact.tool}-${i}`}
                payload={p as any}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          // connect_platform's card: an OAuth link a person clicks to bind a
          // connection to this project space. returnTo is stamped at click time
          // so the OAuth callback lands the person back in this room.
          if (isPermissionRequiredPayload(p)) {
            return <PermissionRequiredCard key={`${artifact.tool}-${i}`} payload={p} />;
          }

          // A room search of someone's Granola notes: no meeting data in the
          // payload; only its owner's browser lists the matches.
          if (isGranolaPrivateResults(p)) {
            return <GranolaPrivateResultsCard key={`${artifact.tool}-${i}`} payload={p} currentUserId={currentUserId} />;
          }

          if (p.type === 'connection_request' && typeof p.connectUrl === 'string') {
            const returnTo = encodeURIComponent(
              `${window.location.pathname}${window.location.search}`
            );
            const href = `${p.connectUrl}${p.connectUrl.includes('?') ? '&' : '?'}returnTo=${returnTo}`;
            return (
              <CrewCard key={`${artifact.tool}-${i}`} testId="connection-request-card">
                <CrewCardHeader icon={<Plug />} title={`Connect ${String(p.providerLabel || p.platform)}`}
                  description={p.scopeNote ? String(p.scopeNote) : undefined} />
                {p.reason && (
                  <CrewCardBody><CrewCardQuote>{String(p.reason)}</CrewCardQuote></CrewCardBody>
                )}
                <CrewCardFooter note={p.authMethod === 'api_key' ? 'Opens the Connectors dashboard.' : 'A person signs in. The connection is scoped to this project space.'}>
                  <Button asChild size="sm"><a href={href}>Connect{p.projectKey ? ` to ${String(p.projectKey)}` : ''}</a></Button>
                </CrewCardFooter>
              </CrewCard>
            );
          }

          if (p.type === 'saas_adapters' && Array.isArray(p.adapters)) {
            const adapters = p.adapters as any[];
            return (
              <CrewCard key={`${artifact.tool}-${i}`} testId="saas-adapters-surface">
                <CrewCardHeader icon={<Plug />} title={String(p.title || 'Connected systems')}
                  description={p.projectKey ? `Project ${p.projectKey}` : undefined}
                  aside={<CrewCardStatus>{adapters.length} {adapters.length === 1 ? 'adapter' : 'adapters'}</CrewCardStatus>} />
                <ul className="divide-y divide-border/60">
                  {adapters.map((adapter: any, ai: number) => (
                    <li key={ai} className="flex items-start gap-3 px-4 py-3 text-xs">
                      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground"><Plug className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium capitalize text-foreground">{adapter.platform || 'Adapter'}</span>
                          <CrewCardStatus tone={adapter.status === 'connected' ? 'success' : 'default'}>{String(adapter.status ?? 'unknown')}</CrewCardStatus>
                          {adapter.scope && <CrewCardStatus>{String(adapter.scope)}</CrewCardStatus>}
                        </div>
                        {adapter.boundResource && (
                          <p className="text-muted-foreground">{adapter.boundResource.kind}: {adapter.boundResource.value}</p>
                        )}
                        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                          {adapter.lastSync
                            ? <span>Last sync {new Date(adapter.lastSync).toLocaleDateString()}</span>
                            : <span className="text-amber-700 dark:text-amber-300">Never synced</span>}
                          <span>{adapter.syncConfig?.enabled ? `Syncs every ${adapter.syncConfig.syncIntervalMinutes} min` : 'Sync off'}</span>
                          {adapter.schemaSnapshot
                            ? <span>Schema: {adapter.schemaSnapshot.fieldCount} fields (v{adapter.schemaSnapshot.version})</span>
                            : <span className="text-amber-700 dark:text-amber-300">No schema captured</span>}
                        </p>
                        {Array.isArray(adapter.bindings) && adapter.bindings.length > 0 && (
                          <ul className="space-y-0.5 text-muted-foreground">
                            {adapter.bindings.map((binding: any, bi: number) => (
                              <li key={bi}>
                                {binding.resourceKind}: {binding.resourceKey}
                                {binding.resourceName && <> ({binding.resourceName})</>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CrewCard>
            );
          }

          if (
            p.type === 'mission_proposal' ||
            p.type === 'approval_request' ||
            p.type === 'cycle_proposal' ||
            (p.proposalId && (p.kind || p.missionName || p.cycleName))
          ) {
            return (
              <InlineApprovalCard
                key={`${artifact.tool}-${i}`}
                payload={p}
                onArtifactSubmit={onArtifactSubmit}
                currentUserId={currentUserId}
              />
            );
          }

          if (
            (p.type === 'input_request' || p.type === 'assistant_form') &&
            (p.schema?.fields || Array.isArray(p.fields))
          ) {
            return (
              <TurnAssistantFormCard
                key={`${artifact.tool}-${i}`}
                payload={p}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          const studioKind = studioMountKind(artifact);
          if (studioKind) {
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                <StudioMountNotice kind={studioKind} title={(p.title ?? p.formName) as string | undefined} />
              </div>
            );
          }

          if (p.type === 'assistant_app' && (p.slug || p.href || p.blueprint)) {
            return (
              <AppLaunchCard key={`${artifact.tool}-${i}`} app={p as AssistantAppPayload} />
            );
          }

          if (p.type === 'instant_app' || p.type === 'instant_app_surface') {
            const moduleName =
              (p.module as string) || (p.componentName as string) || (p.component as string);
            if (!moduleName && p.type === 'instant_app') return null;

            if (p.type === 'instant_app_surface' && Array.isArray(p.blocks) && p.blocks.length > 0) {
              const layout = (p.layout as string) || 'grid';
              const columns = layout === 'stack' ? 1 : 3;
              // Whole class names: Tailwind only generates classes it finds written out.
              const SPAN: Record<number, string> = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3' };
              return (
                <CrewCard key={`${artifact.tool}-${i}`} testId="turn-artifact">
                  <CrewCardHeader icon={<Sparkles />} title={String(p.title || 'Instant app')}
                    description={p.note ? String(p.note) : undefined} />
                  <CrewCardBody>
                  {p.diagnostics && p.diagnostics.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Unavailable blocks: {p.diagnostics.join(', ')}
                    </p>
                  )}
                  <div
                    className={cn(
                      'grid max-h-[36rem] grid-cols-1 gap-3 overflow-auto',
                      columns > 1 && 'sm:grid-cols-3',
                    )}
                  >
                    {p.blocks.map((block: any, bi: number) => {
                      const blockModule =
                        (block.module as string) || (block.componentName as string) || (block.component as string);
                      if (!blockModule) return null;
                      return (
                        <div key={bi} className={cn('rounded-lg border border-border/60 p-2', block.span && columns > 1 ? SPAN[Math.min(block.span, columns)] : '')}>
                          <Suspense fallback={<p className="text-xs text-muted-foreground p-3">Assembling…</p>}>
                            <InstantAppRenderer
                              module={blockModule}
                              componentName={(block.componentName as string) || (block.component as string)}
                              title={(block.title as string) || blockModule}
                              props={{
                                ...(block.props as Record<string, any>),
                                onStageComplete: (data: any) =>
                                  onArtifactSubmit(
                                    `I confirmed stage "${(block.props as any)?.stageId || blockModule}" with configuration: ${JSON.stringify(data)}`,
                                  ),
                                onComplete: (data: any) =>
                                  onArtifactSubmit(
                                    `I completed stage "${(block.props as any)?.stageId || blockModule}" with configuration: ${JSON.stringify(data)}`,
                                  ),
                                onConfirm: (data: any) =>
                                  onArtifactSubmit(
                                    `I confirmed stage "${(block.props as any)?.stageId || blockModule}" with configuration: ${JSON.stringify(data)}`,
                                  ),
                              }}
                            />
                          </Suspense>
                        </div>
                      );
                    })}
                  </div>
                  </CrewCardBody>
                </CrewCard>
              );
            }

            const studioKind = studioMountKind(artifact);
            if (studioKind) {
              return (
                <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                  <StudioMountNotice kind={studioKind} title={(p.title ?? p.formName) as string | undefined} />
                </div>
              );
            }
            if (!moduleName) return null;
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                <InstantAppRenderer
                  module={moduleName}
                  componentName={(p.componentName as string) || moduleName}
                  title={(p.title as string) || moduleName}
                  note={(p.note as string) || ''}
                  props={{
                    ...(p as Record<string, any>),
                    ...(p.props as Record<string, any>),
                    onStageComplete: (data: any) =>
                      onArtifactSubmit(
                        `I confirmed stage "${(p.stageId as string) || (p.props as any)?.stageId || moduleName}" with configuration: ${JSON.stringify(data)}`,
                      ),
                    onComplete: (data: any) =>
                      onArtifactSubmit(
                        `I completed stage "${(p.stageId as string) || (p.props as any)?.stageId || moduleName}" with configuration: ${JSON.stringify(data)}`,
                      ),
                    onConfirm: (data: any) =>
                      onArtifactSubmit(
                        `I confirmed stage "${(p.stageId as string) || (p.props as any)?.stageId || moduleName}" with configuration: ${JSON.stringify(data)}`,
                      ),
                  }}
                />
              </div>
            );
          }

          if (p.type === 'workflow_diagram' || p.chart) {
            return (
              <TurnWorkflowDiagramCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_chart' && Array.isArray(p.data)) {
            return (
              <TurnAssistantChartCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_map' || p.type === 'map') {
            const rawMarkers = Array.isArray(p.markers)
              ? p.markers
              : (p.lat !== undefined && p.lng !== undefined)
                ? [{ lat: p.lat, lng: p.lng, label: p.label || p.title || 'Location', description: p.description }]
                : [];
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
                <Suspense fallback={<div className="p-4 text-xs text-muted-foreground animate-pulse">Loading map...</div>}>
                  <MapSurface
                    title={(p.title as string) || 'Geographic Map'}
                    description={p.description as string | undefined}
                    markers={rawMarkers}
                    route={p.route as any}
                    center={p.center as { lat: number; lng: number } | undefined}
                    zoom={typeof p.zoom === 'number' ? p.zoom : undefined}
                    mapStyle={p.mapStyle as any}
                  />
                </Suspense>
              </div>
            );
          }

          if (p.type === 'assistant_table' && Array.isArray(p.columns) && Array.isArray(p.rows)) {
            return (
              <TurnAssistantTableCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_list' && Array.isArray(p.items)) {
            return (
              <TurnAssistantListCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_timeline' && Array.isArray(p.events)) {
            return (
              <TurnAssistantTimelineCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_progress' && p.progressType) {
            return (
              <TurnAssistantProgressCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_tree' && Array.isArray(p.nodes)) {
            return (
              <TurnAssistantTreeCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_comparison' && Array.isArray(p.items) && Array.isArray(p.criteria)) {
            return (
              <TurnAssistantComparisonCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_app_catalog' && Array.isArray(p.items)) {
            const catalogItems = p.items as any[];
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                {(p.title || p.description) && (
                  <div className="mb-2">
                    {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
                    {p.description && <p className="mt-0.5 text-[11px] text-muted-foreground">{p.description as string}</p>}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {catalogItems.map((item: any, ii: number) => (
                    <AppLaunchCard key={`${artifact.tool}-${i}-${ii}`} app={item as AssistantAppPayload} />
                  ))}
                </div>
              </div>
            );
          }

          if (p.type === 'assistant_carousel' && Array.isArray(p.items)) {
            return (
              <TurnAssistantCarouselCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'assistant_image' && p.url) {
            return (
              <GeneratedImageCard
                key={`${artifact.tool}-${i}`}
                url={p.url as string}
                title={p.title as string}
                description={p.description as string}
                path={p.path as string}
              />
            );
          }

          if (p.type === 'presentation_deck') {
            return (
              <TurnPresentationDeckCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          if (p.type === 'crew_breakout' || artifact.tool === 'propose_breakout_room') {
            return (
              <TurnBreakoutRoomCard
                key={`${artifact.tool}-${i}`}
                payload={p}
                tool={artifact.tool}
              />
            );
          }

          if (p.type === 'crew_scheduling_poll' || artifact.tool === 'propose_meeting_schedule') {
            return (
              <CrewSchedulingPollCard
                key={`${artifact.tool}-${i}`}
                payload={p}
                currentUserId={currentUserId}
                onArtifactSubmit={onArtifactSubmit}
              />
            );
          }

          if (p.type === 'crew_meeting_confirmed' || artifact.tool === 'confirm_meeting_schedule') {
            return (
              <CrewMeetingConfirmedCard
                key={`${artifact.tool}-${i}`}
                payload={p}
              />
            );
          }

          const moduleName =
            (p.module as string) || (p.componentName as string) || (p.component as string);
          if (studioKind) {
            return (
              <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
                <StudioMountNotice kind={studioKind} title={(p.title ?? p.formName) as string | undefined} />
              </div>
            );
          }
          if (!moduleName) return null;
          return (
            <div key={`${artifact.tool}-${i}`} className="mt-3" data-testid="turn-artifact">
              <InstantAppRenderer
                module={moduleName}
                componentName={p.componentName as string}
                title={p.title as string}
                note={p.note as string}
                props={{
                  ...(p.props as Record<string, any>),
                  onStageComplete: (data: any) =>
                    onArtifactSubmit(
                      `I confirmed stage "${p.props?.stageId || (p.stageId as string) || moduleName}" with configuration: ${JSON.stringify(data)}`,
                    ),
                  onComplete: (data: any) =>
                    onArtifactSubmit(
                      `I completed stage "${p.props?.stageId || (p.stageId as string) || moduleName}" with configuration: ${JSON.stringify(data)}`,
                    ),
                  onConfirm: (data: any) =>
                    onArtifactSubmit(
                      `I confirmed stage "${p.props?.stageId || (p.stageId as string) || moduleName}" with configuration: ${JSON.stringify(data)}`,
                    ),
                }}
              />
            </div>
          );
        })}

        {turn.toolsUsed?.length > 0 && (() => {
          // One quiet line: how many tools ran, and the failures by name, since a
          // failure is the only part worth reading. The full list opens on demand.
          const failed = turn.toolsUsed.filter((tool) => !tool.ok);
          return (
            <details className="group mt-2 text-xs text-muted-foreground" data-testid="turn-tools">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <Wrench className="h-3 w-3 shrink-0" aria-hidden />
                <span>
                  {turn.toolsUsed.length} tool{turn.toolsUsed.length === 1 ? '' : 's'} ran
                  {failed.length > 0 && (
                    <span className="text-red-700 dark:text-red-300"> · {failed.length} failed: {failed.map((tool) => tool.name).join(', ')}</span>
                  )}
                </span>
              </summary>
              <ul className="mt-1.5 space-y-0.5 pl-[18px]">
                {turn.toolsUsed.map((tool, i) => (
                  <li key={`${tool.name}-${i}`} className={cn('font-mono', !tool.ok && 'text-red-700 dark:text-red-300')}>
                    {tool.name} · {tool.ok ? `${tool.ms}ms` : `failed${tool.error ? `: ${tool.error}` : ''}`}
                  </li>
                ))}
              </ul>
            </details>
          );
        })()}

        {hasScribeActive && scribeDraft && (() => {
          const isDisclaimer = DISCLAIMER_OR_NOTICE_PATTERN.test(scribeDraft);
          const scribeContext = selectedAssemblyUnit?.type === 'scribe' ? selectedAssemblyUnit.scribe : undefined;
          const isExcerptRewrite = Boolean(scribeContext?.excerpt);

          const dispatchInsert = (placement: 'replace' | 'top' | 'bottom') => {
            window.dispatchEvent(
              new CustomEvent("scribe:insert-text", {
                detail: {
                  text: scribeDraft,
                  excerpt: scribeContext?.excerpt,
                  stationKey: scribeContext?.stationKey,
                  nodeId: scribeContext?.nodeId,
                  placement,
                },
              })
            );
          };

          return (
            <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-end gap-1.5">
              {isExcerptRewrite ? (
                <button
                  type="button"
                  onClick={() => dispatchInsert("replace")}
                  className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  title={`Rewrite the selected excerpt in ${selectedAssemblyUnit?.label || 'station'} with this draft.`}
                  data-testid="scribe-insert-draft"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Rewrite excerpt in Station</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => dispatchInsert("top")}
                    className="px-2 py-1 rounded bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground border border-border text-xs font-medium flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                    title="Insert this draft immediately under the station heading (ideal for disclaimers and introductory notes)"
                    data-testid="scribe-insert-draft-top"
                  >
                    <ArrowUpToLine className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Insert at Top</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatchInsert(isDisclaimer ? "top" : "bottom")}
                    className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    title={isDisclaimer ? "Insert this disclaimer under the station heading" : "Insert this draft into the open Scribe Studio station."}
                    data-testid="scribe-insert-draft"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{isDisclaimer ? "Insert Disclaimer at Top" : "Insert draft into Station"}</span>
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {hasAppStudioActive && forgeSpec && (
          <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("forge:add-requirement", {
                    detail: {
                      text: forgeSpec,
                      agentName: turn.speakerName,
                    },
                  })
                );
              }}
              className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              title="Append this specification to the active App Forge project requirements. The surrounding conversation is not included."
              data-testid="forge-insert-requirement"
            >
              <Layers className="w-3.5 h-3.5 text-amber-500" />
              <span>Add to App Requirements</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// A room re-renders on every streamed turn; memo keeps settled rows (and their
// markdown) from re-rendering. Turn objects keep their identity across merges
// (`mergeTurns`), and the panel passes content-stable list props.
export const TurnRow = React.memo(TurnRowView);

export default TurnRow;
