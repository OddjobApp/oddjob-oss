"use client";
import { useState, useEffect, useRef } from "react";
import { events, PlatformEvent } from "../../lib/platform-client";

interface Props {
  stageFilter?: string;
}

export function LiveLogs({ stageFilter }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Add initial system message
    setLogs(["[SYSTEM] Waiting for organization events. This feed is not bound to a room or repository."]);

    const unsubscribe = events.subscribe((event: PlatformEvent) => {
      let logMsg = "";
      const time = new Date(event.timestamp).toLocaleTimeString();

      switch (event.type) {
        case "agent_thought":
          logMsg = `[${time}] 🤖 THOUGHT: ${event.payload.thought}`;
          break;
        case "tool_start":
          logMsg = `[${time}] 🔧 TOOL CALL: ${event.payload.tool} (${JSON.stringify(event.payload.arguments || {})})`;
          break;
        case "tool_end":
          logMsg = `[${time}] TOOL RETURNED: ${event.payload.tool} (${event.payload.success === false || event.payload.error ? 'failed' : event.payload.success === true ? 'reported success' : 'outcome not supplied'})`;
          break;
        case "stage_transition":
          logMsg = `[${time}] 🔄 STAGE: Transitioned to "${event.payload.to}"`;
          break;
        case "error":
          logMsg = `[${time}] ❌ ERROR: ${event.payload.message}`;
          break;
        default:
          // Format other arbitrary events
          if (event.payload.message) {
            logMsg = `[${time}] ℹ️  ${event.payload.message}`;
          }
      }

      if (logMsg) {
        // If stageFilter is set, make sure it matches the context or filter criteria if provided in payload
        if (stageFilter && event.payload.stage && String(event.payload.stage).toLowerCase() !== stageFilter.toLowerCase()) {
          return;
        }
        setLogs(prev => [...prev.slice(-99), logMsg]); // keep last 100 logs
      }
    });

    return () => unsubscribe();
  }, [stageFilter]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-black/90 font-mono text-xs text-green-400">
      <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center select-none">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Live Agent Feed & Telemetry</span>
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      </div>
      <div className="h-64 overflow-y-auto p-4 space-y-1.5 leading-relaxed selection:bg-green-800 selection:text-green-100">
        {logs.map((log, i) => (
          <div
            key={i}
            className={
              log.includes("❌") ? "text-rose-400" :
              log.includes("🤖") ? "text-teal-300" :
              log.includes("🔧") ? "text-amber-300" :
              log.includes("🔄") ? "text-purple-400 font-bold" : "text-green-400/90"
            }
          >
            {log}
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>
    </div>
  );
}
