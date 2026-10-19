/**
 * Terminal Tab
 * 
 * Delegates to existing ForgeTerminal component for sophisticated terminal display.
 */

import React from "react";
import { ForgeTerminal } from "@domain/mission/ui/modules/missions/components/ForgeTerminal";

interface TerminalTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function TerminalTab({ run }: TerminalTabProps) {
  const logs = (run?.dynamicTrace || [])
    .filter((t: any) => t.type === "system" || t.type === "error" || t.event?.includes("tool_") || t.type === "thought" || t.type === "agent:thought" || t.type === "strategist")
    .map((t: any) => ({
      timestamp: t.timestamp || new Date().toISOString(),
      type: t.type === "error" ? "stderr" : (t.type === "thought" || t.type === "agent:thought") ? "thought" : t.type === "strategist" ? "strategist" : t.event === "tool_success" ? "stdout" : "system",
      content: t.content || t.note || t.error || t.event || "",
    }));

  return <ForgeTerminal logs={logs} />;
}
