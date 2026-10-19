/**
 * AppCard Component
 * 
 * Displays app summary in carousel format
 */

import React from 'react';
import { CheckCircle2, Clock, XCircle, Zap, Pause, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Blueprint, AppStatus } from './types';

interface AppCardProps {
  app: Blueprint;
  isActive: boolean;
  index: number;
  onClick: () => void;
  showDependencies?: boolean;
  compact?: boolean;
}

const STATUS_CONFIG: Record<AppStatus, { icon: React.ReactNode; cls: string; label: string }> = {
  pending: { icon: <Clock className="w-3 h-3" />, cls: 'bg-gray-500/15 text-muted-foreground border-gray-500/20', label: 'PENDING' },
  waiting: { icon: <Clock className="w-3 h-3" />, cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20', label: 'WAITING' },
  waiting_on_app: { icon: <Clock className="w-3 h-3" />, cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20', label: 'WAITING ON APP' },
  active: { icon: <Zap className="w-3 h-3 animate-pulse" />, cls: 'bg-primary/15 text-primary border-primary/20 animate-pulse', label: 'ACTIVE' },
  running: { icon: <Zap className="w-3 h-3 animate-pulse" />, cls: 'bg-primary/15 text-primary border-primary/20 animate-pulse', label: 'RUNNING' },
  completed: { icon: <CheckCircle2 className="w-3 h-3" />, cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', label: 'COMPLETED' },
  failed: { icon: <XCircle className="w-3 h-3" />, cls: 'bg-red-500/15 text-red-400 border-red-500/20', label: 'FAILED' },
  blocked: { icon: <XCircle className="w-3 h-3" />, cls: 'bg-red-500/15 text-red-400 border-red-500/20', label: 'BLOCKED' },
  skipped: { icon: <Pause className="w-3 h-3" />, cls: 'bg-gray-500/15 text-muted-foreground border-gray-500/20 border-dashed', label: 'SKIPPED' },
  paused: { icon: <Pause className="w-3 h-3" />, cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20', label: 'PAUSED' },
};

export function AppCard({ app, isActive, index, onClick, showDependencies = false, compact = false }: AppCardProps) {
  const status = app.status || 'pending';
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const appDomId = `${index}-${app.name}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  
  // Calculate progress if we have step information
  const currentStep = app.currentStep || 0;
  const totalSteps = app.totalSteps || (app.sequence?.length || 1);
  const stepProgress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  
  // Get UI metadata with fallbacks
  const uiMetadata = app.uiMetadata || {};
  const icon = uiMetadata.icon || '📋';
  const color = uiMetadata.color || '#3b82f6';
  const category = uiMetadata.category || 'general';
  
  // Determine card styling based on status and active state
  const cardBaseClasses = 'min-w-[200px] p-4 rounded-xl border transition-all cursor-pointer hover:border-primary/30';
  const activeClasses = isActive 
    ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20' 
    : 'border-white/10 bg-foreground/5 hover:bg-foreground/10';
  
  const statusBorderClasses: Record<string, string> = {
    completed: 'border-emerald-500/30 bg-emerald-500/5',
    failed: 'border-red-500/30 bg-red-500/5',
    blocked: 'border-red-500/30 bg-red-500/5',
    active: 'border-primary/30 bg-primary/5',
    running: 'border-primary/30 bg-primary/5',
    pending: 'border-gray-500/30 bg-gray-500/5',
    waiting: 'border-amber-500/30 bg-amber-500/5',
    skipped: 'border-gray-500/30 bg-gray-500/5 border-dashed',
    paused: 'border-amber-500/30 bg-amber-500/5',
  };
  
  const cardClasses = `${cardBaseClasses} ${activeClasses} ${statusBorderClasses[status] || statusBorderClasses.pending}`;
  
  return (
    <div 
      className={`${cardClasses} app-card-${appDomId}`}
      onClick={onClick}
    >
      <style>{`
        .app-card-${appDomId}.is-active { border-color: ${color}; }
      `}</style>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          {!compact && (
            <Badge 
              variant="outline" 
              className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 ${statusCfg.cls}`}
            >
              {statusCfg.label}
            </Badge>
          )}
        </div>
        {isActive && (
          <div 
            className={`w-2 h-2 rounded-full animate-pulse app-card-pulse-${appDomId}`}
          >
            <style>{`.app-card-pulse-${appDomId} { background-color: ${color}; }`}</style>
          </div>
        )}
      </div>
      
      {/* App Name */}
      <h3 className="text-sm font-bold mb-1 line-clamp-2" title={app.name}>
        {app.name}
      </h3>
      
      {/* Objective (if not compact) */}
      {!compact && app.objective && (
        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-3">
          {app.objective}
        </p>
      )}
      
      {/* Progress Bar (for active/running apps) */}
      {(status === 'active' || status === 'running') && totalSteps > 1 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>Step {currentStep + 1}/{totalSteps}</span>
            <span>{Math.round(stepProgress)}%</span>
          </div>
          <Progress value={stepProgress} className="h-1" />
        </div>
      )}
      
      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        {/* Agent Assignment */}
        {app.primary_agent && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {app.primary_agent.replace('ai-', '').replace('-', ' ')}
          </span>
        )}
        
        {/* Dependencies indicator */}
        {showDependencies && app.dependencies && app.dependencies.length > 0 && (
          <span className="flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {app.dependencies.length}
          </span>
        )}
        
        {/* Estimated duration */}
        {app.estimatedDays && (
          <span>
            {app.estimatedDays}d
          </span>
        )}
      </div>
      
      {/* Category badge (if not compact) */}
      {!compact && category && (
        <div className="mt-2">
          <Badge 
            variant="outline" 
            className="text-[8px] px-1.5 py-0.5 border-white/10"
            style={{ color }}
          >
            {category}
          </Badge>
        </div>
      )}
    </div>
  );
}
