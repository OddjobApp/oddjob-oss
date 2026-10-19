/**
 * AgentChatPanel — SSE streaming chat with ai-scrum-master agent.
 * Injects sprint context, persists history, supports "Apply Recommendation".
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Send, Sparkles, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { agents, records, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";
import type { AgentChatRecord } from "../lib/collections";

interface Props {
  agentId: number | null;
  sprintNumber: number;
  sprintContext: {
    availableEngineerDays: number;
    targetVelocity: number;
    committedTickets: number;
    committedPoints: number;
  };
  onApplyRecommendation?: (values: { engineerDays?: number; velocity?: number }) => void;
}

export function AgentChatPanel({ agentId, sprintNumber, sprintContext, onApplyRecommendation }: Props) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const collectionName = `${COLLECTIONS.AGENT_CHAT}_sprint_${sprintNumber}`;

  // Load history on mount
  useEffect(() => {
    if (!agentId) return;
    agents.history(agentId, collectionName)
      .then((res) => {
        if (res.messages?.length > 0) {
          setMessages(res.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
        }
      })
      .catch(() => {}); // Non-fatal
  }, [agentId, collectionName]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !agentId || streaming) return;
    const userMsg = input.trim();
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);

    // Inject sprint context into the message
    const contextPrefix = `[Sprint ${sprintNumber} | ${sprintContext.availableEngineerDays} eng-days | Target: ${sprintContext.targetVelocity} SP | Committed: ${sprintContext.committedTickets} tickets / ${sprintContext.committedPoints} SP]\n\n`;

    telemetry.emit("agent_chat_message_sent", "info", { sprintNumber, messageLength: userMsg.length });

    try {
      let fullResponse = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      for await (const chunk of agents.chat(agentId, contextPrefix + userMsg, collectionName)) {
        fullResponse += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: fullResponse };
          return updated;
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Chat failed");
      setMessages((prev) => prev.filter((m) => m.content !== ""));
    } finally {
      setStreaming(false);
    }
  }, [input, agentId, streaming, sprintNumber, sprintContext, collectionName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Check if last assistant message contains numbers that could be recommendations
  const lastAssistant = messages.filter((m) => m.role === "assistant").slice(-1)[0];
  const hasRecommendation = lastAssistant?.content && /\d+\s*(SP|story points|engineer.days|velocity)/i.test(lastAssistant.content);

  return (
    <div className="flex flex-col bg-[#15121e]/60 border border-white/5 rounded-xl overflow-hidden h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">AI Sprint Planner</span>
            <span className="block text-[10px] text-slate-500">ai-scrum-master</span>
          </div>
        </div>
        {agentId ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Online
          </span>
        ) : (
          <span className="text-[9px] text-slate-500">Agent not found</span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-xs text-slate-500 py-8">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-amber-400/50" />
            Ask me about sprint capacity, "what-if" scenarios, or backlog prioritization.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-amber-600 text-white rounded-tr-none"
                : "bg-white/5 border border-white/5 text-slate-200 rounded-tl-none"
            }`}>
              {msg.content || (streaming && i === messages.length - 1 ? "..." : "")}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
          </div>
        )}
      </div>

      {/* Apply recommendation */}
      {hasRecommendation && onApplyRecommendation && !streaming && (
        <div className="px-4 py-2 border-t border-white/5">
          <button
            onClick={() => onApplyRecommendation({})}
            className="w-full py-1.5 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg transition-colors"
          >
            Apply Recommendation to Capacity Plan
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming || !agentId}
            placeholder={agentId ? "Ask about sprint planning..." : "Agent unavailable"}
            className="flex-1 bg-[#100d17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming || !agentId}
            className="p-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
