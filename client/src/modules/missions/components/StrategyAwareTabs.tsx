/**
 * Strategy-Aware Tabs
 * 
 * Renders strategy-specific tabs with lazy-loaded content.
 */

import React, { Suspense, lazy, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@domain-ui/core/ui/components/ui/tabs";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Loader2 } from "lucide-react";
import { useMissionStrategy } from "../hooks/useMissionStrategy";

// Core tabs that exist for all strategies
const ActivityTab = lazy(() => import("./tabs/ActivityTab"));

// Strategy-specific tabs
const ExecutionFlowTab = lazy(() => import("./tabs/ExecutionFlowTab"));
const AdaptationsTab = lazy(() => import("./tabs/AdaptationsTab"));
const SelfHealingTab = lazy(() => import("./tabs/SelfHealingTab"));
const AgentsTab = lazy(() => import("./tabs/AgentsTab"));
const PredictiveTab = lazy(() => import("./tabs/PredictiveTab"));
const PhasesTab = lazy(() => import("./tabs/PhasesTab"));
const DeliverablesTab = lazy(() => import("./tabs/DeliverablesTab"));
const PreviewTab = lazy(() => import("./tabs/PreviewTab"));
const TerminalTab = lazy(() => import("./tabs/TerminalTab"));
const ExecutionPlanTab = lazy(() => import("./tabs/ExecutionPlanTab"));
const TimelineTab = lazy(() => import("./tabs/TimelineTab"));
const DeviationsTab = lazy(() => import("./tabs/DeviationsTab"));
const EconomicControlTab = lazy(() => import("./tabs/EconomicControlTab"));
const AgoraTab = lazy(() => import("./tabs/AgoraTab"));
const AIDecisionsTab = lazy(() => import("./tabs/AIDecisionsTab"));
const ThoughtsTab = lazy(() => import("./tabs/ThoughtsTab"));
const IterationsTab = lazy(() => import("./tabs/IterationsTab"));
const ReasoningGymTab = lazy(() => import("./tabs/ReasoningGymTab"));

// Tab component registry
const tabComponents: Record<string, React.ComponentType<any>> = {
  agora: AgoraTab,
  activity: ActivityTab,
  flow: ExecutionFlowTab,
  adaptations: AdaptationsTab,
  healing: SelfHealingTab,
  agents: AgentsTab,
  predictive: PredictiveTab,
  phases: PhasesTab,
  deliverables: DeliverablesTab,
  preview: PreviewTab,
  terminal: TerminalTab,
  plan: ExecutionPlanTab,
  timeline: TimelineTab,
  deviations: DeviationsTab,
  budget: EconomicControlTab,
  ai_decisions: AIDecisionsTab,
  thoughts: ThoughtsTab,
  iterations: IterationsTab,
  reasoning_gym: ReasoningGymTab,
};

const businessTabLabels: Record<string, string> = {
  activity: "Updates",
  plan: "Plan",
  deliverables: "Outputs",
  preview: "Preview",
  budget: "Budget",
  agora: "Workspace",
};

interface StrategyAwareTabsProps {
  mission: any;
  run?: any;
  defaultTab?: string;
  viewMode?: 'business' | 'developer';
}

function TabSkeleton() {
  return (
    <Card className="h-[400px] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </Card>
  );
}

export default function StrategyAwareTabs({ mission, run, defaultTab, viewMode }: StrategyAwareTabsProps) {
  const { tabs, strategy } = useMissionStrategy({ mission, run });
  
  // Filter tabs if in business view mode to keep UI value-focused and clean
  const filteredTabs = React.useMemo(() => {
    if (viewMode === "business") {
      // Value-centric business tabs (including Execution Plan with hidden telemetry)
      const businessTabs = ["activity", "plan", "deliverables", "preview", "budget", "agora"];
      return tabs.filter(tab => businessTabs.includes(tab.id));
    }
    return tabs;
  }, [tabs, viewMode]);

  const [activeTab, setActiveTab] = useState(defaultTab || "activity");

  React.useEffect(() => {
    const ids = filteredTabs.map(t => t.id);
    if (!ids.includes(activeTab)) {
      setActiveTab(ids.includes("activity") ? "activity" : (ids[0] || "activity"));
    }
  }, [filteredTabs, activeTab]);

  if (!filteredTabs.length) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        No views available for this selection.
      </Card>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="bg-background/40 border border-border w-full justify-start overflow-x-auto overflow-y-hidden whitespace-nowrap flex-nowrap gap-1 px-1">
        {filteredTabs.map((tab) => {
          const Icon = tab.icon;
          const label = viewMode === "business" ? (businessTabLabels[tab.id] || tab.label) : tab.label;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-xs whitespace-nowrap shrink-0"
            >
              <Icon className="w-4 h-4 mr-2" />
              {label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {filteredTabs.map((tab) => {
        const TabComponent = tabComponents[tab.id] || ActivityTab;
        
        return (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            <Suspense fallback={<TabSkeleton />}>
              <TabComponent mission={mission} run={run} strategy={strategy} viewMode={viewMode} />
            </Suspense>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
