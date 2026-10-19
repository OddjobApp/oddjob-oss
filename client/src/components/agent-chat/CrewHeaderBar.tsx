import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Boxes,
  CheckCircle2,
  ChevronLeft,
  Cpu,
  GitBranch,
  Info,
  LayoutTemplate,
  Link as LinkIcon,
  UserPlus,
  Users,
} from 'lucide-react';
import { CrewRoster } from './CrewRoster';
import type { AgentCard, CrewSession, Participant, CrewDecision, CrewClaim } from './AgentChatPanel';
import type { CycleFleetApp } from './CrewCycleAppCanvas';

export interface CrewHeaderBarProps {
  appStudioControl?: React.ReactNode;
  headerRef?: React.Ref<HTMLDivElement>;
  breakoutLineage: {
    parent: { sessionKey: string; title: string | null; url: string } | null;
    children: Array<{ id: number; subTopic: string; suggestedBy: string; sessionKey: string; title: string | null; url: string }>;
  } | null;
  cycleFleetData: {
    cycleSlug: string | null;
    cycleName: string | null;
    stageId: string | null;
    stageName: string | null;
    apps: CycleFleetApp[];
  } | null;
  session: CrewSession | null;
  executiveDeckAst?: any;
  isCanvasOpen: boolean;
  onToggleCanvas: () => void;
  agents: AgentCard[];
  selectedIds: number[];
  onToggleAgent: (id: number) => void;
  isLoading: boolean;
  participants: Participant[];
  inviteOpen: boolean;
  setInviteOpen: (open: boolean) => void;
  inviteValue: string;
  setInviteValue: (val: string) => void;
  onInvite: () => void;
  copied: boolean;
  onCopyLink: () => void;
  decisions: CrewDecision[];
  claims: CrewClaim[];
}

