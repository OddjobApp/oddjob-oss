
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Activity, RefreshCw, Zap } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { VECTORS } from './ScoringRuleForm.js';
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

interface SessionData {
    sessionId: string;
    vectors: Record<string, number>;
    dominantVector: string;
    confidence: number;
    eventCount: number;
    lastUpdate: number;
    triggeredThresholds: string[];
}

const INGESTOR_URL = 'http://localhost:3001';

export function LiveSessionView() {
    const [data, setData] = useState<SessionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
    const [autoRefresh, setAutoRefresh] = useState(true);

    const sessionId = sessionStorage.getItem('oj_session_id');

    const fetchData = async () => {
        if (!sessionId) return;
        try {
            const res = await fetch(`${INGESTOR_URL}/session/${sessionId}/scoring-context`);
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (error) {
            console.error("Failed to fetch session data", error);
        } finally {
            setLoading(false);
            setLastRefreshed(new Date());
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => {
            if (autoRefresh) fetchData();
        }, 2000);
        return () => clearInterval(interval);
    }, [autoRefresh, sessionId]);

    if (!sessionId) {
        return (
            <div className="p-8 text-center text-muted-foreground border rounded-lg border-dashed">
                No active session found. Interact with the application to start a session.
            </div>
        );
    }

    const getMaxScore = () => {
        if (!data) return 10;
        const max = Math.max(...Object.values(data.vectors));
        return max > 10 ? max * 1.2 : 10; // Scale to fit
    };

    const maxScore = getMaxScore();

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Activity className="h-5 w-5 text-green-500" />
                        Live Session Debugger
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Real-time visualization of your current browser session's S.C.O.R.E. state.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground tabular-nums">
                        Last updated: {lastRefreshed.toLocaleTimeString()}
                    </div>
                    <Button
                        variant={autoRefresh ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className="gap-2"
                    >
                        {autoRefresh ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {autoRefresh ? "Live" : "Paused"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Session Stats */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Session Info</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div>
                                <div className="text-2xl font-bold truncate" title={sessionId}>{sessionId.substring(0, 15)}...</div>
                                <p className="text-xs text-muted-foreground">Session ID</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="text-xl font-bold">{data?.eventCount || 0}</div>
                                    <div className="text-xs text-muted-foreground">Events Processed</div>
                                </div>
                                <div>
                                    <div className="text-xl font-bold">{(data?.confidence || 0).toFixed(2)}</div>
                                    <div className="text-xs text-muted-foreground">Dominant Confidence</div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Vector Visualization */}
                <Card className="md:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Current S.C.O.R.E. Vectors</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {VECTORS.map(info => {
                                const key = info.id;
                                const score = data?.vectors[key] || 0;
                                const isDominant = data?.dominantVector === key;
                                const percentage = Math.min((score / maxScore) * 100, 100);

                                let colorClass = info.color;

                                return (
                                    <div key={key} className="space-y-1">
                                        <div className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <Badge variant={isDominant ? "default" : "outline"} className="w-8 justify-center">
                                                    {key}
                                                </Badge>
                                                <span className={isDominant ? "font-bold" : "text-muted-foreground"}>
                                                    {info.name}
                                                </span>
                                            </div>
                                            <span className="tabular-nums font-mono">{score.toFixed(1)}</span>
                                        </div>
                                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-500 ${colorClass}`}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Threshold Log */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        Triggered Thresholds
                    </CardTitle>
                    <CardDescription>Rules and thresholds that have fired for this session.</CardDescription>
                </CardHeader>
                <CardContent>
                    {data?.triggeredThresholds && data.triggeredThresholds.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {data.triggeredThresholds.map((t, i) => (
                                <Badge key={i} variant="secondary" className="px-3 py-1 text-sm border-l-4 border-l-yellow-500">
                                    Threshold #{t}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground py-4 text-center">
                            No thresholds triggered yet.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
