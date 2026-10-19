"use client";
import { useState, useEffect, useRef } from "react";

interface Message { id: string; role: "user" | "assistant"; content: string; }

interface AgentChatProps {
  agentName: string;
  agentRole: string;
  defaultGreeting?: string;
}

export function AgentChat({ agentName, agentRole, defaultGreeting = "Hello! How can I help?" }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([{ id: "g", role: "assistant", content: defaultGreeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  async function send() {
    const text = input.trim();
    console.log("AGENT_CHAT_SEND_CALLED", { text, loading });
    if (!text || loading) return;
    setInput("");
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout for long agent tasks
    try {
      const res = await fetch("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, context: { agentName, mode: "execute" } }), signal: controller.signal });
      const data = res.ok ? await res.json() : null;
      const reply = data?.response || data?.content || "I'm currently unavailable. Please try again later.";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: reply }]);
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Request timed out. The agent may be busy — please try again." : "Connection error. The platform may be restarting.";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: msg }]);
    } finally { clearTimeout(timeout); setLoading(false); }
  }

  return (
    <div className="flex flex-col bg-slate-900/40 border border-slate-700/50 rounded-xl overflow-hidden h-[500px]">
      <div className="p-3 border-b border-slate-700/50 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">{agentName[0]}</div>
        <div><p className="text-sm font-semibold text-white">{agentName}</p><p className="text-[10px] text-slate-400 uppercase">{agentRole}</p></div>
        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400" />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} data-role={msg.role} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${msg.role === "user" ? "bg-violet-600 text-white rounded-tr-none" : "bg-slate-800 border border-slate-700 text-slate-100 rounded-tl-none"}`}>{msg.content}</div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-sm animate-pulse">Thinking...</div></div>}
      </div>
      <div className="p-3 border-t border-slate-700/50">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask the agent a question..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500" />
          <button onClick={send} disabled={!input.trim() || loading} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 text-white rounded-lg text-sm font-semibold">Send</button>
        </div>
      </div>
    </div>
  );
}
