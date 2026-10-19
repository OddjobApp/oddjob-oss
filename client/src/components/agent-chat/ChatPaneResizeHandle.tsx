import React from 'react';
import { cn } from '@/lib/utils';

export interface ChatPaneResizeHandleProps {
  hasStudioActive: boolean;
  isChatCollapsed: boolean;
  effectiveChatWidth: number;
  maxChatWidth: number;
  isDraggingChatWidth: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function ChatPaneResizeHandle({
  hasStudioActive,
  isChatCollapsed,
  effectiveChatWidth,
  maxChatWidth,
  isDraggingChatWidth,
  onMouseDown,
  onTouchStart,
  onDoubleClick,
  onKeyDown,
}: ChatPaneResizeHandleProps) {
  if (!hasStudioActive || isChatCollapsed) return null;

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize chat pane"
      aria-valuenow={Math.round(effectiveChatWidth)}
      aria-valuemin={280}
      aria-valuemax={Math.round(maxChatWidth)}
      data-testid="chat-pane-resize-handle"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        'hidden lg:flex group absolute top-0 bottom-0 -right-2 w-4 z-30 cursor-col-resize select-none items-center justify-center',
        'hover:bg-primary/10 transition-colors',
        isDraggingChatWidth && 'bg-primary/15',
      )}
      title="Drag to resize chat pane · Double-click to reset"
    >
      {/* Visual guide line */}
      <div
        className={cn(
          'w-0.5 h-full transition-colors',
          isDraggingChatWidth
            ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]'
            : 'bg-transparent group-hover:bg-primary/80',
        )}
      />
      {/* Visual grab pill indicator */}
      <div
        className={cn(
          'absolute top-1/2 -translate-y-1/2 w-1.5 h-8 rounded-full transition-all flex flex-col items-center justify-center gap-0.5 shadow-sm',
          isDraggingChatWidth
            ? 'bg-primary scale-110 shadow-primary/50'
            : 'bg-muted-foreground/40 group-hover:bg-primary group-hover:scale-110',
        )}
      >
        <div className="w-0.5 h-0.5 rounded-full bg-background/80" />
        <div className="w-0.5 h-0.5 rounded-full bg-background/80" />
        <div className="w-0.5 h-0.5 rounded-full bg-background/80" />
      </div>
    </div>
  );
}
