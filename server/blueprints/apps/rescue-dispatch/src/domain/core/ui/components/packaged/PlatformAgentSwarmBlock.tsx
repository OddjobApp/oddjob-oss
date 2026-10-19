"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertCircle,
  Users,
  GitBranch,
  Brain,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Terminal,
  Timer,
  Coins,
  Play,
  Pause,
  StopCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Progress } from "../ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";

interface Agent {
  id: number;
  name: string;
  role: string;
  systemPrompt: string;
  status: "idle" | "working" | "reviewing" | "complete" | "error";
  output?: string;
  confidence?: number;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

interface DelegationNode {
  id: string;
  agentId: number;
  task: string;
  status: "pending" | "in_progress" | "complete" | "failed";
  subtasks?: DelegationNode[];
  output?: string;
  startTime?: Date;
  endTime?: Date;
}

interface SwarmResult {
  consensus: boolean;
  agreementScore: number;
  finalOutput: string;
  agentVotes: { agentId: number; vote: string; confidence: number }[];
  iterations: number;
  totalTokens: number;
  totalLatency: number;
}

interface PlatformAgentSwarmBlockProps {
  agentIds: number[];
  coordinatorPrompt?: string;
  consensusThreshold?: number;
  showDelegation?: boolean;
  debateMode?: boolean;
  maxIterations?: number;
  title?: string;
  objective?: string;
  onComplete?: (result: SwarmResult) => void;
}

export default function PlatformAgentSwarmBlock({
  agentIds,
  coordinatorPrompt = "You are the coordinator of an agent swarm. Break down the objective into subtasks, delegate to specialists, and synthesize their outputs into a final consensus answer.",
  consensusThreshold = 0.7,
  showDelegation = true,
  debateMode = true,
  maxIterations = 3,
  title = "Agent Swarm",
  objective,
  onComplete,
}: PlatformAgentSwarmBlockProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SwarmResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [delegationTree, setDelegationTree] = useState<DelegationNode | null>(null);
  const [activeTab, setActiveTab] = useState("swarm");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const agentsData: Agent[] = [];
      for (const agentId of agentIds) {
        const res = await fetch(`/api/oddjob/agents/${agentId}`);
        if (!res.ok) throw new Error(`Failed to fetch agent ${agentId}`);
        const data = await res.json();
        agentsData.push({
          id: agentId,
          name: data.name || `Agent ${agentId}`,
          role: data.role || "Specialist",
          systemPrompt: data.systemPrompt || "",
          status: "idle",
        });
      }
      setAgents(agentsData);
    } catch (e: any) {
      setError(e.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [agentIds]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const runSwarm = async () => {
    if (!objective || agents.length === 0) return;

    setIsRunning(true);
    setResult(null);
    setCurrentIteration(0);
    setProgress(0);
    setLogs([]);
    setActiveTab("execution");

    addLog(`🚀 Starting swarm with ${agents.length} agents`);
    addLog(`🎯 Objective: ${objective}`);
    addLog(`📊 Consensus threshold: ${consensusThreshold * 100}%`);

    try {
      // Phase 1: Initial task delegation
      addLog("📋 Phase 1: Task decomposition and delegation");
      const delegation: DelegationNode = {
        id: "root",
        agentId: agents[0]?.id || 0,
        task: objective,
        status: "in_progress",
        startTime: new Date(),
        subtasks: agents.slice(1).map((agent, idx) => ({
          id: `subtask-${idx}`,
          agentId: agent.id,
          task: `Analyze aspect ${idx + 1} of the objective`,
          status: "pending",
        })),
      };
      setDelegationTree(delegation);

      // Simulate parallel agent execution
      const updatedAgents = [...agents];
      for (let i = 0; i < updatedAgents.length; i++) {
        const agent = updatedAgents[i];
        addLog(`🤖 Agent ${agent.name} starting analysis...`);

        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id ? { ...a, status: "working" } : a
          )
        );

        // Simulate API call to agent
        await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 2000));

        const mockOutput = generateMockOutput(agent, objective);
        const confidence = 0.6 + Math.random() * 0.35;
        const tokensUsed = Math.floor(500 + Math.random() * 1500);
        const latencyMs = Math.floor(800 + Math.random() * 2000);

        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id
              ? {
                  ...a,
                  status: "complete",
                  output: mockOutput,
                  confidence,
                  tokensUsed,
                  latencyMs,
                }
              : a
          )
        );

        addLog(
          `✅ Agent ${agent.name} complete (confidence: ${(confidence * 100).toFixed(1)}%, tokens: ${tokensUsed})`
        );
        setProgress(((i + 1) / updatedAgents.length) * 50);
      }

      // Phase 2: Consensus building (if debate mode enabled)
      if (debateMode && agents.length > 1) {
        addLog("🗣️ Phase 2: Consensus building and debate");
        setCurrentIteration(1);

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
          setCurrentIteration(iteration);
          addLog(`🔄 Iteration ${iteration}/${maxIterations}`);

          // Agents review each other's work
          for (const agent of agents) {
            if (agent.status === "complete") {
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agent.id ? { ...a, status: "reviewing" } : a
                )
              );

              await new Promise((resolve) => setTimeout(resolve, 1000));

              setAgents((prev) =>
                prev.map((a) =>
                  a.id === agent.id ? { ...a, status: "complete" } : a
                )
              );
            }
          }

          setProgress(50 + (iteration / maxIterations) * 30);
        }
      }

      // Phase 3: Synthesis
      addLog("🧠 Phase 3: Synthesizing final consensus");
      setProgress(90);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const finalResult: SwarmResult = {
        consensus: true,
        agreementScore: 0.85,
        finalOutput: generateConsensusOutput(agents, objective),
        agentVotes: agents.map((a) => ({
          agentId: a.id,
          vote: a.output?.substring(0, 50) + "..." || "",
          confidence: a.confidence || 0.5,
        })),
        iterations: currentIteration,
        totalTokens: agents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0),
        totalLatency: agents.reduce((sum, a) => sum + (a.latencyMs || 0), 0),
      };

      setResult(finalResult);
      setProgress(100);
      addLog("✨ Swarm execution complete!");
      addLog(`📊 Total tokens: ${finalResult.totalTokens.toLocaleString()}`);
      addLog(`⏱️ Total latency: ${finalResult.totalLatency}ms`);

      if (onComplete) {
        onComplete(finalResult);
      }
    } catch (e: any) {
      setError(e.message || "Swarm execution failed");
      addLog(`❌ Error: ${e.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const generateMockOutput = (agent: Agent, objective: string): string => {
    const perspectives: Record<string, string> = {
      Security: `From a security perspective, ${objective} requires careful consideration of access controls, encryption at rest and in transit, and regular security audits. Key recommendations: implement RBAC, use TLS 1.3, and schedule quarterly penetration testing.`,
      Performance: `Performance analysis shows ${objective} can achieve 99.9th percentile response times under 200ms with proper caching strategies. Recommend: Redis for session storage, CDN for static assets, and database query optimization.`,
      Architecture: `Architecturally, ${objective} should follow a microservices pattern with event-driven communication. Key components: API Gateway, Service Mesh, Message Queue, and Distributed Tracing.`,
      UX: `User experience considerations for ${objective} emphasize simplicity and accessibility. Recommend: progressive disclosure, keyboard navigation, screen reader support, and mobile-first responsive design.`,
      Cost: `Cost optimization for ${objective} suggests a multi-tier approach: spot instances for batch processing, reserved instances for steady-state workloads, and auto-scaling for variable demand. Estimated savings: 40%.`,
    };

    return (
      perspectives[agent.role] ||
      `Analysis by ${agent.name} on "${objective}":\n\nKey findings:\n1. Primary consideration requires detailed evaluation\n2. Secondary factors include scalability and maintainability\n3. Recommended approach balances short-term needs with long-term vision\n\nConfidence: High`
    );
  };

  const generateConsensusOutput = (agents: Agent[], objective: string): string => {
    return `# Swarm Consensus: ${objective}

## Executive Summary
After analysis by ${agents.length} specialized agents across ${debateMode ? maxIterations : 1} iteration(s), the swarm has reached consensus with ${(consensusThreshold * 100).toFixed(0)}% agreement.

## Key Recommendations

${agents
  .map(
    (a) =>
      `### ${a.name} (${a.role}) - ${((a.confidence || 0.5) * 100).toFixed(0)}% confidence\n${
        a.output?.split("\n")[0] || "Analysis complete"
      }`
  )
  .join("\n\n")}

## Next Steps
1. Review individual agent analyses for detailed insights
2. Prioritize recommendations by confidence score
3. Implement phased approach starting with highest-confidence items
4. Schedule follow-up swarm review in 2 weeks

---
*Generated by Agent Swarm v1.0*`
  };

  const stopSwarm = () => {
    setIsRunning(false);
    addLog("🛑 Swarm execution stopped by user");
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-32 rounded-lg" />
            ))}
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
          <Button variant="outline" size="sm" onClick={fetchAgents} className="mt-3">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
            <Users className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              {title}
              <Badge variant="secondary" className="text-[10px]">
                <Sparkles className="w-3 h-3 mr-1" />
                AI Swarm
              </Badge>
            </CardTitle>
            <p className="text-xs text-white/50">
              {agents.length} agents · Consensus threshold {consensusThreshold * 100}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button variant="destructive" size="sm" onClick={stopSwarm}>
              <StopCircle className="w-4 h-4 mr-2" />
              Stop
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={runSwarm}
              disabled={!objective || agents.length === 0}
            >
              <Play className="w-4 h-4 mr-2" />
              Run Swarm
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="swarm">
              <Users className="w-4 h-4 mr-2" />
              Swarm
            </TabsTrigger>
            <TabsTrigger value="execution">
              <Terminal className="w-4 h-4 mr-2" />
              Execution
              {isRunning && (
                <span className="ml-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </TabsTrigger>
            {result && (
              <TabsTrigger value="result">
                <CheckCircle className="w-4 h-4 mr-2" />
                Result
              </TabsTrigger>
            )}
            {showDelegation && (
              <TabsTrigger value="delegation">
                <GitBranch className="w-4 h-4 mr-2" />
                Delegation
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="swarm" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {agents.map((agent) => (
                <motion.div
                  key={agent.id}
                  whileHover={{ scale: 1.02 }}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedAgent?.id === agent.id
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                  onClick={() => setSelectedAgent(agent)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs">
                        {agent.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{agent.name}</p>
                      <p className="text-xs text-white/50">{agent.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        agent.status === "working"
                          ? "border-yellow-500/30 text-yellow-400"
                          : agent.status === "complete"
                          ? "border-green-500/30 text-green-400"
                          : agent.status === "reviewing"
                          ? "border-blue-500/30 text-blue-400"
                          : "border-white/20 text-white/50"
                      }`}
                    >
                      {agent.status === "working" && (
                        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                      )}
                      {agent.status === "complete" && (
                        <CheckCircle className="w-3 h-3 mr-1" />
                      )}
                      {agent.status === "reviewing" && (
                        <Brain className="w-3 h-3 mr-1" />
                      )}
                      {agent.status === "idle" && (
                        <Bot className="w-3 h-3 mr-1" />
                      )}
                      {agent.status}
                    </Badge>
                    {agent.confidence && (
                      <span className="text-xs text-white/50">
                        {(agent.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            {selectedAgent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg border border-white/10 bg-white/5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500">
                        {selectedAgent.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{selectedAgent.name}</p>
                      <p className="text-sm text-white/50">{selectedAgent.role}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedAgent(null)}
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                </div>

                {selectedAgent.output && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-white/50 mb-1">Analysis Output:</p>
                      <div className="p-3 rounded bg-black/30 text-sm font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {selectedAgent.output}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-2 rounded bg-white/5">
                        <Coins className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                        <p className="text-lg font-medium">
                          {(selectedAgent.tokensUsed || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-white/50">tokens</p>
                      </div>
                      <div className="p-2 rounded bg-white/5">
                        <Timer className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                        <p className="text-lg font-medium">
                          {selectedAgent.latencyMs}ms
                        </p>
                        <p className="text-xs text-white/50">latency</p>
                      </div>
                      <div className="p-2 rounded bg-white/5">
                        <CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-400" />
                        <p className="text-lg font-medium">
                          {((selectedAgent.confidence || 0) * 100).toFixed(0)}%
                        </p>
                        <p className="text-xs text-white/50">confidence</p>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="execution">
            <div className="space-y-4">
              {isRunning && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Execution Progress</span>
                    <span>{progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  {currentIteration > 0 && (
                    <p className="text-xs text-white/50">
                      Iteration {currentIteration} of {maxIterations}
                    </p>
                  )}
                </div>
              )}

              <ScrollArea className="h-64 rounded-lg border border-white/10 bg-black/50 p-4">
                <div ref={scrollRef} className="space-y-1 font-mono text-sm">
                  {logs.length === 0 ? (
                    <p className="text-white/30 italic">
                      Swarm execution logs will appear here...
                    </p>
                  ) : (
                    logs.map((log, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-white/70"
                      >
                        {log}
                      </motion.div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          {result && (
            <TabsContent value="result">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-8 h-8 text-green-400" />
                    <div>
                      <p className="font-medium text-green-400">Consensus Reached</p>
                      <p className="text-sm text-white/50">
                        Agreement score: {(result.agreementScore * 100).toFixed(1)}% ·{" "}
                        {result.iterations} iteration(s)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">
                      {result.totalTokens.toLocaleString()}
                    </p>
                    <p className="text-xs text-white/50">total tokens</p>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-white/10 bg-white/5">
                  <h3 className="font-medium mb-3">Consensus Output</h3>
                  <div className="p-4 rounded bg-black/30 font-mono text-sm whitespace-pre-wrap">
                    {result.finalOutput}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {result.agentVotes.map((vote) => (
                    <div
                      key={vote.agentId}
                      className="p-3 rounded-lg border border-white/10 bg-white/5"
                    >
                      <p className="text-sm font-medium">
                        {agents.find((a) => a.id === vote.agentId)?.name}
                      </p>
                      <p className="text-xs text-white/50 line-clamp-2 mb-2">
                        {vote.vote}
                      </p>
                      <Progress value={vote.confidence * 100} className="h-1" />
                      <p className="text-xs text-right mt-1 text-white/50">
                        {(vote.confidence * 100).toFixed(0)}% confidence
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          )}

          {showDelegation && delegationTree && (
            <TabsContent value="delegation">
              <div className="p-4 rounded-lg border border-white/10 bg-white/5">
                <DelegationTreeView node={delegationTree} agents={agents} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function DelegationTreeView({
  node,
  agents,
  depth = 0,
}: {
  node: DelegationNode;
  agents: Agent[];
  depth?: number;
}) {
  const agent = agents.find((a) => a.id === node.agentId);

  return (
    <div className="space-y-2" style={{ marginLeft: depth * 24 }}>
      <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
        <Avatar className="w-6 h-6">
          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px]">
            {agent?.name.charAt(0) || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{agent?.name}</p>
          <p className="text-xs text-white/50 truncate">{node.task}</p>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] ${
            node.status === "complete"
              ? "border-green-500/30 text-green-400"
              : node.status === "in_progress"
              ? "border-yellow-500/30 text-yellow-400"
              : "border-white/20 text-white/50"
          }`}
        >
          {node.status}
        </Badge>
      </div>

      {node.subtasks?.map((subtask) => (
        <div key={subtask.id} className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-white/10" />
          <DelegationTreeView node={subtask} agents={agents} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}
