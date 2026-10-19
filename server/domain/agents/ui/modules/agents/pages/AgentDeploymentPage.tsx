
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRoute, useSearch } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { ArrowUp, Loader2, Paperclip, X, FileText as FileIcon, Send, Lock, Globe, ThumbsUp, ThumbsDown, Bot, User, ShieldAlert, Play, Maximize2, Minimize2, ClipboardCheck, Check } from 'lucide-react';
import { HAT_OPTIONS } from '@domain-ui/core/ui/components/icons/HatIcons';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm"; // Table support
import { cn } from "@/lib/utils";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { AgentInputForm, parseAgentResponse, type InputRequest, type ModeSwitchRequest } from "@domain-ui/ai/ui/modules/agent-ai";
import { PublicForm } from "@/modules/forms/PublicForm";
import { AgentActivityLog } from "@domain-ui/jobs/ui/modules/jobs/components/AgentActivityLog";
import { RescueStatusCard } from "@domain-ui/rescue/ui/modules/rescue/components/RescueStatusCard";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@domain-ui/core/ui/components/ui/sheet";
import { ListRestart, Terminal, Activity, Zap, Shield, Radio, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentDeployment } from "@shared/schema/agent-deployments";
import { YouTubePlayer } from '@domain-ui/core/ui/components/shared/YouTubePlayer';
import { RescueRequestPanel } from '../components/RescueRequestPanel';
import { formatSubmissionValue, humanizeFieldKey, parseFormSubmissionMessage, parseStructuredJsonMessage } from './form-submission-message';

// Helper components for dynamic styles to avoid lint warnings
const DynamicBg = ({ color, className, children, title }: { color: string, className?: string, children?: React.ReactNode, title?: string }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.style.backgroundColor = color;
    }, [color]);
    return <div ref={ref} className={className} title={title}>{children}</div>;
};

const DynamicColorIcon = ({ color, component: Component, className }: { color: string, component: any, className?: string }) => {
    const ref = React.useRef<SVGSVGElement>(null);
    React.useEffect(() => {
        if (ref.current) {
            ref.current.style.color = color;
            // Also handle fill if it's a play icon or similar
            if (className?.includes('fill-current')) {
                ref.current.style.fill = color;
            }
        }
    }, [color, className]);
    return <Component ref={ref} className={className} />;
};

const DynamicButtonBg = ({ color, className, children, onClick, disabled, title, type = "button" }: { color: string, className?: string, children?: React.ReactNode, onClick?: () => void, disabled?: boolean, title?: string, type?: "button" | "submit" | "reset" }) => {
    const ref = React.useRef<HTMLButtonElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.style.backgroundColor = color;
    }, [color]);
    return <Button ref={ref} className={className} onClick={onClick} disabled={disabled} title={title} type={type}>{children}</Button>;
};

/** Shared chrome for the cards that stand in for machine-protocol messages. */
const PayloadCard = ({ title, subtitle, pill, primaryColor, corner, children }: {
    title: string;
    subtitle: string;
    pill: string;
    primaryColor: string;
    /** Which corner stays square, matching the bubble side it sits on. */
    corner: "tl" | "tr";
    children?: React.ReactNode;
}) => (
    <Card className={cn("w-full max-w-md overflow-hidden text-sm shadow-floating border-none glass-card", corner === "tr" ? "rounded-tr-none" : "rounded-tl-none")}>
        <div className={cn("flex items-center gap-3 px-5 py-4", children && "border-b border-white/10")}>
            <DynamicBg color={`${primaryColor}20`} className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0">
                <DynamicColorIcon color={primaryColor} component={ClipboardCheck} className="h-5 w-5" />
            </DynamicBg>
            <div className="flex-1 min-w-0">
                <p className="font-bold tracking-tight leading-none truncate">{title}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1.5">{subtitle}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 shrink-0">
                <Check className="h-3 w-3" /> {pill}
            </span>
        </div>
        {children}
    </Card>
);

interface Message {
    id?: number;
    role: "user" | "agent";
    content: string;
    timestamp: number;
    rating?: number;
    feedbackReason?: string;
    inputRequest?: InputRequest; // For structured input forms
    formSubmitted?: boolean; // Track if form was already submitted
    metadata?: any;
}

interface FileAttachment {
    id: string;
    name: string;
    type: string;
    size: number;
}

