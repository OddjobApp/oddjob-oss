import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import {
    Code2,
    Send,
    ShieldCheck,
    CheckCircle2,
    Loader2,
    Copy,
    ExternalLink,
    Database,
    Zap,
    Play,
    Check,
    Terminal,
    Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApiEndpoint {
    id: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    summary: string;
    description?: string;
    auth: 'public' | 'bearer' | 'session';
    sampleBody?: string;
}

const DEFAULT_ENDPOINTS: ApiEndpoint[] = [
    {
        id: 'ep-health',
        method: 'GET',
        path: '/api/health',
        summary: 'Service Health & Readiness Probe',
        description: 'Returns active container status, memory usage, and uptime.',
        auth: 'public',
    },
    {
        id: 'ep-metrics',
        method: 'GET',
        path: '/api/metrics',
        summary: 'Platform Telemetry & Performance Counters',
        description: 'Returns high-resolution Eulerian H3 bin metrics and query latencies.',
        auth: 'public',
    },
    {
        id: 'ep-query',
        method: 'POST',
        path: '/api/query',
        summary: 'Unified Platform Data Query',
        description: 'Queries bounded collections with projection and filter criteria.',
        auth: 'session',
        sampleBody: JSON.stringify({ collection: "rescues", filter: { status: "active" }, limit: 10 }, null, 2),
    },
    {
        id: 'ep-dispatch',
        method: 'POST',
        path: '/api/dispatch',
        summary: 'Tactical Event Ingestion & Webhook Dispatch',
        description: 'Dispatches operational events into the Oddjob event bus.',
        auth: 'bearer',
        sampleBody: JSON.stringify({ event: "squad.deploy", priority: "critical", unitId: "squad-alpha" }, null, 2),
    },
];

interface ApiContractExplorerProps {
    appId: number;
    appSlug: string;
    assignedPort: number;
}

export function ApiContractExplorer({ appId, appSlug, assignedPort }: ApiContractExplorerProps) {
    const { toast } = useToast();
    const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint>(DEFAULT_ENDPOINTS[0]);
    const [requestBody, setRequestBody] = useState<string>(DEFAULT_ENDPOINTS[0].sampleBody || '');
    const [isExecuting, setIsExecuting] = useState(false);
    const [responseResult, setResponseResult] = useState<{
        status: number;
        statusText: string;
        latencyMs: number;
        headers: Record<string, string>;
        data: any;
    } | null>(null);
    const [copiedCurl, setCopiedCurl] = useState(false);

    const handleSelectEndpoint = (ep: ApiEndpoint) => {
        setSelectedEndpoint(ep);
        setRequestBody(ep.sampleBody || '');
        setResponseResult(null);
    };

    const targetUrl = `/forged/${appSlug}${selectedEndpoint.path}`;

    const curlSnippet = selectedEndpoint.method === 'GET'
        ? `curl -X GET "${window.location.origin}${targetUrl}"`
        : `curl -X ${selectedEndpoint.method} "${window.location.origin}${targetUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${requestBody.replace(/'/g, "'\\''")}'`;

    const handleCopyCurl = () => {
        navigator.clipboard.writeText(curlSnippet);
        setCopiedCurl(true);
        setTimeout(() => setCopiedCurl(false), 2000);
        toast({ title: "cURL Copied", description: "Command copied to clipboard." });
    };

    const handleExecuteRequest = async () => {
        setIsExecuting(true);
        setResponseResult(null);
        const startTime = performance.now();

        try {
            const options: RequestInit = {
                method: selectedEndpoint.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            };

            if (selectedEndpoint.method !== 'GET' && requestBody.trim()) {
                options.body = requestBody;
            }

            const res = await fetch(targetUrl, options);
            const endTime = performance.now();
            const latencyMs = Math.round(endTime - startTime);

            const headers: Record<string, string> = {};
            res.headers.forEach((val, key) => { headers[key] = val; });

            let data: any;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }

            setResponseResult({
                status: res.status,
                statusText: res.statusText,
                latencyMs,
                headers,
                data,
            });
        } catch (err: any) {
            const endTime = performance.now();
            setResponseResult({
                status: 500,
                statusText: 'Internal Proxy Error',
                latencyMs: Math.round(endTime - startTime),
                headers: {},
                data: { error: err.message || 'Failed to reach API endpoint container' },
            });
        } finally {
            setIsExecuting(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-background/50 overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-foreground/10 bg-background/80 backdrop-blur-md flex-shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <Code2 className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                                OpenAPI 3.1 Specification & Request Playground
                            </h3>
                            <Badge variant="outline" className="text-[9px] font-mono text-cyan-400 border-cyan-500/30">
                                REST v1
                            </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            Interactive client playground routed to container on Port {assignedPort}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopyCurl} className="h-8 gap-1.5 text-[10px] font-mono">
                        {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCurl ? 'Copied' : 'Copy cURL'}</span>
                    </Button>
                    <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                        200 OK Online
                    </Badge>
                </div>
            </div>

            {/* Main 2-Column Split: Endpoints List + Request/Response Console */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden">
                {/* Left Column: Endpoint Navigation (4 cols) */}
                <div className="md:col-span-4 border-r border-foreground/10 flex flex-col min-h-0 bg-card/20">
                    <div className="p-3 border-b border-foreground/10 bg-foreground/5 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                            Operations ({DEFAULT_ENDPOINTS.length})
                        </span>
                        <span className="text-[9px] font-mono text-primary">/forged/{appSlug}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {DEFAULT_ENDPOINTS.map((ep) => {
                            const isSelected = selectedEndpoint.id === ep.id;
                            return (
                                <div
                                    key={ep.id}
                                    onClick={() => handleSelectEndpoint(ep)}
                                    className={cn(
                                        "p-3 rounded-xl border transition-all cursor-pointer select-none space-y-1",
                                        isSelected
                                            ? "border-primary bg-primary/10 shadow-[0_0_15px_hsl(var(--primary)/0.15)]"
                                            : "border-border/60 bg-card/40 hover:border-primary/40"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "px-1.5 py-0.5 rounded font-mono text-[9px] font-black tracking-wider uppercase",
                                                ep.method === 'GET' ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" :
                                                ep.method === 'POST' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                                                ep.method === 'DELETE' ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" :
                                                "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                            )}>
                                                {ep.method}
                                            </span>
                                            <span className="font-mono text-xs font-bold text-foreground">{ep.path}</span>
                                        </div>
                                        <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground">
                                            {ep.auth}
                                        </Badge>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">{ep.summary}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Execution Playground & Results (8 cols) */}
                <div className="md:col-span-8 flex flex-col min-h-0 bg-background/30 overflow-y-auto p-6 space-y-6">
                    {/* Operation Title Card */}
                    <div className="p-4 rounded-2xl bg-card/60 border border-border/80 space-y-2">
                        <div className="flex items-center gap-3">
                            <span className={cn(
                                "px-2 py-1 rounded-md font-mono text-xs font-black tracking-wider uppercase",
                                selectedEndpoint.method === 'GET' ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" :
                                selectedEndpoint.method === 'POST' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                                "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            )}>
                                {selectedEndpoint.method}
                            </span>
                            <span className="font-mono text-sm font-bold text-foreground">{targetUrl}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{selectedEndpoint.description}</p>
                    </div>

                    {/* Request Payload Editor (for POST/PUT) */}
                    {selectedEndpoint.method !== 'GET' && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                    <Terminal className="w-3.5 h-3.5 text-primary" /> Request Body (application/json)
                                </Label>
                                <span className="text-[9px] font-mono text-muted-foreground">JSON Body</span>
                            </div>
                            <Textarea
                                value={requestBody}
                                onChange={(e) => setRequestBody(e.target.value)}
                                rows={6}
                                className="font-mono text-xs bg-card/90 border-foreground/10 rounded-xl"
                            />
                        </div>
                    )}

                    {/* Execute Action Bar */}
                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span>Targeting active runtime container</span>
                        </div>
                        <Button
                            onClick={handleExecuteRequest}
                            disabled={isExecuting}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wider text-xs gap-2 px-6 h-10 shadow-lg shadow-primary/20"
                        >
                            {isExecuting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Executing...</span>
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4 fill-current" />
                                    <span>Send Request</span>
                                </>
                            )}
                        </Button>
                    </div>

                    {/* Response Inspector */}
                    {responseResult && (
                        <div className="space-y-3 pt-4 border-t border-foreground/10 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-bold uppercase tracking-wider">Response</span>
                                    <Badge className={cn(
                                        "font-mono text-xs",
                                        responseResult.status >= 200 && responseResult.status < 300 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                                    )}>
                                        {responseResult.status} {responseResult.statusText}
                                    </Badge>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                    Latency: <span className="text-emerald-400 font-bold">{responseResult.latencyMs} ms</span>
                                </span>
                            </div>

                            <div className="p-4 rounded-xl bg-[#07101f] border border-white/10 font-mono text-xs overflow-x-auto max-h-[300px]">
                                <pre className="text-emerald-300/90 leading-relaxed">
                                    {typeof responseResult.data === 'object'
                                        ? JSON.stringify(responseResult.data, null, 2)
                                        : String(responseResult.data)}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
