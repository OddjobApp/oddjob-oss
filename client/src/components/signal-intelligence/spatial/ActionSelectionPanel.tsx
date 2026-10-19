import { Bot, Sparkles, Radio, Activity, Zap } from 'lucide-react';
import { useWizard } from './WizardContext';
import { cn } from '@/lib/utils';
import type { WizardAction } from './WizardContext';

interface ActionOption {
  id: WizardAction;
  icon: any;
  title: string;
  description: string;
  impact: string;
  time: string;
}

const ACTIONS: ActionOption[] = [
  {
    id: 'subscription',
    icon: Bot,
    title: 'Assign Accountable Cycle',
    description: 'Create automated subscription rule to route similar signals to a business cycle',
    impact: 'High',
    time: '2 min',
  },
  {
    id: 'cycle',
    icon: Sparkles,
    title: 'Launch Coordinated Response',
    description: 'Create governed response cycle to assess impact and coordinate actions',
    impact: 'Critical',
    time: '5 min',
  },
  {
    id: 'source',
    icon: Radio,
    title: 'Configure Signal Source',
    description: 'Add or modify signal feed sources to improve detection capabilities',
    impact: 'Medium',
    time: '3 min',
  },
  {
    id: 'monitor',
    icon: Activity,
    title: 'Monitor Backbone Status',
    description: 'Review event delivery status and resolve any backbone issues',
    impact: 'Low',
    time: '1 min',
  },
];

export function ActionSelectionPanel() {
  const { state, setSelectedAction } = useWizard();

  const handleActionSelect = (action: WizardAction) => {
    setSelectedAction(action);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Choose Your Response Action</h3>
        <p className="text-sm text-muted-foreground">
          Select how you want to respond to the selected signal: "{state.selectedSignal?.title?.slice(0, 50)}..."
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => handleActionSelect(action.id)}
            className={cn(
              'min-h-[140px] w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50',
              state.selectedAction === action.id
                ? 'border-primary bg-primary/5'
                : 'border-border'
            )}
          >
            <div className="flex gap-3">
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                state.selectedAction === action.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent'
              )}>
                <action.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold">{action.title}</h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {action.description}
                </p>
                <div className="mt-3 flex items-center gap-2 text-[10px]">
                  <span className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    action.impact === 'Critical' ? 'bg-red-500/15 text-red-400' :
                    action.impact === 'High' ? 'bg-amber-500/15 text-amber-400' :
                    action.impact === 'Medium' ? 'bg-blue-500/15 text-blue-400' :
                    'bg-slate-500/15 text-muted-foreground'
                  )}>
                    {action.impact} impact
                  </span>
                  <span className="text-muted-foreground">• {action.time}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {state.selectedAction && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-primary">
              Selected: {ACTIONS.find(a => a.id === state.selectedAction)?.title}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Click "Next" to configure your response
          </p>
        </div>
      )}
    </div>
  );
}
