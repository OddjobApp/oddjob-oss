import { Clock, Bot, Sparkles, Radio, Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowOutput } from './WorkflowHistory';

interface WorkflowSummaryCardProps {
  workflow: WorkflowOutput;
  onClick: () => void;
}

export function WorkflowSummaryCard({ workflow, onClick }: WorkflowSummaryCardProps) {
  const getActionIcon = () => {
    switch (workflow.action.type) {
      case 'subscription': return Bot;
      case 'cycle': return Sparkles;
      case 'source': return Radio;
      case 'monitor': return Activity;
      default: return Activity;
    }
  };

  const getActionColor = () => {
    switch (workflow.action.type) {
      case 'subscription': return 'bg-blue-500/15 text-blue-400';
      case 'cycle': return 'bg-purple-500/15 text-purple-400';
      case 'source': return 'bg-amber-500/15 text-amber-400';
      case 'monitor': return 'bg-emerald-500/15 text-emerald-400';
      default: return 'bg-slate-500/15 text-muted-foreground';
    }
  };

  const getImpactColor = () => {
    switch (workflow.action.impact) {
      case 'Critical': return 'text-red-400';
      case 'High': return 'text-amber-400';
      case 'Medium': return 'text-blue-400';
      case 'Low': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  };

  const ActionIcon = getActionIcon();
  const timeAgo = getTimeAgo(workflow.timestamp);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card/40 p-4 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', getActionColor())}>
          <ActionIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold truncate">{workflow.signal.title}</span>
            <span className={cn('text-[10px] font-medium', getImpactColor())}>
              {workflow.action.impact}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {workflow.action.description}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo}
            </span>
            <span>•</span>
            <span>{workflow.signal.kind}</span>
            <span>•</span>
            <span>Score {workflow.signal.score}</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-2" />
      </div>
    </button>
  );
}

function getTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
