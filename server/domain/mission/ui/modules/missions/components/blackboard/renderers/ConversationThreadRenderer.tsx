import React from "react";
import { MessageSquare, Bot, User, Clock } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RendererProps } from "../registry";

export function ConversationThreadRenderer({ label, displayLabel, value }: RendererProps) {
    const messages = Array.isArray(value) ? value : [];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">
                        {displayLabel || label}
                    </span>
                </div>
                <Badge variant="outline" className="text-[9px] h-4 border-blue-400/30 text-blue-400">
                    {messages.length} message{messages.length !== 1 ? "s" : ""}
                </Badge>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-500/20 px-0.5">
                {messages.map((msg: any, i: number) => {
                    const isAssistant = /assistant|agent|bot|model/i.test(msg.role ?? "");
                    const Icon = isAssistant ? Bot : User;
                    const content = typeof msg.content === "object"
                        ? JSON.stringify(msg.content, null, 2)
                        : String(msg.content ?? "");

                    return (
                        <div key={msg.id || i} className={cn(
                            "flex gap-2.5 p-3 rounded-lg border",
                            isAssistant ? "bg-blue-500/5 border-blue-500/20" : "bg-primary/5 border-primary/20"
                        )}>
                            <div className={cn(
                                "shrink-0 w-7 h-7 rounded-full border flex items-center justify-center",
                                isAssistant ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-card border-primary/30 text-primary"
                            )}>
                                <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className={cn(
                                        "text-[9px] font-bold uppercase tracking-wider",
                                        isAssistant ? "text-blue-400" : "text-primary"
                                    )}>
                                        {msg.sender || (isAssistant ? "Agent" : "User")}
                                    </span>
                                    {msg.timestamp && (
                                        <span className="text-[9px] text-muted-foreground flex items-center gap-1 shrink-0">
                                            <Clock className="w-2 h-2" />
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">{content}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
