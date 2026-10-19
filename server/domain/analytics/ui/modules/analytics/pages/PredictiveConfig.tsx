import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Settings, Check, Shield, Zap, GraduationCap } from "lucide-react";
import { usePredictiveAnalytics } from "@domain-ui/core/ui/hooks/use-predictive";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@domain-ui/core/ui/components/ui/radio-group";
import { Label } from "@domain-ui/core/ui/components/ui/label";

export default function PredictiveConfig() {
  const { summary, setServiceMode, isLoadingSummary } = usePredictiveAnalytics();

  if (isLoadingSummary) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const currentMode = summary?.service_mode || 'monitoring';

  const modes = [
    {
      id: 'monitoring',
      name: 'Monitoring Only',
      icon: Shield,
      description: 'Passively monitors system health and resource usage. No active changes are made.'
    },
    {
      id: 'advisory',
      name: 'Advisory Mode',
      icon: GraduationCap,
      description: 'Generates recommendations and insights, but requires manual approval for actions.'
    },
    {
      id: 'automated',
      name: 'Fully Automated',
      icon: Zap,
      description: 'AI proactively optimizes resources and fixes issues within safety limits.'
    },
    {
      id: 'learning',
      name: 'Learning Mode',
      icon: Settings,
      description: 'Focuses on gathering data to build baseline models. Low confidence predictions are suppressed.'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Predictive Configuration</h1>
        <p className="text-muted-foreground">
          Configure AI prediction models and automation settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operating Mode</CardTitle>
          <CardDescription>Select how the predictive AI interacts with your system</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            defaultValue={currentMode}
            onValueChange={(val) => setServiceMode(val)}
            className="grid gap-4 md:grid-cols-2"
          >
            {modes.map((mode) => {
              const Icon = mode.icon;
              const isSelected = currentMode === mode.id;
              return (
                <div key={mode.id}>
                  <RadioGroupItem value={mode.id} id={mode.id} className="peer sr-only" />
                  <Label
                    htmlFor={mode.id}
                    className="flex flex-col h-full items-start justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all"
                  >
                    <div className="flex w-full items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="font-semibold text-lg">{mode.name}</span>
                      </div>
                      {isSelected && <Check className="w-5 h-5 text-primary" />}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {mode.description}
                    </p>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Fine-tune AI parameters</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Advanced model parameters (confidence thresholds, prediction horizons) are currently managed via the backend configuration file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

