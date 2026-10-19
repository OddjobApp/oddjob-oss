import React, { useState, useEffect, useRef } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, ShieldAlert, Globe, LayoutTemplate, Send, ThumbsUp, ThumbsDown, Zap } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { SocialCopilotApp } from "../runners/SocialCopilotApp";
import { DynamicUIRenderer } from "@/components/dynamic-ui/DynamicUIRenderer.js";
import { TacticalDispatchDashboard } from "@domain-ui/rescue/ui/modules/rescue/components/TacticalDispatchDashboard";

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

function GenericAppShell({ deployment }: { deployment: any }) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || loading) return;
        setMessages(prev => [...prev, { role: "user", content: text }]);
        setInput("");
        setLoading(true);

        try {
            const res = await fetch(`/api/public/apps/${deployment.slug}/missions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    name: `Chat: ${text.slice(0, 40)}`,
                    objective: text,
                    blackboard: { viaAppSlug: deployment.slug, userMessage: text },
                }),
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            setMessages(prev => [...prev, {
                role: "assistant",
                content: data.objective || "Your request has been received and is being processed.",
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
        } finally {
            setLoading(false);
        }
    };

    const systemPromptPreview = deployment.config?.systemPrompt || deployment.description || "How can I help you today?";

    return (
        <div className="flex flex-col h-full min-h-[500px]">
            {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                    <LayoutTemplate className="w-10 h-10 mb-4 opacity-30" />
                    <p className="text-sm italic max-w-sm">{systemPromptPreview.slice(0, 120)}</p>
                </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-3 px-2 py-4">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                            {m.content}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="max-w-[80%] px-4 py-2 rounded-2xl text-sm bg-muted text-muted-foreground flex items-center gap-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 border-t pt-3 pb-1 px-2">
                <Input
                    value={input}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1"
                    disabled={loading}
                />
                <Button size="icon" onClick={sendMessage} disabled={loading || !input.trim()}>
                    <Send className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

function ForgedAppRunner({ deployment, onStart }: { deployment: any, onStart: () => void }) {
    const status = deployment.app?.runtimeMetadata?.status;
    const isRunning = status === "running";

    if (!isRunning) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8 space-y-6">
                <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center">
                    <LayoutTemplate className="w-10 h-10 text-primary opacity-50" />
                </div>
                <div className="space-y-2 max-w-sm">
                    <h3 className="text-xl font-bold">Application Offline</h3>
                    <p className="text-muted-foreground text-sm">
                        This standalone application needs to be initialized before it can be accessed.
                    </p>
                </div>
                <Button onClick={onStart} size="lg" className="rounded-full px-8 shadow-lg font-bold">
                    Launch Application
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full h-full min-h-[600px] bg-card rounded-lg overflow-hidden shadow-inner border relative group">
            <iframe 
                src={`/forged/${deployment.slug}`} 
                className="w-full h-full border-none absolute inset-0" 
                title={deployment.title} 
            />
        </div>
    );
}

// Helper component for dynamic styles
const DynamicBg = ({ color, className, children }: { color: string, className?: string, children?: React.ReactNode }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.style.backgroundColor = color;
    }, [color]);
    return <div ref={ref} className={className}>{children}</div>;
};
const SOCIAL_COPILOT_SLUG = 'social-copilot';

export default function PublicAppDeploymentPage() {
    // Org-scoped first: /o/:orgId/app/:slug names which organization's deployment is
    // meant. An app can be deployed once per org, so the bare form is ambiguous and the
    // server has to fall back to picking one. Both are matched, because links to the
    // bare form are already in circulation.
    const [, orgScopedParams] = useRoute("/o/:orgId/app/:slug");
    const [, appParams] = useRoute("/app/:slug");
    const [, deployParams] = useRoute("/deploy/:slug");
    const slug = orgScopedParams?.slug ?? appParams?.slug ?? deployParams?.slug;

    const routeOrgId = (() => {
        const raw = orgScopedParams?.orgId;
        if (!raw) return null;
        const parsed = Number.parseInt(raw, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    })();

    const queryClient = useQueryClient();
    const [sessionId] = useState(() => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));

    useEffect(() => {
        if ((window as any).clearLoginLoading) {
            (window as any).clearLoginLoading();
        }
    }, []);

    const { data: deployment, isLoading, error } = useQuery<{
        appId: number;
        appName: string;
        slug: string;
        title: string;
        description: string;
        brandingConfig: any;
        config: any;
        app?: {
            dockerImage?: string;
            runtimeMetadata?: any;
        };
    }, Error>({
        // orgId is part of the key: the same slug resolves to a different
        // deployment per organization, so caching them together would serve one
        // org's app under another's URL.
        queryKey: [`/api/public/apps/${slug}`, routeOrgId],
        queryFn: async () => {
            const res = await fetch(
                routeOrgId ? `/api/public/apps/${slug}?orgId=${routeOrgId}` : `/api/public/apps/${slug}`,
            );
            if (res.status === 401) return { requiresPassword: true } as any;
            if (res.status === 404) throw new Error("App not found or not published");
            if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
            return res.json();
        },
        enabled: !!slug
    });

    const [password, setPassword] = useState("");
    const [isVerified, setIsVerified] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [showPasswordError, setShowPasswordError] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

    // Telemetry Beacon Logic
    useEffect(() => {
        if (!slug || !deployment || isLoading) return;

        const sendTelemetry = async (type: string, metadata: any = {}) => {
            try {
                await fetch(`/api/public/apps/${slug}/telemetry`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type, sessionId, metadata }),
                    keepalive: true // Important for session_complete on unload
                });
            } catch (e) {
                // Silently fail telemetry
            }
        };

        const sendFeedback = async (sentiment: 'positive' | 'negative') => {
            await sendTelemetry("app.feedback", {
                sentiment,
                timestamp: Date.now(),
                context: "user_beacon"
            });
            // Show a small thank you state?
        };

        (window as any)._oddjob_feedback = sendFeedback;

        // 1. Session Start
        sendTelemetry("app.session.start", {
            referrer: document.referrer,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
        });

        // 2. Heartbeat Interval (30s)
        const heartbeat = setInterval(() => {
            sendTelemetry("app.session.heartbeat", {
                activeTimeMs: 30000,
                timestamp: Date.now()
            });
        }, 30000);

        // 3. Session Complete (Cleanup)
        const handleUnload = () => {
            sendTelemetry("app.session.complete", {
                durationMs: Date.now() - startTimeRef.current,
                timestamp: Date.now()
            });
        };

        const startTimeRef = { current: Date.now() };
        window.addEventListener("beforeunload", handleUnload);

        return () => {
            clearInterval(heartbeat);
            window.removeEventListener("beforeunload", handleUnload);
            handleUnload();
        };
    }, [slug, !!deployment, isLoading]);

    // Handle PWA Install Prompt

    // Handle PWA Install Prompt
    useEffect(() => {
        const handler = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setDeferredPrompt(null);
        }
    };

    // Inject dynamic manifest
    useEffect(() => {
        if (!slug) return;
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = `/api/public/apps/${slug}/manifest.json`;
        document.head.appendChild(link);
        return () => {
            document.head.removeChild(link);
        };
    }, [slug]);


    const handleVerifyPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsVerifying(true);
        setShowPasswordError(false);
        try {
            const res = await fetch(`/api/public/apps/${slug}/auth`, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                // const data = await res.json();
                // setSessionToken(data.token);
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

    const handleLaunchApp = async () => {
        setIsLaunching(true);
        try {
            const res = await fetch(`/api/public/apps/${slug}/start`, { method: "POST" });
            if (!res.ok) throw new Error(await res.text());
            
            // Poll for status or just invalidate query
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: [`/api/public/apps/${slug}`] });
                setIsLaunching(false);
            }, 2000);
        } catch (err: any) {
            setIsLaunching(false);
            setShowPasswordError(true); // Reuse error state or show toast
        }
    };

    if (isLoading) return <div className="flex items-center justify-center min-h-screen bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    if (error || !deployment) {
        const errorObject = error as any;
        const errorMsg = errorObject ? (errorObject.message || "App not found or inactive.") : "App not found or inactive.";
        return (
            <div className="flex h-screen items-center justify-center p-4">
                <Card className="max-w-md w-full p-8 text-center space-y-4 border-destructive/50 bg-destructive/5">
                    <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
                    <h2 className="text-xl font-bold text-destructive">Deployment Error</h2>
                    <p className="text-muted-foreground">{error instanceof Error ? error.message : (error as any)?.message || 'Application not found or unavailable'}</p>
                    <Button variant="outline" onClick={() => window.location.reload()}>Try Again</Button>
                </Card>
            </div>);
    }

    const requirePassword = !!(deployment as any).requiresPassword;

    const branding = deployment.brandingConfig as any;
    const primaryColor = branding?.primaryColor || "#3b82f6";

    return (
        <div className="flex flex-col min-h-screen bg-background">
            <style dangerouslySetInnerHTML={{
                __html: `
                :root {
                    --app-primary: ${primaryColor};
                }
                .text-app-primary { color: var(--app-primary); }
                .bg-app-primary { background-color: var(--app-primary); }
            `}} />
            <header className="px-6 py-4 flex items-center justify-between z-10 glass-header shadow-soft border-b border-primary/5">
                <div className="flex items-center space-x-3">
                    {branding?.logoUrl ? (
                        <img src={branding.logoUrl} alt="Logo" className="h-8 w-8 object-contain" />
                    ) : (
                        <DynamicBg
                            className="h-10 w-10 rounded-xl flex items-center justify-center overflow-hidden shadow-glow"
                            color={primaryColor}
                        >
                            <LayoutTemplate className="h-5 w-5 text-foreground" />
                        </DynamicBg>
                    )}
                    <div>
                        <h1 className="font-black text-xl tracking-tighter leading-none block text-app-primary">
                            {deployment.title || deployment.appName}
                        </h1>
                        <p className="text-[10px] font-bold text-muted-foreground mt-1 flex items-center uppercase tracking-widest">
                            <Globe className="h-3 w-3 mr-1" /> Published App
                        </p>
                    </div>
                </div>
                {deferredPrompt && (
                    <Button
                        onClick={handleInstall}
                        variant="outline"
                        size="sm"
                        className="animate-in fade-in zoom-in duration-500 border-app-primary text-app-primary hover:bg-app-primary hover:text-foreground"
                    >
                        Install App
                    </Button>
                )}
            </header>

            <main className="flex-1 flex flex-col items-center justify-center p-6 bg-muted/10 relative overflow-hidden">
                {/* Background Decorator */}
                <div className="absolute inset-0 pointer-events-none z-0">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-5 blur-[100px] bg-app-primary" />
                </div>

                {isVerified || !requirePassword ? (
                    (deployment.slug?.includes('rescue-dispatch') || deployment.appName === 'rescue-dispatch') ? (
                        <div className="w-full h-full min-h-screen relative z-10">
                            <TacticalDispatchDashboard />
                        </div>
                    ) : (
                    <Card className="max-w-4xl w-full p-0 text-center shadow-xl border-none glass-card relative z-10 overflow-hidden flex flex-col min-h-[70vh]">
                        {/* Top Navigation / Brand */}
                        <div className="w-full h-16 bg-card/60 backdrop-blur-md border-b flex items-center px-4 md:px-8 justify-between z-10 sticky top-0">
                            <div className="flex items-center gap-3">
                                <LayoutTemplate className="w-6 h-6 text-app-primary" />
                                <span className="font-bold text-lg tracking-tight">{deployment.title}</span>
                            </div>
                        </div>

                        {/* App Runner Area */}
                        <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8">
                            {isLaunching ? (
                                <div className="flex flex-col items-center justify-center h-full min-h-[400px] space-y-4">
                                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                                    <p className="font-bold text-lg animate-pulse">Initializing Application Container...</p>
                                </div>
                            ) : deployment.app?.dockerImage ? (
                                <ForgedAppRunner deployment={deployment} onStart={handleLaunchApp} />
                            ) : deployment.config?.tokenizedUI ? (
                                <DynamicUIRenderer schema={deployment.config.tokenizedUI} />
                            ) : deployment.slug === SOCIAL_COPILOT_SLUG ? (
                                <SocialCopilotApp deployment={deployment} />
                            ) : (
                                <GenericAppShell deployment={deployment} />
                            )}
                        </main>
                    </Card>
                    )
                ) : (
                    /* Password Gate */
                    <Card className="max-w-md w-full p-8 space-y-6 shadow-xl border-none glass-card relative z-10">
                        <div className="text-center space-y-4">
                            <div className="h-16 w-16 bg-amber-50 dark:bg-amber-900/20 text-amber-500 rounded-full flex items-center justify-center mx-auto">
                                <Lock className="h-8 w-8" />
                            </div>
                            <div className="space-y-1">
                                <h2 className="text-2xl font-black tracking-tighter text-app-primary">
                                    {deployment.title || deployment.appName}
                                </h2>
                                <p className="text-sm text-muted-foreground">This application requires an access password.</p>
                            </div>
                        </div>
                        <form onSubmit={handleVerifyPassword} className="space-y-4">
                            <div className="space-y-2">
                                <Input
                                    id="page-password"
                                    type="password"
                                    value={password}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                    className={cn("h-12 bg-white/50 dark:bg-black/50 text-center text-lg tracking-widest", showPasswordError && "border-red-500")}
                                    placeholder="••••••••"
                                    autoFocus
                                />
                                {showPasswordError && <p className="text-xs text-red-500 font-medium text-center mt-1">Incorrect password. Please try again.</p>}
                            </div>
                            <Button
                                type="submit"
                                className="w-full h-12 text-lg font-bold transition-all shadow-md bg-app-primary text-foreground hover:opacity-90"
                                disabled={isVerifying || !password}
                            >
                                {isVerifying ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Unlock App"}
                            </Button>
                        </form>
                    </Card>
                )}
            </main>

            {/* Floating Feedback Beacon */}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-2 group">
                <div className="bg-foreground/90 backdrop-blur shadow-lg border border-primary/20 p-2 rounded-2xl flex gap-2 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 pointer-events-none group-hover:pointer-events-auto">
                    <button 
                        onClick={() => (window as any)._oddjob_feedback?.('positive')}
                        className="p-3 hover:bg-emerald-50 rounded-xl text-emerald-600 transition-colors"
                        title="High ROI / Accurate"
                    >
                        <ThumbsUp className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => (window as any)._oddjob_feedback?.('negative')}
                        className="p-3 hover:bg-rose-50 rounded-xl text-rose-600 transition-colors"
                        title="Low ROI / Error"
                    >
                        <ThumbsDown className="w-5 h-5" />
                    </button>
                </div>
                <div className="bg-app-primary text-foreground p-3 rounded-full shadow-glow cursor-default">
                    <Zap className="w-5 h-5 animate-pulse" />
                </div>
            </div>
        </div>
    );
}
