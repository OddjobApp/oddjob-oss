/**
 * App Co-Pilot Service
 *
 * Provisions a dedicated AI agent identity for each forged app.
 * The co-pilot is scoped to the app's blueprint, knowledge, and allowed tools
 * and is embedded into the forged app's UI via an OddjobCopilot injection.
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { jobs, apps } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { COPILOT_MODES } from "@domain/ai/core/copilot-contract.js";

const logger = createLogger("AppCopilotService");

export interface CopilotConfig {
  agentJobId: number;
  appSlug: string;
  persona: string;
  allowedTools: string[];
  welcomeMessage: string;
  blueprint: string;
}

export interface CopilotProvisionResult {
  success: boolean;
  copilotJobId?: number;
  message: string;
}

export class AppCopilotService {
  async provisionCopilot(
    appId: number,
    appSlug: string,
    blueprint: string,
    organizationId: number,
    userId: string,
    persona?: string,
    allowedTools?: string[],
  ): Promise<CopilotProvisionResult> {
    logger.info(`[AppCopilot] Provisioning co-pilot for app ${appSlug}`);

    try {
      const existing = await db.query.jobs.findFirst({
        where: and(
          eq(jobs.organizationId, organizationId),
          eq((jobs.config as any).copilotForAppSlug, appSlug),
        ),
      }).catch(() => null);

      if (existing) {
        logger.info(`[AppCopilot] Co-pilot already exists for ${appSlug}: job ${existing.id}`);
        return { success: true, copilotJobId: existing.id, message: "Co-pilot already provisioned" };
      }

      const defaultTools = allowedTools || [
        "search_unified_knowledge",
        "get_blackboard",
        "update_blackboard",
        "google_search",
        "browse_web",
        "execute_visual_query",
      ];

      const copilotPersona = persona || `You are the AI Co-Pilot for the ${appSlug} application. Act like a practical app operator: explain the current screen in plain business language, identify safe next actions, cite the app blueprint or available data when possible, and ask for confirmation before any action that could change records, launch work, send messages, or spend budget. Keep responses concise, specific, and evidence-aware.`;

      const [copilotJob] = await db.insert(jobs).values({
        name: `Co-Pilot: ${appSlug}`,
        tool: "chat",
        organizationId,
        createdBy: userId,
        config: {
          copilotForAppSlug: appSlug,
          copilotForAppId: appId,
          blueprint,
          persona: copilotPersona,
          allowedTools: defaultTools,
          isCopilot: true,
          welcomeMessage: `Hi, I'm the ${appSlug} Co-Pilot. I can explain this app, summarize data, plan next steps, and prepare confirmed actions.`,
        },
        supervisionLevel: "full",
      } as any).returning();

      await (db.update(apps) as any)
        .set({ config: sql`config || ${JSON.stringify({ copilotJobId: copilotJob.id })}::jsonb` })
        .where(eq(apps.id, appId))
        .catch((err: any) => logger.warn(`[AppCopilot] Could not update app config: ${err.message}`));

      logger.info(`[AppCopilot] Provisioned co-pilot job ${copilotJob.id} for app ${appSlug}`);
      return { success: true, copilotJobId: copilotJob.id, message: "Co-pilot provisioned" };
    } catch (err: any) {
      logger.error(`[AppCopilot] Failed to provision co-pilot for ${appSlug}: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  async getCopilotConfig(appSlug: string, organizationId: number): Promise<CopilotConfig | null> {
    try {
      const [copilotJob] = await db
        .select()
        .from(jobs)
        .where(and(
          eq(jobs.organizationId, organizationId),
          sql`(config->>'isCopilot')::boolean = true`,
          sql`config->>'copilotForAppSlug' = ${appSlug}`,
        ))
        .limit(1);

      if (!copilotJob) return null;

      const config = copilotJob.config as any;

      return {
        agentJobId: copilotJob.id,
        appSlug,
        persona: config.persona || "",
        allowedTools: config.allowedTools || [],
        welcomeMessage: config.welcomeMessage || "How can I help?",
        blueprint: config.blueprint || "custom-tool",
      };
    } catch (err: any) {
      logger.warn(`[AppCopilot] Failed to get copilot config for ${appSlug}: ${err.message}`);
      return null;
    }
  }

  generateWidgetCode(copilotJobId: number, appSlug: string, welcomeMessage: string): string {
    return `
{/* === Oddjob Co-Pilot Widget (auto-injected by forge) === */}
<OddjobCopilot
  agentJobId={${copilotJobId}}
  appSlug="${appSlug}"
  welcomeMessage="${welcomeMessage.replace(/"/g, '\\"')}"
  position="bottom-right"
  apiBase={process.env.NEXT_PUBLIC_ODDJOB_API_URL || ""}
/>
{/* === End Co-Pilot Widget === */}
`;
  }

  generateCopilotComponent(): string {
    const copilotModesLiteral = JSON.stringify(COPILOT_MODES);
    return `"use client";
import { useState, useRef, useEffect } from "react";

const COPILOT_MODES = ${copilotModesLiteral} as const;
type CopilotMode = typeof COPILOT_MODES[number];

