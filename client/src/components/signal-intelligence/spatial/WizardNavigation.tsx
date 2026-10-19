import { ChevronLeft, ChevronRight, SkipForward, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWizard } from './WizardContext';

interface WizardNavigationProps {
  onNext: () => void;
  onPrevious: () => void;
  onSkip?: () => void;
  onCancel: () => void;
  canNext: boolean;
  canPrevious: boolean;
  canSkip?: boolean;
  isLastStep: boolean;
  totalSteps: number;
}

export function WizardNavigation({
  onNext,
  onPrevious,
  onSkip,
  onCancel,
  canNext,
  canPrevious,
  canSkip = false,
  isLastStep,
  totalSteps,
}: WizardNavigationProps) {
  const { state } = useWizard();

  return (
    <div className="flex items-center justify-between border-t border-border bg-card/40 p-4">
      <div className="flex items-center gap-2">
        {canPrevious && (
          <button
            onClick={onPrevious}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
        )}
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>

      <div className="flex items-center gap-2">
        {canSkip && onSkip && (
          <button
            onClick={onSkip}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <SkipForward className="h-4 w-4" />
            Skip
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!canNext}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
            canNext
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          {isLastStep ? 'Complete' : 'Next'}
          {!isLastStep && <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
  stepNames: string[];
  onStepClick?: (step: number) => void;
}

export function WizardProgress({ currentStep, totalSteps, stepNames, onStepClick }: WizardProgressProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="mb-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </span>
        <span className="text-xs font-medium text-primary">{Math.round(progress)}% Complete</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {stepNames.map((name, index) => {
          const stepNum = index + 1;
          const isActive = stepNum === currentStep;

          return (
            <button
              key={index}
              type="button"
              onClick={() => onStepClick?.(stepNum)}
              className={cn(
                'flex-1 min-w-[120px] rounded-full px-3 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer border shadow-xs hover:opacity-90',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm ring-2 ring-primary/30'
                  : stepNum < currentStep
                  ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
                  : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
              )}
            >
              {stepNum}. {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
