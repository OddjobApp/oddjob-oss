import React, { useState, useEffect, useRef } from "react";
import { readCrewAppActivity, type CrewAppActivity } from './crew-app-activity';
import { surfaceRequestSchema } from '@shared/crew-surface-request';
import type { PendingSurfaceRequest } from './CrewSurfaceRequestCard';
import { createPortal } from 'react-dom';
import { CREW_APP_PRESENTATION_CSS } from '@shared/crew-app-presentation';
import type { CrewAppSurface } from '@shared/crew-surface-connections';
import { Button } from "@/components/ui/button";
import { CrewDevelopmentSetup } from './CrewDevelopmentSetup';
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    ExternalLink,
    RotateCcw,
    X,
    Maximize2,
    Minimize2,
    LayoutTemplate,
    Boxes,
    Columns2,
    PanelRightOpen,
} from "lucide-react";

export interface CycleFleetApp {
    id: number;
    appId: number;
    title: string;
    description: string | null;
    slug: string;
    publicSlug: string;
    publicPath: string;
    status: string;
    isLive: boolean;
    stage?: string | null;
    blueprint?: string | null;
}

interface CrewCycleAppCanvasProps {
    roomKey?: string;
    organizationId?: number | null;
    onDiscuss?: (app: CycleFleetApp) => void;
    onRequestCycle?: (app: CycleFleetApp, reference?: { handoffId: string }) => void;
    onInputRequest?: (request: PendingSurfaceRequest) => void;
    onActivity?: (activity: CrewAppActivity) => void;
    onSurfaceChange?: (surface: CrewAppSurface) => void;
    onShowChat?: () => void;
    onFullscreenChange?: (fullscreen: boolean) => void;
    rightRailCollapsed?: boolean;
    onToggleRightRail?: () => void;
    cycleSlug?: string | null;
    cycleName?: string | null;
    stageName?: string | null;
    apps: CycleFleetApp[];
    activeAppId?: number | null;
    onSelectApp?: (appId: number) => void;
    onClose: () => void;
}

type ViewportMode = "split" | "wide" | "fullscreen";