interface OddjobCopilotProps {
  agentJobId: number;
  appSlug: string;
  welcomeMessage?: string;
  position?: "bottom-right" | "bottom-left";
  apiBase?: string;
}

interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
  evidence?: Array<{ label: string; source: string }>;
}

const QUICK_ACTIONS: Array<{ label: string; mode: CopilotMode; prompt: string }> = [
  { label: "Explain app", mode: "explain", prompt: "Explain what this app does, who it is for, and what I should inspect first." },
  { label: "Summarize data", mode: "explain", prompt: "Summarize the visible app data or available app context in plain business language." },
  { label: "Plan next step", mode: "plan", prompt: "Recommend the safest next action in this app. Include required inputs, risks, and expected outcome." },
  { label: "Audit risk", mode: "audit", prompt: "Audit this app context for missing data, risky actions, stale assumptions, or approval needs." },
];

function actionNeedsConfirmation(text: string) {
  return /delete|abort|terminate|approve|launch|trigger|run|write|update|sync|send|create/i.test(text);
}

export function OddjobCopilot({ agentJobId, appSlug, welcomeMessage = "How can I help?", position = "bottom-right", apiBase = "" }: OddjobCopilotProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([{ role: "assistant", content: welcomeMessage }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<CopilotMode>("explain");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingAction]);

  const send = async (text = input, options?: { confirmed?: boolean; mode?: CopilotMode }) => {
    const prompt = text.trim();
    const activeMode = options?.mode || mode;
    if (!prompt || loading) return;

    if (activeMode === "execute" && !options?.confirmed && actionNeedsConfirmation(prompt)) {
      setPendingAction(prompt);
      return;
    }

    const userMsg: CopilotMessage = { role: "user", content: prompt };
    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages);
    setInput("");
    setPendingAction(null);
    setLoading(true);

    try {
      const res = await fetch(apiBase + "/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: prompt,
          context: {
            jobId: agentJobId,
            history: currentMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
            sessionId: appSlug + "-copilot",
            appSlug,
            mode: activeMode,
            audience: "business",
            confirmedExecution: options?.confirmed === true,
            provenanceHint: [
              { label: appSlug, source: "Forged app context" },
              { label: "Blueprint", source: "App Forge configuration" },
              { label: "Allowed tools", source: "Scoped copilot permissions" }
            ],
          },
        }),
      });
      const data = await res.json();
      const reply = data.response || data.reply || data.message || data.output || "...";
      const evidence = Array.isArray(data.metadata?.evidence) ? data.metadata.evidence : [
        { label: appSlug, source: "Forged app context" },
        { label: "Copilot scope", source: "Scoped Oddjob agent" }
      ];
      setMessages(prev => [...prev, { role: "assistant", content: reply, evidence }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const positionClass = position === "bottom-right" ? "right-6" : "left-6";

  return (
    <div className={"fixed bottom-6 " + positionClass + " z-50"}>
      {open && (
        <div className="mb-4 w-[22rem] bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-gray-950 text-white px-4 py-3 flex items-center justify-between">
            <div>
              <span className="font-semibold text-sm">AI Co-Pilot</span>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">{appSlug} / {mode}</div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-xs">Close</button>
          </div>
          <div className="grid grid-cols-4 gap-1 border-b border-gray-100 bg-gray-50 p-2">
            {COPILOT_MODES.map(item => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={item === mode ? "rounded-lg bg-gray-900 px-2 py-1.5 text-[10px] font-semibold uppercase text-white" : "rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-500 hover:bg-gray-100"}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 border-b border-gray-100 bg-white p-3">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                onClick={() => { setMode(action.mode); send(action.prompt, { mode: action.mode }); }}
                disabled={loading}
                className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex-1 max-h-80 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.map((m, i) => (
              <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[85%] rounded-lg px-3 py-2 text-sm " + (m.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-800")}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.role === "assistant" && m.evidence && m.evidence.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 pt-2">
                      {m.evidence.slice(0, 3).map((e, idx) => (
                        <span key={idx} title={e.source} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                          {e.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pendingAction && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-semibold uppercase tracking-wide">Confirm live action</div>
                <p className="mt-1">This may change app or platform state. I will run it only after confirmation.</p>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setPendingAction(null)} className="rounded-md px-2 py-1 font-semibold text-amber-800 hover:bg-amber-100">Cancel</button>
                  <button onClick={() => pendingAction && send(pendingAction, { confirmed: true, mode: "execute" })} className="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700">Confirm</button>
                </div>
              </div>
            )}
            {loading && <div className="text-xs text-gray-400 animate-pulse">Thinking...</div>}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-3 border-t border-gray-100 flex gap-2">
            <input
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={mode === "execute" ? "Describe action to preview..." : "Ask the app copilot..."}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
            />
            <button onClick={() => send()} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
              Send
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-12 h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center text-sm font-bold hover:bg-gray-700 transition-colors"
      >
        {open ? "Close" : "AI"}
      </button>
    </div>
  );
}
`;
  }
}

export const appCopilotService = new AppCopilotService();
