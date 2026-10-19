'use client';

import { useState, useEffect } from 'react';
import { getBlueprintExecutionService, MissionStep } from '@/lib/blueprint-execution';

interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
  output?: any;
  error?: string;
}

interface WorkflowVisualizationProps {
  workflowName: string;
  steps: WorkflowStep[];
  executionId?: string;
  onStepClick?: (stepId: string) => void;
}

export function WorkflowVisualization({ workflowName, steps, executionId, onStepClick }: WorkflowVisualizationProps) {
  const [localSteps, setLocalSteps] = useState<WorkflowStep[]>(steps);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [isRealTime, setIsRealTime] = useState(!!executionId);

  useEffect(() => {
    if (executionId) {
      const service = getBlueprintExecutionService();
      
      service.startPolling(executionId, (status) => {
        if (status.steps && status.steps.length > 0) {
          const updatedSteps: WorkflowStep[] = status.steps.map((step: MissionStep) => ({
            id: step.stepId,
            name: step.name,
            status: step.status,
            duration: step.duration,
            output: step.output,
            error: step.error,
          }));
          setLocalSteps(updatedSteps);
        }
      }, 2000);

      return () => {
        service.stopPolling(executionId);
      };
    }
  }, [executionId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-blue-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-slate-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✓';
      case 'running': return '⟳';
      case 'failed': return '✗';
      default: return '○';
    }
  };

  const handleStepClick = (stepId: string) => {
    setSelectedStep(stepId);
    if (onStepClick) {
      onStepClick(stepId);
    }
  };

  const selectedStepData = localSteps.find(step => step.id === selectedStep);

  return (
    <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{workflowName}</h3>
        {isRealTime && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-green-400">Live</span>
          </div>
        )}
      </div>
      
      {/* Workflow Timeline */}
      <div className="relative">
        {/* Progress Line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-700" />
        
        {/* Steps */}
        <div className="space-y-4">
          {localSteps.map((step, index) => (
            <div key={step.id} className="relative flex items-start gap-4">
              {/* Status Indicator */}
              <div 
                className={`w-8 h-8 rounded-full ${getStatusColor(step.status)} flex items-center justify-center text-white font-semibold z-10 cursor-pointer hover:scale-110 transition-transform`}
                onClick={() => handleStepClick(step.id)}
              >
                {getStatusIcon(step.status)}
              </div>
              
              {/* Step Content */}
              <div 
                className={`flex-1 p-4 rounded-lg border cursor-pointer transition-colors ${
                  selectedStep === step.id 
                    ? 'bg-blue-600/20 border-blue-500' 
                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                }`}
                onClick={() => handleStepClick(step.id)}
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">{step.name}</h4>
                  {step.duration && (
                    <span className="text-xs text-muted-foreground">{step.duration}m</span>
                  )}
                </div>
                
                {step.status === 'running' && (
                  <div className="mt-2 text-xs text-blue-400">Processing...</div>
                )}
                
                {step.status === 'failed' && step.error && (
                  <div className="mt-2 text-xs text-red-400">{step.error}</div>
                )}
                
                {step.status === 'completed' && step.output && (
                  <div className="mt-2 text-xs text-green-400">Completed successfully</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step Details Panel */}
      {selectedStepData && (
        <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <h4 className="font-semibold mb-2">Step Details: {selectedStepData.name}</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className={`font-medium ${
                selectedStepData.status === 'completed' ? 'text-green-400' :
                selectedStepData.status === 'failed' ? 'text-red-400' :
                selectedStepData.status === 'running' ? 'text-blue-400' : 'text-slate-400'
              }`}>
                {selectedStepData.status.toUpperCase()}
              </span>
            </div>
            
            {selectedStepData.duration && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span>{selectedStepData.duration} minutes</span>
              </div>
            )}
            
            {selectedStepData.error && (
              <div className="mt-2">
                <span className="text-muted-foreground">Error:</span>
                <div className="mt-1 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400">
                  {selectedStepData.error}
                </div>
              </div>
            )}
            
            {selectedStepData.output && (
              <div className="mt-2">
                <span className="text-muted-foreground">Output:</span>
                <pre className="mt-1 p-2 bg-slate-900 rounded text-xs overflow-auto max-h-32">
                  {JSON.stringify(selectedStepData.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface WorkflowMetricsProps {
  totalWorkflows: number;
  activeWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  averageDuration: number;
}

export function WorkflowMetrics({ 
  totalWorkflows, 
  activeWorkflows, 
  completedWorkflows, 
  failedWorkflows, 
  averageDuration 
}: WorkflowMetricsProps) {
  const successRate = totalWorkflows > 0 
    ? Math.round((completedWorkflows / totalWorkflows) * 100) 
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="text-2xl font-bold">{totalWorkflows}</div>
        <div className="text-xs text-muted-foreground">Total Workflows</div>
      </div>
      
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="text-2xl font-bold text-blue-400">{activeWorkflows}</div>
        <div className="text-xs text-muted-foreground">Active</div>
      </div>
      
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="text-2xl font-bold text-green-400">{completedWorkflows}</div>
        <div className="text-xs text-muted-foreground">Completed</div>
      </div>
      
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="text-2xl font-bold text-red-400">{failedWorkflows}</div>
        <div className="text-xs text-muted-foreground">Failed</div>
      </div>
      
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="text-2xl font-bold text-purple-400">{successRate}%</div>
        <div className="text-xs text-muted-foreground">Success Rate</div>
      </div>
    </div>
  );
}
