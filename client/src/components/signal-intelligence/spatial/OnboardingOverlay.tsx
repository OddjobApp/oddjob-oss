import { useState, useCallback, useEffect } from 'react';
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { cn } from '@/lib/utils';

/**
 * OnboardingOverlay — 4-step guided walkthrough for first-time spatial UX users.
 * Requirements: 1.1, 1.2, 1.3, 1.6
 *
 * Highlights key UI regions in sequence:
 *   1. Signal Feed
 *   2. Impact Visualization
 *   3. View Switcher
 *   4. Recommended Actions
 *
 * Persists completion state to localStorage under `oddjob:spatial:onboarding-complete`.
 * If localStorage is unavailable, the overlay is not displayed (treat as returning user).
 */

const STORAGE_KEY = 'oddjob:spatial:onboarding-complete';

export interface OnboardingOverlayProps {
  onComplete: () => void;
  onSkip: () => void;
}

export interface OnboardingStep {
  targetSelector: string;
  heading: string;       // max 50 chars
  description: string;   // max 150 chars
}

const STEPS: OnboardingStep[] = [
  {
    targetSelector: '[data-onboarding="signal-feed"]',
    heading: 'Signal Feed',
    description: 'Browse, sort, and filter intelligence signals by severity, confidence, or recency. Select signals to explore their downstream impact.',
  },
  {
    targetSelector: '[data-onboarding="impact-visualization"]',
    heading: 'Impact Visualization',
    description: 'See causal relationships between a selected signal and affected business domains. Click nodes to drill into entity details.',
  },
  {
    targetSelector: '[data-onboarding="view-switcher"]',
    heading: 'View Switcher',
    description: 'Navigate between Signals, Graph, Scenarios, and Event Stream views using the tab bar above the main content area.',
  },
  {
    targetSelector: '[data-onboarding="recommended-actions"]',
    heading: 'Recommended Actions',
    description: 'Launch response cycles, escalate signals, or snooze items. Actions are tracked in a timeline for full audit visibility.',
  },
];

/**
 * Checks whether localStorage is available and can be read/written.
 * Returns false if localStorage is unavailable or throws on access.
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__ls_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether onboarding has already been completed.
 * If localStorage is unavailable, returns true (treat as returning user).
 */
function hasCompletedOnboarding(): boolean {
  if (!isLocalStorageAvailable()) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return true;
  }
}

/**
 * Persists the onboarding completion state.
 */
function persistCompletion(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // Silently ignore — cannot persist, but overlay was already dismissed.
  }
}

export function OnboardingOverlay({ onComplete, onSkip }: OnboardingOverlayProps) {
  // Rendered only while the walkthrough is showing, so it is open throughout.
  // Escape skips rather than completes: dismissing is not finishing.
  const panelRef = useModalBehavior<HTMLDivElement>({ isOpen: true, onClose: onSkip });
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Determine on mount whether to show the overlay
  useEffect(() => {
    if (!hasCompletedOnboarding()) {
      setVisible(true);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Final step completed
      persistCompletion();
      setVisible(false);
      onComplete();
    }
  }, [currentStep, onComplete]);

  const handleSkip = useCallback(() => {
    persistCompletion();
    setVisible(false);
    onSkip();
  }, [onSkip]);

  if (!visible) return null;

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div
      data-testid="onboarding-overlay"
      ref={panelRef}
      className="fixed inset-0 z-modal flex items-end justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding walkthrough"
    >
      <div
        className={cn(
          'relative w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-lg bg-card p-5 shadow-lg sm:p-6',
          'border border-border',
        )}
      >
        {/* Step indicator */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Step {currentStep + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            data-testid="onboarding-skip"
            onClick={handleSkip}
            className={cn(
              'text-xs font-medium text-muted-foreground underline-offset-2 hover:underline',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            Skip
          </button>
        </div>

        {/* Step content */}
        <h2
          data-testid="onboarding-heading"
          className="mb-2 text-lg font-semibold text-foreground"
        >
          {step.heading}
        </h2>
        <p
          data-testid="onboarding-description"
          className="mb-6 text-sm text-muted-foreground"
        >
          {step.description}
        </p>

        {/* Step dots */}
        <div className="mb-4 flex justify-center gap-1.5" aria-hidden="true">
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                index === currentStep ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="onboarding-next"
            onClick={handleNext}
            className={cn(
              'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'min-h-[44px] min-w-[44px]',
            )}
          >
            {isLastStep ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { STEPS, STORAGE_KEY, isLocalStorageAvailable, hasCompletedOnboarding, persistCompletion };
