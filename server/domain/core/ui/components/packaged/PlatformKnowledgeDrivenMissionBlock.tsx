"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  GitBranch,
  Users,
  Target,
  Sparkles,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Network,
  Zap,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Bot,
  Layers,
  MapPin,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Skeleton } from "../ui/skeleton";
import { ScrollArea } from "../ui/scroll-area";

interface EnrichedContext {
  entities: Array<{
    id: number;
    name: string;
    type: string;
    relevance: number;
    source: string;
  }>;
  keyRelationships: Array<{
    from: string;
    to: string;
    relation: string;
  }>;
  similarPastMissions: Array<{
    id: number;
    name: string;
    outcome: string;
    learnings: string[];
  }>;
  suggestedActions: Array<{
    type: string;
    id: number;
    name: string;
    reason: string;
    confidence: number;
  }>;
  enrichmentScore: number;
  enrichedAt?: string;
}

interface AgentRouting {
  agentId: string;
  agentName: string;
  role: string;
  status: "idle" | "working" | "complete" | "error";
  knowledgeProximity: number;
  currentLoad: number;
  assignedTasks: number;
  expertise: string[];
}

interface TaskRouting {
  taskId: string;
  taskName: string;
  assignedAgent: string;
  confidence: number;
  estimatedDuration: number;
  reasoning: string;
}

interface MissionStats {
  teamEfficiency: number;
  knowledgeCoverage: number;
  estimatedDuration: number;
  enrichmentScore: number;
}

interface PlatformKnowledgeDrivenMissionBlockProps {
  missionId: number;
  enableAutoEnrichment?: boolean;
  enableAgentRouting?: boolean;
  showContextGraph?: boolean;
  showRoutingVisualization?: boolean;
  refreshInterval?: number; // seconds
  onEnrichmentComplete?: (context: EnrichedContext) => void;
  onRoutingUpdate?: (routing: TaskRouting[]) => void;
}

