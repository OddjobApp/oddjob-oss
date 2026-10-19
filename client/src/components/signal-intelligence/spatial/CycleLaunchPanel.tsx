import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useWizard } from './WizardContext';
import { cn } from '@/lib/utils';

interface CycleLaunchPanelProps {
  onComplete?: () => void;
}

export function CycleLaunchPanel({ onComplete }: CycleLaunchPanelProps) {
  const { state, setCycleData } = useWizard();
  const queryClient = useQueryClient();

  const launchCycle = useMutation({
    mutationFn: async () => {
      if (!state.selectedSignal) throw new Error('Select a signal first');
      const response = await apiRequest('POST', '/api/cycles/launch', {
        name: state.cycleData.name || `Response: ${state.selectedSignal.title.slice(0, 70)}`,
        description: `Governed response cycle created from intelligence signal ${state.selectedSignal.id}`,
        objective: state.cycleData.objective || `Assess and respond to: ${state.selectedSignal.title}`,
        priority: state.cycleData.priority,
        requiresApproval: state.cycleData.requiresApproval,
        metadata: { source: 'signal-intelligence', eventPrimitiveId: state.selectedSignal.id },
        blueprints: [{ name: 'Signal impact assessment', objective: `Validate impact, options, and response for ${state.selectedSignal.title}`, type: 'mission', config: { reasoningProtocol: 'json_manifest' } }],
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cycles?limit=100'] });
      if (onComplete) {
        onComplete();
      }
    },
  });

  const handleLaunch = () => {
    launchCycle.mutate();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Configure Response Cycle</h3>
        <p className="text-sm text-muted-foreground">
          Create a governed response cycle to assess impact and coordinate actions for: "{state.selectedSignal?.title?.slice(0, 50)}..."
        </p>
      </div>

      {/* Signal Context */}
      {state.selectedSignal && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                  state.selectedSignal.kind === 'opportunity' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                )}>
                  {state.selectedSignal.kind}
                </span>
                <span className="text-xs text-muted-foreground">Score {state.selectedSignal.score}</span>
              </div>
              <p className="text-sm font-medium">{state.selectedSignal.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{state.selectedSignal.subtitle}</p>
            </div>
          </div>
        </div>
      )}

      {/* Cycle Configuration */}
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Cycle Name</label>
          <input
            type="text"
            value={state.cycleData.name}
            onChange={(e) => setCycleData({ name: e.target.value })}
            placeholder={`Response: ${state.selectedSignal?.title?.slice(0, 50)}...`}
            className="h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Objective</label>
          <textarea
            value={state.cycleData.objective}
            onChange={(e) => setCycleData({ objective: e.target.value })}
            placeholder={`Assess and respond to: ${state.selectedSignal?.title}`}
            rows={3}
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <select
              value={state.cycleData.priority}
              onChange={(e) => setCycleData({ priority: Number(e.target.value) })}
              className="h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
            >
              <option value="1">Critical</option>
              <option value="2">High</option>
              <option value="3">Medium</option>
              <option value="4">Low</option>
              <option value="5">Informational</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Requires Approval</label>
            <select
              value={state.cycleData.requiresApproval ? '1' : '0'}
              onChange={(e) => setCycleData({ requiresApproval: e.target.value === '1' })}
              className="h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
            >
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
        </div>
      </div>

      {/* Launch Button */}
      <button
        onClick={handleLaunch}
        disabled={!state.cycleData.name || launchCycle.isPending}
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {launchCycle.isPending ? 'Launching Cycle...' : 'Launch Response Cycle'}
      </button>

      {launchCycle.isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {(launchCycle.error as Error).message}
        </div>
      )}
    </div>
  );
}
