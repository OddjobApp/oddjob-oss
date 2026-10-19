/**
 * QaAgentChatPanel — SSE streaming chat with ai-qa-engineer agent.
 * Injects defect context and investigation results.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Send, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { agents, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";

interface Props {
  agentId: number | null;
  defectContext?: { title: string; severity: string; reproSteps: string; suiteName: string } | null;
  visible: boolean;
}

export function QaAgentChatPanel({ agentId, defectContext, visible }: Props) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const collectionName = COLLECTIONS.AGENT_CHAT;

  useEffect(() => {
    if (!agentId || !visible) return;
    agents.history(agentId, collectionName).then((res) => {
      if (res.messages?.length > 0) setMessages(res.messages.map((m: any) => ({ role: m.role, content: m.content })));
    }).catch(() => {});
  }, [agentId, visible, collectionName]);

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

    const contextPrefix = defectContext
      ? `[Defect: "${defectContext.title}" | Severity: ${defectContext.severity} | Suite: ${defectContext.suiteName}]\n\n`
      : "";

    telemetry.emit("qa_agent_chat_sent", "info", { defectId: defectContext?.title, messageLength: userMsg.length });

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
  }, [input, agentId, streaming, defectContext, collectionName]);

  if (!visible) return null;

  return (
    <div className="flex flex-col bg-[#15121e]/60 border border-white/5 rounded-xl overflow-hidden h-[450px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <Bot className="w-4 h-4 text-rose-400" />
        <span className="text-sm font-semibold text-white">AI QA Assistant</span>
        {agentId ? (
          <span className="ml-auto text-[9px] text-emerald-400 font-bold">Online</span>
        ) : (
          <span className="ml-auto text-[9px] text-slate-500">Offline</span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-xs text-slate-500 py-6">
            <Sparkles className="w-5 h-5 mx-auto mb-2 text-rose-400/50" />
            Ask about test strategy, defect analysis, or coverage gaps.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
              msg.role === "user" ? "bg-rose-600 text-white rounded-tr-none" : "bg-white/5 border border-white/5 text-slate-200 rounded-tl-none"
            }`}>{msg.content || "..."}</div>
          </div>
        ))}
        {streaming && <div className="text-[10px] text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Thinking...</div>}
      </div>

      {error && <div className="mx-3 mb-2 px-2 py-1.5 rounded bg-rose-500/10 text-rose-400 text-[10px] flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</div>}

      <div className="p-3 border-t border-white/5">
        <div className="flex gap-2">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={streaming || !agentId} placeholder={agentId ? "Ask about testing..." : "Agent unavailable"}
            className="flex-1 bg-[#100d17] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500 disabled:opacity-50" />
          <button onClick={handleSend} disabled={!input.trim() || streaming || !agentId}
            className="p-2 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white rounded-lg transition-colors">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
