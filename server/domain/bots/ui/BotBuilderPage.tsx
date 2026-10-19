/**
 * BotBuilderPage
 *
 * Simplified "Describe a bot, it exists" UX.
 *
 * Flow:
 *  1. User types a natural-language description in the hero text field.
 *  2. POST /api/bots/interpret → preview card (BotBlueprint) is rendered.
 *  3. User can edit name/description in the preview.
 *  4. POST /api/bots/propose → Agent Studio shows permissions, cost, gaps, cautions.
 *  5. POST /api/bots/create → apply the reviewed proposal and open Agent Studio in CREW.
 *
 * Advanced users can click "Configure manually" to open the full CreateAgent form.
 */

import React, { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    ArrowRight,
    Bot,
    Braces,
    CalendarClock,
    ChevronRight,
    CircleCheck,
    Loader2,
    Plug,
    Sparkles,
    Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AgentChangeProposalCard } from "@/components/agent-chat/AgentChangeProposalCard";
import type { AgentChangeProposal } from "@shared/agent-studio";

// ── Types (matching server BotBlueprint / BotCreationResult shapes) ───────────

interface BotBlueprint {
    name: string;
    description: string;
    persona: string;
    schedule: string | null;
    integrations: string[];
    capabilities: string[];
    isAiGenerated: boolean;
}

interface BotCreationResult {
    proposalId: string;
    agentCardId: number;
    agentCardName: string;
    agentCardUrl: string;
    crewRoomKey: string;
    crewRoomUrl: string;
    agentStudioUrl: string;
    schedule?: {
        expression: string;
        status: "not_provisioned";
        note: string;
    };
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Request failed");
    }
    return res.json() as Promise<T>;
}

// ── Persona icons ─────────────────────────────────────────────────────────────

const PERSONA_EMOJI: Record<string, string> = {
    analyst: "📊",
    coder: "💻",
    researcher: "🔍",
    ghostwriter: "✍️",
    "art-director": "🎨",
    devops: "⚙️",
    copilot: "🤖",
    general: "🤖",
};

// ── Preview Card ──────────────────────────────────────────────────────────────

