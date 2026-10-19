/**
 * MultiAgentDashboardBlock
 * 
 * Real-time monitoring and control for the multi-agent architecture.
 * View agent status, task queues, workflows, and system performance.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Activity, CheckCircle, XCircle, Clock, Loader2,
  GitBranch, Zap, BarChart3, Users, Play, Pause, RotateCcw,
  Terminal, ChevronRight, AlertTriangle, Cpu, Network
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Progress } from '../ui/progress.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import { useEventStream } from '../../hooks/useEventStream.js';

interface Agent {
  id: string;
  name: string;
  role: "architect" | "coder" | "reviewer" | "tester" | "specialist";
  status: "idle" | "working" | "error";
  currentTask?: string;
  capabilities: string[];
  performance: {
    tasksCompleted: number;
    tasksFailed: number;
    averageResponseTime: number;
    successRate: number;
  };
}

interface Task {
  id: string;
  type: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "assigned" | "in_progress" | "completed" | "failed";
  assignedAgent?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface Workflow {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  taskCount: number;
  completedTasks: number;
  createdAt: number;
}

interface SystemStatus {
  agents: Agent[];
  pendingTasks: number;
  activeWorkflows: number;
  queueLength: number;
}

interface MultiAgentDashboardBlockProps {
  title?: string;
  showPerformance?: boolean;
  autoRefresh?: boolean;
}

export default function MultiAgentDashboardBlock({
  title = "Multi-Agent Orchestration",
  showPerformance = true,
  autoRefresh = true
}: MultiAgentDashboardBlockProps) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // Subscribe to agent events
  const { events, isConnected } = useEventStream({
    type: ["agent.*", "task.*", "workflow.*"],
    autoConnect: autoRefresh
  });

  // Process events
  useEffect(() => {
    events.forEach(event => {
      const payload = event.payload;
      
      switch (event.eventType) {
        case "agent.registered":
          setStatus(prev => prev ? {
            ...prev,
            agents: [...prev.agents, payload as Agent]
          } : null);
          break;
          
        case "task.submitted":
          setTasks(prev => [payload as Task, ...prev]);
          break;
          
        case "task.started":
          setTasks(prev => prev.map(t => 
            t.id === payload.taskId 
              ? { ...t, status: "in_progress", assignedAgent: payload.agentId, startedAt: payload.timestamp }
              : t
          ));
          break;
          
        case "task.completed":
          setTasks(prev => prev.map(t => 
            t.id === payload.taskId 
              ? { ...t, status: "completed", completedAt: payload.timestamp }
              : t
          ));
          break;
          
        case "workflow.created":
          setWorkflows(prev => [{
            id: payload.workflowId,
            name: payload.name,
            status: "pending",
            taskCount: payload.taskCount,
            completedTasks: 0,
            createdAt: payload.timestamp
          }, ...prev]);
          break;
          
        case "workflow.started":
          setWorkflows(prev => prev.map(w => 
            w.id === payload.workflowId ? { ...w, status: "running" } : w
          ));
          break;
          
        case "workflow.completed":
          setWorkflows(prev => prev.map(w => 
            w.id === payload.workflowId 
              ? { ...w, status: payload.status, completedTasks: w.taskCount }
              : w
          ));
          break;
      }
    });
  }, [events]);

  // Fetch initial status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/status");
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error("[MultiAgentDashboard] Failed to fetch status:", err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "architect": return <Network className="h-4 w-4" />;
      case "coder": return <Terminal className="h-4 w-4" />;
      case "reviewer": return <CheckCircle className="h-4 w-4" />;
      case "tester": return <Activity className="h-4 w-4" />;
      default: return <Bot className="h-4 w-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "architect": return "bg-purple-500/20 text-purple-300 border-purple-500/30";
      case "coder": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
      case "reviewer": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      case "tester": return "bg-amber-500/20 text-amber-300 border-amber-500/30";
      default: return "bg-white/10 text-white/60";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "idle": return <Clock className="h-4 w-4 text-white/40" />;
      case "working": return <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />;
      case "error": return <AlertTriangle className="h-4 w-4 text-rose-400" />;
      default: return null;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "critical": return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">Critical</Badge>;
      case "high": return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">High</Badge>;
      case "medium": return <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">Medium</Badge>;
      default: return <Badge className="bg-white/10 text-white/60">Low</Badge>;
    }
  };

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-bold text-white">{title}</CardTitle>
            <Badge 
              variant="outline" 
              className={isConnected ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-white/10 text-white/60">
              <Users className="h-3 w-3 mr-1" />
              {status?.agents.length || 0} Agents
            </Badge>
            <Badge variant="outline" className="bg-white/10 text-white/60">
              <Clock className="h-3 w-3 mr-1" />
              {status?.pendingTasks || 0} Pending
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="agents">
          <TabsList className="bg-white/5 border-white/10 mb-4">
            <TabsTrigger value="agents" className="data-[state=active]:bg-white/10">
              <Bot className="h-4 w-4 mr-2" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="tasks" className="data-[state=active]:bg-white/10">
              <Terminal className="h-4 w-4 mr-2" />
              Tasks ({tasks.length})
            </TabsTrigger>
            <TabsTrigger value="workflows" className="data-[state=active]:bg-white/10">
              <GitBranch className="h-4 w-4 mr-2" />
              Workflows
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="space-y-4">
            {!status || status.agents.length === 0 ? (
              <div className="text-center py-12 text-white/30">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No agents registered</p>
                <p className="text-sm mt-1">Agents will appear when they connect to the coordinator</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {status.agents.map((agent) => (
                  <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedAgent?.id === agent.id
                        ? "bg-indigo-500/10 border-indigo-500/30"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getRoleColor(agent.role)}`}>
                          {getRoleIcon(agent.role)}
                        </div>
                        <div>
                          <p className="font-medium text-white">{agent.name}</p>
                          <p className="text-xs text-white/40 capitalize">{agent.role}</p>
                        </div>
                      </div>
                      {getStatusIcon(agent.status)}
                    </div>

                    {showPerformance && (
                      <div className="mt-3 space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-white/40">Success Rate</span>
                          <span className={agent.performance.successRate > 0.9 ? "text-emerald-400" : "text-amber-400"}>
                            {(agent.performance.successRate * 100).toFixed(0)}%
                          </span>
                        </div>
                        <Progress 
                          value={agent.performance.successRate * 100} 
                          className="h-1"
                        />
                        <div className="flex justify-between text-xs text-white/40">
                          <span>{agent.performance.tasksCompleted} completed</span>
                          <span>{agent.performance.tasksFailed} failed</span>
                        </div>
                      </div>
                    )}

                    {agent.currentTask && (
                      <div className="mt-3 p-2 bg-black/40 rounded text-xs">
                        <span className="text-white/40">Working on: </span>
                        <span className="text-indigo-300">{agent.currentTask.slice(0, 20)}...</span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.capabilities.slice(0, 3).map(cap => (
                        <Badge key={cap} variant="outline" className="text-xs border-white/10 text-white/40">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Agent Detail Panel */}
            {selectedAgent && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${getRoleColor(selectedAgent.role)}`}>
                      {getRoleIcon(selectedAgent.role)}
                    </div>
                    <div>
                      <p className="font-bold text-white">{selectedAgent.name}</p>
                      <p className="text-xs text-white/40">{selectedAgent.id}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedAgent(null)}
                  >
                    <XCircle className="h-4 w-4 text-white/40" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{selectedAgent.performance.tasksCompleted}</p>
                    <p className="text-xs text-white/40">Tasks Completed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{(selectedAgent.performance.successRate * 100).toFixed(0)}%</p>
                    <p className="text-xs text-white/40">Success Rate</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{Math.round(selectedAgent.performance.averageResponseTime)}ms</p>
                    <p className="text-xs text-white/40">Avg Response</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{selectedAgent.capabilities.length}</p>
                    <p className="text-xs text-white/40">Capabilities</p>
                  </div>
                </div>
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="tasks">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {tasks.length === 0 ? (
                  <div className="text-center py-8 text-white/30">
                    <Terminal className="h-8 w-8 mx-auto mb-2" />
                    <p>No tasks in queue</p>
                  </div>
                ) : (
                  tasks.slice(0, 20).map((task) => (
                    <div
                      key={task.id}
                      className="p-3 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        {task.status === "in_progress" ? (
                          <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />
                        ) : task.status === "completed" ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : task.status === "failed" ? (
                          <XCircle className="h-4 w-4 text-rose-400" />
                        ) : (
                          <Clock className="h-4 w-4 text-white/40" />
                        )}
                        <div>
                          <p className="text-sm text-white">{task.type}</p>
                          <p className="text-xs text-white/40 font-mono">{task.id.slice(0, 16)}...</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getPriorityBadge(task.priority)}
                        {task.assignedAgent && (
                          <Badge variant="outline" className="text-xs border-white/10 text-white/40">
                            {task.assignedAgent.slice(0, 8)}...
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="workflows">
            <div className="space-y-3">
              {workflows.length === 0 ? (
                <div className="text-center py-8 text-white/30">
                  <GitBranch className="h-8 w-8 mx-auto mb-2" />
                  <p>No active workflows</p>
                </div>
              ) : (
                workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="p-4 bg-white/5 rounded-lg border border-white/10"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-indigo-400" />
                        <span className="font-medium text-white">{workflow.name}</span>
                      </div>
                      <Badge className={
                        workflow.status === "running" ? "bg-indigo-500/20 text-indigo-300" :
                        workflow.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                        workflow.status === "failed" ? "bg-rose-500/20 text-rose-300" :
                        "bg-white/10 text-white/60"
                      }>
                        {workflow.status}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-white/40">
                        <span>{workflow.completedTasks} / {workflow.taskCount} tasks</span>
                        <span>{new Date(workflow.createdAt).toLocaleString()}</span>
                      </div>
                      <Progress 
                        value={(workflow.completedTasks / workflow.taskCount) * 100} 
                        className="h-1"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
