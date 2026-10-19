
import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { MessageSquare, Send, Sparkles, X, Brain, Network, Terminal } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
    role: "user" | "agent";
    content: string;
    timestamp: Date;
    id?: number;
}

interface KnowledgeChatProps {
    selectedNodeId?: number | null;
    onClose?: () => void;
    context?: "graph" | "node" | "schema";
    stats?: [string, number][] | null;
    searchResults?: any[] | null;
    onFocusNode?: (nodeId: number) => void;
    onCategoryClick?: (label: string) => void;
}

export function KnowledgeChat({ selectedNodeId, onClose, context = "graph", stats, searchResults, onFocusNode, onCategoryClick }: KnowledgeChatProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: "agent",
            content: "Hello! I am the **Oddjob Knowledge Engine**. I can help you analyze the Knowledge Graph, search documents, or query structured Datasets like JIRA and GitHub. How can I assist you today?",
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    // Live progress label driven by SSE `status` events during the agent loop.
    const [typingStatus, setTypingStatus] = useState<string | null>(null);

    // Typewriter State
    const [typingMessageId, setTypingMessageId] = useState<number | null>(null);
    const [typingContent, setTypingContent] = useState("");

    const scrollRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping, typingContent]);

    // Typewriter Effect
    useEffect(() => {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'agent' && lastMsg.id !== typingMessageId && !isTyping) {
            // Start typing
            setTypingMessageId(lastMsg.id || Date.now());
            setTypingContent("");
            let i = -1;
            const content = lastMsg.content;
            const interval = setInterval(() => {
                i++;
                if (i >= content.length) {
                    clearInterval(interval);
                    setTypingMessageId(null);
                    setTypingContent(content);
                } else {
                    setTypingContent(prev => prev + content.charAt(i));
                }
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }, 10); // Slightly faster for knowledge chat
            return () => clearInterval(interval);
        }
    }, [messages, isTyping]);

    const handleSendMessage = async () => {
        if (!input.trim() || isTyping) return;

        const userMsg: Message = {
            role: "user",
            content: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsTyping(true);

        try {
            const body = JSON.stringify({
                message: input,
                context: {
                    page: "knowledge_graph",
                    currentUrl: window.location.pathname,
                    ui_context: {
                        card_type: "knowledge_chat",
                        node_id: selectedNodeId,
                        graph_context: context
                    }
                }
            });

            // Opt into SSE; server streams when it can and falls back to JSON otherwise.
            const res = await fetch("/api/agent/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
                credentials: "include",
                body,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const appendAgent = (content: string) => {
                setMessages(prev => [...prev, { role: "agent", content, timestamp: new Date() } as Message]);
            };

            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("text/event-stream") && res.body) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let rendered = false;
                let streamError: string | null = null;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let sep: number;
                    while ((sep = buffer.indexOf("\n\n")) !== -1) {
                        const frame = buffer.slice(0, sep);
                        buffer = buffer.slice(sep + 2);
                        if (frame.startsWith(":")) continue; // keepalive comment
                        let eventName = "message";
                        const dataLines: string[] = [];
                        for (const line of frame.split("\n")) {
                            if (line.startsWith("event:")) eventName = line.slice(6).trim();
                            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
                        }
                        let payload: any = {};
                        try { payload = dataLines.length ? JSON.parse(dataLines.join("\n")) : {}; } catch { continue; }
                        if (eventName === "status") {
                            if (typeof payload.label === "string") setTypingStatus(payload.label);
                        } else if (eventName === "final") {
                            if (payload.error && !payload.response) { streamError = payload.error; continue; }
                            appendAgent(typeof payload.response === "string" ? payload.response : JSON.stringify(payload.response ?? "No response received."));
                            rendered = true;
                            setTypingStatus(null);
                        }
                    }
                }
                if (streamError && !rendered) throw new Error(streamError);
                if (!rendered) appendAgent("No response received.");
            } else {
                const data = await res.json();
                if (data?.error && !data?.response) throw new Error(data.error);
                appendAgent(typeof data.response === "string" ? data.response : JSON.stringify(data.response ?? "No response received."));
            }
        } catch (error) {
            toast({
                title: "Chat Failed",
                description: "Could not connect to the Knowledge Orchestrator.",
                variant: "destructive"
            });
        } finally {
            setIsTyping(false);
            setTypingStatus(null);
        }
    };

    return (
        <Card className="flex flex-col h-full border-l rounded-none bg-muted/30 backdrop-blur-sm">
            <CardHeader className="py-3 px-4 border-b bg-card flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-1 bg-primary/10 rounded-md">
                        <Network className="w-4 h-4 text-primary" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Graph Intelligence</CardTitle>
                    <Badge variant="outline" className="text-[10px] py-0 h-4 ml-1 border-indigo-200 text-indigo-600 bg-indigo-50">
                        BETA
                    </Badge>
                </div>
                {onClose && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                        <X className="w-4 h-4" />
                    </Button>
                )}
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                    <div className="space-y-4">
                        {searchResults && searchResults.length > 0 && (
                            <div className="bg-indigo-50/50 border border-indigo-100 p-3 rounded-xl shadow-sm mb-4">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-0.5">
                                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Search Results ({searchResults.length})
                                </div>
                                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                                    {searchResults.map((result, idx) => (
                                        <div
                                            key={idx}
                                            className="p-2 bg-card rounded-lg border border-border hover:border-indigo-300 transition-all cursor-pointer shadow-none hover:shadow-sm"
                                            onClick={() => onFocusNode?.(result.source.id)}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <Badge variant="outline" className="text-[9px] py-0 h-3.5 bg-muted border-border text-muted-foreground uppercase">
                                                    {result.source.label}
                                                </Badge>
                                                <span className="text-[9px] font-mono text-foreground">#{result.source.id}</span>
                                            </div>
                                            <div className="text-xs font-semibold text-foreground mb-1 leading-tight line-clamp-2">
                                                {result.source.name}
                                            </div>
                                            {result.edge && (
                                                <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-border">
                                                    <Badge className="text-[8px] h-3 px-1 bg-indigo-50 text-indigo-400 border-indigo-100 shadow-none">
                                                        {result.edge.relation}
                                                    </Badge>
                                                    <span className="text-[10px] text-muted-foreground truncate">
                                                        → {result.target.name}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {stats && stats.length > 0 && (
                            <div className="bg-muted border border-border/60 p-3 rounded-xl shadow-sm mb-4">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-0.5">
                                    <Brain className="w-3.5 h-3.5 text-indigo-500" /> Graph Distribution
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {stats.slice(0, 6).map(([label, count]) => (
                                        <div
                                            key={label}
                                            className="px-2 py-1.5 bg-card rounded-lg flex items-center justify-between border border-border group hover:border-indigo-200 transition-colors cursor-pointer"
                                            onClick={() => onCategoryClick?.(label)}
                                        >
                                            <span className="text-[10px] font-semibold text-muted-foreground truncate mr-1 group-hover:text-indigo-600 transition-colors">{label}</span>
                                            <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-1.5 rounded-md min-w-[20px] text-center group-hover:bg-indigo-100 transition-colors">{count}</span>
                                        </div>
                                    ))}
                                    {stats.length > 6 && (
                                        <div className="col-span-2 mt-1 px-2 py-1 bg-muted/50 rounded-md text-[9px] font-medium text-muted-foreground text-center uppercase tracking-tight">
                                            + {stats.length - 6} specialized entities
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user'
                                    ? 'bg-indigo-600 text-foreground ml-4'
                                    : 'bg-card border text-muted-foreground shadow-sm mr-4'
                                    }`}>
                                    {m.role === 'agent' && (
                                        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                            <Sparkles className="w-3 h-3" />
                                            Agent
                                        </div>
                                    )}
                                    <div className={`prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:border-0 prose-pre:bg-transparent ${m.role === 'user' ? 'prose-invert' : 'dark:prose-invert'}`}>
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                code: ({ node, className, children, ...props }) => {
                                                    const { ref, ...rest } = props as any;
                                                    const match = /language-(\w+)/.exec(className || "");
                                                    return match ? (
                                                        <div className="relative group rounded-md overflow-hidden my-2 border border-border/50 shadow-sm">
                                                            <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
                                                                    className="p-1 rounded bg-muted/80 text-foreground hover:text-foreground"
                                                                    aria-label="Copy Code"
                                                                    title="Copy Code"
                                                                >
                                                                    <Copy className="h-3 w-3" />
                                                                </button>
                                                            </div>
                                                            <SyntaxHighlighter
                                                                style={vscDarkPlus as any}
                                                                language={match[1]}
                                                                PreTag="div"
                                                                className="!my-0 !bg-card !p-3 text-xs"
                                                                {...rest}
                                                            >
                                                                {String(children).replace(/\n$/, "")}
                                                            </SyntaxHighlighter>
                                                        </div>
                                                    ) : (
                                                        <code className={cn("bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono border border-border", className)} {...props}>
                                                            {children}
                                                        </code>
                                                    );
                                                },
                                                a: ({ href, children, ...props }) => {
                                                    // Chat-to-Graph Focus Link
                                                    if (href?.startsWith('/knowledge/nodes/')) {
                                                        const nodeId = parseInt(href.split('/').pop() || "0");
                                                        return (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    if (onFocusNode && !isNaN(nodeId)) {
                                                                        onFocusNode(nodeId);
                                                                    }
                                                                }}
                                                                className="text-amber-600 hover:text-amber-800 font-semibold inline-flex items-center gap-1 hover:underline cursor-pointer align-baseline"
                                                                type="button"
                                                                title="Focus on Node"
                                                            >
                                                                <Network className="h-3 w-3 self-center" />
                                                                {children}
                                                            </button>
                                                        );
                                                    }
                                                    return <a href={href} {...props} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{children}</a>;
                                                }
                                            }}
                                        >
                                            {(m.id === typingMessageId) ? typingContent : m.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="bg-card border rounded-lg px-3 py-2 text-sm shadow-sm mr-4 flex items-center gap-2">
                                    <div className="flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                        <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                        <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"></span>
                                    </div>
                                    <span className="text-muted-foreground text-xs">{typingStatus || "Thinking..."}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <div className="p-4 bg-card border-t">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Ask about relationships or data patterns..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            className="bg-muted border-border focus-visible:ring-indigo-500"
                        />
                        <Button size="icon" onClick={handleSendMessage} disabled={isTyping} className="bg-indigo-600 hover:bg-indigo-700">
                            <Send className="w-4 h-4" />
                        </Button>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1 uppercase tracking-tighter">
                            <Brain className="w-3 h-3" /> Powered by Knowledge Engine
                        </span>
                        <span className="uppercase tracking-tighter">
                            {selectedNodeId ? `Target: Node #${selectedNodeId}` : "Global Context"}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

