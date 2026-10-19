
import React, { useState, useEffect } from "react";
import { BoardRoomMetrics, ZombieAssetTable } from '../../../components/BoardRoomMetrics.js';
import ScalingMonitor from '../../../components/ScalingMonitor.js';
import { Card, CardHeader, CardTitle, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { RefreshCcw, Landmark, ShieldCheck, Zap, Globe } from "lucide-react";

interface InstitutionalReport {
    totalCorporateSpendUsd: number;
    projectedMonthlyBurnUsd: number;
    topExpensiveApps: Array<{ 
        name: string, 
        slug: string, 
        cost: number, 
        usage: number,
        activeInstances: number,
        currentDensity: number
    }>;
    zombieAssets: Array<{ 
        type: 'app' | 'skill', 
        name: string, 
        slug: string, 
        reason: string,
        feedbackSnippet?: string 
    }>;
    efficiencyRating: number;
    fleetTotalInstances: number;
}

export default function BoardRoomPage() {
    const [report, setReport] = useState<InstitutionalReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { toast } = useToast();

    const fetchReport = async () => {
        setRefreshing(true);
        try {
            const response = await fetch("/api/governor/institutional-health");
            if (!response.ok) throw new Error("Failed to fetch health report");
            const data = await response.json();
            setReport(data);
        } catch (error) {
            toast({
                title: "Audit Connection Error",
                description: "Could not establish connection to the Sovereign Auditor.",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, []);

    const handleArchive = async (assetSlug: string, assetType: 'app' | 'skill') => {
        try {
            const response = await fetch("/api/governor/archive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    assetSlug,
                    assetType,
                    reason: "Manual decommissioning triggered via Board Room ROI Audit."
                })
            });

            if (!response.ok) throw new Error("Archival request failed");
            
            const result = await response.json();

            toast({
                title: "Decommissioning Initiated",
                description: `A formal archival proposal (ID: ${result.decisionId}) has been sent to the Decision Inbox for final HIL approval.`,
            });
        } catch (error) {
            toast({
                title: "Request Failed",
                description: "Could not initiate the decommissioning sequence.",
                variant: "destructive"
            });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <RefreshCcw className="w-8 h-8 animate-spin text-bronze-600" />
            </div>
        );
    }

    if (!report) return <div>No data available. Ensure the InstitutionalAuditorService is active.</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-700">
            <header className="flex justify-between items-end mb-8 border-b border-bronze-100 pb-6">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Landmark className="h-6 w-6 text-bronze-700" />
                        <h1 className="text-3xl font-black tracking-tighter text-mocha-900 uppercase">
                            Board Room
                        </h1>
                    </div>
                    <p className="text-mocha-600 font-medium">Sovereign Institutional Oversight & Resource Governance</p>
                </div>
                <div className="flex gap-3">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={fetchReport} 
                        disabled={refreshing}
                        className="border-bronze-200 text-mocha-700 hover:bg-bronze-50"
                    >
                        <RefreshCcw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh Audit
                    </Button>
                    <Button size="sm" className="bg-bronze-700 hover:bg-bronze-800 text-foreground shadow-lg shadow-bronze-200">
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        System Certified
                    </Button>
                </div>
            </header>

            <BoardRoomMetrics data={report} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <ZombieAssetTable assets={report.zombieAssets} onArchive={handleArchive} />
                    
                    <Card className="border-border bg-muted text-foreground shadow-sm overflow-hidden">
                        <CardHeader className="bg-card/50 border-b border-border">
                            <CardTitle className="text-sm font-bold text-foreground uppercase tracking-widest flex items-center gap-2">
                                <Zap className="h-4 w-4 text-blue-400" />
                                Top Resource Consumers (Forged Apps)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-gray-700">
                                {report.topExpensiveApps.map(app => (
                                    <div key={app.slug} className="p-4 flex justify-between items-center hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                                            <div>
                                                <div className="font-bold text-foreground">{app.name}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">{app.slug}</div>
                                            </div>
                                        </div>
                                        <div className="flex gap-4 items-center">
                                            <div className="text-right">
                                                <div className="text-[10px] text-muted-foreground uppercase font-black mb-0.5">Fleet</div>
                                                <div className="flex gap-1">
                                                    <span className="text-xs font-bold px-1.5 py-0.5 bg-muted rounded text-foreground">{app.activeInstances} Replicas</span>
                                                    <span className="text-xs font-bold px-1.5 py-0.5 bg-blue-900/50 rounded text-blue-300">{app.currentDensity.toFixed(1)} usr/inst</span>
                                                </div>
                                            </div>
                                            <div className="text-right border-l pl-4 border-border">
                                                <div className="text-sm font-black text-blue-300">${app.cost.toFixed(4)}</div>
                                                <div className="text-[10px] text-muted-foreground uppercase">{app.usage} missions</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6 text-sm">
                    <Card className="bg-mocha-900 text-bronze-100 border-none shadow-xl">
                        <CardHeader>
                            <CardTitle className="text-lg font-black text-foreground italic">DIRECTOR'S BRIEF</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 opacity-90 leading-relaxed font-serif">
                            <p>
                                The corporation is currently operating at <span className="text-foreground font-bold underlineDecoration-bronze-400">{report.efficiencyRating}% efficiency</span>. 
                                We have {report.fleetTotalInstances} replicas active across the fleet, supporting real-time demand variations.
                            </p>
                            <p>
                                <span className="text-foreground font-bold">Strategy Recommended:</span> Initiate "Soft-Archive" on all flagged zombie apps to reclaim $${(report.projectedMonthlyBurnUsd * 0.15).toFixed(2)} in projected monthly overhead.
                            </p>
                            <div className="pt-4 border-t border-mocha-800">
                                <p className="text-[10px] uppercase tracking-tighter opacity-50">Authorized by Agentic Governance Layer v4.0</p>
                            </div>
                        </CardContent>
                    </Card>

                    <ScalingMonitor />
                </div>
            </div>
        </div>
    );
}
