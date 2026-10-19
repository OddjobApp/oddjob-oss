"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Bot,
  User,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Trash2,
  SlidersHorizontal,
  X,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface AgentInfo {
  name: string;
  label: string;
  role: string;
}

export interface SteeringField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "multiselect";
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface SteeringMode {
  id: string;
  label: string;
  description: string;
  intent: string;
  fields: SteeringField[];
}

interface Job {
  id: number;
  name: string;
  type: string;
}

interface AgentChatProps {
  agentName: string;
  agentRole: string;
  defaultGreeting?: string;
  agentsList?: AgentInfo[];
  steeringModes?: SteeringMode[];
}

export function AgentChat({
  agentName: initialAgentName,
  agentRole: initialAgentRole,
  defaultGreeting = "Hello! How can I help you today?",
  agentsList = [],
  steeringModes = [],
}: AgentChatProps) {
  const [activeAgent, setActiveAgent] = useState<AgentInfo>({
    name: initialAgentName,
    label: initialAgentName,
    role: initialAgentRole,
  });

  const [jobId, setJobId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingJob, setFetchingJob] = useState(true);
  const [activeSteeringMode, setActiveSteeringMode] =
    useState<SteeringMode | null>(null);
  const [steeringValues, setSteeringValues] = useState<
    Record<string, string | string[]>
  >({});

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchJobId() {
      setFetchingJob(true);
      setError(null);
      try {
        const res = await fetch("/api/oddjob/jobs");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result: { items: Job[]; total: number } = await res.json();
        const jobs = result.items || [];
        const matched = jobs.find(
          (j) =>
            j.type === "ai_agent" &&
            j.name.toLowerCase() === activeAgent.name.toLowerCase(),
        );
        if (matched) {
          setJobId(matched.id);
        } else {
          setError(
            `Agent "${activeAgent.name}" not found. Make sure the cycle app is installed.`,
          );
        }
      } catch (err: unknown) {
        setError("Connection failed. Could not retrieve agent status.");
      } finally {
        setFetchingJob(false);
      }
    }
    fetchJobId();
  }, [activeAgent.name]);

  useEffect(() => {
    const key = `oddjob_chat_history_${activeAgent.name.replace(/\s+/g, "_")}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch {
        setMessages([]);
      }
    } else {
      setMessages([
        {
          id: "greeting",
          role: "assistant",
          content: defaultGreeting,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [activeAgent.name, defaultGreeting]);

  const saveHistory = (msgs: Message[]) => {
    setMessages(msgs);
    const key = `oddjob_chat_history_${activeAgent.name.replace(/\s+/g, "_")}`;
    localStorage.setItem(key, JSON.stringify(msgs));
  };

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading || !jobId) return;
    setInput("");
    setError(null);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    const updated = [...messages, userMsg];
    saveHistory(updated);
    setLoading(true);

    try {
      const res = await fetch("/api/oddjob/agents/" + jobId + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: { jobId, mode: "execute" },
        }),
      });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      const data = await res.json();
      const reply = data.response || data.content || "(No response received)";
      saveHistory([
        ...updated,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: reply,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to communicate with the agent.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const openSteeringMode = (mode: SteeringMode) => {
    setActiveSteeringMode(mode);
    setSteeringValues(
      Object.fromEntries(
        mode.fields.map((field) => [
          field.name,
          field.type === "multiselect" ? [] : "",
        ]),
      ),
    );
  };

  const applySteeringMode = () => {
    if (!activeSteeringMode) return;
    const missing = activeSteeringMode.fields.find((field) => {
      if (!field.required) return false;
      const value = steeringValues[field.name];
      return Array.isArray(value) ? value.length === 0 : !value?.trim();
    });
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    const entries = activeSteeringMode.fields
      .map((field) => {
        const value = steeringValues[field.name];
        const rendered = Array.isArray(value) ? value.join(", ") : value;
        return rendered ? `- ${field.label}: ${rendered}` : null;
      })
      .filter(Boolean)
      .join("\n");
    setInput(
      `STEERING CASE: ${activeSteeringMode.label}\n` +
        `Intent: ${activeSteeringMode.intent}\n` +
        `${entries}\n\n` +
        `Prepare a steering preview. Do not trigger a mission, modify an artifact, publish, or approve anything. ` +
        `Summarize the proposed scope, assumptions, expected outputs, risks, and the explicit confirmation needed.`,
    );
    setActiveSteeringMode(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (!window.confirm("Clear the conversation history?")) return;
    const key = `oddjob_chat_history_${activeAgent.name.replace(/\s+/g, "_")}`;
    localStorage.removeItem(key);
    setMessages([
      {
        id: "greeting",
        role: "assistant",
        content: defaultGreeting,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="flex flex-col bg-slate-900/40 border border-slate-700/50 backdrop-blur-md rounded-xl overflow-hidden shadow-2xl h-[600px] w-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="text-white w-5 h-5" />
          </div>
          <div>
            {agentsList.length > 0 ? (
              <div className="flex flex-col">
                <select
                  value={activeAgent.name}
                  onChange={(e) => {
                    const sel = agentsList.find(
                      (a) => a.name === e.target.value,
                    );
                    if (sel) setActiveAgent(sel);
                  }}
                  className="bg-slate-800/80 border border-slate-700 text-white rounded px-2 py-0.5 text-sm font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  {agentsList.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mt-0.5 ml-1">
                  {activeAgent.role}
                </span>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-white tracking-tight">
                  {activeAgent.name}
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                  {activeAgent.role}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fetchingJob ? (
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : jobId ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">
                Online
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-[9px] uppercase tracking-wider text-amber-400 font-bold">
                Offline
              </span>
            </div>
          )}
          <button
            onClick={handleClear}
            title="Clear Chat History"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/60 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20"
        ref={scrollRef}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-blue-600/10 border border-blue-500/20" : "bg-slate-800 border border-slate-700"}`}
              >
                {msg.role === "user" ? (
                  <User className="w-4 h-4 text-blue-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                )}
              </div>
              <div
                className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-blue-600 text-white rounded-tr-none" : "bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tl-none"}`}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800 border border-slate-700">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-slate-800/50 border border-slate-700/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-slate-700/50 bg-slate-900/60 shrink-0">
        {steeringModes.length > 0 && (
          <div className="mb-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <SlidersHorizontal className="h-3 w-3" />
              Steering modes
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {steeringModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => openSteeringMode(mode)}
                  title={mode.description}
                  className="shrink-0 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[10px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20"
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeSteeringMode && (
          <div className="mb-3 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-indigo-500/20 bg-slate-950/90 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white">
                  {activeSteeringMode.label}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {activeSteeringMode.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSteeringMode(null)}
                aria-label="Close steering form"
                className="text-slate-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {activeSteeringMode.fields.map((field) => (
              <label
                key={field.name}
                className="block text-[10px] font-medium text-slate-400"
              >
                {field.label}
                {field.required ? " *" : ""}
                {field.type === "textarea" ? (
                  <textarea
                    value={(steeringValues[field.name] as string) || ""}
                    onChange={(event) =>
                      setSteeringValues((values) => ({
                        ...values,
                        [field.name]: event.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  />
                ) : field.type === "select" ? (
                  <select
                    value={(steeringValues[field.name] as string) || ""}
                    onChange={(event) =>
                      setSteeringValues((values) => ({
                        ...values,
                        [field.name]: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  >
                    <option value="">Select…</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "multiselect" ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {field.options?.map((option) => {
                      const selected = (
                        (steeringValues[field.name] as string[]) || []
                      ).includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setSteeringValues((values) => {
                              const current =
                                (values[field.name] as string[]) || [];
                              return {
                                ...values,
                                [field.name]: selected
                                  ? current.filter((value) => value !== option)
                                  : [...current, option],
                              };
                            })
                          }
                          className={`rounded border px-2 py-1 text-[10px] ${selected ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/10 text-slate-400"}`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    value={(steeringValues[field.name] as string) || ""}
                    onChange={(event) =>
                      setSteeringValues((values) => ({
                        ...values,
                        [field.name]: event.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  />
                )}
              </label>
            ))}
            <button
              type="button"
              onClick={applySteeringMode}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Prepare steering preview
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || !jobId}
            placeholder={
              jobId ? "Ask the agent a question..." : "Agent not available..."
            }
            className="flex-1 bg-slate-950/60 border border-slate-700/60 text-white placeholder:text-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !jobId}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium p-2.5 rounded-xl transition-colors flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20 disabled:shadow-none"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
