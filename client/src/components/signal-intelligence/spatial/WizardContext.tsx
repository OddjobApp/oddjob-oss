import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { IntelligenceSignal, SignalEvent } from './utils';
import { toIntelligenceSignal } from './utils';

const WIZARD_STORAGE_KEY = 'oddjob:spatial:wizard-state';

/** A run left unfinished in a previous visit, offered rather than restored. */
export interface SuspendedRun {
  step: number;
  signalTitle: string | null;
}

function persist(state: unknown): void {
  try {
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors (private browsing, quota)
  }
}

export type WizardAction = 'subscription' | 'cycle' | 'source' | 'monitor' | null;

export interface WizardState {
  currentStep: number;
  selectedSignal: IntelligenceSignal | null;
  selectedAction: WizardAction;
  subscriptionData: {
    cycleId: string;
    deliveryMode: string;
    filters: {
      eventTypes?: string[];
      minimumConfidence: number;
    };
  };
  cycleData: {
    name: string;
    objective: string;
    priority: number;
    requiresApproval: boolean;
  };
  sourceData: {
    name: string;
    sourceType: string;
    url: string;
    pollingIntervalSeconds: number;
    signalTypes: string[];
  };
  completed: boolean;
  isRerun: boolean;
  rerunWorkflowId: string | null;
  canSkip: boolean[];
}

interface WizardContextType {
  state: WizardState;
  setCurrentStep: (step: number) => void;
  setSelectedSignal: (signal: IntelligenceSignal | null) => void;
  setSelectedAction: (action: WizardAction) => void;
  setSubscriptionData: (data: Partial<WizardState['subscriptionData']>) => void;
  setCycleData: (data: Partial<WizardState['cycleData']>) => void;
  setSourceData: (data: Partial<WizardState['sourceData']>) => void;
  resetWizard: () => void;
  saveWizard: () => void;
  loadWizard: () => void;
  loadRerunWorkflow: (workflow: any) => void;
  /** An unfinished run from a previous visit, if one exists. */
  suspendedRun: SuspendedRun | null;
  /** Accept the suspended run. */
  resumeSuspendedRun: () => void;
  /** Decline it and start clean. */
  discardSuspendedRun: () => void;
}

const WizardContext = createContext<WizardContextType | undefined>(undefined);

const defaultState: WizardState = {
  currentStep: 1,
  selectedSignal: null,
  selectedAction: 'subscription',
  subscriptionData: {
    cycleId: '',
    deliveryMode: 'context_only',
    filters: {
      minimumConfidence: 0.5,
    },
  },
  cycleData: {
    name: '',
    objective: '',
    priority: 3,
    requiresApproval: false,
  },
  sourceData: {
    name: '',
    sourceType: 'api',
    url: '',
    pollingIntervalSeconds: 60,
    signalTypes: [],
  },
  completed: false,
  isRerun: false,
  rerunWorkflowId: null,
  canSkip: [false, false, true, true, false],
};

const defaultContext: WizardContextType = {
  state: defaultState,
  setCurrentStep: () => {},
  setSelectedSignal: () => {},
  setSelectedAction: () => {},
  setSubscriptionData: () => {},
  setCycleData: () => {},
  setSourceData: () => {},
  resetWizard: () => {},
  saveWizard: () => {},
  loadWizard: () => {},
  loadRerunWorkflow: () => {},
  suspendedRun: null,
  resumeSuspendedRun: () => {},
  discardSuspendedRun: () => {},
};

export function useWizard() {
  const context = useContext(WizardContext);
  return context || defaultContext;
}

/**
 * A signal for the wizard, whatever shape came in.
 *
 * Stored workflows and pod selections carry the raw event, which has flat
 * `eventType`/`severity` fields and no nested `event`. IntelligenceSignal's
 * consumers read `signal.event.*`, so a raw event has to be converted, not cast.
 */
function normalizeWizardSignal(signal: any): IntelligenceSignal | null {
    if (!signal) return null;
    if (signal.event) return signal as IntelligenceSignal;
    if (typeof signal.eventType === 'string') return toIntelligenceSignal(signal as SignalEvent);
    return signal as IntelligenceSignal;
}

