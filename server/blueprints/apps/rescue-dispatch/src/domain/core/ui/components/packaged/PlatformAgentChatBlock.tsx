import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { Card } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Skeleton } from '../ui/skeleton.js';
import { Badge } from '../ui/badge.js';

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface PlatformAgentChatBlockProps {
  /** Oddjob agent ID to chat with */
  agentId: number;
  personaName?: string;
  suggestedPrompts?: string[];
  /** Dataset collection to persist conversation history */
  collectionName?: string;
  height?: string;
}

export default function PlatformAgentChatBlock({
  agentId,
  personaName = "AI Assistant",
  suggestedPrompts = [],
  collectionName,
  height = "600px",
}: PlatformAgentChatBlockProps) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [streaming, setStreaming]   = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [streamBuffer, setStreamBuffer] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty("--dynamic-height", height);
    }
  }, [height]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamBuffer]);

  // Load conversation history from platform
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/oddjob/agents/${agentId}/history`);
      if (res.ok) {
        const data = await res.json();
        const hist: Message[] = (data.messages ?? data ?? []).map((m: any) => ({
          id: m.id ?? String(Math.random()),
          role: m.role,
          content: m.content,
          timestamp: m.createdAt ?? m.timestamp ?? new Date().toISOString(),
        }));
        setMessages(hist);
      }
    } catch {
      // History unavailable — start fresh
    } finally {
      setLoadingHistory(false);
    }
  }, [agentId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    setInput("");
    setError(null);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer("");

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/oddjob/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, collectionName }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        // SSE streaming path
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content ?? parsed.content ?? parsed.token ?? "";
                accumulated += token;
                setStreamBuffer(accumulated);
              } catch { accumulated += data; setStreamBuffer(accumulated); }
            }
          }
        }

        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: accumulated || "(no response)",
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamBuffer("");
      } else {
        // JSON response path
        const data = await res.json();
        const reply = data.message ?? data.content ?? data.response ?? data.output ?? "";
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: reply || "(no response)",
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setError(e.message || "Failed to send message.");
        setMessages(prev => prev.slice(0, -1)); // Remove optimistic user msg
      }
    } finally {
      setStreaming(false);
      setStreamBuffer("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <Card className="flex flex-col bg-black/40 border-white/10 backdrop-blur-xl overflow-hidden shadow-2xl dynamic-height" ref={wrapperRef}>
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Bot className="text-black w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white tracking-tight">{personaName}</h3>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${streaming ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                {streaming ? "Thinking…" : "Ready"}
              </span>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={loadHistory} className="text-white/30 hover:text-white">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5" ref={scrollRef}>
        {loadingHistory ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className={`h-14 rounded-2xl bg-white/5 ${i % 2 === 0 ? "ml-12" : "mr-12"}`} />)}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[82%] flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    msg.role === "user" ? "bg-white/10" : "bg-amber-500/10 border border-amber-500/20"
                  }`}>
                    {msg.role === "user"
                      ? <User className="w-4 h-4 text-white/60" />
                      : <Sparkles className="w-4 h-4 text-amber-500" />}
                  </div>
                  <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-white/10 text-white rounded-tr-none"
                      : "bg-white/5 border border-white/10 text-white/90 rounded-tl-none"
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Live stream buffer */}
            {streaming && streamBuffer && (
              <motion.div key="stream" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="max-w-[82%] flex gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/10 border border-amber-500/20">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-none text-sm leading-relaxed bg-white/5 border border-white/10 text-white/90 whitespace-pre-wrap">
                    {streamBuffer}
                    <span className="inline-block w-1.5 h-4 bg-amber-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                  </div>
                </div>
              </motion.div>
            )}

            {/* Typing indicator (no buffer yet) */}
            {streaming && !streamBuffer && (
              <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="flex gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-white/5 border border-white/10 flex items-center gap-1">
                    {[0, 1, 2].map(i => (
                      <span 
                        key={i} 
                        className={`w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce ${i === 1 ? 'delay-150' : i === 2 ? 'delay-300' : ''}`} 
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Empty state with suggested prompts */}
        {!loadingHistory && messages.length === 0 && suggestedPrompts.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-4">
            <p className="text-white/30 text-xs text-center mb-4 uppercase tracking-widest">Suggested</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestedPrompts.map(p => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/50 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-300 transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Input bar */}
      <div className="p-4 border-t border-white/10 bg-white/5 shrink-0">
        <div className="relative">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Send a message…"
            className="bg-black/20 border-white/10 text-white placeholder:text-white/20 h-12 pl-4 pr-14 rounded-xl focus-visible:ring-amber-500/50"
          />
          <Button
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || streaming}
            className="absolute right-1.5 top-1.5 h-9 w-9 bg-amber-500 hover:bg-amber-400 text-black rounded-lg disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
