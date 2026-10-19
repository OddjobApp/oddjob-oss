/**
 * Strategy Hero Layout
 * 
 * Dynamically renders the appropriate hero component based on execution strategy.
 * Also displays strategy-specific metrics.
 */

import React, { Suspense, lazy } from "react";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { useMissionStrategy } from "../hooks/useMissionStrategy";
import { Loader2 } from "lucide-react";

// Lazy load hero components
const DynamicFlowHero = lazy(() => import("./heroes/DynamicFlowHero"));
const RollingWaveHero = lazy(() => import("./heroes/RollingWaveHero"));
const PrePlannedTimelineHero = lazy(() => import("./heroes/PrePlannedTimelineHero"));

interface StrategyHeroLayoutProps {
  mission: any;
  run?: any;
}

const heroComponents: Record<string, React.ComponentType<any>> = {
  dynamic_autonomous: DynamicFlowHero,
  rolling_wave: RollingWaveHero,
  pre_planned: PrePlannedTimelineHero,
};

function HeroSkeleton() {
  return (
    <Card className="h-[300px] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </Card>
  );
}

export default function StrategyHeroLayout({ mission, run }: StrategyHeroLayoutProps) {
  const { strategy, config, metricValues } = useMissionStrategy({ mission, run });

  const HeroComponent = heroComponents[strategy] || heroComponents.pre_planned;

  return (
    <div className="space-y-4">
      {/* Main Hero Component */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroComponent mission={mission} run={run} />
      </Suspense>

      {/* Strategy Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metricValues.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card 
              key={metric.id}
              className={`p-4 bg-background/40 backdrop-blur-sm border-${metric.color}-500/10 hover:border-${metric.color}-500/30 transition-colors`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg bg-${metric.color}-500/20 flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 text-${metric.color}-500`} />
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {metric.label}
                </span>
              </div>
              <div className={`text-2xl font-black text-${metric.color}-500`}>
                {metric.displayValue}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