export default function AgentDeploymentPage() {
    const [, params] = useRoute('/a/:slug');
    const searchString = useSearch();
    const slug = params?.slug;
    const searchParams = new URLSearchParams(searchString);
    const isEmbed = searchParams.get('embed') === '1' || searchParams.get('embed') === 'true';
    const isWidget = searchParams.get('widget') === '1' || searchParams.get('widget') === 'true';

    // 1. All State and Context
    const [sessionId, setSessionId] = useState<string>("");

    useEffect(() => {
        if ((window as any).clearLoginLoading) {
            (window as any).clearLoginLoading();
        }
    }, []);

    const { user } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const initialPrompt = searchParams.get('prompt') || searchParams.get('message') || "";
    const [inputValue, setInputValue] = useState(initialPrompt);
    const [attachments, setAttachments] = useState<FileAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [submittedNonces, setSubmittedNonces] = useState<Set<string>>(new Set());

    useEffect(() => {
        const queryPrompt = searchParams.get('prompt') || searchParams.get('message');
        if (queryPrompt && !inputValue) {
            setInputValue(queryPrompt);
        }
    }, [searchString]);

    useEffect(() => {
        const nonces = new Set<string>();
        for (const msg of messages) {
            if (msg.role === 'user' && typeof msg.content === 'string') {
                const match = msg.content.match(/\[FORM_SUBMISSION\] Execute pipeline with nonce ([a-zA-Z0-9-]+)/);
                if (match) {
                    nonces.add(match[1]);
                }
            }
        }
        setSubmittedNonces(nonces);
    }, [messages]);

    const [password, setPassword] = useState("");
    const [isVerified, setIsVerified] = useState(false);
    const [showPasswordError, setShowPasswordError] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [executingNonce, setExecutingNonce] = useState<string | null>(null);
    const [embedTokens, setEmbedTokens] = useState<{ accessToken: string; sessionToken: string } | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 2. Query hooks
    const { data: deployment, isLoading: isMetadataLoading, error: metadataError } = useQuery<AgentDeployment>({
        queryKey: [`/api/public/agents/${slug}`],
        queryFn: async () => {
            const res = await fetch(`/api/public/agents/${slug}`);
            if (res.status === 404) throw new Error("Agent not found or inactive");
            if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
            return res.json();
        },
        enabled: !!slug
    });

    // Handle Session ID based on Access Policy
    useEffect(() => {
        if (!deployment || !slug) return;

        const storage = deployment.accessPolicy === 'public' ? sessionStorage : localStorage;
        const key = `agent-session-${slug}`;
        let id = storage.getItem(key);

        if (!id) {
            id = crypto.randomUUID();
            storage.setItem(key, id);
        }

        setSessionId(id);
    }, [deployment, slug]);

    const { data: polledMessages } = useQuery({
        queryKey: [`/api/public/agents/${slug}/messages`, sessionId],
        queryFn: async () => {
            if (!deployment?.jobId || !sessionId) return [];
            try {
                const res = await fetch(`/api/public/agents/${slug}/messages?sessionId=${sessionId}`);
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (e) {
                return [];
            }
        },
        enabled: !!deployment && !!sessionId,
        refetchInterval: 3000,
        refetchOnWindowFocus: true,
    });

    const { data: activities, isLoading: isActivitiesLoading } = useQuery({
        queryKey: [`/api/public/agents/${slug}/activities`, sessionId],
        queryFn: async () => {
            if (!sessionId || !user) return []; // Reasoning for internal users only
            const res = await fetch(`/api/public/agents/${slug}/activities?sessionId=${sessionId}`);
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!slug && !!sessionId && !!user,
        refetchInterval: 3000,
    });

    // 3. Mutation hooks
    const uploadMutation = useMutation({
        mutationFn: async (files: FileList | null) => {
            if (!files || files.length === 0) return { files: [] };
            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
                formData.append("files", files[i]);
            }
            const res = await fetch(`/api/public/agents/${slug}/upload`, {
                method: "POST",
                body: formData,
                headers: password ? { 'X-Agent-Password': password } : {}
            });
            if (!res.ok) throw new Error("Upload failed");
            return res.json();
        },
        onSuccess: (data) => {
            setAttachments(prev => [...prev, ...data.files]);
            setIsUploading(false);
        },
        onError: () => setIsUploading(false)
    });

    const chatMutation = useMutation({
        mutationFn: async (args: { text: string, attachments: FileAttachment[] }) => {
            // Extract all search params to pass to the agent context (e.g., assetId from QR code)
            const urlParams = Object.fromEntries(new URLSearchParams(searchString).entries());
            
            const body: Record<string, unknown> = {
                message: args.text,
                attachments: args.attachments.map(a => ({ id: a.id, name: a.name })),
                context: { 
                    jobId: deployment?.jobId,
                    urlParams // This enables the agent to access ?assetId=... etc
                },
                sessionId,
                password
            };
            if (embedTokens) {
                body.accessToken = embedTokens.accessToken;
                body.sessionToken = embedTokens.sessionToken;
            }
            const res = await apiRequest("POST", `/api/public/agents/${slug}/chat`, body);
            return res.json();
        },
        onSuccess: (data) => {
            setMessages(prev => {
                if (prev.some(m => m.id === data.messageId || (m.role === 'agent' && m.content === data.response))) {
                    return prev;
                }
                return [...prev, {
                    role: "agent",
                    content: data.response,
                    timestamp: Date.now(),
                    id: data.messageId
                }];
            });
        },
        onError: (err: any) => {
            setMessages(prev => [...prev, { role: "agent", content: `Error: ${err.message}`, timestamp: Date.now() }]);
        }
    });

    const feedbackMutation = useMutation({
        mutationFn: async ({ messageId, rating, reason, videoMetadata }: {
            messageId: number,
            rating: number,
            reason?: string,
            videoMetadata?: { videoId: string; segmentId?: number; topic?: string }
        }) => {
            await apiRequest("POST", `/api/public/agents/${slug}/feedback/${messageId}`, {
                rating,
                reason,
                videoMetadata
            });
        },
        onSuccess: (_, variables) => {
            setMessages(prev => prev.map(m =>
                m.id === variables.messageId ? { ...m, rating: variables.rating, feedbackReason: variables.reason } : m
            ));
        },
        onError: (err) => {
            console.error("Failed to submit feedback:", err);
        }
    });

    const pipelineExecutionMutation = useMutation({
        mutationFn: async ({ nonce, inputData }: { nonce: string; inputData: Record<string, any> }) => {
            setExecutingNonce(nonce);
            const body: Record<string, unknown> = {
                message: `[FORM_SUBMISSION] Execute pipeline with nonce ${nonce} and inputs: ${JSON.stringify(inputData)}`,
                context: {
                    jobId: deployment?.jobId,
                    pipelineExecution: { nonce, inputData }
                },
                sessionId,
                password
            };
            if (embedTokens) {
                body.accessToken = embedTokens.accessToken;
                body.sessionToken = embedTokens.sessionToken;
            }
            const res = await apiRequest("POST", `/api/public/agents/${slug}/chat`, body);
            return res.json();
        },
        onSuccess: (data, variables) => {
            setMessages(prev => prev.map(m =>
                m.inputRequest?.nonce === variables.nonce
                    ? { ...m, formSubmitted: true }
                    : m
            ));
            setMessages(prev => {
                if (prev.some(m => m.id === data.messageId || (m.role === 'agent' && m.content === data.response))) {
                    return prev;
                }
                return [...prev, {
                    role: "agent",
                    content: data.response,
                    timestamp: Date.now(),
                    id: data.messageId
                }];
            });
            setExecutingNonce(null);
        },
        onError: (err: any) => {
            setMessages(prev => [...prev, { role: "agent", content: `Error executing pipeline: ${err.message}`, timestamp: Date.now() }]);
            setExecutingNonce(null);
        }
    });

    // Index each issued input_request by nonce so a [FORM_SUBMISSION] turn can
    // render its answers under the form's own title and field labels.
    const inputRequestByNonce = useMemo(() => {
        const map = new Map<string, InputRequest>();
        for (const m of messages) {
            if (m.role !== "agent" || typeof m.content !== "string") continue;
            const parsed = parseAgentResponse(m.content);
            if (parsed.type === "input_request") {
                const req = parsed.data as InputRequest;
                if (req.nonce) map.set(req.nonce, req);
            }
        }
        return map;
    }, [messages]);

    const lastAgentMsg = [...messages].reverse().find(m => m.role === 'agent');
    const isMonitorActive = !!lastAgentMsg && (
        (lastAgentMsg.metadata?.isMonitorUpdate === true && !lastAgentMsg.content.includes("Completed Successfully") && !lastAgentMsg.content.includes("Execution Failed") && !lastAgentMsg.content.includes("Execution Cancelled")) ||
        (typeof lastAgentMsg.content === 'string' && (
            (lastAgentMsg.content.includes("Status: running") && lastAgentMsg.content.includes("notify you of updates")) ||
            (lastAgentMsg.content.includes("started the") && lastAgentMsg.content.includes("pipeline") && lastAgentMsg.content.includes("notify")) ||
            (lastAgentMsg.content.includes("execution ID") && lastAgentMsg.content.includes("notify"))
        ))
    );

    // 4. Methods - Defined EARLY to avoid scoping issues in return block
    const handleSend = (messageOverride?: string) => {
        if ((!messageOverride && !inputValue.trim() && attachments.length === 0) || chatMutation.isPending || isUploading) return;

        const userMsg = messageOverride || inputValue.trim();
        const currentAttachments = [...attachments];

        setMessages(prev => [...prev, {
            role: "user",
            content: userMsg + (currentAttachments.length > 0 ? `\n[Attached: ${currentAttachments.map(a => a.name).join(", ")}]` : ""),
            timestamp: Date.now()
        }]);

        if (!messageOverride) {
            setInputValue("");
        }
        setAttachments([]);

        chatMutation.mutate({ text: userMsg || "Please analyze the attached files.", attachments: currentAttachments });
    };

    const handleVerifyPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsVerifying(true);
        setShowPasswordError(false);
        try {
            const res = await fetch(`/api/public/agents/${slug}/verify-password`, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                setIsVerified(true);
            } else {
                setShowPasswordError(true);
            }
        } catch (err) {
            setShowPasswordError(true);
        } finally {
            setIsVerifying(false);
        }
    };

    useEffect(() => {
        if (polledMessages && Array.isArray(polledMessages)) {
            // Normalize server roles to the UI's two-role model: anything that isn't
            // a user turn is an agent turn. Some persistence paths store "assistant"
            // (vs the canonical "agent"), and only "agent" renders avatars/forms/feedback.
            const normalized = polledMessages.map((m: any) =>
                m.role === "user" ? m : { ...m, role: "agent" }
            );
            setMessages(prev => {
                if (normalized.length === 0) return prev;
                const serverIdMap = new Map(normalized.map(m => [m.id, m]));
                const serverContentRoleKeys = new Set(normalized.map(m => `${m.role}:${m.content}`));
                const firstPolledTime = normalized[0].timestamp;
                const olderMessages = prev.filter(m => m.id && m.id !== -1 && !serverIdMap.has(m.id) && m.timestamp < firstPolledTime);
                const welcomeMessage = prev.find(m => m.id === -1);
                const currentHistory = normalized;
                const pendingMessages = prev.filter(m => !m.id && !serverContentRoleKeys.has(`${m.role}:${m.content}`));
                
                const combined = [...olderMessages, ...currentHistory, ...pendingMessages];
                if (welcomeMessage) {
                    combined.push(welcomeMessage);
                }
                return combined.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            });
        }
    }, [polledMessages]);

    // Ref to track if welcome message has been shown
    const welcomeShownRef = useRef(false);

    useEffect(() => {
        // Only show welcome message ONCE when:
        // 1. We have deployment data
        // 2. No messages exist yet (from server or local)
        // 3. We haven't already shown the welcome
        if (deployment && !welcomeShownRef.current && messages.length === 0 &&
            Array.isArray(polledMessages) && polledMessages.length === 0) {
            welcomeShownRef.current = true;
            setMessages([
                {
                    id: -1,
                    role: "agent",
                    content: deployment.welcomeMessage || `Hello! I am ${deployment.title || "Assistant"}. How can I help you today?`,
                    timestamp: Date.now()
                }
            ]);
        }
    }, [deployment, messages.length, polledMessages]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isUploading]);

    // postMessage: send oddjob:embed:ready when mounted in embed/widget mode
    useEffect(() => {
        if ((isEmbed || isWidget) && slug && window.parent !== window) {
            window.parent.postMessage(
                { type: 'oddjob:embed:ready', slug, version: '1' },
                '*'
            );
        }
    }, [isEmbed, isWidget, slug]);

    // postMessage: receive oddjob:embed:credentials with origin validation
    useEffect(() => {
        if ((!isEmbed && !isWidget) || !deployment) return;
        const allowedOrigins = (deployment as { allowedEmbedOrigins?: string[] }).allowedEmbedOrigins ?? [];
        const handler = (event: MessageEvent) => {
            if (event.data?.type !== 'oddjob:embed:credentials') return;
            if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) return;
            const { accessToken, sessionToken } = event.data;
            if (accessToken && sessionToken) {
                setEmbedTokens({ accessToken, sessionToken });
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [isEmbed, isWidget, deployment]);

    // 6. Rendering logic
    if (isMetadataLoading) return <div className="flex items-center justify-center min-h-screen bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    if (metadataError || !deployment) {
        const errorMsg = metadataError instanceof Error ? metadataError.message : "Agent not found or inactive.";
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background text-muted-foreground font-medium space-y-4">
                <div className="h-16 w-16 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto">
                    <ShieldAlert className="h-8 w-8" />
                </div>
                <p>{errorMsg}</p>
                <Button variant="outline" onClick={() => window.location.reload()} className="border-primary/20 hover:bg-primary/5">Retry</Button>
            </div>
        );
    }

    const branding = deployment.brandingConfig as any;
    const primaryColor = branding?.primaryColor || "#3b82f6";

    if (deployment.accessPolicy === 'internal_only' && !user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
                <Card className="max-w-md w-full p-8 text-center space-y-6 shadow-xl border-none glass-card">
                    <div className="h-16 w-16 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto">
                        <ShieldAlert className="h-8 w-8" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black text-primary dark:text-white tracking-tighter">Access Restricted</h2>
                        <p className="text-muted-foreground">This agent is only available to registered users of this organization. Please log in to continue.</p>
                    </div>
                    <Button className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 transition-all shadow-md" onClick={() => window.location.href = `/auth?redirect=/a/${slug}`}>
                        {branding?.loginText || "Log In to Oddjob"}
                    </Button>
                </Card>
            </div>
        );
    }

    if (deployment.accessPolicy === 'password' && !isVerified) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
                <Card className="max-w-md w-full p-8 space-y-6 shadow-xl border-none glass-card">
                    <div className="text-center space-y-4">
                        <div className="h-16 w-16 bg-amber-50 dark:bg-amber-900/20 text-amber-500 rounded-full flex items-center justify-center mx-auto">
                            <Lock className="h-8 w-8" />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black text-primary dark:text-white tracking-tighter">{deployment.title}</h2>
                            <p className="text-sm text-muted-foreground">This agent is protected by a password.</p>
                        </div>
                    </div>
                    <form onSubmit={handleVerifyPassword} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="page-password">Enter Password</Label>
                            <Input
                                id="page-password"
                                type="password"
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                className={cn("h-12 border-primary/20 focus-visible:ring-primary bg-white/50 dark:bg-black/50", showPasswordError && "border-red-500 focus-visible:ring-red-500")}
                                placeholder="••••••••"
                                autoFocus
                            />
                            {showPasswordError && <p className="text-xs text-red-500 font-medium">Incorrect password. Please try again.</p>}
                        </div>
                        <DynamicButtonBg 
                            type="submit" 
                            className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 transition-all shadow-md" 
                            disabled={isVerifying || !password} 
                            color={primaryColor}
                        >
                            {isVerifying ? <Loader2 className="h-5 w-5 animate-spin" /> : "Access Agent"}
                        </DynamicButtonBg>
                    </form>
                </Card>
            </div>
        );
    }

    const isMinimalChrome = isEmbed || isWidget;
    return (
        <div className={cn("flex flex-col bg-background transition-all duration-300",
            isMinimalChrome ? "h-full min-h-0" : "h-screen",
            isFullscreen && "fixed inset-0 z-50"
        )}>
            {!isMinimalChrome && (
                <header className="px-4 py-3 flex items-center justify-between z-10 glass-header shadow-soft">
                    <div className="flex items-center space-x-3">
                        {branding?.logoUrl ? (
                            <img src={branding.logoUrl} alt="Logo" className="h-8 w-8 object-contain" />
                        ) : (
                            <DynamicBg
                                className="h-9 w-9 rounded-xl flex items-center justify-center overflow-hidden shadow-glow"
                                color={primaryColor}
                            >
                                {(() => {
                                    const HatComponent = HAT_OPTIONS.find((h: any) => h.id === (branding as any)?.iconId)?.component;
                                    return HatComponent ? <HatComponent className="h-6 w-6 text-foreground" /> : <Bot className="h-6 w-6 text-foreground" />;
                                })()}
                            </DynamicBg>
                        )}
                        <div>
                            <h1 className="font-black text-[23px] tracking-tighter leading-none text-primary uppercase block">{deployment.title || "Assistant"}</h1>
                            <p className="text-[10px] font-bold text-muted-foreground mt-1 flex items-center uppercase tracking-widest">
                                <Globe className="h-3 w-3 mr-1" /> Agentic Deployment
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Stability Widget (Public Safe) */}
                        <div className="hidden md:flex flex-col items-end mr-2">
                            <div className="flex items-center gap-1.5">
                                <Activity className="h-3 w-3 text-emerald-500" />
                                <span className="text-[10px] font-black text-foreground uppercase tracking-tighter">Stability 99.8%</span>
                            </div>
                            <div className="w-20 h-1 bg-foreground/10 rounded-full mt-1 overflow-hidden">
                                <div className="h-full bg-emerald-500 w-[99.8%] shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 border-white/10 bg-black/20 hover:bg-foreground/10 transition-colors"
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            title={isFullscreen ? "Exit Fullscreen" : "Expand App"}
                        >
                            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </Button>

                        {user && (
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-9 gap-2 border-primary/30 text-primary hover:bg-primary/10 transition-all font-bold uppercase text-[10px] tracking-widest shadow-glow-sm relative">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-ping absolute -top-0.5 -right-0.5" />
                                        <Terminal className="h-3.5 w-3.5" />
                                        Mission Log
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="right" className="p-0 border-l border-white/10 w-full sm:max-w-md bg-background">
                                    <AgentActivityLog
                                        steps={activities || []}
                                        isLoading={isActivitiesLoading || chatMutation.isPending}
                                    />
                                </SheetContent>
                            </Sheet>
                        )}
                    </div>
                </header>
            )}

            <main className="flex-1 overflow-hidden relative">
                {/* Status HUD (Public Safe) */}
                <div className="absolute top-4 right-4 z-20 pointer-events-none">
                    <AnimatePresence>
                        {(chatMutation.isPending || isMonitorActive) ? (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="flex flex-col items-end gap-2"
                            >
                                <div className="bg-black/60 backdrop-blur-xl border border-primary/40 p-2 px-4 rounded-lg flex items-center gap-3 shadow-[0_0_15px_rgba(205,127,50,0.2)] pointer-events-auto">
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] font-black text-primary uppercase tracking-widest leading-none">Status</span>
                                        <span className="text-xs font-bold text-foreground uppercase tracking-tighter mt-1">
                                            {chatMutation.isPending ? 'Analyzing' : 'Executing'}
                                        </span>
                                    </div>
                                    <div className="h-8 w-[2px] bg-primary/20" />
                                    <div className="flex items-center gap-2">
                                        <div className="h-6 w-6 rounded-full border border-primary/60 flex items-center justify-center relative">
                                            <div className="h-full w-full rounded-full border-t-2 border-primary animate-spin" />
                                            <Cpu className="h-3 w-3 text-primary absolute" />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    {[1, 2, 3].map(i => (
                                        <motion.div
                                            key={i}
                                            animate={{ opacity: [0.2, 1, 0.2] }}
                                            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                            className="h-1 w-4 bg-primary/80 rounded-full"
                                        />
                                    ))}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="bg-black/40 backdrop-blur-md border border-white/10 p-2 px-4 rounded-lg flex items-center gap-3 pointer-events-auto"
                            >
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">System</span>
                                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-tighter mt-1">Ready</span>
                                </div>
                                <div className="h-8 w-[2px] bg-foreground/5" />
                                <Shield className="h-4 w-4 text-emerald-500/60" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div ref={scrollRef} className="h-full overflow-y-auto p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
                    {messages.map((msg, i) => (
                        <div key={msg.id ? `msg-server-${msg.id}` : `msg-local-${i}-${msg.timestamp}`} className={cn("flex gap-4", msg.role === "user" ? "justify-end" : "justify-start")}>
                            {msg.role === "agent" && (
                                <DynamicBg
                                    className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden"
                                    color={`${primaryColor}20`}
                                >
                                    {(() => {
                                        const iconId = (branding as any)?.iconId;
                                        const hatOption = HAT_OPTIONS.find((h: any) => h.id === iconId);
                                        const HatComponent = hatOption?.component;
                                        return HatComponent ? (
                                            <DynamicColorIcon color={primaryColor} component={HatComponent} className="h-6 w-6" />
                                        ) : (
                                            <DynamicColorIcon color={primaryColor} component={Bot} className="h-6 w-6" />
                                        );
                                    })()}
                                </DynamicBg>
                            )}
                            <div className={cn("flex flex-col gap-1 max-w-[85%]", msg.role === "user" ? "items-end" : "items-start")}>
                                {(() => {
                                    const formSubmission = msg.role === "user" ? parseFormSubmissionMessage(msg.content) : null;
                                    if (formSubmission) {
                                        const request = formSubmission.nonce ? inputRequestByNonce.get(formSubmission.nonce) : undefined;
                                        const inputs = formSubmission.inputs ?? {};
                                        const rows = [
                                            ...(request?.fields ?? [])
                                                .filter(f => inputs[f.name] !== undefined)
                                                .map(f => ({ key: f.name, label: f.label || humanizeFieldKey(f.name) })),
                                            ...Object.keys(inputs).filter(k => !request?.fields.some(f => f.name === k))
                                                .map(k => ({ key: k, label: humanizeFieldKey(k) })),
                                        ];
                                        return (
                                            <PayloadCard
                                                title={request?.pipelineName || "Form submitted"}
                                                subtitle="Submission received"
                                                pill="Sent"
                                                primaryColor={primaryColor}
                                                corner="tr"
                                            >
                                                {rows.length > 0 && (
                                                    <dl className="px-5 py-4 grid gap-3" data-testid="form-submission-summary">
                                                        {rows.map(({ key, label }) => (
                                                            <div key={key} className="grid gap-0.5">
                                                                <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                                                                <dd className="font-medium break-words">{formatSubmissionValue(inputs[key])}</dd>
                                                            </div>
                                                        ))}
                                                    </dl>
                                                )}
                                            </PayloadCard>
                                        );
                                    }
                                    if (msg.role === "agent") {
                                        const parsed = typeof msg.content === "string"
                                            ? parseAgentResponse(msg.content)
                                            : { type: 'text' as const, data: msg.content };
                                        if (parsed.type === 'input_request') {
                                            const inputRequest = parsed.data as InputRequest;
                                            const isAlreadySubmitted = msg.formSubmitted || submittedNonces.has(inputRequest.nonce);
                                            if (!isAlreadySubmitted) {
                                                return (
                                                    <AgentInputForm
                                                        key={inputRequest.nonce}
                                                        request={inputRequest}
                                                        onSubmit={(nonce: string, inputData: Record<string, any>) => pipelineExecutionMutation.mutate({ nonce, inputData })}
                                                        isSubmitting={executingNonce === inputRequest.nonce}
                                                        primaryColor={primaryColor}
                                                    />
                                                );
                                            }
                                            return (
                                                <PayloadCard
                                                    title={inputRequest.pipelineName}
                                                    subtitle="Form completed"
                                                    pill="Done"
                                                    primaryColor={primaryColor}
                                                    corner="tl"
                                                />
                                            );
                                        }
                                        if (parsed.type === 'rescue_status') {
                                            return <RescueStatusCard sessionId={(parsed.data as any).sessionId} />;
                                        }
                                        if (parsed.type === 'form_studio_form') {
                                            // Filled in and submitted here, anonymously, through the form's
                                            // public link; the visitor sees only respondent results.
                                            return (
                                                <div className="w-full min-w-[min(36rem,85vw)]" data-testid="agent-shared-form">
                                                    <PublicForm token={(parsed.data as any).token} compact />
                                                </div>
                                            );
                                        }
                                        if (parsed.type === 'mode_switch_request') {
                                            const req = parsed.data as ModeSwitchRequest;
                                            return (
                                                <Card className="px-4 py-3 text-xs text-muted-foreground shadow-floating border-none glass-card rounded-tl-none">
                                                    {req.message || req.reason || `Switched to ${req.targetMode} mode.`}
                                                </Card>
                                            );
                                        }
                                        const structured = parseStructuredJsonMessage(msg.content);
                                        if (structured) {
                                            if (Array.isArray(structured)) {
                                                return (
                                                    <PayloadCard title="Update" subtitle={`${structured.length} ${structured.length === 1 ? "item" : "items"}`} pill="New" primaryColor={primaryColor} corner="tl">
                                                        <ul className="px-5 py-4 grid gap-1.5 list-disc pl-9">
                                                            {structured.map((item, i) => <li key={i} className="font-medium break-words">{formatSubmissionValue(item)}</li>)}
                                                        </ul>
                                                    </PayloadCard>
                                                );
                                            }
                                            const { type, ...fields } = structured;
                                            return (
                                                <PayloadCard
                                                    title={typeof type === "string" ? humanizeFieldKey(type) : "Update"}
                                                    subtitle="Details"
                                                    pill="New"
                                                    primaryColor={primaryColor}
                                                    corner="tl"
                                                >
                                                    {Object.keys(fields).length > 0 && (
                                                        <dl className="px-5 py-4 grid gap-3">
                                                            {Object.entries(fields).map(([key, value]) => (
                                                                <div key={key} className="grid gap-0.5">
                                                                    <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{humanizeFieldKey(key)}</dt>
                                                                    <dd className="font-medium break-words">{formatSubmissionValue(value)}</dd>
                                                                </div>
                                                            ))}
                                                        </dl>
                                                    )}
                                                </PayloadCard>
                                            );
                                        }
                                    }
                                    return (
                                        <Card className={cn("p-5 text-sm shadow-floating border-none glass-card", msg.role === "user" ? "rounded-tr-none" : "rounded-tl-none")}>
                                            <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        pre: ({ node, ...props }) => <pre className="overflow-auto w-full my-2 bg-card p-4 rounded-xl text-foreground text-xs border border-white/10" {...props} />,
                                                        code: ({ node, ...props }) => <code className="bg-sidebar dark:bg-white/10 rounded px-1.5 py-0.5 text-primary dark:text-muted font-mono text-xs" {...props} />,
                                                        a: ({ href, children, ...props }) => {
                                                            if (href?.startsWith('#tool:')) {
                                                                const toolId = href.split(':')[1];
                                                                return (
                                                                    <button
                                                                        onClick={() => handleSend(`I want to run ${children}`)}
                                                                        className="text-vibrantBronze hover:text-vibrantBronze/80 font-bold inline-flex items-center gap-1.5 cursor-pointer bg-vibrantBronze/10 px-2.5 py-1 rounded-lg border border-vibrantBronze/20 transition-all hover:scale-[1.02] shadow-sm my-1 uppercase text-[10px] tracking-widest"
                                                                        type="button"
                                                                    >
                                                                        <Play className="h-3 w-3 fill-current" />
                                                                        {children}
                                                                    </button>
                                                                );
                                                            }
                                                            return <a href={href} {...props} target="_blank" rel="noopener noreferrer" className="text-vibrantBronze hover:underline font-bold">{children}</a>;
                                                        }
                                                    }}
                                                >
                                                    {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                                                </ReactMarkdown>

                                                {/* --- YouTube Video Integration --- */}
                                                {(() => {
                                                    const match = typeof msg.content === 'string' && msg.content.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)(?:&t=(\d+))?/);
                                                    if (match) {
                                                        const videoId = match[1];
                                                        const timestamp = match[2] ? parseInt(match[2]) : 0;
                                                        return (
                                                            <YouTubePlayer
                                                                videoId={videoId}
                                                                timestamp={timestamp}
                                                                onRate={(rating: number, reason?: string) => {
                                                                    feedbackMutation.mutate({
                                                                        messageId: msg.id!,
                                                                        rating,
                                                                        reason,
                                                                        videoMetadata: { videoId, segmentId: timestamp }
                                                                    });
                                                                }}
                                                                currentRating={msg.rating}
                                                            />
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        </Card>
                                    );
                                })()}
                                <div className="flex items-center justify-between w-full px-1">
                                    <span className="text-[10px] text-muted-foreground">
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {msg.id && msg.id !== -1 && <span className="ml-2 opacity-50">#{msg.id}</span>}
                                    </span>
                                    {msg.role === "agent" && msg.id && msg.id !== -1 && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => feedbackMutation.mutate({ messageId: msg.id!, rating: 1 })}
                                                className={cn("p-1 rounded hover:bg-muted text-muted-foreground hover:text-green-600", msg.rating === 1 && "text-green-600")}
                                                title="Helpful"
                                                type="button"
                                            >
                                                <ThumbsUp className="h-3 w-3" />
                                            </button>
                                            <button
                                                onClick={() => feedbackMutation.mutate({ messageId: msg.id!, rating: -1 })}
                                                className={cn("p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-600", msg.rating === -1 && "text-red-600")}
                                                title="Not helpful"
                                                type="button"
                                            >
                                                <ThumbsDown className="h-3 w-3" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {isMonitorActive && (
                        <div className="flex gap-4 justify-start">
                            <DynamicBg
                                className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                                color={`${primaryColor}20`}
                            >
                                {(() => {
                                    const iconId = (branding as any)?.iconId;
                                    const HatComponent = HAT_OPTIONS.find((h: any) => h.id === iconId)?.component;
                                    return HatComponent ? (
                                        <DynamicColorIcon color={primaryColor} component={HatComponent} className="h-6 w-6" />
                                    ) : (
                                        <DynamicColorIcon color={primaryColor} component={Bot} className="h-6 w-6" />
                                    );
                                })()}
                            </DynamicBg>
                            <div className="bg-blue-50 dark:bg-primary/10 border border-blue-100 dark:border-primary/20 rounded-lg p-4 flex items-center gap-3 shadow-sm animate-pulse">
                                <div className="h-2 w-2 bg-blue-500 dark:bg-primary rounded-full animate-ping" />
                                <span className="text-sm text-blue-700 dark:text-primary font-medium">Monitoring Pipeline Execution...</span>
                            </div>
                        </div>
                    )}

                    {chatMutation.isPending && (
                        <div className="flex gap-4 justify-start">
                            <DynamicBg
                                className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                                color={`${primaryColor}20`}
                            >
                                {(() => {
                                    const iconId = (branding as any)?.iconId;
                                    const HatComponent = HAT_OPTIONS.find((h: any) => h.id === iconId)?.component;
                                    return HatComponent ? (
                                        <DynamicColorIcon color={primaryColor} component={HatComponent} className="h-6 w-6 animate-pulse" />
                                    ) : (
                                        <DynamicColorIcon color={primaryColor} component={Bot} className="h-6 w-6 animate-pulse" />
                                    );
                                })()}
                            </DynamicBg>
                            <div className="bg-card border rounded-lg p-4 flex items-center gap-3 shadow-sm">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <span className="text-sm text-muted-foreground italic">Thinking...</span>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <footer className="p-6 glass-header border-t-0">
                <div className="max-w-4xl mx-auto space-y-4">
                    {messages.filter(m => m.role === 'user').length === 0 && (() => {
                        const title = (deployment?.title || slug || "").toLowerCase();
                        const role = (deployment?.soulArchetype || "").toLowerCase();
                        const demoPrompts = (title.includes("rescue") || role.includes("emergency") || slug?.includes("rescue")) ? [
                            "Emergency incident reported: Structural collapse at Sector 7, Building A with 3 trapped casualties. Please initiate incident intake and dispatch the rescue squad.",
                            "Triage incident: Fire alarm triggered with chemical hazard at Warehouse B.",
                            "Dispatch nearest emergency squad to North Terminal."
                        ] : (title.includes("codegen") || title.includes("architect") || slug?.includes("codegen")) ? [
                            "Scaffold a new real-time Vendor Risk & Compliance monitoring app with interactive metrics, audit trails, and export tools.",
                            "Generate a high-performance H3 Eulerian Spatial Telemetry dashboard for live vehicle tracking."
                        ] : (title.includes("budget") || title.includes("finance") || slug?.includes("budget")) ? [
                            "Run Q3 department spend anomaly detection, analyze Cloud Infrastructure overrun (+14.2%), and prepare multi-tier executive sign-off package.",
                            "Perform autonomous variance forecast modeling across all active engineering cost centers."
                        ] : (title.includes("workforce") || title.includes("training") || slug?.includes("workforce") || slug?.includes("hr")) ? [
                            "Audit fleet reliability scores, identify agents with elevated error rates, and initiate skill upskilling cycle with rollback snapshot.",
                            "Evaluate agent portfolio metrics and assign performance improvement remediation."
                        ] : (title.includes("sdlc") || title.includes("overseer") || slug?.includes("sdlc")) ? [
                            "Execute hybrid SDLC validation suite, verify 5-layer autonomy policy gates, and generate signed audit record.",
                            "Inspect AST structural topology and attest security policy compliance."
                        ] : (title.includes("sre") || title.includes("sentinel") || slug?.includes("sre")) ? [
                            "Analyze telemetry anomaly in production Redis cache layer and generate mitigation steps.",
                            "Run automated chaos drill on message bus ingestion pipeline."
                        ] : (title.includes("intake") || title.includes("form") || slug?.includes("intake")) ? [
                            "Please initiate the incident intake questionnaire schema and collect required operational parameters.",
                            "Verify required form fields and generate structured input request."
                        ] : (title.includes("supervisor") || title.includes("foundry") || slug?.includes("supervisor")) ? [
                            "Start autonomous verification and run operational cycle attestation for active pipelines.",
                            "Inspect active pipeline execution status and attest artifacts."
                        ] : [
                            `Initiate operational workflow and execute task for ${deployment?.title || "Agent"}.`
                        ];

                        return (
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 flex-shrink-0">
                                    <Zap className="w-3 h-3 text-amber-500" /> Demo Process:
                                </span>
                                {demoPrompts.map((promptText, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setInputValue(promptText)}
                                        className="px-3 py-1.5 rounded-xl bg-white/40 dark:bg-black/40 hover:bg-primary/10 border border-primary/20 text-foreground text-[11px] truncate max-w-[320px] transition-all hover:border-primary/50 text-left shadow-sm flex-shrink-0"
                                        title={promptText}
                                    >
                                        {promptText}
                                    </button>
                                ))}
                            </div>
                        );
                    })()}

                    {attachments.length > 0 && (
                        <div className="flex gap-2 flex-wrap pb-2">
                            {attachments.map(file => (
                                <div key={file.id} className="bg-white/50 dark:bg-black/50 backdrop-blur-sm rounded-xl pl-3 pr-2 py-1.5 flex items-center gap-2 text-[10px] font-bold border border-white/20 text-muted-foreground uppercase tracking-widest">
                                    <FileIcon className="h-3 w-3" />
                                    <span className="truncate max-w-[150px]">{file.name}</span>
                                    <button
                                        onClick={() => setAttachments(prev => prev.filter(f => f.id !== file.id))}
                                        className="hover:text-red-500 p-0.5 rounded-full hover:bg-red-50/50 transition-colors"
                                        title="Remove attachment"
                                        type="button"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-4 items-end">
                        <div className="flex-1 relative">
                            <Input
                                value={inputValue}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                                placeholder="Type your message..."
                                className="pr-12 py-7 rounded-2xl border-none glass-card shadow-soft focus-visible:ring-primary/30 text-base"
                            />
                            <div className="absolute right-3 bottom-3 flex items-center gap-1">
                                <input
                                    type="file"
                                    multiple
                                    accept={deployment.allowedFileTypes?.join(',') || "*"}
                                    className="hidden"
                                    ref={fileInputRef}
                                    title="Choose files to upload"
                                    onChange={(e) => {
                                        if (e.target.files) {
                                            const files = Array.from(e.target.files);
                                            const maxBytes = (deployment.maxFileSizeMb || 10) * 1024 * 1024;
                                            if (files.find(f => f.size > maxBytes)) {
                                                alert(`File too large. Max ${deployment.maxFileSizeMb || 10}MB.`);
                                                return;
                                            }
                                            setIsUploading(true);
                                            uploadMutation.mutate(e.target.files);
                                        }
                                    }}
                                />
                                <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isUploading || chatMutation.isPending} className="h-10 w-10 text-muted-foreground hover:text-primary transition-colors" title="Attach files"><Paperclip className="h-5 w-5" /></Button>
                            </div>
                        </div>
                        <DynamicButtonBg
                            onClick={() => handleSend()}
                            disabled={(!inputValue.trim() && attachments.length === 0) || chatMutation.isPending || isUploading}
                            className="h-14 w-14 rounded-2xl shadow-glow transition-transform active:scale-95"
                            color={primaryColor}
                        >
                            {chatMutation.isPending || isUploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
                        </DynamicButtonBg>
                    </div>
                </div>
            </footer>
        </div>
    );
}
