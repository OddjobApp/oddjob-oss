import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { MediaConfigurationRail } from '@/modules/media/MediaConfigurationRail';
import { CyclePipelineRightRail } from './rails/CyclePipelineRightRail';
import { CrewTabbedRightRail, type CrewRailTab } from './rails/CrewTabbedRightRail';
import { AgentChatSupervisorPanel } from './AgentChatSupervisorPanel';
import { CrewReadinessPanel } from './CrewReadinessPanel';
import { AgentChatBlackboard } from './AgentChatBlackboard';
import { ModularAssemblyPuzzleRail, type AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import type {
  CrewSession,
  CrewTurn,
  SupervisorNote,
  CrewDecision,
  CrewClaim,
  CrewCommitment,
  CrewIssue,
  CrewPlan,
} from './AgentChatPanel';
import type { StudioSurfaceKind } from './AgentChatPanel';
import type { CycleFleetApp } from './CrewCycleAppCanvas';

export interface CrewRightRailPortalProps {
  surfaceConnections?: React.ReactNode;
  roomDirection?: React.ReactNode;
  roomWork?: React.ReactNode;
  railRef?: React.Ref<HTMLDivElement>;
  railTop: number;
  sidebarLeft: number;
  effectiveChatWidth: number;
  isDraggingChatWidth: boolean;
  hasStudioActive: boolean;
  isChatCollapsed: boolean;
  setIsChatCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  session: CrewSession | null;
  /** The room key in the URL — what /api/crew/:sessionKey and room lookups take. */
  roomKey?: string;
  turns: CrewTurn[];
  roomAttachments: any[];
  selectedAssemblyUnit: AssemblyUnitSelection | null;
  setSelectedAssemblyUnit: (unit: AssemblyUnitSelection | null) => void;
  setComposerDraft: (draft: string) => void;

  activeStudioKind: StudioSurfaceKind | null;
  hasScribeActive: boolean;
  manuscriptRailTarget: HTMLElement | null;
  setManuscriptRailTarget: (el: HTMLElement | null) => void;
  exitScribeToScaffold: () => void;

  hasAppStudioActive: boolean;
  exitAppStudioToScaffold: () => void;

  hasFormStudioActive: boolean;
  exitFormStudioToScaffold: () => void;

  hasFlowStudioActive?: boolean;
  exitFlowStudioToScaffold?: () => void;

  hasPredictionStudioActive?: boolean;
  exitPredictionStudioToScaffold?: () => void;

  hasMediaStudioActive: boolean;
  exitMediaStudioToScaffold: () => void;
  openMediaStudio?: boolean;
  mediaProductionId: number | null;
  setMediaProductionId: (id: number | null) => void;
  isMediaRailCollapsed: boolean;
  setIsMediaRailCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  hasProjectStudioActive: boolean;
  exitProjectStudioToScaffold: () => void;
  openProjectStudio?: boolean;

  hasAgentStudioActive: boolean;
  exitAgentStudioToScaffold: () => void;

  hasComputerStudioActive: boolean;
  exitComputerStudioToScaffold: () => void;
  openComputerStudio?: boolean;

  hasSignalStudioActive?: boolean;
  exitSignalStudioToScaffold?: () => void;
  openSignalStudio?: boolean;
  onActiveStudioChange?: (kind: string | null) => void;

  cycleContext: {
    cycleSlug?: string;
    cycleName?: string;
    stageId?: string;
    stageName?: string;
  } | null;
  cycleFleetData: {
    cycleSlug: string | null;
    cycleName: string | null;
    stageId: string | null;
    stageName: string | null;
    apps: CycleFleetApp[];
  } | null;
  isCyclePipelineCollapsed: boolean;
  setIsCyclePipelineCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  isTabbedRailCollapsed: boolean;
  setIsTabbedRailCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onSendMessage: (msg: string) => void;

  notes: SupervisorNote[];
  decisions: CrewDecision[];
  claims: CrewClaim[];
  commitments: CrewCommitment[];
  issues: CrewIssue[];
  plans: CrewPlan[];
  agentTurns: CrewTurn[];

  recordKind: 'decision' | 'claim' | 'commitment';
  setRecordKind: (kind: 'decision' | 'claim' | 'commitment') => void;
  recordText: string;
  setRecordText: (text: string) => void;
  recordSaving: boolean;
  onCreateRecord: () => void;
  onUpdateRecord: (type: 'decisions' | 'claims' | 'commitments', id: number, status: string) => Promise<void>;
  onChangeRoomMode: (mode: CrewSession['mode']) => void;
}

export function CrewRightRailPortal({
  surfaceConnections,
  roomDirection,
  roomWork,
  railRef,
  railTop,
  sidebarLeft,
  effectiveChatWidth,
  isDraggingChatWidth,
  hasStudioActive,
  isChatCollapsed,
  setIsChatCollapsed,
  session,
  roomKey,
  turns,
  roomAttachments,
  selectedAssemblyUnit,
  setSelectedAssemblyUnit,
  setComposerDraft,
  activeStudioKind,
  hasScribeActive,
  manuscriptRailTarget,
  setManuscriptRailTarget,
  exitScribeToScaffold,
  hasAppStudioActive,
  exitAppStudioToScaffold,
  hasFormStudioActive,
  exitFormStudioToScaffold,
  hasFlowStudioActive,
  exitFlowStudioToScaffold,
  hasPredictionStudioActive,
  exitPredictionStudioToScaffold,
  hasMediaStudioActive,
  exitMediaStudioToScaffold,
  openMediaStudio,
  mediaProductionId,
  setMediaProductionId,
  isMediaRailCollapsed,
  setIsMediaRailCollapsed,
  hasProjectStudioActive,
  exitProjectStudioToScaffold,
  openProjectStudio,
  hasAgentStudioActive,
  exitAgentStudioToScaffold,
  hasComputerStudioActive,
  exitComputerStudioToScaffold,
  openComputerStudio,
  hasSignalStudioActive,
  exitSignalStudioToScaffold,
  openSignalStudio,
  onActiveStudioChange,
  cycleContext,
  cycleFleetData,
  isCyclePipelineCollapsed,
  setIsCyclePipelineCollapsed,
  isTabbedRailCollapsed,
  setIsTabbedRailCollapsed,
  onSendMessage,
  notes,
  decisions,
  claims,
  commitments,
  issues,
  plans,
  agentTurns,
  recordKind,
  setRecordKind,
  recordText,
  setRecordText,
  recordSaving,
  onCreateRecord,
  onUpdateRecord,
  onChangeRoomMode,
}: CrewRightRailPortalProps) {
  const [activeTab, setActiveTab] = useState<CrewRailTab>('supervisor');
  useEffect(() => {
    setActiveTab('supervisor');
  }, [roomKey]);
  useEffect(() => {
    const openWork = () => {
      setActiveTab('blackboard');
      setIsTabbedRailCollapsed(false);
      window.setTimeout(() => document.getElementById('crew-workspace')?.scrollIntoView({ block: 'start' }), 0);
    };
    document.addEventListener('crew-open-work-product', openWork);
    return () => document.removeEventListener('crew-open-work-product', openWork);
  }, [setIsTabbedRailCollapsed]);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={railRef}
      style={{
        position: 'fixed',
        top: railTop,
        right: 8,
        bottom: 8,
        zIndex: 50,
        left:
          hasStudioActive && !isChatCollapsed
            ? `${sidebarLeft + effectiveChatWidth}px`
            : undefined,
      }}
      className={cn(
        'min-h-0 flex-col gap-2 lg:right-4 lg:bottom-4 lg:flex-row lg:items-stretch',
        !isDraggingChatWidth && 'transition-all duration-300',
        hasStudioActive && !isChatCollapsed ? 'hidden lg:flex' : 'flex',
        isChatCollapsed
          ? 'left-2 w-auto max-w-none lg:left-[76px] lg:w-[calc(100vw-92px)]'
          : cn(
              'left-2 w-auto lg:left-auto lg:w-auto',
              hasStudioActive && 'lg:w-auto lg:max-w-none lg:overflow-hidden',
            ),
      )}
    >
      {/* Center Studio Active Canvas */}
      {hasStudioActive && (
        <div
          className={cn(
            'flex-1 min-w-0 h-full overflow-hidden flex flex-col',
            isChatCollapsed && 'w-full max-w-none',
          )}
          data-testid="crew-active-studio-canvas"
        >
          <ModularAssemblyPuzzleRail
            showEmpty
            className="flex-1 min-w-0 w-full h-full"
            sessionId={session?.id}
            roomKey={roomKey}
            organizationId={session?.organizationId}
            onSelectionChange={(unit, promptSuggestion) => {
              setSelectedAssemblyUnit(unit);
              if (promptSuggestion) {
                setComposerDraft(promptSuggestion);
              }
              setIsChatCollapsed(false);
            }}
            onExpandChat={() => setIsChatCollapsed(false)}
            onShowTurn={(turnId) => {
              setIsChatCollapsed(false);
              window.setTimeout(() => {
                const target = Array.from(
                  document.querySelectorAll<HTMLElement>('[data-turn-id]'),
                ).find((node) => node.dataset.turnId === String(turnId));
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 0);
            }}
            selectedId={selectedAssemblyUnit?.id ?? null}
            turns={turns}
            attachments={roomAttachments}
            isChatCollapsed={isChatCollapsed}
            onToggleChatCollapse={() => setIsChatCollapsed((prev) => !prev)}
            isScribeVisible={hasScribeActive}
            manuscriptRailTarget={manuscriptRailTarget}
            onExitScribe={exitScribeToScaffold}
            isAppStudioVisible={hasAppStudioActive}
            onExitAppStudio={exitAppStudioToScaffold}
            isFormStudioVisible={hasFormStudioActive}
            onExitFormStudio={exitFormStudioToScaffold}
            isFlowStudioVisible={hasFlowStudioActive}
            onExitFlowStudio={exitFlowStudioToScaffold}
            isPredictionStudioVisible={hasPredictionStudioActive}
            onExitPredictionStudio={exitPredictionStudioToScaffold}
            isMediaStudioVisible={hasMediaStudioActive}
            onExitMediaStudio={exitMediaStudioToScaffold}
            openMediaStudio={openMediaStudio}
            onMediaProductionChange={setMediaProductionId}
            isProjectStudioVisible={hasProjectStudioActive}
            onExitProjectStudio={exitProjectStudioToScaffold}
            openProjectStudio={openProjectStudio}
            isAgentStudioVisible={hasAgentStudioActive}
            onExitAgentStudio={exitAgentStudioToScaffold}
            isComputerStudioVisible={hasComputerStudioActive}
            onExitComputerStudio={exitComputerStudioToScaffold}
            openComputerStudio={openComputerStudio}
            isSignalStudioVisible={hasSignalStudioActive}
            onExitSignalStudio={exitSignalStudioToScaffold}
            openSignalStudio={openSignalStudio}
            onActiveStudioChange={onActiveStudioChange}
          />
        </div>
      )}

      {/* Scribe uses this space for manuscript navigation. */}
      {activeStudioKind === 'scribe' ? (
        <aside
          ref={setManuscriptRailTarget}
          aria-label="Manuscripts"
          data-testid="scribe-manuscripts-right-rail"
          className="flex min-h-0 h-full w-72 lg:w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/85 shadow-sm"
        />
      ) : activeStudioKind === 'media' ? (
        <div
          className={cn(
            'flex min-h-0 h-full shrink-0 flex-col overflow-hidden transition-all duration-300',
            isMediaRailCollapsed ? 'w-9' : 'w-72 lg:w-80',
          )}
        >
          <MediaConfigurationRail
            crewSessionId={session?.id}
            productionId={mediaProductionId}
            isCollapsed={isMediaRailCollapsed}
            onToggleCollapse={() => setIsMediaRailCollapsed((prev) => !prev)}
          />
        </div>
      ) : activeStudioKind !== 'project' &&
        Boolean(cycleContext || (cycleFleetData?.apps && cycleFleetData.apps.length > 0)) ? (
        <CyclePipelineRightRail
          turns={turns}
          activeTopic={session?.activeTopic}
          cycleFleetData={cycleFleetData}
          isCollapsed={isCyclePipelineCollapsed}
          onToggleCollapse={() => setIsCyclePipelineCollapsed((prev) => !prev)}
        />
      ) : null}

      {/* Tabbed Right Rail: Supervisor with Governance, Blackboard with Decisions and Forensics, Assembler */}
      <CrewTabbedRightRail
        activeTab={activeTab}
        onTabChange={setActiveTab}
        turns={turns}
        sessionMode={session?.mode}
        isCollapsed={isTabbedRailCollapsed}
        onToggleCollapse={() => setIsTabbedRailCollapsed((prev) => !prev)}
        onSendMessage={onSendMessage}
        supervisorRail={<>{surfaceConnections}<div className="p-2">{roomDirection}</div>{roomKey && session?.organizationId != null && <CrewReadinessPanel key={`${session.organizationId}:${roomKey}`} roomKey={roomKey} organizationId={session.organizationId} studio={activeStudioKind} />}<AgentChatSupervisorPanel session={session} notes={notes} latestRound={Math.max(0, ...turns.map(turn => turn.round))} /></>}
        blackboardRail={
          <><div className="p-2">{roomWork}</div><AgentChatBlackboard
            session={session}
            roomOpen={session !== null}
            decisions={decisions}
            claims={claims}
            commitments={commitments}
            issues={issues}
            notes={notes}
            plans={plans}
            agentTurns={agentTurns}
            recordKind={recordKind}
            setRecordKind={setRecordKind}
            recordText={recordText}
            setRecordText={setRecordText}
            recordSaving={recordSaving}
            onCreateRecord={onCreateRecord}
            onUpdateRecord={onUpdateRecord}
            onChangeRoomMode={(mode) => void onChangeRoomMode(mode as CrewSession['mode'])}
          /></>
        }
        puzzleRail={
          <ModularAssemblyPuzzleRail
            showEmpty
            className="h-full min-h-0 w-full"
            sessionId={session?.id}
            roomKey={roomKey}
            organizationId={session?.organizationId}
            onSelectionChange={(unit, promptSuggestion) => {
              setSelectedAssemblyUnit(unit);
              if (promptSuggestion) {
                setComposerDraft(promptSuggestion);
              }
              setIsChatCollapsed(false);
            }}
            onExpandChat={() => setIsChatCollapsed(false)}
            onShowTurn={(turnId) => {
              setIsChatCollapsed(false);
              window.setTimeout(() => {
                const target = Array.from(
                  document.querySelectorAll<HTMLElement>('[data-turn-id]'),
                ).find((node) => node.dataset.turnId === String(turnId));
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 0);
            }}
            selectedId={selectedAssemblyUnit?.id ?? null}
            turns={turns}
            attachments={roomAttachments}
            isChatCollapsed={isChatCollapsed}
            onToggleChatCollapse={() => setIsChatCollapsed((prev) => !prev)}
            isScribeVisible={false}
            isAppStudioVisible={false}
            isPredictionStudioVisible={false}
            isFormStudioVisible={false}
            isMediaStudioVisible={false}
            isProjectStudioVisible={false}
            isComputerStudioVisible={false}
            isAgentStudioVisible={false}
            isCollapsed={false}
            onToggleCollapse={() => setIsTabbedRailCollapsed((prev) => !prev)}
          />
        }
      />
    </div>,
    document.body,
  );
}
