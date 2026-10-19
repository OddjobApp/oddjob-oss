/**
 * StepProgress Component
 * 
 * Visualize step-by-step progress within an app
 */

import React from 'react';
import { CheckCircle2, Clock, Zap, XCircle, SkipForward } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { Step, StepStatus } from './types';

interface StepProgressProps {
  steps: Step[];
  currentStepIndex: number;
  onStepClick?: (stepIndex: number) => void;
  compact?: boolean;
  showLabels?: boolean;
}

const STATUS_CONFIG: Record<StepStatus, { icon: React.ReactNode; color: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, color: 'bg-gray-500' },
  active: { icon: <Zap className="w-4 h-4 animate-pulse" />, color: 'bg-primary' },
  completed: { icon: <CheckCircle2 className="w-4 h-4" />, color: 'bg-emerald-500' },
  failed: { icon: <XCircle className="w-4 h-4" />, color: 'bg-red-500' },
  skipped: { icon: <SkipForward className="w-4 h-4" />, color: 'bg-gray-500' },
  waiting: { icon: <Clock className="w-4 h-4" />, color: 'bg-amber-500' },
};

export function StepProgress({ 
  steps, 
  currentStepIndex, 
  onStepClick, 
  compact = false, 
  showLabels = true 
}: StepProgressProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No steps defined
      </div>
    );
  }

  const progressPercentage = steps.length > 0 
    ? ((currentStepIndex + 1) / steps.length) * 100 
    : 0;

  return (
    <div className="space-y-4">
      {/* Overall Progress Bar */}
      {!compact && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-medium">{Math.round(progressPercentage)}%</span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>
      )}

      {/* Step List */}
      <div className="space-y-2">
        {steps.map((step, index) => {
          const stepStatus = index < currentStepIndex ? 'completed' : 
                            index === currentStepIndex ? 'active' : 'pending';
          const statusConfig = STATUS_CONFIG[stepStatus] || STATUS_CONFIG.pending;
          const isCurrentStep = index === currentStepIndex;
          const isClickable = onStepClick && stepStatus !== 'pending';

          return (
            <div
              key={step.stepCode || index}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                isCurrentStep 
                  ? 'border-primary bg-primary/10' 
                  : stepStatus === 'completed'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-white/10 bg-foreground/5'
              } ${isClickable ? 'cursor-pointer hover:border-primary/50' : ''}`}
              onClick={() => isClickable && onStepClick(index)}
            >
              {/* Step Icon */}
              <div 
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${statusConfig.color}`}
              >
                {statusConfig.icon}
              </div>

              {/* Step Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{step.action}</span>
                  {step.ui_metadata?.display_name && (
                    <Badge variant="outline" className="text-[9px]">
                      {step.ui_metadata.display_name}
                    </Badge>
                  )}
                  {isCurrentStep && (
                    <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                      Current
                    </Badge>
                  )}
                </div>
                
                {step.description && showLabels && (
                  <p className="text-[10px] text-muted-foreground line-clamp-2">
                    {step.description}
                  </p>
                )}
                
                {/* Additional Info */}
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  {step.agent && (
                    <span>Agent: {step.agent}</span>
                  )}
                  {step.estimated_duration_minutes && (
                    <span>Est. {step.estimated_duration_minutes}m</span>
                  )}
                  {step.tool && (
                    <span>Tool: {step.tool}</span>
                  )}
                </div>
              </div>

              {/* Step Status Badge */}
              {compact && (
                <Badge 
                  variant="outline" 
                  className={`text-[9px] ${
                    stepStatus === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                    stepStatus === 'active' ? 'bg-primary/15 text-primary border-primary/20' :
                    'bg-gray-500/15 text-muted-foreground border-gray-500/20'
                  }`}
                >
                  {stepStatus.toUpperCase()}
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      {/* Step Count */}
      <div className="text-[10px] text-muted-foreground text-center">
        Step {currentStepIndex + 1} of {steps.length}
      </div>
    </div>
  );
}
