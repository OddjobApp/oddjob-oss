import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hammer, CheckCircle, XCircle, Loader2, Terminal, AlertTriangle, Sparkles } from "lucide-react";
import { useEventStream } from '../../hooks/useEventStream.js';

interface ForgeProgressToastProps {
  jobId?: string;
  appSlug?: string;
  onComplete?: (success: boolean) => void;
  onClose?: () => void;
}

interface ForgeStage {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
  timestamp: number;
}

const STAGE_ORDER = [
  "blueprint_selected",
  "workspace_prepared",
  "codegen_started",
  "ai_architect_invoked",
  "files_generated",
  "slot_tokens_injected",
  "dependencies_installed",
  "typescript_validated",
  "security_audited",
  "design_synthesized",
  "docker_build_started",
  "container_built",
  "deployment_ready"
];

const STAGE_LABELS: Record<string, string> = {
  blueprint_selected: "Blueprint Selected",
  workspace_prepared: "Workspace Prepared",
  codegen_started: "Starting Code Generation",
  ai_architect_invoked: "AI Architect Working",
  files_generated: "Files Generated",
  slot_tokens_injected: "Wiring Platform Blocks",
  dependencies_installed: "Installing Dependencies",
  typescript_validated: "Validating TypeScript",
  security_audited: "Security Audit",
  design_synthesized: "Applying Design System",
  docker_build_started: "Starting Container Build",
  container_built: "Container Built",
  deployment_ready: "Deployment Ready"
};

export default function ForgeProgressToast({
  jobId,
  appSlug,
  onComplete,
  onClose
}: ForgeProgressToastProps) {
  const [stages, setStages] = useState<Record<string, ForgeStage>>({});
  const [overallStatus, setOverallStatus] = useState<"running" | "completed" | "failed">("running");
  const [currentStageIndex, setCurrentStageIndex] = useState(-1);

  // Subscribe to forge events
  const { events, isConnected } = useEventStream({
    type: jobId ? [`forge.${jobId}.*`, `forge.${appSlug}.*`] : ["forge.*"],
    autoConnect: true
  });

  // Process incoming forge events
  useEffect(() => {
    events.forEach(event => {
      const { eventType, payload, timestamp } = event;
      
      // Parse stage from event type (e.g., "forge.abc123.workspace_prepared")
      const parts = eventType.split(".");
      const stageName = parts[parts.length - 1];
      
      if (STAGE_ORDER.includes(stageName)) {
        setStages(prev => ({
          ...prev,
          [stageName]: {
            name: stageName,
            status: payload.status || "completed",
            message: payload.message,
            timestamp
          }
        }));
        
        const stageIdx = STAGE_ORDER.indexOf(stageName);
        if (stageIdx > currentStageIndex) {
          setCurrentStageIndex(stageIdx);
        }
      }
      
      // Handle overall completion
      if (stageName === "completed" || payload.overallStatus === "completed") {
        setOverallStatus("completed");
        onComplete?.(true);
      }
      if (stageName === "failed" || payload.overallStatus === "failed") {
        setOverallStatus("failed");
        onComplete?.(false);
      }
    });
  }, [events, currentStageIndex, onComplete]);

  const getStageStatus = (stageName: string): ForgeStage["status"] => {
    const stage = stages[stageName];
    if (stage) return stage.status;
    
    const stageIdx = STAGE_ORDER.indexOf(stageName);
    if (stageIdx < currentStageIndex) return "completed";
    if (stageIdx === currentStageIndex) return "running";
    return "pending";
  };

  const getStageIcon = (status: ForgeStage["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-rose-400" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />;
      default:
        return <div className="h-4 w-4 rounded-full border border-white/20" />;
    }
  };

  const progress = Math.max(0, Math.min(100, 
    ((currentStageIndex + 1) / STAGE_ORDER.length) * 100
  ));

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 50, scale: 0.95 }}
      className="fixed bottom-6 right-6 z-50 w-96 bg-zinc-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${
            overallStatus === "completed" ? "bg-emerald-500/20" :
            overallStatus === "failed" ? "bg-rose-500/20" :
            "bg-indigo-500/20"
          }`}>
            {overallStatus === "completed" ? (
              <Sparkles className="h-4 w-4 text-emerald-400" />
            ) : overallStatus === "failed" ? (
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            ) : (
              <Hammer className="h-4 w-4 text-indigo-400 animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">
              {overallStatus === "completed" ? "Forge Complete" :
               overallStatus === "failed" ? "Forge Failed" :
               "Building App..."}
            </h3>
            <p className="text-xs text-white/40">
              {isConnected ? (
                overallStatus === "running" ? "Live progress via SSE" : ""
              ) : (
                "Reconnecting..."
              )}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <XCircle className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-3">
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              overallStatus === "completed" ? "bg-emerald-500" :
              overallStatus === "failed" ? "bg-rose-500" :
              "bg-indigo-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <p className="text-xs text-white/40 mt-1.5 text-right">
          {Math.round(progress)}% complete
        </p>
      </div>

      {/* Stage List */}
      <div className="px-4 pb-4 max-h-64 overflow-y-auto">
        <div className="space-y-1">
          {STAGE_ORDER.slice(0, currentStageIndex + 3).map((stageName, idx) => {
            const status = getStageStatus(stageName);
            const stage = stages[stageName];
            
            return (
              <motion.div
                key={stageName}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`flex items-center gap-3 p-2 rounded-lg ${
                  status === "running" ? "bg-white/5" : ""
                }`}
              >
                {getStageIcon(status)}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${
                    status === "pending" ? "text-white/30" :
                    status === "running" ? "text-white font-medium" :
                    status === "completed" ? "text-white/70" :
                    "text-rose-400"
                  }`}>
                    {STAGE_LABELS[stageName]}
                  </p>
                  {stage?.message && status === "running" && (
                    <p className="text-xs text-white/40 truncate">
                      {stage.message}
                    </p>
                  )}
                </div>
                {status === "running" && (
                  <span className="text-xs text-indigo-400 animate-pulse">
                    running
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Log Preview */}
      {overallStatus === "running" && (
        <div className="px-4 py-3 bg-black/40 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs text-white/30 mb-2">
            <Terminal className="h-3 w-3" />
            <span>Latest Log</span>
          </div>
          <p className="text-xs text-white/50 font-mono truncate">
            {stages[STAGE_ORDER[currentStageIndex]]?.message || "Initializing..."}
          </p>
        </div>
      )}

      {/* Actions */}
      {overallStatus !== "running" && (
        <div className="p-4 border-t border-white/5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white transition-colors"
          >
            Close
          </button>
          {overallStatus === "completed" && (
            <button
              onClick={() => window.open(`/apps/${appSlug}`, "_blank")}
              className="flex-1 py-2 px-4 bg-indigo-500 hover:bg-indigo-400 rounded-lg text-sm text-white transition-colors"
            >
              Open App
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
