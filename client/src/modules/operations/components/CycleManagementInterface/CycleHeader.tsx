/**
 * CycleHeader Component
 * 
 * Displays cycle context, global controls, and status summary
 */

import React, { useState, useMemo } from 'react';
import { 
  LayoutDashboard, Play, Pause, Settings, RefreshCcw, 
  ArrowLeft, CheckCircle2, Clock, DollarSign, 
  Target, ShieldAlert, XCircle, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useCycleStore } from './cycleStore';
import type { Cycle, CycleStatus } from './types';

interface CycleHeaderProps {
  cycle: Cycle;
  onPause?: () => void;
  onResume?: () => void;
  onAbort?: () => void;
  onConfigure?: () => void;
  onRefresh?: () => void;
  isMutating?: boolean;
  showBudget?: boolean;
  showMetrics?: boolean;
}

const STATUS_CONFIG: Record<CycleStatus, { label: string; cls: string }> = {
  active: { label: 'ACTIVE', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  running: { label: 'RUNNING', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 animate-pulse' },
  paused: { label: 'PAUSED', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  pending_approval: { label: 'PENDING', cls: 'bg-primary/15 text-primary border-primary/20 animate-pulse' },
  reviewing: { label: 'REVIEWING', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  closed: { label: 'CLOSED', cls: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'CANCELLED', cls: 'bg-red-500/15 text-red-400 border-red-500/20' },
  failed: { label: 'FAILED', cls: 'bg-red-500/15 text-red-400 border-red-500/20' },
};

function safeDate(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(); } catch { return '—'; }
}

function safeTime(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return '—'; }
}

export function CycleHeader({
  cycle,
  onPause,
  onResume,
  onAbort,
  onConfigure,
  onRefresh,
  isMutating = false,
  showBudget = true,
  showMetrics = true,
}: CycleHeaderProps) {
  const [showFullObjective, setShowFullObjective] = useState(false);
  
  const { getCompletedApps, getActiveApps, getFailedApps } = useCycleStore();
  
  const completedApps = getCompletedApps() || [];
  const activeApps = getActiveApps() || [];
  const failedApps = getFailedApps() || [];
  
  const totalApps = cycle.metadata?.blueprints?.length || 0;
  const progressPercentage = totalApps > 0 ? (completedApps.length / totalApps) * 100 : 0;
  
  const budgetNum = parseFloat(String(cycle.budgetLimitUsd || 0)) || 0;
  const totalSpend = cycle.outcomeMetrics?.totalSpend || 0;
  const budgetPct = budgetNum > 0 ? Math.min((totalSpend / budgetNum) * 100, 100) : 0;
  const budgetWarning = budgetPct >= 80;
  
  const statusCfg = STATUS_CONFIG[cycle.status as CycleStatus] || { label: (cycle.status || 'unknown').toUpperCase(), cls: 'bg-muted text-muted-foreground' };
  const isTerminated = ['closed', 'cancelled', 'failed'].includes(cycle.status || '');
  const isPaused = (cycle.status || '') === 'paused';
  
  return (
    <div className="bg-black/20 p-5 rounded-2xl border border-white/5 backdrop-blur-2xl">
      {/* Progress & Metrics */}
      {(showBudget || showMetrics) && (
        <div className="w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Progress */}
            {showMetrics && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Cycle Progress</span>
                  <span className="font-medium">{Math.round(progressPercentage)}%</span>
                </div>
                <Progress value={progressPercentage} className="h-2" />
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> {completedApps.length} completed
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-primary" /> {activeApps.length} active
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-400" /> {failedApps.length} failed
                  </span>
                </div>
              </div>
            )}
            
            {/* Budget */}
            {showBudget && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Budget Usage</span>
                  <span className={`font-medium ${budgetWarning ? 'text-amber-400' : ''}`}>
                    ${totalSpend.toFixed(2)} / ${budgetNum.toFixed(2)}
                  </span>
                </div>
                <Progress 
                  value={budgetPct} 
                  className={`h-2 ${budgetWarning ? 'bg-amber-500/20' : ''}`}
                />
                <div className="text-[10px] text-muted-foreground">
                  {budgetPct.toFixed(1)}% of budget used
                </div>
              </div>
            )}
            
            {/* Quick Stats */}
            {showMetrics && cycle.outcomeMetrics && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium">
                    {cycle.outcomeMetrics.successRate 
                      ? `${cycle.outcomeMetrics.successRate.toFixed(1)}%` 
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total Tokens</span>
                  <span className="font-medium">
                    {cycle.outcomeMetrics.totalTokens 
                      ? cycle.outcomeMetrics.totalTokens.toLocaleString() 
                      : '—'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
