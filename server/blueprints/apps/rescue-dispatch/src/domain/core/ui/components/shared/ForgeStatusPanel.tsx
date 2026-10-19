import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Hammer, CheckCircle, XCircle, Clock, 
  ChevronRight, ChevronDown, Terminal, 
  AlertTriangle, RotateCcw, ExternalLink 
} from "lucide-react";
import { useEventStream, useFilteredEvents } from '../../hooks/useEventStream.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';

interface ForgeStatusPanelProps {
  title?: string;
  filterAppSlug?: string;
  maxHeight?: string;
}

interface ForgeRun {
  appSlug: string;
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  stages: Record<string, { status: string; message?: string; timestamp: number }>;
  currentStage: string;
  startTime: number;
  lastUpdate: number;
}

const STAGE_LABELS: Record<string, string> = {
  blueprint_selected: "Blueprint Selected",
  workspace_prepared: "Workspace Prepared",
  codegen_started: "Code Generation",
  ai_architect_invoked: "AI Architect",
  files_generated: "Files Generated",
  slot_tokens_injected: "Platform Wiring",
  dependencies_installed: "Dependencies",
  typescript_validated: "TypeScript Check",
  security_audited: "Security Audit",
  design_synthesized: "Design System",
  docker_build_started: "Docker Build",
  container_built: "Container Built",
  deployment_ready: "Deployment"
};

export default function ForgeStatusPanel({
  title = "App Forge Status",
  filterAppSlug,
  maxHeight = "600px"
}: ForgeStatusPanelProps) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  
  // Subscribe to all forge events
  const { events, isConnected } = useEventStream({
    type: "forge.*",
    autoConnect: true
  });

  // Group events by app slug
  const forgeRuns = React.useMemo(() => {
    const runs: Record<string, ForgeRun> = {};
    
    events.forEach(event => {
      const parts = event.eventType.split(".");
      // Format: forge.{jobId}.{stage} or forge.{appSlug}.{stage}
      const identifier = parts[1];
      const stageName = parts[2] || event.payload.stage;
      
      if (!identifier || !stageName) return;
      
      const slug = event.payload.appSlug || identifier;
      
      // Apply filter if provided
      if (filterAppSlug && slug !== filterAppSlug) return;
      
      if (!runs[slug]) {
        runs[slug] = {
          appSlug: slug,
          jobId: event.payload.jobId || identifier,
          status: "running",
          stages: {},
          currentStage: stageName,
          startTime: event.timestamp,
          lastUpdate: event.timestamp
        };
      }
      
      runs[slug].stages[stageName] = {
        status: event.payload.status || "completed",
        message: event.payload.message,
        timestamp: event.timestamp
      };
      
      runs[slug].currentStage = stageName;
      runs[slug].lastUpdate = event.timestamp;
      
      // Update overall status
      if (stageName === "completed" || event.payload.overallStatus === "completed") {
        runs[slug].status = "completed";
      } else if (stageName === "failed" || event.payload.overallStatus === "failed") {
        runs[slug].status = "failed";
      }
    });
    
    return runs;
  }, [events, filterAppSlug]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      case "failed": return "bg-rose-500/20 text-rose-300 border-rose-500/30";
      case "running": return "bg-indigo-500/20 text-indigo-300 border-indigo-500/30 animate-pulse";
      default: return "bg-white/10 text-white/40 border-white/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4" />;
      case "failed": return <XCircle className="h-4 w-4" />;
      case "running": return <Hammer className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatDuration = (start: number, end: number = Date.now()) => {
    const seconds = Math.floor((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-3">
          <Hammer className="h-5 w-5 text-indigo-400" />
          <CardTitle className="text-lg font-bold text-white">{title}</CardTitle>
          <Badge 
            variant="outline" 
            className={isConnected 
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" 
              : "bg-rose-500/20 text-rose-300 border-rose-500/30"
            }
          >
            {isConnected ? "LIVE" : "OFFLINE"}
          </Badge>
        </div>
        <div className="text-xs text-white/40">
          {Object.keys(forgeRuns).length} active
        </div>
      </CardHeader>

      <CardContent>
        {Object.keys(forgeRuns).length === 0 ? (
          <div className="text-center py-12 text-white/30">
            <Hammer className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No active forge runs</p>
            <p className="text-sm mt-1">Forge events will appear here in real-time</p>
          </div>
        ) : (
          <ScrollArea className="pr-4" style={{ height: maxHeight }}>
            <div className="space-y-3">
              <AnimatePresence>
                {Object.values(forgeRuns).map((run) => (
                  <motion.div
                    key={run.appSlug}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-lg bg-white/5 border border-white/10 overflow-hidden"
                  >
                    {/* Run Header */}
                    <div 
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setExpandedSlug(
                        expandedSlug === run.appSlug ? null : run.appSlug
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={getStatusColor(run.status)}>
                          {getStatusIcon(run.status)}
                        </Badge>
                        <div>
                          <p className="font-medium text-white">{run.appSlug}</p>
                          <p className="text-xs text-white/40">
                            {STAGE_LABELS[run.currentStage] || run.currentStage}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/30">
                          {formatDuration(run.startTime, run.lastUpdate)}
                        </span>
                        {expandedSlug === run.appSlug ? (
                          <ChevronDown className="h-4 w-4 text-white/40" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-white/40" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {expandedSlug === run.appSlug && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="border-t border-white/5"
                        >
                          <div className="p-4 space-y-2">
                            {/* Stage Timeline */}
                            <div className="space-y-1.5">
                              {Object.entries(STAGE_LABELS).map(([stageKey, label]) => {
                                const stage = run.stages[stageKey];
                                const isCompleted = !!stage && stage.status !== "pending";
                                const isRunning = run.currentStage === stageKey && run.status === "running";
                                const isFailed = stage?.status === "failed";
                                
                                return (
                                  <div key={stageKey} className="flex items-center gap-2 text-sm">
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                                      isFailed ? "bg-rose-500/20" :
                                      isRunning ? "bg-indigo-500/20" :
                                      isCompleted ? "bg-emerald-500/20" :
                                      "bg-white/10"
                                    }`}>
                                      {isFailed ? (
                                        <XCircle className="h-2.5 w-2.5 text-rose-400" />
                                      ) : isRunning ? (
                                        <Hammer className="h-2.5 w-2.5 text-indigo-400" />
                                      ) : isCompleted ? (
                                        <CheckCircle className="h-2.5 w-2.5 text-emerald-400" />
                                      ) : (
                                        <div className="h-1.5 w-1.5 rounded-full bg-white/30" />
                                      )}
                                    </div>
                                    <span className={`flex-1 ${
                                      isRunning ? "text-white font-medium" :
                                      isCompleted ? "text-white/60" :
                                      "text-white/30"
                                    }`}>
                                      {label}
                                    </span>
                                    {stage?.message && (
                                      <span className="text-xs text-white/30 truncate max-w-[150px]">
                                        {stage.message}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-3 mt-3 border-t border-white/5">
                              {run.status === "failed" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                                >
                                  <RotateCcw className="h-3 w-3 mr-1.5" />
                                  Retry
                                </Button>
                              )}
                              {run.status === "completed" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 border-white/10 text-white hover:bg-white/5"
                                  onClick={() => window.open(`/apps/${run.appSlug}`, "_blank")}
                                >
                                  <ExternalLink className="h-3 w-3 mr-1.5" />
                                  Open App
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-white/40 hover:text-white"
                              >
                                <Terminal className="h-3 w-3 mr-1.5" />
                                Logs
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
