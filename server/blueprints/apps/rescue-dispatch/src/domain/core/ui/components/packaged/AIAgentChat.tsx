import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Sparkles, Command } from "lucide-react";
import { Card } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { ScrollArea } from "../ui/scroll-area.js";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

interface AIAgentChatProps {
    personaName?: string;
    initialMessages?: Message[];
    suggestedPrompts?: string[];
    onSendMessage?: (content: string) => void;
}

export default function AIAgentChat({
    personaName = "Sovereign Intelligence",
    initialMessages = [],
    suggestedPrompts = ["Analyze current mission status", "List resource bottlenecks", "Generate summary report"],
    onSendMessage
}: AIAgentChatProps) {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = () => {
        if (!input.trim()) return;
        const newMsg: Message = { id: Date.now().toString(), role: "user", content: input, timestamp: new Date() };
        setMessages(prev => [...prev, newMsg]);
        setInput("");
        onSendMessage?.(input);
    };

    return (
        <Card className="flex flex-col h-[600px] bg-white/5 backdrop-blur-xl border-white/10 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <Bot className="text-black w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white tracking-tight">{personaName}</h3>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[10px] uppercase tracking-widest text-emerald-400/80 font-bold">Neural Link Active</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="text-white/40 hover:text-white">
                        <Command className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Chat Content */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                <div className="space-y-6">
                    <AnimatePresence initial={false}>
                        {messages.map((msg) => (
                            <motion.div
                                key={msg.id}
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div className={`max-w-[80%] flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                        msg.role === "user" ? "bg-white/10" : "bg-amber-500/10 border border-amber-500/20"
                                    }`}>
                                        {msg.role === "user" ? <User className="w-4 h-4 text-white" /> : <Sparkles className="w-4 h-4 text-amber-500" />}
                                    </div>
                                    <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                                        msg.role === "user" 
                                            ? "bg-white/10 text-white rounded-tr-none" 
                                            : "bg-white/5 border border-white/10 text-white/90 rounded-tl-none shadow-xl"
                                    }`}>
                                        {msg.content}
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </ScrollArea>

            {/* Suggested Prompts */}
            {messages.length === 0 && (
                <div className="px-4 py-2 flex flex-wrap gap-2">
                    {suggestedPrompts.map(prompt => (
                        <button
                            key={prompt}
                            onClick={() => setInput(prompt)}
                            className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/60 hover:bg-white/10 hover:text-white transition-all"
                        >
                            {prompt}
                        </button>
                    ))}
                </div>
            )}

            {/* Footer / Input */}
            <div className="p-4 bg-white/5 border-t border-white/10">
                <div className="relative">
                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        placeholder="Transmit mission directive..."
                        className="bg-black/20 border-white/10 text-white placeholder:text-white/20 h-12 pl-4 pr-12 rounded-xl focus-visible:ring-amber-500/50"
                    />
                    <Button 
                        size="icon" 
                        onClick={handleSend}
                        className="absolute right-1 top-1 h-10 w-10 bg-amber-500 hover:bg-amber-400 text-black rounded-lg"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </Card>
    );
};