export function WizardProvider({ children, initialWorkflow }: { children: React.ReactNode; initialWorkflow?: any }) {
  const [state, setState] = useState<WizardState>(() => {
    if (initialWorkflow) {
      const sig = initialWorkflow.signal;
      return {
        currentStep: 1,
        selectedSignal: sig ? {
          // Placeholder signal content used to stand in here — a "Geofence
          // Intrusion" title, a "Defense & Security / Sector 7-A" subtitle, a
          // CRITICAL impact and a score of 92 — none of which came from the
          // signal. Absent fields now read as absent.
          id: sig.id,
          title: sig.title,
          subtitle: [sig.targetSector, sig.jurisdiction].filter(Boolean).join(' · '),
          kind: sig.kind,
          score: typeof sig.score === 'number' ? (sig.score > 1 ? sig.score : Math.round(sig.score * 100)) : undefined,
          age: 'Just now',
          impact: `${sig.severity} impact`,
          confidence: sig.confidence,
          event: sig as any,
        } : null,
        selectedAction: initialWorkflow.action?.type || 'subscription',
        subscriptionData: {
          cycleId: initialWorkflow.resource?.id || '',
          deliveryMode: 'context_only',
          filters: { minimumConfidence: 0.5 },
        },
        cycleData: {
          name: initialWorkflow.resource?.name || '',
          objective: initialWorkflow.action?.description || '',
          priority: 3,
          requiresApproval: true,
        },
        sourceData: {
          name: initialWorkflow.resource?.name || '',
          sourceType: 'rss',
          url: '',
          pollingIntervalSeconds: 900,
          signalTypes: [],
        },
        completed: false,
        isRerun: true,
        rerunWorkflowId: initialWorkflow.id,
        canSkip: [false, false, true, true, false],
      };
    }
    return {
      currentStep: 1,
      selectedSignal: null,
      selectedAction: 'subscription',
      subscriptionData: {
        cycleId: '',
        deliveryMode: 'context_only',
        filters: {
          minimumConfidence: 0.5,
        },
      },
      cycleData: {
        name: '',
        objective: '',
        priority: 3,
        requiresApproval: true,
      },
      sourceData: {
        name: '',
        sourceType: 'rss',
        url: '',
        pollingIntervalSeconds: 900,
        signalTypes: [],
      },
      completed: false,
      isRerun: false,
      rerunWorkflowId: null,
      canSkip: [false, false, true, true, false],
    };
  });

  /** Latest state for the imperative `saveWizard()`, which cannot see it otherwise. */
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const [suspendedRun, setSuspendedRun] = useState<SuspendedRun | null>(null);

  const setCurrentStep = (step: number) => {
    setState(prev => ({ ...prev, currentStep: step }));
  };

  const setSelectedSignal = (signal: IntelligenceSignal | null) => {
    setState(prev => ({ ...prev, selectedSignal: signal }));
  };

  const setSelectedAction = (action: WizardAction) => {
    setState(prev => ({ ...prev, selectedAction: action }));
  };

  const setSubscriptionData = (data: Partial<WizardState['subscriptionData']>) => {
    setState(prev => ({ ...prev, subscriptionData: { ...prev.subscriptionData, ...data } }));
  };

  const setCycleData = (data: Partial<WizardState['cycleData']>) => {
    setState(prev => ({ ...prev, cycleData: { ...prev.cycleData, ...data } }));
  };

  const setSourceData = (data: Partial<WizardState['sourceData']>) => {
    setState(prev => ({ ...prev, sourceData: { ...prev.sourceData, ...data } }));
  };

  const resetWizard = () => {
    setState({
      currentStep: 1,
      selectedSignal: null,
      selectedAction: 'subscription',
      subscriptionData: {
        cycleId: '',
        deliveryMode: 'context_only',
        filters: {
          minimumConfidence: 0.5,
        },
      },
      cycleData: {
        name: '',
        objective: '',
        priority: 3,
        requiresApproval: true,
      },
      sourceData: {
        name: '',
        sourceType: 'rss',
        url: '',
        pollingIntervalSeconds: 900,
        signalTypes: [],
      },
      completed: false,
      isRerun: false,
      rerunWorkflowId: null,
      canSkip: [false, false, true, true, false],
    });
  };

  /**
   * Kept for callers that still ask to save explicitly, but persistence is now
   * driven by the effect below.
   *
   * It used to be the ONLY save path, and it closed over `state`. Every caller
   * did `setCurrentStep(n + 1); saveWizard();` — React state is async, so it
   * wrote the value from BEFORE the transition. Reloading resumed a step
   * behind, without the signal you had just picked.
   */
  const saveWizard = () => {
    persist(stateRef.current);
  };

  /**
   * Restores a suspended run. Only meaningful when `hasSuspendedRun()` says
   * there is one; the provider no longer calls this unprompted.
   */
  const loadWizard = () => {
    try {
      const stored = localStorage.getItem(WIZARD_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.selectedAction) {
          parsed.selectedAction = 'subscription';
        }
        setState(parsed);
      }
    } catch {
      // Ignore storage errors
    }
  };

  const resumeSuspendedRun = () => {
    loadWizard();
    setSuspendedRun(null);
  };

  /** Forgets any suspended run and starts clean. */
  const discardSuspendedRun = () => {
    try {
      localStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    setSuspendedRun(null);
  };

  const loadRerunWorkflow = (workflow: any) => {
    setState({
      currentStep: 1,
      // A stored workflow's signal may be the RAW event, which has no `event` of
      // its own; RuleBuilder and SubscriptionsView read through that field, so
      // normalize here rather than handing them something they crash on.
      selectedSignal: normalizeWizardSignal(workflow.signal),
      selectedAction: workflow.action.type,
      subscriptionData: {
        cycleId: workflow.resource?.id || '',
        deliveryMode: 'context_only',
        filters: {
          minimumConfidence: 0.5,
        },
      },
      cycleData: {
        name: workflow.resource?.name || '',
        objective: workflow.action.description,
        priority: 3,
        requiresApproval: true,
      },
      sourceData: {
        name: workflow.resource?.name || '',
        sourceType: 'rss',
        url: '',
        pollingIntervalSeconds: 900,
        signalTypes: [],
      },
      completed: false,
      isRerun: true,
      rerunWorkflowId: workflow.id,
      // Required on WizardState, and the same value every other transition
      // uses. Omitting it here left a rerun without step-skip information.
      canSkip: [false, false, true, true, false],
    });
    // Clear the rerun storage after loading
    localStorage.removeItem('oddjob:spatial:rerun-workflow');
  };

  /**
   * Autosave. Persisting from an effect on `state` is what makes the stored
   * value match what is on screen; the previous imperative saves ran before
   * React had applied the update they were meant to capture.
   */
  useEffect(() => {
    // A run that has been reset to its initial state is not worth restoring,
    // and writing it would resurrect a wizard the user just cancelled.
    if (state.currentStep === 1 && !state.selectedSignal && !state.isRerun) return;
    persist(state);
  }, [state]);

  useEffect(() => {
    // A rerun is an explicit request and still loads immediately. A merely
    // suspended run does NOT: it is offered, not imposed. Resuming silently
    // dropped people into the middle of a flow from a previous session with
    // no explanation and no way back to the start.
    try {
      const rerunWorkflow = localStorage.getItem('oddjob:spatial:rerun-workflow');
      if (rerunWorkflow) {
        loadRerunWorkflow(JSON.parse(rerunWorkflow));
        return;
      }
    } catch {
      // fall through to the suspended-run check
    }

    try {
      const stored = localStorage.getItem(WIZARD_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as WizardState;
      if (parsed?.currentStep > 1 || parsed?.selectedSignal) {
        setSuspendedRun({ step: parsed.currentStep, signalTitle: parsed.selectedSignal?.title ?? null });
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  return (
    <WizardContext.Provider value={{ state, setCurrentStep, setSelectedSignal, setSelectedAction, setSubscriptionData, setCycleData, setSourceData, resetWizard, saveWizard, loadWizard, loadRerunWorkflow, suspendedRun, resumeSuspendedRun, discardSuspendedRun }}>
      {children}
    </WizardContext.Provider>
  );
}
