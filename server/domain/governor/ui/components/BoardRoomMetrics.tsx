
import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { TrendingUp, Coins, Trash2, ShieldAlert, Activity } from 'lucide-react';

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

export function BoardRoomMetrics({ data }: { data: InstitutionalReport }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card className="border-bronze-200/50 bg-bronze-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-mocha-700">Total Spend</CardTitle>
                    <Coins className="h-4 w-4 text-bronze-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">${data.totalCorporateSpendUsd.toFixed(2)}</div>
                    <p className="text-[10px] text-mocha-600/70 uppercase tracking-tighter mt-1">
                        Actual usage cost
                    </p>
                </CardContent>
            </Card>

            <Card className="border-mocha-200/50 bg-mocha-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-mocha-700">Projected</CardTitle>
                    <TrendingUp className="h-4 w-4 text-mocha-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-mocha-800">${data.projectedMonthlyBurnUsd.toFixed(2)}</div>
                    <p className="text-[10px] text-mocha-600/70 uppercase tracking-tighter mt-1">
                        Monthly run-rate
                    </p>
                </CardContent>
            </Card>

            <Card className="border-blue-200/50 bg-blue-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-blue-700">Active Fleet</CardTitle>
                    <Activity className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-blue-800">{data.fleetTotalInstances}</div>
                    <p className="text-[10px] text-blue-600/70 uppercase tracking-tighter mt-1">
                        Total replicas online
                    </p>
                </CardContent>
            </Card>
            <Card className="border-bronze-200/50 bg-bronze-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-mocha-700">30d Total Spend</CardTitle>
                    <Coins className="h-4 w-4 text-bronze-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">${data.totalCorporateSpendUsd.toFixed(2)}</div>
                    <p className="text-xs text-muted-foreground mt-1 text-mocha-600/70">
                        Actual AI usage cost
                    </p>
                </CardContent>
            </Card>

            <Card className="border-mocha-200/50 bg-mocha-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-mocha-700">Projected Burn</CardTitle>
                    <TrendingUp className="h-4 w-4 text-mocha-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-mocha-800">${data.projectedMonthlyBurnUsd.toFixed(2)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Monthly extrapolated run-rate
                    </p>
                </CardContent>
            </Card>

            <Card className="border-amber-200/50 bg-amber-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-amber-700">Zombie Assets</CardTitle>
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-amber-800">{data.zombieAssets.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Low-ROI apps flagged
                    </p>
                </CardContent>
            </Card>

            <Card className="border-emerald-200/50 bg-emerald-50/10 backdrop-blur-md">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-emerald-700">Efficiency Rating</CardTitle>
                    <Activity className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-emerald-800">{data.efficiencyRating}%</div>
                    <div className="w-full bg-emerald-200 h-1.5 rounded-full mt-2 overflow-hidden">
                        <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${data.efficiencyRating}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                            className="bg-emerald-600 h-1.5 rounded-full" 
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export function ZombieAssetTable({ assets, onArchive }: { assets: InstitutionalReport['zombieAssets'], onArchive: (slug: string, type: 'app' | 'skill') => void }) {
    if (assets.length === 0) return (
        <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p>No zombie assets identified.</p>
                <p className="text-xs">Corporate resource utilization is optimized.</p>
            </CardContent>
        </Card>
    );

    return (
        <Card className="overflow-hidden border-bronze-200/50">
            <CardHeader className="bg-bronze-900 text-foreground p-4">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Trash2 className="h-5 w-5" />
                    Archive Candidate Queue
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted text-muted-foreground font-medium border-b">
                        <tr>
                            <th className="px-4 py-3">Asset</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Reason</th>
                            <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {assets.map((asset) => (
                            <tr key={asset.slug} className="hover:bg-muted/50 transition-colors">
                                <td className="px-4 py-3 font-semibold text-mocha-800">
                                    {asset.name}
                                    {asset.feedbackSnippet && (
                                        <div className="text-[10px] text-mocha-400 font-normal italic mt-0.5 max-w-xs truncate">
                                            "{asset.feedbackSnippet}"
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <Badge variant="outline" className="uppercase text-[10px] tracking-wider border-mocha-200 text-mocha-600">
                                        {asset.type}
                                    </Badge>
                                </td>
                                <td className="px-4 py-3 text-mocha-600 text-xs italic">{asset.reason}</td>
                                <td className="px-4 py-3 text-right">
                                    <button 
                                        onClick={() => onArchive(asset.slug, asset.type)}
                                        className="text-mocha-600 hover:text-bronze-700 font-medium px-3 py-1 rounded bg-mocha-100/50 hover:bg-bronze-100 transition-all text-xs"
                                    >
                                        Initiate Review
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}
