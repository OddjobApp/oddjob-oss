import type { IntelligenceSignal } from './utils';
import type { WizardAction } from './WizardContext';

export interface WorkflowOutput {
  id: string;
  timestamp: string;
  /** Seconds. Absent until the workflow has actually run. */
  duration?: number;
  signal: {
    id: string;
    title: string;
    kind: 'threat' | 'opportunity';
    /** Absent when nothing has scored this signal yet. */
    score?: number;
    confidence?: string;
    severity: string;
    targetSector: string;
    jurisdiction: string;
    eventType: string;
  };
  action: {
    type: WizardAction;
    impact: string;
    description: string;
  };
  resource?: {
    type: 'subscription' | 'cycle' | 'source' | 'monitor';
    id?: string;
    name?: string;
    details?: Record<string, any>;
  };
  statusReview?: {
    backboneStatus: string;
    eventsPublished: number;
    eventsProcessed: number;
    failuresReviewed: number;
  };
  completed: boolean;
}

export function saveWorkflowOutput(output: WorkflowOutput) {
  try {
    const history = getWorkflowHistory();
    history.unshift(output);
    // Keep only last 50 workflows
    if (history.length > 50) {
      history.pop();
    }
    localStorage.setItem('oddjob:spatial:workflow-history', JSON.stringify(history));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Workflow history for this browser.
 *
 * This used to seed itself with INITIAL_WORKFLOWS on first read — fabricated
 * records ("Geofence Intrusion & Anomaly Detection", score 0.92, duration 45s,
 * Sector 7-A) written into localStorage and rendered as completed runs. A first
 * visit therefore showed three workflows that had never happened, and because
 * they were persisted on read they then looked like the user's own history.
 *
 * It now starts empty. WorkflowHistoryPage already renders an empty state.
 *
 * Note this store is per-browser localStorage, not server-held: it is a record
 * of what this user did in this browser, and there is no backend behind it.
 */
export function getWorkflowHistory(): WorkflowOutput[] {
  try {
    const stored = localStorage.getItem('oddjob:spatial:workflow-history');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

export function getWorkflowById(id: string): WorkflowOutput | null {
  const history = getWorkflowHistory();
  return history.find(w => w.id === id) || null;
}

export function updateWorkflow(updatedWorkflow: WorkflowOutput) {
  try {
    const history = getWorkflowHistory();
    const index = history.findIndex(w => w.id === updatedWorkflow.id);
    if (index !== -1) {
      history[index] = updatedWorkflow;
      localStorage.setItem('oddjob:spatial:workflow-history', JSON.stringify(history));
    }
  } catch {
    // Ignore storage errors
  }
}

export function deleteWorkflow(id: string) {
  try {
    const history = getWorkflowHistory();
    const filtered = history.filter(w => w.id !== id);
    localStorage.setItem('oddjob:spatial:workflow-history', JSON.stringify(filtered));
  } catch {
    // Ignore storage errors
  }
}

export function createWorkflowOutput(
  signal: IntelligenceSignal,
  action: WizardAction,
  resource?: any,
  statusReview?: any,
  duration: number = 0
): WorkflowOutput {
  return {
    id: `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    duration,
    signal: {
      id: signal.id,
      title: signal.title,
      kind: signal.kind,
      score: signal.score,
      confidence: signal.confidence,
      severity: signal.event.severity,
      targetSector: signal.event.targetSector,
      jurisdiction: signal.event.jurisdiction,
      eventType: signal.event.eventType,
    },
    action: {
      type: action,
      impact: action === 'subscription' ? 'High' : action === 'cycle' ? 'Critical' : action === 'source' ? 'Medium' : 'Low',
      description: action === 'subscription' ? 'Created automated subscription rule' :
                  action === 'cycle' ? 'Launched governed response cycle' :
                  action === 'source' ? 'Configured signal feed source' :
                  'Reviewed backbone status',
    },
    resource: resource && action ? {
      type: action as 'subscription' | 'cycle' | 'source' | 'monitor',
      id: resource.id,
      name: resource.name,
      details: resource,
    } : undefined,
    statusReview,
    completed: true,
  };
}
