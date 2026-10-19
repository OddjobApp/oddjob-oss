import React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Film, ExternalLink, CheckCircle2, RotateCcw } from 'lucide-react';
import { ConcludeRoomDialog } from './ConcludeRoomDialog';
import type { CrewSession } from './AgentChatPanel';

export interface CrewBottomActionsProps {
  executiveDeckAst?: any;
  onOpenExecutiveBrief: () => void;
  session: CrewSession | null;
  isReopening: boolean;
  isConcluding: boolean;
  isSending: boolean;
  onReopenMeeting: () => void;
  onConcludeMeeting: () => void;
  isConcludeDialogOpen: boolean;
  setIsConcludeDialogOpen: (open: boolean) => void;
  onConfirmConcludeMeeting: () => void;
}

export function CrewBottomActions({
  executiveDeckAst,
  onOpenExecutiveBrief,
  session,
  isReopening,
  isConcluding,
  isSending,
  onReopenMeeting,
  onConcludeMeeting,
  isConcludeDialogOpen,
  setIsConcludeDialogOpen,
  onConfirmConcludeMeeting,
}: CrewBottomActionsProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside
      aria-label="Room lifecycle actions"
      style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 60 }}
      className="fixed bottom-4 right-4 z-floating flex items-center gap-2"
      data-testid="bottom-right-room-actions"
    >
      {executiveDeckAst && (
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenExecutiveBrief}
          className="text-xs font-semibold border-purple-500/40 text-purple-600 dark:text-purple-300 hover:bg-purple-500/10 hover:text-purple-700 dark:hover:text-purple-200 gap-1.5 h-9 px-3 rounded-lg shadow-md bg-card/95 backdrop-blur-md transition-all animate-in fade-in"
          data-testid="deliverables-ready-chip"
          data-tutorial-title="Executive Briefing"
          data-tutorial-description="Interactive full-screen presentation deck covering room deliverables, decisions, and media reels."
          data-tutorial-action="Opens the Executive Briefing & Deliverables presentation deck."
          data-tutorial-hint="Accessible anytime during or after room deliberation."
          title="Open Executive Briefing & Presentation Deck"
        >
          <Film className="h-3.5 w-3.5 text-purple-400" />
          <span>Briefing</span>
          <ExternalLink className="h-3 w-3 opacity-70" />
        </Button>
      )}
      {session?.status === 'archived' ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-card/95 p-1.5 shadow-md backdrop-blur-md">
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            <span>Room Archived</span>
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={onReopenMeeting}
            disabled={isReopening || isSending}
            className="text-xs border-primary/30 text-foreground hover:bg-primary/10 gap-1.5 h-7 px-2.5"
            data-testid="reopen-meeting-btn"
            title="Re-open this room for additional collaboration"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{isReopening ? 'Reopening...' : 'Re-Open Room'}</span>
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onConcludeMeeting}
          disabled={isConcluding || isSending}
          className="text-xs font-semibold border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 gap-2 h-9 px-3.5 rounded-lg shadow-md bg-card/95 backdrop-blur-md transition-all"
          data-testid="conclude-meeting-btn"
          data-tutorial-title="Close Room"
          data-tutorial-description="Room lifecycle control for concluding and archiving deliberation sessions."
          data-tutorial-action="Closes the room, archives active deliberations, and generates an executive closing report."
          data-tutorial-hint="You can re-open the room at any time if further collaboration is needed."
          title="Formally close room and generate an executive closing report"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span>{isConcluding ? 'Closing...' : 'Close Room'}</span>
        </Button>
      )}

      <ConcludeRoomDialog
        open={isConcludeDialogOpen}
        onOpenChange={setIsConcludeDialogOpen}
        onConfirm={onConfirmConcludeMeeting}
      />
    </aside>,
    document.body,
  );
}