export default function PlatformKnowledgeDrivenMissionBlock({
  missionId,
  enableAutoEnrichment = true,
  enableAgentRouting = true,
  showContextGraph = true,
  showRoutingVisualization = true,
  refreshInterval = 30,
  onEnrichmentComplete,
  onRoutingUpdate,
}: PlatformKnowledgeDrivenMissionBlockProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichedContext, setEnrichedContext] = useState<EnrichedContext | null>(null);
  const [agentRouting, setAgentRouting] = useState<AgentRouting[]>([]);
  const [taskRouting, setTaskRouting] = useState<TaskRouting[]>([]);
  const [stats, setStats] = useState<MissionStats | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isEnriching, setIsEnriching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);

  const fetchMissionContext = useCallback(async () => {
    try {
      const res = await fetch(`/api/oddjob/missions/${missionId}/context`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEnrichedContext(data);
      if (onEnrichmentComplete) onEnrichmentComplete(data);
    } catch (e: any) {
      setError(e.message || "Failed to load mission context");
    }
  }, [missionId, onEnrichmentComplete]);

  const fetchAgentRouting = useCallback(async () => {
    if (!enableAgentRouting) return;
    try {
      const res = await fetch(`/api/oddjob/missions/${missionId}/routing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAgentRouting(data.agents);
      setTaskRouting(data.tasks);
      setStats(data.stats);
      if (onRoutingUpdate) onRoutingUpdate(data.tasks);
    } catch (e: any) {
      console.error("Failed to load routing:", e);
    }
  }, [missionId, enableAgentRouting, onRoutingUpdate]);

  const triggerEnrichment = async () => {
    setIsEnriching(true);
    try {
      const res = await fetch(
        `/api/oddjob/missions/${missionId}/enrich`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchMissionContext();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsEnriching(false);
    }
  };

  const triggerRouting = async () => {
    setIsRouting(true);
    try {
      const res = await fetch(
        `/api/oddjob/missions/${missionId}/route`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAgentRouting();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsRouting(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchMissionContext(), fetchAgentRouting()]);
      setLoading(false);
    };
    loadData();

    // Auto-refresh
    const interval = setInterval(() => {
      fetchMissionContext();
      fetchAgentRouting();
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [fetchMissionContext, fetchAgentRouting, refreshInterval]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full border-red-500/30 bg-red-500/5">
        <CardContent className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-red-400/50 mb-3" />
          <p className="text-red-400 font-medium">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              fetchMissionContext();
            }}
            className="mt-3"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const getSourceColor = (source: string) => {
    switch (source) {
      case "direct":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "related":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "inferred":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-foreground/10 text-foreground/70";
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "primary_strategist":
        return <Target className="w-4 h-4" />;
      case "critic":
        return <AlertCircle className="w-4 h-4" />;
      case "gatekeeper":
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <Bot className="w-4 h-4" />;
    }
  };

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              Knowledge-Driven Mission
              <Badge variant="secondary" className="text-[10px]">
                <Sparkles className="w-3 h-3 mr-1" />
                AI-Powered
              </Badge>
            </CardTitle>
            <p className="text-xs text-foreground/50">
              Mission #{missionId} • Context-Aware Routing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enableAutoEnrichment && (
            <Button
              variant="outline"
              size="sm"
              onClick={triggerEnrichment}
              disabled={isEnriching}
            >
              {isEnriching ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Brain className="w-4 h-4 mr-2" />
              )}
              {isEnriching ? "Enriching..." : "Enrich Context"}
            </Button>
          )}
          {enableAgentRouting && (
            <Button
              variant="outline"
              size="sm"
              onClick={triggerRouting}
              disabled={isRouting}
            >
              {isRouting ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Network className="w-4 h-4 mr-2" />
              )}
              {isRouting ? "Routing..." : "Route Tasks"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview">
              <Target className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="context">
              <Brain className="w-4 h-4 mr-2" />
              Context ({enrichedContext?.entities.length || 0})
            </TabsTrigger>
            <TabsTrigger value="routing">
              <Network className="w-4 h-4 mr-2" />
              Routing ({agentRouting.length})
            </TabsTrigger>
            {showRoutingVisualization && (
              <TabsTrigger value="tasks">
                <Layers className="w-4 h-4 mr-2" />
                Tasks ({taskRouting.length})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-foreground/50">Team Efficiency</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {(stats.teamEfficiency * 100).toFixed(0)}%
                  </p>
                  <Progress value={stats.teamEfficiency * 100} className="h-1 mt-2" />
                </div>

                <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-violet-400" />
                    <span className="text-sm text-foreground/50">Knowledge Coverage</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {(stats.knowledgeCoverage * 100).toFixed(0)}%
                  </p>
                  <Progress value={stats.knowledgeCoverage * 100} className="h-1 mt-2" />
                </div>

                <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-foreground/50">Est. Duration</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {Math.ceil(stats.estimatedDuration / 60)}h
                  </p>
                  <p className="text-xs text-foreground/50 mt-1">Parallel execution</p>
                </div>

                <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-foreground/50">Context Score</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {(stats.enrichmentScore * 100).toFixed(0)}%
                  </p>
                  <Progress value={stats.enrichmentScore * 100} className="h-1 mt-2" />
                </div>
              </div>
            )}

            {enrichedContext?.suggestedActions &&
              enrichedContext.suggestedActions.length > 0 && (
                <div className="p-4 rounded-lg bg-violet-500/5 border border-violet-500/20">
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-violet-400" />
                    Suggested Actions
                  </h4>
                  <div className="space-y-2">
                    {enrichedContext.suggestedActions.slice(0, 3).map((action, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-foreground/5"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {action.type}
                          </Badge>
                          <span className="text-sm">{action.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground/50">{action.reason}</span>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              action.confidence > 0.7
                                ? "bg-green-500/20"
                                : "bg-amber-500/20"
                            }`}
                          >
                            {(action.confidence * 100).toFixed(0)}%
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {enrichedContext?.similarPastMissions &&
              enrichedContext.similarPastMissions.length > 0 && (
                <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-blue-400" />
                    Similar Past Missions
                  </h4>
                  <div className="space-y-2">
                    {enrichedContext.similarPastMissions.map((mission) => (
                      <div
                        key={mission.id}
                        className="p-3 rounded bg-background/20 border border-foreground/5"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{mission.name}</span>
                          <Badge
                            variant="outline"
                            className={
                              mission.outcome === "success"
                                ? "border-green-500/30 text-green-400"
                                : "border-amber-500/30 text-amber-400"
                            }
                          >
                            {mission.outcome}
                          </Badge>
                        </div>
                        {mission.learnings.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {mission.learnings.slice(0, 3).map((learning, idx) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-[10px] bg-foreground/5"
                              >
                                {learning}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </TabsContent>

          <TabsContent value="context">
            {showContextGraph && enrichedContext?.entities && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {enrichedContext.entities.map((entity, idx) => (
                    <motion.div
                      key={entity.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-3 rounded-lg border bg-foreground/5 hover:bg-foreground/10 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{entity.name}</p>
                          <p className="text-xs text-foreground/50">{entity.type}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${getSourceColor(entity.source)}`}
                        >
                          {entity.source}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress value={entity.relevance * 100} className="h-1 flex-1" />
                        <span className="text-xs text-foreground/50">
                          {(entity.relevance * 100).toFixed(0)}%
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {enrichedContext.keyRelationships.length > 0 && (
                  <div className="p-4 rounded-lg bg-foreground/5 border border-foreground/10">
                    <h4 className="font-medium mb-3">Key Relationships</h4>
                    <div className="space-y-2">
                      {enrichedContext.keyRelationships.map((rel, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2 rounded bg-background/20"
                        >
                          <span className="text-sm font-medium">{rel.from}</span>
                          <ArrowRight className="w-4 h-4 text-foreground/30" />
                          <Badge variant="secondary" className="text-[10px]">
                            {rel.relation}
                          </Badge>
                          <ArrowRight className="w-4 h-4 text-foreground/30" />
                          <span className="text-sm font-medium">{rel.to}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="routing">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentRouting.map((agent) => (
                <Card key={agent.agentId} className="bg-foreground/5 border-foreground/10">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm">
                            {getRoleIcon(agent.role)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{agent.agentName}</p>
                          <p className="text-xs text-foreground/50 capitalize">
                            {agent.role.replace("_", " ")}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          agent.status === "working"
                            ? "border-yellow-500/30 text-yellow-400"
                            : agent.status === "complete"
                            ? "border-green-500/30 text-green-400"
                            : agent.status === "error"
                            ? "border-red-500/30 text-red-400"
                            : "border-foreground/20 text-foreground/50"
                        }`}
                      >
                        {agent.status}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/50">Knowledge Proximity</span>
                        <span>{(agent.knowledgeProximity * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={agent.knowledgeProximity * 100} className="h-1" />

                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/50">Current Load</span>
                        <span>{(agent.currentLoad * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={agent.currentLoad * 100} className="h-1" />

                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/50">Assigned Tasks</span>
                        <span>{agent.assignedTasks}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.expertise.slice(0, 3).map((exp, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="text-[10px] bg-foreground/5"
                        >
                          {exp}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="tasks">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {taskRouting.map((task, idx) => (
                  <motion.div
                    key={task.taskId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="p-3 rounded-lg border bg-foreground/5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className="text-[10px] w-16 text-center"
                        >
                          {task.taskId}
                        </Badge>
                        <span className="font-medium">{task.taskName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            task.confidence > 0.7
                              ? "bg-green-500/20"
                              : "bg-amber-500/20"
                          }`}
                        >
                          {(task.confidence * 100).toFixed(0)}% confidence
                        </Badge>
                        <span className="text-xs text-foreground/50">
                          {task.estimatedDuration}m
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-foreground/50">
                      <Bot className="w-4 h-4" />
                      <span>{task.assignedAgent}</span>
                      <ChevronRight className="w-3 h-3" />
                      <span className="text-xs">{task.reasoning}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