function BlueprintPreview({
    blueprint,
    onNameChange,
    onDescriptionChange,
}: {
    blueprint: BotBlueprint;
    onNameChange: (v: string) => void;
    onDescriptionChange: (v: string) => void;
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3">
                <span className="text-3xl" role="img" aria-label="Bot persona icon">
                    {PERSONA_EMOJI[blueprint.persona] ?? "🤖"}
                </span>
                <div className="flex-1 min-w-0">
                    <Input
                        id="bot-name-input"
                        value={blueprint.name}
                        onChange={e => onNameChange(e.target.value)}
                        className="text-lg font-semibold h-auto py-1 border-0 px-0 focus-visible:ring-0 bg-transparent"
                        maxLength={80}
                        aria-label="Bot name"
                    />
                    <p className="text-xs text-muted-foreground mt-0.5">Tap to rename</p>
                </div>
                {blueprint.isAiGenerated && (
                    <Badge variant="outline" className="text-xs gap-1 shrink-0">
                        <Sparkles className="w-3 h-3" />
                        AI-assisted
                    </Badge>
                )}
            </div>

            <div>
                <Textarea
                    id="bot-description-input"
                    value={blueprint.description}
                    onChange={e => onDescriptionChange(e.target.value)}
                    className="text-sm text-muted-foreground resize-none border-0 px-0 bg-transparent focus-visible:ring-0 min-h-[60px]"
                    maxLength={200}
                    aria-label="Bot description"
                />
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                {blueprint.schedule && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="w-3.5 h-3.5 text-primary" />
                        <code className="font-mono">{blueprint.schedule}</code>
                    </div>
                )}
                {blueprint.integrations.map(i => (
                    <Badge key={i} variant="secondary" className="text-xs gap-1">
                        <Plug className="w-3 h-3" />
                        {i}
                    </Badge>
                ))}
                {blueprint.capabilities.slice(0, 4).map(c => (
                    <Badge key={c} variant="outline" className="text-xs gap-1">
                        <Braces className="w-3 h-3" />
                        {c}
                    </Badge>
                ))}
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BotBuilderPage() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [prompt, setPrompt] = useState("");
    const [blueprint, setBlueprint] = useState<BotBlueprint | null>(null);
    const [proposal, setProposal] = useState<AgentChangeProposal | null>(null);

    // Step 1: interpret
    const interpretMutation = useMutation<BotBlueprint, Error, string>({
        mutationFn: (p: string) => apiPost<BotBlueprint>("/api/bots/interpret", { prompt: p }),
        onSuccess: (data) => {
            setBlueprint(data);
            setProposal(null);
        },
        onError: (err) => {
            toast({ title: "Could not analyse prompt", description: err.message, variant: "destructive" });
        },
    });

    // Step 2: Agent Studio review
    const proposeMutation = useMutation<AgentChangeProposal, Error, { instruction: string; blueprint: BotBlueprint }>({
        mutationFn: (input) => apiPost<AgentChangeProposal>("/api/bots/propose", input),
        onSuccess: (data) => setProposal(data),
        onError: (err) => {
            toast({ title: "Could not draft the agent", description: err.message, variant: "destructive" });
        },
    });

    // Step 3: explicit apply
    const createMutation = useMutation<BotCreationResult, Error, AgentChangeProposal>({
        mutationFn: (reviewed) => {
            if (!blueprint) return Promise.reject(new Error("Blueprint is missing"));
            return apiPost<BotCreationResult>("/api/bots/create", {
                instruction: prompt.trim(),
                blueprint,
                proposal: reviewed,
            });
        },
        onSuccess: (result) => {
            toast({
                title: `${result.agentCardName} is ready`,
                description: "Opening it in Agent Studio…",
            });
            navigate(result.agentStudioUrl);
        },
        onError: (err) => {
            toast({ title: "Bot creation failed", description: err.message, variant: "destructive" });
        },
    });

    const handleInterpret = () => {
        if (prompt.trim().length < 3) return;
        setProposal(null);
        interpretMutation.mutate(prompt.trim());
    };

    const handleReview = () => {
        if (!blueprint) return;
        proposeMutation.mutate({ instruction: prompt.trim(), blueprint });
    };

    const updateBlueprint = (patch: Partial<BotBlueprint>) => {
        setBlueprint((current) => current ? { ...current, ...patch } : current);
        setProposal(null);
    };

    const isInterpreting = interpretMutation.isPending;
    const isReviewing = proposeMutation.isPending;
    const isCreating = createMutation.isPending;
    const isBusy = isInterpreting || isReviewing || isCreating;

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-2xl mx-auto px-4 py-16 space-y-8">

                {/* Header */}
                <div className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-2">
                        <Bot className="w-7 h-7 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight">Create a Bot</h1>
                    <p className="text-muted-foreground text-base max-w-md mx-auto">
                        Describe what you want your bot to do in plain English.
                        Oddjob handles the rest.
                    </p>
                </div>

                {/* Prompt area */}
                <div className="space-y-3">
                    <Textarea
                        id="bot-prompt-input"
                        ref={textareaRef}
                        placeholder='e.g. "Monitor my Jira board daily and post a Slack summary each morning"'
                        value={prompt}
                        onChange={e => {
                            setPrompt(e.target.value);
                            setProposal(null);
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleInterpret();
                        }}
                        className="min-h-[120px] text-base resize-none rounded-xl"
                        autoFocus
                        disabled={isBusy}
                        aria-label="Describe your bot"
                    />
                    <div className="flex justify-between items-center">
                        <p className="text-xs text-muted-foreground">
                            {blueprint ? "Review its permissions before anything is created." : "Press ⌘↵ or click Analyse"}
                        </p>
                        <Button
                            id="bot-analyse-btn"
                            onClick={handleInterpret}
                            disabled={prompt.trim().length < 3 || isBusy}
                            variant="outline"
                            size="sm"
                        >
                            {isInterpreting ? (
                                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Thinking…</>
                            ) : (
                                <><Wand2 className="w-4 h-4 mr-1.5" />Analyse</>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Blueprint preview */}
                {blueprint && (
                    <>
                        <BlueprintPreview
                            blueprint={blueprint}
                            onNameChange={v => updateBlueprint({ name: v })}
                            onDescriptionChange={v => updateBlueprint({ description: v })}
                        />

                        {proposal ? (
                            <div className="space-y-3">
                                <AgentChangeProposalCard
                                    payload={proposal}
                                    onApply={(reviewed) => createMutation.mutateAsync(reviewed)}
                                />
                                <div className="text-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setProposal(null)}
                                        disabled={isCreating}
                                    >
                                        Revise the draft
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col sm:flex-row gap-3">
                                <Button
                                    id="bot-create-btn"
                                    onClick={handleReview}
                                    disabled={isBusy || !blueprint.name.trim() || !blueprint.description.trim()}
                                    className="flex-1 gap-2"
                                    size="lg"
                                >
                                    {isReviewing ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" />Preparing review…</>
                                    ) : (
                                        <><CircleCheck className="w-4 h-4" />Review permissions<ArrowRight className="w-4 h-4 ml-auto" /></>
                                    )}
                                </Button>
                            </div>
                        )}
                    </>
                )}

                {/* Advanced link */}
                <div className="text-center pt-2">
                    <a
                        href="/operations/agents/new"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        id="bot-advanced-link"
                    >
                        Configure manually
                        <ChevronRight className="w-3.5 h-3.5" />
                    </a>
                </div>
            </div>
        </div>
    );
}
