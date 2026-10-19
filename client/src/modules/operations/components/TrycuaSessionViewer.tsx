import React, { useEffect, useRef, useState, useCallback } from "react";
import { ExternalLink, Monitor, Wifi, WifiOff, ZoomIn, ZoomOut, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface TrycuaSessionViewerProps {
    sessionId: string;
    organizationId: number;
    userId: string;
    /** Called when user closes the viewer */
    onClose?: () => void;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

function buildWsUrl(path: string): string {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${path}`;
}

export function TrycuaSessionViewer({
    sessionId,
    organizationId,
    userId,
    onClose,
}: TrycuaSessionViewerProps) {
    const [frameUrl, setFrameUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>("connecting");
    const [lastFrameTs, setLastFrameTs] = useState<number | null>(null);
    const [zoom, setZoom] = useState(1);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const connect = useCallback(async () => {
        if (wsRef.current) {
            wsRef.current.close();
        }

        setStatus("connecting");
        // The socket is authorized by a one-use ticket from an authenticated request; it no
        // longer trusts ids sent in the JOIN message.
        let ticket: string;
        try {
            const res = await apiRequest("POST", `/api/integrations/trycua/sessions/${sessionId}/stream-ticket`);
            ticket = (await res.json()).ticket;
        } catch (e) {
            setStatus("error");
            console.error("[TrycuaViewer] Could not get a stream ticket", e);
            return;
        }
        const ws = new WebSocket(buildWsUrl(`/api/trycua/stream?ticket=${encodeURIComponent(ticket)}`));
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: "JOIN", payload: { sessionId } }));
        };

        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                switch (msg.type) {
                    case "JOINED":
                        setStatus("connected");
                        break;
                    case "FRAME":
                        setFrameUrl(msg.payload.dataUrl);
                        setLastFrameTs(msg.payload.ts);
                        break;
                    case "SESSION_ENDED":
                        setStatus("disconnected");
                        ws.close();
                        break;
                    case "ERROR":
                        setStatus("error");
                        console.error("[TrycuaViewer] Server error:", msg.payload);
                        break;
                }
            } catch (e) {
                console.warn("[TrycuaViewer] Failed to parse message", e);
            }
        };

        ws.onclose = () => {
            if (status !== "disconnected") {
                setStatus("disconnected");
                // Auto-reconnect after 3s
                reconnectTimer.current = setTimeout(() => void connect(), 3000);
            }
        };

        ws.onerror = () => {
            setStatus("error");
        };
    }, [sessionId, organizationId, userId]);

    useEffect(() => {
        void connect();
        return () => {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            wsRef.current?.send(JSON.stringify({ type: "LEAVE" }));
            wsRef.current?.close();
        };
    }, [connect]);

    const statusColor: Record<ConnectionStatus, string> = {
        connecting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
        connected:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        disconnected: "bg-slate-500/20 text-muted-foreground border-slate-500/30",
        error:      "bg-red-500/20 text-red-400 border-red-500/30",
    };

    const statusIcon: Record<ConnectionStatus, React.ReactNode> = {
        connecting:   <Loader2 className="w-3 h-3 animate-spin" />,
        connected:    <Wifi className="w-3 h-3" />,
        disconnected: <WifiOff className="w-3 h-3" />,
        error:        <WifiOff className="w-3 h-3" />,
    };

    const fps = lastFrameTs
        ? `Last frame: ${((Date.now() - lastFrameTs) / 1000).toFixed(1)}s ago`
        : null;

    return (
        <div className="flex flex-col h-full bg-black/40 backdrop-blur-2xl rounded-2xl border border-white/5 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-black/20">
                <div className="flex items-center gap-3">
                    <Monitor className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Live Session
                    </span>
                    <Badge
                        variant="outline"
                        className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 ${statusColor[status]}`}
                    >
                        {statusIcon[status]}
                        {status}
                    </Badge>
                    {fps && (
                        <span className="text-[10px] text-muted-foreground/60">{fps}</span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => window.open(`/api/integrations/trycua/desktop/viewer?orgId=${organizationId}`, "_blank", "noopener,noreferrer")}
                        title="Open the desktop in a new tab to control it yourself, e.g. to log in to a site"
                        data-testid="button-open-desktop"
                    >
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        Open desktop
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-foreground/5"
                        onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
                        title="Zoom out"
                    >
                        <ZoomOut className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono w-10 text-center">
                        {Math.round(zoom * 100)}%
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-foreground/5"
                        onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                        title="Zoom in"
                    >
                        <ZoomIn className="w-3.5 h-3.5" />
                    </Button>
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg hover:bg-red-500/10 hover:text-red-400"
                            onClick={onClose}
                            title="Close viewer"
                        >
                            <X className="w-3.5 h-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Frame Display */}
            <div className="flex-1 overflow-auto flex items-center justify-center bg-black/60 p-4">
                {frameUrl ? (
                    <img
                        src={frameUrl}
                        alt="Live VM Screenshot"
                        style={{
                            transform: `scale(${zoom})`,
                            transformOrigin: "top center",
                            transition: "transform 0.15s ease",
                            imageRendering: "pixelated",
                        }}
                        className="max-w-none shadow-2xl shadow-black/60 rounded"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-3 opacity-40">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <p className="text-sm font-medium">
                            {status === "connecting" ? "Connecting to session…" : "Waiting for first frame…"}
                        </p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-white/5 bg-black/20 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                    {sessionId.slice(0, 8)}…
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                    Polling @ 1 fps · Read-only view
                </span>
            </div>
        </div>
    );
}
