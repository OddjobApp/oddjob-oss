import { useLocation, useParams } from 'wouter';
import { SignalIntelligenceWizardPage } from './SignalIntelligenceWizard';
import { getWorkflowById } from './WorkflowHistory';

export function WorkflowEditPage() {
  const [, navigate] = useLocation();
  const { id } = useParams<{ id: string }>();

  /*
    A workflow that could not be found used to be replaced by an invented one —
    a complete "Geofence Intrusion & Anomaly Detection" record, score 0.92,
    duration 45s, marked completed — which the editor then presented as the
    workflow under edit. The id also defaulted to 'wf-spatial-001', one of the
    seeded demo records. A missing workflow now says so.
  */
  const workflow = id ? getWorkflowById(id) : null;

  const handleClose = () => {
    navigate('/signal-intelligence/workflows');
  };

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <h2 className="text-lg font-semibold">Workflow not found</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {id ? `No workflow with id "${id}" exists in this browser's history.` : 'No workflow was specified.'}
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="text-sm underline underline-offset-2"
        >
          Back to workflows
        </button>
      </div>
    );
  }

  return (
    <SignalIntelligenceWizardPage
      initialWorkflow={workflow}
      onClose={handleClose}
      onComplete={handleClose}
    />
  );
}

export default WorkflowEditPage;