export function CrewHeaderBar({
  appStudioControl,
  headerRef,
  breakoutLineage,
  cycleFleetData,
  session,
  executiveDeckAst,
  isCanvasOpen,
  onToggleCanvas,
  agents,
  selectedIds,
  onToggleAgent,
  isLoading,
  participants,
  inviteOpen,
  setInviteOpen,
  inviteValue,
  setInviteValue,
  onInvite,
  copied,
  onCopyLink,
  decisions,
  claims,
}: CrewHeaderBarProps) {
  return (
    <div
      ref={headerRef}
      className="border-b border-border/60 bg-background pt-0 pb-2 flex-shrink-0 z-20"
      data-testid="crew-header"
    >
      {Boolean(
        breakoutLineage?.parent ||
        (breakoutLineage?.children && breakoutLineage.children.length > 0) ||
        cycleFleetData?.cycleSlug ||
        (cycleFleetData?.apps && cycleFleetData.apps.length > 0) ||
        session?.status === 'archived' ||
        executiveDeckAst
      ) && (
        <div className="flex items-baseline gap-2 flex-wrap mb-1.5 px-4">
          {breakoutLineage?.parent && (
            <a
              href={breakoutLineage.parent.url}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-700 dark:text-emerald-300 transition-colors bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md"
              data-testid="parent-room-breadcrumb"
              title={`Breakout of: ${breakoutLineage.parent.title || breakoutLineage.parent.sessionKey}`}
            >
              <ChevronLeft className="h-3 w-3" />
              <span className="truncate max-w-[200px]">From: {breakoutLineage.parent.title || 'Parent Room'}</span>
            </a>
          )}
          {breakoutLineage?.children && breakoutLineage.children.length > 0 && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span>{breakoutLineage.children.length} Breakout{breakoutLineage.children.length > 1 ? 's' : ''}</span>
            </Badge>
          )}
          {cycleFleetData?.cycleSlug && (
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-700 dark:text-cyan-300 flex items-center gap-1 font-mono">
              <Boxes className="h-3 w-3" />
              <span>{cycleFleetData.cycleName || cycleFleetData.cycleSlug}{cycleFleetData.stageName ? ` : ${cycleFleetData.stageName}` : ''}</span>
            </Badge>
          )}
          {cycleFleetData?.apps && cycleFleetData.apps.length > 0 && (
            <Button
              variant={isCanvasOpen ? "default" : "outline"}
              size="sm"
              onClick={onToggleCanvas}
              className={cn(
                "text-xs gap-1.5 h-7 px-2.5 transition-all",
                isCanvasOpen
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
              )}
              data-testid="toggle-app-canvas-btn"
              title="Toggle live Cycle App Surface Canvas split view"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              <span>{isCanvasOpen ? 'Hide App Canvas' : 'App Canvas'}</span>
              <span className="ml-0.5 rounded-full bg-cyan-500/20 px-1 py-0.2 text-[9px] font-mono font-bold">
                {cycleFleetData.apps.length}
              </span>
            </Button>
          )}
          {session?.status === 'archived' && (
            <Badge variant="outline" className="ml-auto border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              <span>Room Concluded & Archived</span>
            </Badge>
          )}
        </div>
      )}

      {/* Agent Bar with contrast separation from top navigation — full-width, square, end-to-end */}
      <div
        className="w-full rounded-none border-y border-border/80 bg-muted/80 dark:bg-muted/50 backdrop-blur-md px-4 py-1.5 flex items-center"
        data-testid="crew-roster-container"
        data-tutorial-snippet="snippet:crew-roster"
        data-component-id="crew-roster"
      >
        <div className="min-w-0 w-full space-y-2">
          <CrewRoster agents={agents} selectedIds={selectedIds} onToggle={onToggleAgent} isLoading={isLoading} />
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 px-4" data-testid="crew-people">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        {participants.map((p) => (
          <span
            key={p.userId}
            title={`@${p.username}${p.role === 'owner' ? ' — room host' : ''}`}
            className="rounded-md border border-border/60 bg-card/60 px-2 py-0.5 text-[11px] text-foreground/85"
          >
            {p.displayName}
            {p.role === 'owner' && <span className="ml-1 text-muted-foreground">★</span>}
          </span>
        ))}
        {inviteOpen ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={inviteValue}
              onChange={(e) => setInviteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onInvite();
                if (e.key === 'Escape') setInviteOpen(false);
              }}
              placeholder="username…"
              className="w-32 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="crew-invite-input"
            />
            <button
              type="button"
              onClick={onInvite}
              className="rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
            >
              Add
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            data-testid="crew-invite-open"
          >
            <UserPlus className="h-3 w-3" />
            Add person
          </button>
        )}
        <button
          type="button"
          onClick={onCopyLink}
          className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          data-testid="crew-copy-link"
        >
          <LinkIcon className="h-3 w-3" />
          {copied ? 'Copied' : 'Copy link'}
        </button>

        {/* Dynamic Squad Presence Badge & Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-700 dark:text-purple-300 hover:border-purple-500/60 transition-colors"
              data-testid="squad-presence-badge"
            >
              <Users className="h-3 w-3 text-purple-400" />
              <span className="font-medium">Active Squad</span>
              <span className="text-purple-700 dark:text-purple-300 font-sans">
                · {participants.length || 1} Human{participants.length > 1 ? 's' : ''} · {selectedIds.length} Agent{selectedIds.length === 1 ? '' : 's'}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3 bg-popover/95 backdrop-blur-md border-border/80 shadow-lg text-xs" align="end">
            <div className="flex items-center justify-between pb-2 border-b border-border/60 mb-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-purple-400" />
                Squad Roster & Liveness
              </span>
              <Badge variant="outline" className="text-[9px] font-mono text-purple-700 dark:text-purple-300 border-purple-500/30">
                Host: {participants[0]?.displayName || 'Admin'}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {participants.map((p) => (
                <div key={p.userId} className="flex items-center justify-between p-1.5 rounded bg-muted/40 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="font-medium text-foreground">{p.displayName}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {p.role === 'owner' ? 'Human · Host' : 'Human · Member'}
                  </span>
                </div>
              ))}
              {agents.filter((a) => selectedIds.includes(a.id)).map((a) => (
                <div key={a.id} className="flex items-center justify-between p-1.5 rounded bg-muted/40 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    <span className="font-medium text-cyan-700 dark:text-cyan-300 truncate max-w-[140px]">{a.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[90px]">
                    {a.personaType || 'Agent · Active'}
                  </span>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Live Blackboard / Working Memory Popover */}
        {appStudioControl}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border"
              data-testid="toggle-blackboard-popover"
            >
              <Info className="h-3 w-3 text-primary" />
              <span>Memory HUD</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3 bg-popover/95 backdrop-blur-md border-border/80 shadow-lg text-xs" align="end">
            <div className="flex items-center justify-between pb-2 border-b border-border/60 mb-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                Active Blackboard State
              </span>
              <Badge variant="outline" className="text-[9px] font-mono text-emerald-400 border-emerald-500/30">
                Synchronized
              </Badge>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between bg-muted/40 p-1 rounded">
                <span className="text-muted-foreground">activeTopic:</span>
                <span className="text-foreground font-semibold truncate max-w-[170px]">{session?.activeTopic || "Operational Deliberation"}</span>
              </div>
              <div className="flex justify-between bg-muted/40 p-1 rounded">
                <span className="text-muted-foreground">decisions:</span>
                <span className="text-cyan-700 dark:text-cyan-300 font-semibold">{decisions.length} recorded</span>
              </div>
              <div className="flex justify-between bg-muted/40 p-1 rounded">
                <span className="text-muted-foreground">claims & evidence:</span>
                <span className="text-emerald-400 font-semibold">{claims.length} verified</span>
              </div>
              <div className="flex justify-between bg-muted/40 p-1 rounded">
                <span className="text-muted-foreground">roomStatus:</span>
                <span className={session?.status === 'archived' ? 'text-amber-400' : 'text-emerald-400'}>
                  {session?.status === 'archived' ? 'Archived' : 'Active Deliberation'}
                </span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
