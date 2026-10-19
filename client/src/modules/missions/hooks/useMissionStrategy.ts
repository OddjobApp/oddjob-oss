/**
 * Mission Strategy Hook
 * 
 * Provides strategy-aware configuration and utilities for mission UI components.
 */

import { useMemo } from "react";
import { BrainCircuit, LayoutGrid } from "lucide-react";
import {
  getStrategyConfig,
  getTabsForStrategy,
  getWidgetsForStrategy,
  getMetricsForStrategy,
  shouldShowFeature,
  type ExecutionStrategy,
  type MissionType,
} from "../config/mission-strategies.config";

export interface UseMissionStrategyOptions {
  mission: any;
  run?: any;
}

export function useMissionStrategy({ mission, run }: UseMissionStrategyOptions) {
  // Detect execution strategy from mission
  const strategy = useMemo<ExecutionStrategy>(() => {
    const strategyFromMission = mission?.executionStrategy as ExecutionStrategy;
    if (strategyFromMission && ["pre_planned", "dynamic_autonomous", "rolling_wave"].includes(strategyFromMission)) {
      return strategyFromMission;
    }
    // Default based on mission type detection
    if (mission?.type?.includes("Forge") || (mission?.blackboard as any)?.isForge) {
      return "rolling_wave";
    }
    return "pre_planned";
  }, [mission?.executionStrategy, mission?.type, mission?.blackboard]);

  // Detect mission type
  const missionType = useMemo<MissionType>(() => {
    return (mission?.type as MissionType) || "supervisor_led";
  }, [mission?.type]);

  // Get full strategy configuration
  const config = useMemo(() => {
    return getStrategyConfig(strategy);
  }, [strategy]);

  // Get strategy-specific tabs
  const tabs = useMemo(() => {
    const baseTabs = getTabsForStrategy(strategy);
    
    // Filter out Forge-specific tabs if this isn't a Forge mission
    const isForge = mission?.type?.includes("Forge") || (mission?.blackboard as any)?.isForge;
    const previewSlug = (mission?.blackboard as any)?.viaAppSlug || 
                        (mission?.blackboard as any)?.forge_app_slug || 
                        (mission?.blackboard as any)?.appSlug;
    const hasPreview = !!previewSlug || isForge;

    const agoraTab = { id: 'agora', label: 'Agora Canvas', icon: LayoutGrid };
    const reasoningGymTab = { id: 'reasoning_gym', label: 'Reasoning Gym', icon: BrainCircuit };

    if (!hasPreview) {
      return [agoraTab, reasoningGymTab, ...baseTabs.filter(tab => tab.id !== "preview" && tab.id !== "terminal")];
    }

    return [agoraTab, reasoningGymTab, ...baseTabs];
  }, [strategy, mission]);

  // Get sidebar widgets
  const sidebarWidgets = useMemo(() => {
    return getWidgetsForStrategy(strategy, "sidebar");
  }, [strategy]);

  // Get primary metrics
  const metrics = useMemo(() => {
    const baseMetrics = getMetricsForStrategy(strategy);
    
    // Filter out Forge-specific metrics if this isn't a Forge mission
    const isForge = mission?.type?.includes("Forge") || (mission?.blackboard as any)?.isForge;
    const hasApp = isForge || (mission?.blackboard as any)?.viaAppSlug;

    if (!hasApp) {
      return baseMetrics.filter(m => m.id !== "app_health");
    }

    return baseMetrics;
  }, [strategy, mission]);

  // Feature flags
  const features = useMemo(() => ({
    predictivePlanning: shouldShowFeature(strategy, "predictivePlanning"),
    selfHealing: shouldShowFeature(strategy, "selfHealing"),
    multiAgentCoordination: shouldShowFeature(strategy, "multiAgentCoordination"),
  }), [strategy]);

  // Layout preferences
  const layout = useMemo(() => config.layout, [config]);

  // Calculate metric values
  const metricValues = useMemo(() => {
    const runs = run ? [run] : [];
    return metrics.map(metric => {
      const value = metric.getValue(mission, runs);
      return {
        ...metric,
        displayValue: metric.format ? metric.format(value) : String(value),
        rawValue: value,
      };
    });
  }, [metrics, mission, run]);

  // Check if mission is active/running
  const isActive = useMemo(() => {
    return run?.status === "running" || run?.status === "active" || run?.status === "paused";
  }, [run?.status]);

  // Get strategy badge props
  const strategyBadge = useMemo(() => ({
    label: config.name,
    icon: config.icon,
    color: config.colorScheme.primary,
    description: config.description,
  }), [config]);

  return {
    strategy,
    missionType,
    config,
    tabs,
    sidebarWidgets,
    metrics,
    metricValues,
    features,
    layout,
    isActive,
    strategyBadge,
  };
}

// Hook for strategy-aware class names
export function useStrategyStyles(strategy: ExecutionStrategy) {
  const config = getStrategyConfig(strategy);
  
  return {
    gradient: config.colorScheme.bgGradient,
    border: `border-${config.colorScheme.primary}-500/20`,
    badge: `bg-${config.colorScheme.primary}-500/10 text-${config.colorScheme.primary}-500 border-${config.colorScheme.primary}-500/30`,
    icon: `text-${config.colorScheme.primary}-500`,
    iconBg: `bg-${config.colorScheme.primary}-500/20`,
  };
}

// Hook for tab visibility
export function useTabVisibility(strategy: ExecutionStrategy, tabId: string) {
  const tabs = getTabsForStrategy(strategy);
  return tabs.some(t => t.id === tabId);
}
