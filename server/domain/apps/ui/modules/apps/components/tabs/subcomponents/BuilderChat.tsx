import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, MessageCircle, Bug, Sparkles } from 'lucide-react';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { cn } from '@/lib/utils';

// Memoized Chat Bubble to prevent redundant renders
const ChatBubble = React.memo(({ msg, isAI, onQuickAction }: { msg: { content: string }, isAI: boolean, onQuickAction?: (action: string) => void }) => {
    const isRiskAssessment = isAI && msg.content.includes("⚠️ RISK ASSESSMENT:");
    
    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.98, y: 10 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className={cn("flex flex-col mb-6 max-w-[90%]", isAI ? "self-start" : "self-end items-end")}
        >
            <div className={cn("px-4 py-3 rounded-2xl shadow-sm relative overflow-hidden",
                isAI
                    ? cn("bg-muted/50 border border-border text-foreground rounded-tl-none", 
                         isRiskAssessment && "border-amber-500/30 bg-amber-500/5")
                    : "bg-primary text-primary-foreground rounded-tr-none")}>
                {isRiskAssessment && (
                    <div className="flex items-center gap-2 mb-2 text-amber-400">
                        <Bug className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Blast Radius Warning</span>
                    </div>
                )}
                <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                
                {isRiskAssessment && onQuickAction && (
                    <div className="flex gap-2 mt-4 pt-3 border-t border-amber-500/20">
                        <Button 
                            variant="default" 
                            size="sm" 
                            className="h-7 px-4 bg-amber-600 hover:bg-amber-700 text-foreground text-[10px] font-black uppercase tracking-widest"
                            onClick={() => onQuickAction("Yes, proceed with these changes.")}
                        >
                            Proceed
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 px-4 text-amber-400 hover:text-amber-700 dark:text-amber-300 hover:bg-amber-400/10 text-[10px] font-black uppercase tracking-widest"
                            onClick={() => onQuickAction("No, cancel these changes.")}
                        >
                            Cancel
                        </Button>
                    </div>
                )}
            </div>
        </motion.div>
    );
});

ChatBubble.displayName = 'ChatBubble';

interface BuilderChatProps {
    chatHistory: { role: 'user' | 'system'; content: string }[];
    onEnhance: (prompt: string) => void;
    isEnhancing: boolean;
    viewingFile: string | null;
    canUndo: boolean;
    onRevert: () => void;
    onQuickAction: (action: string) => void;
    /**
     * Seeds the composer and focuses it. Lets a control elsewhere in the studio —
     * "Request Changes" on the plan gate — hand the user into the change request
     * it names, instead of telling them to go and start one themselves.
     */
    draftPrompt?: string;
}

export const BuilderChat = React.memo(({
    chatHistory,
    onEnhance,
    isEnhancing,
    viewingFile,
    canUndo,
    onRevert,
    onQuickAction,
    draftPrompt
}: BuilderChatProps) => {
    const [localPrompt, setLocalPrompt] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Seed but never send: the user still edits and submits. Only a non-empty
    // draft applies, so clearing it does not wipe what they have typed.
    useEffect(() => {
        if (!draftPrompt) return;
        setLocalPrompt(draftPrompt);
        inputRef.current?.focus();
    }, [draftPrompt]);

    // Auto-scroll on history change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [chatHistory]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!localPrompt.trim() || isEnhancing) return;
        
        onEnhance(localPrompt.trim());
        setLocalPrompt(''); // Clear local state, keeping outer component clean
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar" ref={scrollRef}>
                <div className="p-4">
                    {chatHistory.map((msg, idx) => (
                        <ChatBubble key={idx} msg={msg} isAI={msg.role === 'system'} onQuickAction={onQuickAction} />
                    ))}
                    
                    {isEnhancing && (
                        <div className="flex justify-start mb-6">
                            <div className="bg-muted/50 border border-border rounded-2xl rounded-tl-none px-4 py-3 text-xs text-muted-foreground flex items-center gap-3">
                                <div className="flex gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                                </div>
                                <span className="text-xs text-muted-foreground">Thinking…</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="p-4 border-t border-foreground/10 flex-shrink-0 space-y-3 bg-foreground/5">
                <div className="relative group">
                    <Input 
                        ref={inputRef}
                        value={localPrompt} 
                        onChange={e => setLocalPrompt(e.target.value)} 
                        placeholder={viewingFile ? `Refactor ${viewingFile.split('/').pop()}…` : 'Direct the ARCHITECT…'} 
                        className="pr-10 text-xs bg-background/20 border-foreground/10 rounded-xl focus:ring-primary/50" 
                        disabled={isEnhancing} 
                    />
                    <Button 
                        type="submit" 
                        size="icon" 
                        variant="ghost" 
                        className="absolute right-1 top-1 h-8 w-8 text-primary hover:bg-primary/10" 
                        disabled={!localPrompt.trim() || isEnhancing}
                        data-testid="builder-chat-submit"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
                
                <div className="flex items-center gap-2">
                    <button 
                        type="button" 
                        onClick={() => onQuickAction('Fix types and patterns')} 
                        className="px-2 py-1 rounded bg-muted text-muted-foreground border border-foreground/5 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:text-foreground hover:bg-foreground/10 transition-all font-mono"
                    >
                        <Bug className="w-3 h-3" /> Debug
                    </button>
                    <button 
                        type="button" 
                        onClick={() => onQuickAction('Polish with high-fidelity glassmorphism')} 
                        className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-indigo-500/20 transition-all font-mono"
                    >
                        <Sparkles className="w-3 h-3" /> Beautify
                    </button>
                    {canUndo && (
                        <button 
                            type="button" 
                            onClick={onRevert} 
                            className="px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-red-500/20 transition-all font-mono"
                        >
                            Revert
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
});

BuilderChat.displayName = 'BuilderChat';
