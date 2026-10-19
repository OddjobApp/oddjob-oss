import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Sparkles, RefreshCw, AlertCircle, ThumbsUp, ThumbsDown, MoreVertical, Edit2, Trash2, Download, Search, X, Filter } from "lucide-react";
import { Card } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Skeleton } from '../ui/skeleton.js';
import { Badge } from '../ui/badge.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';
import { Textarea } from '../ui/textarea.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.js';

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  rating?: number;
  feedback?: string;
}

interface PlatformAgentChatBlockProps {
  /** Oddjob agent ID to chat with */
  agentId: number;
  personaName?: string;
  suggestedPrompts?: string[];
  /** Dataset collection to persist conversation history */
  collectionName?: string;
  height?: string;
  /** Available models for selection */
  availableModels?: Array<{ id: string; name: string; provider: string }>;
  /** Default model to use */
  defaultModel?: string;
}

export default function PlatformAgentChatBlock({
  agentId,
  personaName = "AI Assistant",
  suggestedPrompts = [],
  collectionName,
  height = "600px",
  availableModels = [],
  defaultModel,
}: PlatformAgentChatBlockProps) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [streaming, setStreaming]   = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackMessageId, setFeedbackMessageId] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(0);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterRole, setFilterRole] = useState<"all" | "user" | "assistant">("all");
  const [selectedModel, setSelectedModel] = useState(defaultModel || availableModels[0]?.id || "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  useEffect(() => {
    if (wrapperRef.current) {
      // Set height directly. This used a --dynamic-height custom property read by
      // a .dynamic-height class that only exists in the platform stylesheet, so
      // inside a forged app the height fell back to auto and the block collapsed.
      wrapperRef.current.style.height = height;
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
    setError(null);
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
      } else {
        setError(`Failed to load history: HTTP ${res.status}`);
      }
    } catch (e: any) {
      setError(`Failed to load history: ${e.message || 'Network error'}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [agentId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSend = async (text?: string, retryCount: number = 0) => {
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
        body: JSON.stringify({ message: content, collectionName, model: selectedModel }),
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
        // Retry logic with exponential backoff
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          setError(`Connection failed. Retrying in ${delay / 1000}s... (${retryCount + 1}/3)`);
          setTimeout(() => {
            setError(null);
            handleSend(content, retryCount + 1);
          }, delay);
        } else {
          setError(e.message || "Failed to send message after retries.");
          setMessages(prev => prev.slice(0, -1)); // Remove optimistic user msg
        }
      }
    } finally {
      setStreaming(false);
      setStreamBuffer("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFeedback = async (messageId: string, rating: number, reason?: string) => {
    try {
      await fetch(`/api/oddjob/agents/${agentId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating, reason }),
      });
      // Update local message with feedback
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, rating, feedback: reason } 
          : msg
      ));
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    }
  };

  const openFeedbackDialog = (messageId: string) => {
    setFeedbackMessageId(messageId);
    setFeedbackRating(0);
    setFeedbackReason("");
    setFeedbackDialogOpen(true);
  };

  const submitFeedback = () => {
    if (feedbackMessageId && feedbackRating !== 0) {
      handleFeedback(feedbackMessageId, feedbackRating, feedbackReason);
      setFeedbackDialogOpen(false);
    }
  };

  const handleEditMessage = (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (msg && msg.role === "user") {
      setEditingMessageId(messageId);
      setEditContent(msg.content);
    }
  };

  const saveEdit = () => {
    if (editingMessageId) {
      setMessages(prev => prev.map(msg => 
        msg.id === editingMessageId 
          ? { ...msg, content: editContent } 
          : msg
      ));
      setEditingMessageId(null);
      setEditContent("");
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
  };

  const exportConversation = (format: 'json' | 'markdown') => {
    const data = {
      agentId,
      personaName,
      messages,
      exportedAt: new Date().toISOString(),
    };

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${agentId}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'markdown') {
      let md = `# Conversation with ${personaName}\n\n`;
      md += `Exported: ${new Date().toLocaleString()}\n\n`;
      messages.forEach(msg => {
        md += `## ${msg.role === 'user' ? 'You' : personaName}\n\n`;
        md += `${msg.content}\n\n`;
      });
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${agentId}-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Filter messages based on search query and role filter
  const filteredMessages = messages.filter(msg => {
    const matchesSearch = searchQuery === "" || 
      msg.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterRole === "all" || 
      (filterRole === "user" && msg.role === "user") ||
      (filterRole === "assistant" && msg.role === "assistant");
    return matchesSearch && matchesFilter;
  });

  // Highlight search terms in content
  const highlightSearchTerm = (text: string) => {
    // The result is injected via dangerouslySetInnerHTML, so escape HTML first —
    // raw message content (e.g. "<img src=x onerror=...>") must never render as markup.
    const escaped = (text ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    if (!searchQuery) return escaped;
    // Escape regex metacharacters in the user's query so it can't throw on an
    // unbalanced "(" / "[" or act as an injected pattern.
    const safeQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${safeQuery})`, "gi");
    return escaped.replace(regex, '<mark class="bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded px-0.5">$1</mark>');
  };

  return (
    <Card className="flex flex-col bg-background/40 border-foreground/10 backdrop-blur-xl overflow-hidden shadow-2xl" ref={wrapperRef}>
      {/* Header */}
      <div className="p-4 border-b border-foreground/10 flex items-center justify-between bg-foreground/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Bot className="text-background w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground tracking-tight">{personaName}</h3>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${streaming ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">
                {streaming ? "Thinking…" : "Ready"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {availableModels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-foreground/70 hover:text-foreground text-xs">
                  {availableModels.find(m => m.id === selectedModel)?.name || "Select Model"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {availableModels.map(model => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={selectedModel === model.id ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : ""}
                  >
                    {model.name} <span className="text-foreground/40 text-xs ml-2">({model.provider})</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setSearchOpen(!searchOpen)} 
            className={`text-foreground/30 hover:text-foreground ${searchOpen ? 'text-amber-400' : ''}`}
          >
            <Search className="w-4 h-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground/30 hover:text-foreground">
                <Download className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportConversation('json')}>
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportConversation('markdown')}>
                Export as Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" onClick={loadHistory} className="text-foreground/30 hover:text-foreground">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search and Filter Bar */}
      {searchOpen && (
        <div className="p-3 border-b border-foreground/10 bg-foreground/5 flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="bg-background/20 border-foreground/10 text-foreground placeholder:text-foreground/20 pl-10 h-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant={filterRole === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterRole("all")}
              className={filterRole === "all" ? "bg-amber-500 hover:bg-amber-400 text-background" : "border-foreground/20 text-foreground/70"}
            >
              All
            </Button>
            <Button
              variant={filterRole === "user" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterRole("user")}
              className={filterRole === "user" ? "bg-amber-500 hover:bg-amber-400 text-background" : "border-foreground/20 text-foreground/70"}
            >
              User
            </Button>
            <Button
              variant={filterRole === "assistant" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterRole("assistant")}
              className={filterRole === "assistant" ? "bg-amber-500 hover:bg-amber-400 text-background" : "border-foreground/20 text-foreground/70"}
            >
              Assistant
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5" ref={scrollRef}>
        {loadingHistory ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className={`h-14 rounded-2xl bg-foreground/5 ${i % 2 === 0 ? "ml-12" : "mr-12"}`} />)}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filteredMessages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[82%] flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    msg.role === "user" ? "bg-foreground/10" : "bg-amber-500/10 border border-amber-500/20"
                  }`}>
                    {msg.role === "user"
                      ? <User className="w-4 h-4 text-foreground/60" />
                      : <Sparkles className="w-4 h-4 text-amber-500" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-foreground/10 text-foreground rounded-tr-none"
                        : "bg-foreground/5 border border-foreground/10 text-foreground/90 rounded-tl-none"
                    }`}>
                      {editingMessageId === msg.id ? (
                        <Textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit();
                            } else if (e.key === "Escape") {
                              setEditingMessageId(null);
                              setEditContent("");
                            }
                          }}
                          className="bg-background/20 border-foreground/10 text-foreground min-h-[60px]"
                          autoFocus
                        />
                      ) : (
                        <span dangerouslySetInnerHTML={{ __html: highlightSearchTerm(msg.content) }} />
                      )}
                    </div>
                    {/* Feedback and actions */}
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-2 ml-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 ${msg.rating === 1 ? 'text-emerald-400' : 'text-foreground/30 hover:text-emerald-400'}`}
                          onClick={() => handleFeedback(msg.id, 1)}
                        >
                          <ThumbsUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 ${msg.rating === -1 ? 'text-rose-400' : 'text-foreground/30 hover:text-rose-400'}`}
                          onClick={() => openFeedbackDialog(msg.id)}
                        >
                          <ThumbsDown className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    {msg.role === "user" && (
                      <div className="flex items-center gap-1 mr-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-foreground/30 hover:text-foreground"
                          onClick={() => handleEditMessage(msg.id)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-foreground/30 hover:text-rose-400"
                          onClick={() => handleDeleteMessage(msg.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
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
                  <div className="px-4 py-3 rounded-2xl rounded-tl-none text-sm leading-relaxed bg-foreground/5 border border-foreground/10 text-foreground/90 whitespace-pre-wrap">
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
                  <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-foreground/5 border border-foreground/10 flex items-center gap-1">
                    {[0, 1, 2].map(i => (
                      <span 
                        key={i} 
                        className={`w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce ${i === 1 ? 'delay-150' : i === 2 ? 'delay-300' : ''}`} 
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
            <p className="text-foreground/30 text-xs text-center mb-4 uppercase tracking-widest">Suggested</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestedPrompts.map(p => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  className="px-3 py-1.5 rounded-full bg-foreground/5 border border-foreground/10 text-[11px] text-foreground/50 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-700 dark:text-amber-300 transition-all"
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
      <div className="p-4 border-t border-foreground/10 bg-foreground/5 shrink-0">
        <div className="relative">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Send a message…"
            className="bg-background/20 border-foreground/10 text-foreground placeholder:text-foreground/20 h-12 pl-4 pr-14 rounded-xl focus-visible:ring-amber-500/50"
          />
          <Button
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || streaming}
            className="absolute right-1.5 top-1.5 h-9 w-9 bg-amber-500 hover:bg-amber-400 text-background rounded-lg disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Feedback Dialog */}
      <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
        <DialogContent className="bg-background/40 border-foreground/10 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Provide Feedback</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-4">
              <Button
                variant={feedbackRating === 1 ? "default" : "outline"}
                onClick={() => setFeedbackRating(1)}
                className={feedbackRating === 1 ? "bg-emerald-500 hover:bg-emerald-400" : "border-foreground/20 text-foreground/70 hover:text-foreground"}
              >
                <ThumbsUp className="w-4 h-4 mr-2" />
                Helpful
              </Button>
              <Button
                variant={feedbackRating === -1 ? "default" : "outline"}
                onClick={() => setFeedbackRating(-1)}
                className={feedbackRating === -1 ? "bg-rose-500 hover:bg-rose-400" : "border-foreground/20 text-foreground/70 hover:text-foreground"}
              >
                <ThumbsDown className="w-4 h-4 mr-2" />
                Not Helpful
              </Button>
            </div>
            <Textarea
              placeholder="Why was this response helpful or not? (optional)"
              value={feedbackReason}
              onChange={e => setFeedbackReason(e.target.value)}
              className="bg-background/20 border-foreground/10 text-foreground min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFeedbackDialogOpen(false)} className="text-foreground/70 hover:text-foreground">
              Cancel
            </Button>
            <Button 
              onClick={submitFeedback} 
              disabled={feedbackRating === 0}
              className="bg-amber-500 hover:bg-amber-400 text-background"
            >
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