export function CrewCycleAppCanvas({
    roomKey,
    organizationId,
    onDiscuss,
    onRequestCycle,
    onInputRequest,
    onActivity,
    onSurfaceChange,
    onShowChat,
    onFullscreenChange,
    rightRailCollapsed,
    onToggleRightRail,
    cycleSlug,
    cycleName,
    stageName,
    apps,
    activeAppId,
    onSelectApp,
    onClose,
}: CrewCycleAppCanvasProps) {
    const [selectedId, setSelectedId] = useState<number>(() => {
        if (activeAppId && apps.some((a) => a.id === activeAppId)) return activeAppId;
        return apps[0]?.id ?? 0;
    });
    const [viewportMode, setViewportMode] = useState<ViewportMode>("split");
    useEffect(() => { onFullscreenChange?.(viewportMode === 'fullscreen'); }, [viewportMode, onFullscreenChange]);
    useEffect(() => () => onFullscreenChange?.(false), [onFullscreenChange]);
    const [iframeKey, setIframeKey] = useState(0);
    const [frameStatus, setFrameStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [navigationUrl, setNavigationUrl] = useState<string | null>(null);
    const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
    useEffect(() => {
        setFrameStatus('loading');
        const timeout = window.setTimeout(() => setFrameStatus((status) => status === 'loading' ? 'failed' : status), 20000);
        return () => window.clearTimeout(timeout);
    }, [iframeKey, selectedId, navigationUrl]);
    useEffect(() => { setNavigationUrl(null); setNavigationHistory([]); }, [selectedId]);

    const activeApp = apps.find((a) => a.id === selectedId) || apps[0];
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const inputRequests = useRef(new Map<string, () => void>());
    const currentView = useRef<string | null>(null);
    useEffect(() => () => { inputRequests.current.forEach(cancel => cancel()); inputRequests.current.clear(); }, [roomKey, selectedId, iframeKey]);
    useEffect(() => {
        if (!roomKey || !activeApp) return;
        const receive = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
            const request = event.data;
            if (request?.source === 'crew-app-discuss' && request.version === 1 && request.roomKey === roomKey) {
                setViewportMode('split');
                onShowChat?.();
                onDiscuss?.(activeApp);
                return;
            }
            if (request?.source === 'crew-surface-cancel' && request.version === 1 && request.roomKey === roomKey && typeof request.requestId === 'string') {
                inputRequests.current.get(request.requestId)?.();
                return;
            }
            if (request?.source === 'crew-surface-request') {
                const parsed = surfaceRequestSchema.safeParse(request);
                if (!parsed.success || parsed.data.roomKey !== roomKey || !onInputRequest || inputRequests.current.has(parsed.data.requestId) || inputRequests.current.size >= 20) return;
                const windowAtRequest = event.source as Window;
                const pathAtRequest = iframeRef.current?.src;
                const documentAtRequest = iframeRef.current?.contentDocument;
                const locationAtRequest = iframeRef.current?.contentWindow?.location.href;
                let finished = false;
                const reply = (status: string, data?: Record<string, unknown>) => {
                    try { windowAtRequest.postMessage({ source: 'crew-surface-response', version: 1, roomKey, requestId: parsed.data.requestId, status, data }, event.origin); }
                    catch { /* The originating window has already been removed. */ }
                };
                const finish: PendingSurfaceRequest['finish'] = (status, data) => {
                    if (finished) throw new Error('This input request is no longer active.');
                    if (iframeRef.current?.contentWindow !== windowAtRequest || iframeRef.current?.src !== pathAtRequest || iframeRef.current?.contentDocument !== documentAtRequest || iframeRef.current?.contentWindow?.location.href !== locationAtRequest) { finished = true; reply('cancelled'); return; }
                    finished = true; reply(status, data);
                    if (status === 'submitted' && parsed.data.kind === 'approval') {
                        try { windowAtRequest.postMessage({ source: 'crew-host-event', version: 1, roomKey, type: 'approval-resolved', approvalId: parsed.data.approvalId, data }, event.origin); }
                        catch {}
                    }
                };
                inputRequests.current.set(parsed.data.requestId, () => { if (!finished) finish('cancelled'); });
                reply('accepted');
                onInputRequest({ request: parsed.data, appTitle: activeApp.title, finish,
                    approvalUrl: `/api/crew/${encodeURIComponent(roomKey)}/surface-approval/${parsed.data.approvalId}?orgId=${organizationId}&app=${encodeURIComponent(activeApp.publicPath)}` });
                onShowChat?.();
                return;
            }
            if (request?.source === 'crew-app-view' && request.version === 1 && request.roomKey === roomKey && typeof request.pathname === 'string' && /^\/[a-z0-9/-]*$/.test(request.pathname)) {
                const base = new URL(activeApp.publicPath, window.location.origin).pathname.replace(/\/$/, '');
                const reported = request.pathname;
                // Next may expose a logical route or a deployment-prefixed route.
                const path = reported === base || reported.startsWith(`${base}/`) ? reported : reported.startsWith('/app/') ? null : `${base}${reported === '/' ? '' : reported}`;
                if (path) {
                    if (currentView.current && currentView.current !== path) inputRequests.current.forEach(cancel => cancel());
                    currentView.current = path;
                    const embeddedPath = getEmbeddedUrl(path);
                    const rawRec = request.selectedRecord;
                    const selectedRecord = rawRec && typeof rawRec === 'object' && typeof rawRec.collection === 'string' && typeof rawRec.recordId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(rawRec.collection) && rawRec.recordId.length <= 150
                        ? { collection: rawRec.collection, recordId: rawRec.recordId }
                        : null;
                    onSurfaceChange?.({ title: activeApp.title, blueprint: activeApp.blueprint ?? activeApp.slug, path, ...(selectedRecord ? { selectedRecord } : {}) });
                    if (embeddedPath) {
                        setNavigationHistory(previous => previous.at(-1) === embeddedPath ? previous : [...previous, embeddedPath]);
                    }
                }
                return;
            }
            if (request?.source === 'workbench' && request.version === 1 && request.type === 'trigger-cycle' && request.roomKey === roomKey && typeof request.requestId === 'string' && request.requestId.length < 150) {
                const handoffId = request.payload?.payload?.handoffId;
                if (handoffId !== undefined && (typeof handoffId !== 'string' || !/^[a-f0-9]{64}$/.test(handoffId))) {
                    iframeRef.current?.contentWindow?.postMessage({ source: 'crew-workbench-host', version: 1, roomKey, requestId: request.requestId, status: 'unavailable' }, event.origin);
                    return;
                }
                if (handoffId) onRequestCycle?.(activeApp, { handoffId });
                else onRequestCycle?.(activeApp);
                iframeRef.current?.contentWindow?.postMessage({ source: 'crew-workbench-host', version: 1, roomKey, requestId: request.requestId, status: onRequestCycle ? 'prepared' : 'unavailable' }, event.origin);
                return;
            }
            const activity = readCrewAppActivity(event.data, roomKey);
            if (activity) onActivity?.({ ...activity, appTitle: activeApp.title });
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [roomKey, activeApp?.id, activeApp?.title, activeApp?.publicPath, onActivity, onDiscuss, onRequestCycle, onSurfaceChange, onInputRequest, onShowChat]);

    const handleAppChange = (val: string) => {
        const id = Number(val);
        setSelectedId(id);
        if (onSelectApp) onSelectApp(id);
    };

    const handleRefresh = () => {
        setIframeKey((k) => k + 1);
    };

    const getEmbeddedUrl = (path: string) => {
        if (!path) return path;
        if (roomKey) {
            const url = new URL(path, window.location.origin);
            if (url.origin !== window.location.origin || !url.pathname.startsWith('/app/')) return '';
            url.searchParams.set('embedded', 'true');
            url.searchParams.set('embed', '1');
            url.searchParams.set('crewRoom', roomKey);
            if (onActivity) url.searchParams.set('crewActivity', 'chat');
            if (organizationId != null) url.searchParams.set('orgId', String(organizationId));
            return `${url.pathname}${url.search}${url.hash}`;
        }
        const separator = path.includes("?") ? "&" : "?";
        if (path.includes("embedded=true")) return path;
        return `${path}${separator}embedded=true`;
    };

    if (!activeApp) {
        return (
            <div className="flex h-full flex-col items-center justify-center bg-card/60 p-6 text-center border-l border-border/50">
                <Boxes className="h-10 w-10 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold">No Connected App Surfaces</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    This cycle does not have any active app deployments registered yet.
                </p>
                <Button size="sm" variant="outline" className="mt-4" onClick={onClose}>
                    Close Canvas
                </Button>
            </div>
        );
    }

    const modeClasses =
        viewportMode === "fullscreen"
            ? "fixed inset-0 z-50 border-none"
            : viewportMode === "wide"
            ? "w-full max-w-[75vw] min-w-[480px]"
            : "w-full max-w-[50vw] min-w-[360px]";

    const canvas = (
        <div
            data-testid="crew-app-studio-canvas"
            className={`flex flex-col h-full bg-background border-l border-border/60 transition-all duration-200 z-30 ${modeClasses}`}
        >
            {/* Header Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30 backdrop-blur shrink-0 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded bg-primary/10 text-primary shrink-0">
                        <LayoutTemplate className="h-4 w-4" />
                    </div>

                    {apps.length > 1 ? (
                        <Select value={String(activeApp.id)} onValueChange={handleAppChange}>
                            <SelectTrigger className="h-7 text-xs font-medium max-w-[220px] bg-background/80 border-border/60">
                                <SelectValue placeholder="Select App Surface" />
                            </SelectTrigger>
                            <SelectContent>
                                {apps.map((app) => (
                                    <SelectItem key={app.id} value={String(app.id)} className="text-xs">
                                        <div className="flex items-center gap-1.5">
                                            <span>{app.title}</span>
                                            {app.stage && (
                                                <span className="text-[10px] text-muted-foreground uppercase">
                                                    ({app.stage})
                                                </span>
                                            )}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="flex items-center gap-1.5 truncate">
                            <span className="text-xs font-semibold truncate">{activeApp.title}</span>
                        </div>
                    )}

                    <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono hidden sm:inline-flex items-center gap-1"
                    >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        App Studio
                    </Badge>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {/* Viewport Width Controls */}
                    <div className="flex items-center bg-background/80 p-0.5 rounded-md border border-border/60 mr-1">
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 rounded text-xs ${
                                viewportMode === "split" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
                            }`}
                            title="Split View (50%)"
                            onClick={() => setViewportMode("split")}
                        >
                            <Columns2 className="h-3 w-3" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 rounded text-xs ${
                                viewportMode === "wide" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
                            }`}
                            title="Wide View (75%)"
                            onClick={() => setViewportMode("wide")}
                        >
                            <PanelRightOpen className="h-3 w-3" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 rounded text-xs ${
                                viewportMode === "fullscreen" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
                            }`}
                            title="Fullscreen Canvas (100%)"
                            onClick={() => setViewportMode(viewportMode === "fullscreen" ? "split" : "fullscreen")}
                        >
                            {viewportMode === "fullscreen" ? (
                                <Minimize2 className="h-3 w-3" />
                            ) : (
                                <Maximize2 className="h-3 w-3" />
                            )}
                        </Button>
                    </div>

                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Reload App Surface"
                        onClick={handleRefresh}
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Open in New Tab"
                        asChild
                    >
                        <a href={activeApp.publicPath} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Close Canvas"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Embedded Iframe App Surface with embedded=true */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border/60 px-3 py-2">
                {roomKey && organizationId != null && /sdlc/i.test(`${activeApp.slug} ${activeApp.title}`) && <CrewDevelopmentSetup roomKey={roomKey} organizationId={organizationId} onSaved={() => setIframeKey(key => key + 1)} />}
                <Button size="sm" variant="outline" disabled={navigationHistory.length < 2} onClick={() => {
                    const previous = navigationHistory.slice(0, -1);
                    setNavigationHistory(previous);
                    setNavigationUrl(previous.at(-1) ?? null);
                    setIframeKey((key) => key + 1);
                }}>Back</Button>
                <Button size="sm" variant="outline" onClick={() => { setNavigationUrl(null); setNavigationHistory([]); setIframeKey((key) => key + 1); }}>App home</Button>
                {onShowChat && <Button size="sm" variant="outline" onClick={() => { setViewportMode('split'); onShowChat(); }}>Show chat</Button>}
                {onToggleRightRail && <Button size="sm" variant="outline" aria-expanded={!rightRailCollapsed} onClick={() => { setViewportMode('split'); onShowChat?.(); onToggleRightRail(); }}>{rightRailCollapsed ? 'Show right rail' : 'Hide right rail'}</Button>}
                <Button size="sm" variant="outline" onClick={onClose}><X className="mr-1 h-3.5 w-3.5" />Exit</Button>
            </div>
            {onDiscuss && <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{activeApp.title} · {activeApp.status}</span>
                <Button size="sm" variant="outline" onClick={() => { setViewportMode('split'); onShowChat?.(); onDiscuss(activeApp); }}>Discuss app</Button>
            </div>}
            <div className="flex-1 relative w-full h-full bg-card overflow-hidden">
                {frameStatus !== 'ready' && <div role="status" className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
                    <span>{frameStatus === 'loading' ? 'Loading app surface…' : 'The app surface did not finish loading. Retry or open it in a new tab.'}</span>
                    {frameStatus === 'failed' && <Button size="sm" variant="outline" onClick={handleRefresh}>Retry app surface</Button>}
                </div>}
                <iframe
                    ref={iframeRef}
                    key={iframeKey}
                    src={getEmbeddedUrl(navigationUrl ?? activeApp.publicPath)}
                    onLoad={() => {
                        try {
                            const location = iframeRef.current?.contentWindow?.location;
                            if (!location || location.origin !== window.location.origin || !location.pathname.startsWith('/app/')) { setFrameStatus('failed'); return; }
                            const title = iframeRef.current?.contentDocument?.title ?? '';
                            if (/starting app|workbench starting/i.test(title)) return;
                            if (/unavailable|workbench error|session expired/i.test(title)) { setFrameStatus('failed'); return; }
                            setFrameStatus('ready');
                            if (roomKey && onActivity) {
                                const document = iframeRef.current?.contentDocument;
                                if (document?.head) {
                                    const style = document.querySelector<HTMLStyleElement>('style[data-crew-app-presentation]') ?? document.createElement('style');
                                    style.setAttribute('data-crew-app-presentation', '');
                                    style.textContent = CREW_APP_PRESENTATION_CSS;
                                    if (!style.parentNode) document.head.appendChild(style);
                                }
                            }
                            const href = `${location.pathname}${location.search}${location.hash}`;
                            onSurfaceChange?.({ title: activeApp.title, blueprint: activeApp.blueprint ?? activeApp.slug, path: href });
                            setNavigationHistory((previous) => previous.at(-1) === href ? previous : [...previous, href]);
                        } catch { setFrameStatus('failed'); }
                    }}
                    onError={() => setFrameStatus('failed')}
                    title={activeApp.title}
                    className="w-full h-full border-none"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                />
            </div>
        </div>
    );
    return viewportMode === 'fullscreen' ? createPortal(canvas, document.body) : canvas;
}

