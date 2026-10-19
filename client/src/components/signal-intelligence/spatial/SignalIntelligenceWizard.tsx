import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { WizardProvider, useWizard } from './WizardContext';
import { WizardProgress, WizardNavigation } from './WizardNavigation';
import { SignalDetectionPanel } from './SignalDetectionPanel';
import { ActionSelectionPanel } from './ActionSelectionPanel';
import { SubscriptionsView } from './SubscriptionsView';
import { CycleLaunchPanel } from './CycleLaunchPanel';
import { SourcesView } from './SourcesView';
import { EventBackboneView } from './EventBackboneView';

import { RuleBuilder } from './RuleBuilder';

interface SignalIntelligenceWizardProps {
  onClose?: () => void;
  onComplete?: () => void;
  initialWorkflow?: any;
}

const STEP_NAMES = [
  'Signal Detection',
  'Choose Action',
  'Configure Response',
  'Monitor Status',
  'Complete',
];

function WizardInner({ onClose, onComplete }: SignalIntelligenceWizardProps = {}) {
  const [, navigate] = useLocation();
  const { state, setCurrentStep, setSelectedSignal, resetWizard, suspendedRun, resumeSuspendedRun, discardSuspendedRun } = useWizard();

  const handleBackToDashboard = () => {
    resetWizard();
    if (onClose) {
      onClose();
    } else {
      navigate('/signal-intelligence');
    }
  };

  const handleSignalSelect = (signal: any) => {
    setSelectedSignal(signal);
  };

  /**
   * Whether there is anything to select on step 1. Same query key the panel
   * uses, so react-query serves it from cache rather than refetching.
   */
  const { data: availableEvents = [] } = useQuery<unknown[]>({
    queryKey: ['/api/event-primitives?limit=100'],
  });
  const hasSignals = availableEvents.length > 0;

  /**
   * Whether step 3's embedded panel has reported success. It is the wizard's
   * only honest completion signal for that step: the panels own the work and
   * write their own data, so the shell learns about it through these callbacks
   * rather than by inspecting state nothing populates.
   */
  const [stepCommitted, setStepCommitted] = useState(false);

  // Re-entering a step means its previous commitment no longer applies.
  useEffect(() => { setStepCommitted(false); }, [state.currentStep, state.selectedAction]);

  const handleSubscriptionComplete = () => {
    setStepCommitted(true);
    setCurrentStep(4);
  };

  const handleCycleComplete = () => {
    setStepCommitted(true);
    setCurrentStep(4);
  };

  const handleSourceComplete = () => {
    setStepCommitted(true);
    setCurrentStep(4);
  };

  const handleMonitorComplete = () => {
    setCurrentStep(5);
  };

  const handleNext = () => {
    if (state.currentStep < 5) {
      setCurrentStep(state.currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (state.currentStep > 1) {
      setCurrentStep(state.currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (state.currentStep < 5) {
      setCurrentStep(state.currentStep + 1);
    }
  };

  const handleCancel = () => {
    resetWizard();
    if (onClose) {
      onClose();
    } else {
      navigate('/signal-intelligence');
    }
  };

  const handleComplete = () => {
    resetWizard();
    if (onComplete) {
      onComplete();
    } else {
      navigate('/signal-intelligence/workflows');
    }
  };

  /**
   * What each step actually requires before it makes sense to leave it.
   *
   * Step 3 used to gate on `subscriptionData.cycleId`, which NOTHING ever sets
   * — `setSubscriptionData` has no callers — so Next was permanently disabled
   * on the default path and the only ways forward were Skip or the embedded
   * RuleBuilder's own Deploy button. The step's real completion signal is the
   * one its panels already fire (`onDeploy` / `onComplete`), so that is what
   * it gates on now.
   *
   * Steps 1 and 2 returned bare `true`, so a signal was optional despite the
   * step being called "Select a Signal" — and step 3 then built a rule against
   * a null signal.
   */
  const canNext = () => {
    switch (state.currentStep) {
      case 1:
        // Choosing a signal is the purpose of this step — but only when there
        // is one to choose. With an empty feed the step shows a "connect a
        // source" form instead, and step 1 has no Skip, so requiring a
        // selection outright would make the wizard unusable in a fresh
        // environment. The signal is context for the rule, not a prerequisite.
        return state.selectedSignal !== null || !hasSignals;
      case 2:
        return state.selectedAction !== null;
      case 3:
        // Each branch reports completion through its own panel; `stepCommitted`
        // records that. The cycle branch additionally accepts a typed name, so
        // a user who filled the form is not blocked on a callback.
        return stepCommitted || (state.selectedAction === 'cycle' && state.cycleData.name !== '');
      case 4:
      case 5:
        return true;
      default:
        return false;
    }
  };

  const canPrevious = state.currentStep > 1;
  const canSkip = state.canSkip?.[state.currentStep - 1] || false;
  const isLastStep = state.currentStep === 5;

  return (
    <div className="min-h-screen bg-background flex flex-col justify-between">
      {/* Header */}
      <div className="border-b border-border bg-card/40 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-[1850px] w-full mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBackToDashboard}
                className="rounded-lg p-2 hover:bg-accent transition-colors"
                title="Back to Signal Intelligence"
              >
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Signal Intelligence Wizard
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Guided workflow for signal detection, analysis, and governed response
                </p>
              </div>
            </div>

            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 border border-border text-sm font-medium rounded-lg hover:bg-accent transition-colors text-foreground"
            >
              <X className="h-4 w-4" />
              Exit Wizard
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="border-t border-border bg-card/20 px-4 py-2.5">
          <div className="max-w-[1850px] w-full mx-auto">
            <WizardProgress
              currentStep={state.currentStep}
              totalSteps={5}
              stepNames={STEP_NAMES}
              onStepClick={(step) => {
                setCurrentStep(step);
              }}
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-[1850px] w-full mx-auto p-4 overflow-y-auto">
        {/* An unfinished run is offered, never imposed. Restoring silently
            dropped people into the middle of a flow from a previous session
            with no explanation and no obvious way back to the start. */}
        {suspendedRun && (
          <div
            role="status"
            data-testid="wizard-resume-prompt"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Unfinished run found</p>
              <p className="text-xs text-muted-foreground">
                You left off at step {suspendedRun.step} of 5
                {suspendedRun.signalTitle ? ` on “${suspendedRun.signalTitle}”` : ''}.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={discardSuspendedRun}
                data-testid="wizard-resume-discard"
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                Start fresh
              </button>
              <button
                type="button"
                onClick={resumeSuspendedRun}
                data-testid="wizard-resume-accept"
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Resume
              </button>
            </div>
          </div>
        )}

        {state.currentStep === 1 && (
          <SignalDetectionPanel onSignalSelect={handleSignalSelect} />
        )}

        {state.currentStep === 2 && (
          <ActionSelectionPanel />
        )}

        {state.currentStep === 3 && (
          <div className="h-full space-y-4">
            {/* The panel below owns this step's commit, so Next stays disabled
                until it reports success. Saying so is the point: an unexplained
                dead Next was the reason this step read as broken. */}
            {!canNext() && (
              <p
                className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground"
                data-testid="step3-hint"
              >
                {state.selectedAction === 'cycle'
                  ? 'Name the response cycle below to continue.'
                  : state.selectedAction === 'source'
                    ? 'Save the source below to continue, or skip this step.'
                    : state.selectedAction === 'monitor'
                      ? 'Review the backbone below, then continue or skip.'
                      : 'Deploy the rule below to continue — that is what completes this step. You can also skip it.'}
              </p>
            )}
            {(!state.selectedAction || state.selectedAction === 'subscription') && (
              <div className="space-y-4">
                <RuleBuilder
                  selectedSignal={state.selectedSignal}
                  onDeploy={() => handleSubscriptionComplete()}
                  embedded
                />
              </div>
            )}
            {state.selectedAction === 'cycle' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Configure Response Cycle</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a governed response cycle to assess impact and coordinate actions
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-6 shadow-sm">
                  <CycleLaunchPanel onComplete={handleCycleComplete} />
                </div>
              </div>
            )}
            {state.selectedAction === 'source' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Configure Signal Source</h3>
                  <p className="text-sm text-muted-foreground">
                    Add or modify signal feed sources to improve detection capabilities
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-6 shadow-sm">
                  <SourcesView
                    wizardMode={true}
                    onComplete={handleSourceComplete}
                  />
                </div>
              </div>
            )}
            {state.selectedAction === 'monitor' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Monitor Backbone Status</h3>
                  <p className="text-sm text-muted-foreground">
                    Review event delivery status and resolve any backbone issues
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-6 shadow-sm">
                  <EventBackboneView
                    wizardMode={true}
                    onComplete={handleMonitorComplete}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {state.currentStep === 4 && (
          <div className="flex h-full items-center justify-center py-16">
            <div className="text-center max-w-lg bg-card/40 border border-border rounded-xl p-8 shadow-sm">
              <div className="mb-4 rounded-full bg-primary/10 p-4 inline-block">
                <div className="h-12 w-12 animate-pulse rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-xl text-primary font-bold">⚡</span>
                </div>
              </div>
              <h3 className="text-xl font-bold text-foreground">Monitor Backbone Status</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Real-time telemetry and event backbone monitoring active
              </p>
            </div>
          </div>
        )}

        {state.currentStep === 5 && (
          <div className="max-w-2xl mx-auto py-8 space-y-6">
            <div className="text-center">
              <div className="mb-4 rounded-full bg-emerald-500/10 p-4 inline-block">
                <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-3xl text-emerald-400 font-bold">✓</span>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-foreground">Wizard Complete</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your signal intelligence workflow has been configured and completed successfully
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-xl border border-border bg-card/40 p-6 space-y-4 shadow-sm">
              <h4 className="text-base font-semibold text-foreground">Actions Completed</h4>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-emerald-500/15 text-emerald-400 p-1 mt-0.5">
                    <span className="text-xs font-bold">✓</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Signal Selected</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {state.selectedSignal?.title?.slice(0, 75)}...
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-emerald-500/15 text-emerald-400 p-1 mt-0.5">
                    <span className="text-xs font-bold">✓</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Action Configured</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {state.selectedAction === 'subscription' && 'Subscription rule created'}
                      {state.selectedAction === 'cycle' && 'Response cycle launched'}
                      {state.selectedAction === 'source' && 'Signal source configured'}
                      {state.selectedAction === 'monitor' && 'Backbone status reviewed'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4 pt-2">
              <button
                onClick={handleComplete}
                className="flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                View Workflow History
              </button>
              <button
                onClick={() => {
                  resetWizard();
                  setCurrentStep(1);
                }}
                className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-foreground"
              >
                Start New Wizard
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="border-t border-border bg-card/40 sticky bottom-0 z-10 backdrop-blur-md">
        <div className="max-w-[1850px] w-full mx-auto px-4 py-3">
          <WizardNavigation
            onNext={isLastStep ? handleComplete : handleNext}
            onPrevious={handlePrevious}
            onSkip={canSkip ? handleSkip : undefined}
            onCancel={handleCancel}
            canNext={canNext()}
            canPrevious={canPrevious}
            canSkip={canSkip}
            isLastStep={isLastStep}
            totalSteps={5}
          />
        </div>
      </div>
    </div>
  );
}

export function SignalIntelligenceWizardPage(props: SignalIntelligenceWizardProps = {}) {
  return (
    <WizardProvider initialWorkflow={props.initialWorkflow}>
      <WizardInner {...props} />
    </WizardProvider>
  );
}

// Backwards compatibility export
export const SignalIntelligenceWizard = SignalIntelligenceWizardPage;
export default SignalIntelligenceWizardPage;
