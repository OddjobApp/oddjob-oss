/**
 * InvestigateTab — container for all 5 investigation panels with collapsible sections.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Play, Globe, Database, FileText, Monitor, Rocket } from "lucide-react";
import { PlaywrightRunner } from "./PlaywrightRunner";
import { BrowserAutopilotPanel } from "./BrowserAutopilotPanel";
import { SqlQueryPanel } from "./SqlQueryPanel";
import { LogReaderPanel } from "./LogReaderPanel";
import { ConsoleCapture } from "./ConsoleCapture";

interface Props {
  defectId?: string;
  jiraKey?: string;
  onReproStepsGenerated?: (steps: string) => void;
  onLinkConsoleErrors?: (errors: string[]) => void;
  onSuiteLogged?: () => void;
}

type Section = "playwright" | "browser" | "sql" | "logs" | "console";

const SECTIONS: Array<{ id: Section; label: string; icon: React.ElementType; description: string }> = [
  { id: "playwright", label: "Playwright E2E", icon: Play, description: "Run automated test suites" },
  { id: "browser", label: "Browser Autopilot", icon: Globe, description: "Reproduce issues with AI navigation" },
  { id: "sql", label: "SQL Verification", icon: Database, description: "Query staging database" },
  { id: "logs", label: "Log Reader", icon: FileText, description: "Search application logs" },
  { id: "console", label: "Console Capture", icon: Monitor, description: "Capture browser console + network errors" },
];

export function InvestigateTab({ defectId, jiraKey, onReproStepsGenerated, onLinkConsoleErrors, onSuiteLogged }: Props) {
  const [expanded, setExpanded] = useState<Section | null>(null);

  function toggle(section: Section) {
    setExpanded((prev) => prev === section ? null : section);
  }

  return (
    <div className="space-y-3">
      {/* Quick action: full verification pipeline */}
      <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-semibold text-rose-400">Full Verification Pipeline</span>
          <span className="text-[10px] text-slate-500">Browser → Console → SQL → Logs</span>
        </div>
        <button className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold transition-colors">
          Run All
        </button>
      </div>

      {/* Collapsible sections */}
      {SECTIONS.map(({ id, label, icon: Icon, description }) => (
        <div key={id} className="rounded-xl border border-white/5 overflow-hidden">
          <button
            onClick={() => toggle(id)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left"
            aria-expanded={expanded === id}
          >
            {expanded === id ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            <Icon className="w-4 h-4 text-rose-400" />
            <div className="flex-1">
              <span className="text-sm font-semibold text-white">{label}</span>
              <span className="ml-2 text-[10px] text-slate-500">{description}</span>
            </div>
          </button>

          {expanded === id && (
            <div className="px-4 pb-4 pt-1 border-t border-white/5">
              {id === "playwright" && <PlaywrightRunner onSuiteLogged={onSuiteLogged} />}
              {id === "browser" && <BrowserAutopilotPanel defectId={defectId} onReproStepsGenerated={onReproStepsGenerated} />}
              {id === "sql" && <SqlQueryPanel defectId={defectId} />}
              {id === "logs" && <LogReaderPanel defectId={defectId} jiraKey={jiraKey} />}
              {id === "console" && <ConsoleCapture defectId={defectId} onLinkToDefect={onLinkConsoleErrors} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
