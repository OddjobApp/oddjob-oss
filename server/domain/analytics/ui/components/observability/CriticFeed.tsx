
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@domain-ui/core/ui/components/ui/dialog";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";

interface Critique {
    id: number;
    agentName: string;
    userQuery: string;
    agentResponse: string;
    score: number;
    critique: string;
    correction: string | null;
    createdAt: string;
    interactionId: string | null;
}

export function CriticFeed() {
    const [showLowQualityOnly, setShowLowQualityOnly] = useState(false);

    const { data: critiques, isLoading } = useQuery<Critique[]>({
        queryKey: ["agent-critiques", showLowQualityOnly],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append("limit", "50");
            if (showLowQualityOnly) {
                params.append("maxScore", "3");
            }
            const res = await fetch(`/api/agent-critiques?${params.toString()}`);
            if (!res.ok) throw new Error("Failed to fetch critiques");
            return res.json();
        },
        refetchInterval: 10000
    });

    if (isLoading) return <Skeleton className="h-64 sticky top-0" />;

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle>Live Critique Feed</CardTitle>
                    <CardDescription>Real-time quality grades from the Internal Critic Agent.</CardDescription>
                </div>
                <div className="flex items-center space-x-2">
                    <Switch
                        id="low-quality"
                        checked={showLowQualityOnly}
                        onCheckedChange={setShowLowQualityOnly}
                    />
                    <Label htmlFor="low-quality">Show Low Scores Only (&le; 3)</Label>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Score</TableHead>
                            <TableHead>Agent</TableHead>
                            <TableHead>User Query</TableHead>
                            <TableHead>Critique Summary</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {critiques?.map((c) => (
                            <TableRow key={c.id}>
                                <TableCell>
                                    <ScoreBadge score={c.score} />
                                </TableCell>
                                <TableCell className="font-medium text-xs">{c.agentName}</TableCell>
                                <TableCell className="max-w-[200px] truncate text-xs" title={c.userQuery}>
                                    {c.userQuery}
                                </TableCell>
                                <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground" title={c.critique}>
                                    {c.critique}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {new Date(c.createdAt).toLocaleTimeString()}
                                </TableCell>
                                <TableCell>
                                    <CritiqueDetailsDialog critique={c} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

function ScoreBadge({ score }: { score: number }) {
    if (score >= 5) return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400"><CheckCircle className="w-3 h-3 mr-1" /> 5/5</Badge>;
    if (score >= 4) return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20">4/5</Badge>;
    if (score >= 3) return <Badge variant="outline" className="text-yellow-500 border-yellow-500">3/5</Badge>;
    return <Badge variant="destructive" className="bg-red-500 hover:bg-red-600"><AlertTriangle className="w-3 h-3 mr-1" /> {score}/5</Badge>;
}

function CritiqueDetailsDialog({ critique }: { critique: Critique }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm">View</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Critique Details
                        <ScoreBadge score={critique.score} />
                    </DialogTitle>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-4">
                    <div className="space-y-4">
                        <div className="bg-muted/50 p-4 rounded-md">
                            <h4 className="text-sm font-semibold mb-1">User Query</h4>
                            <p className="text-sm">{critique.userQuery}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <div className="border p-4 rounded-md border-l-4 border-l-primary/50">
                                <h4 className="text-sm font-semibold mb-1 text-primary">Agent Response</h4>
                                <p className="text-sm whitespace-pre-wrap">{critique.agentResponse}</p>
                            </div>
                        </div>

                        <div className="bg-destructive/10 p-4 rounded-md border border-destructive/20">
                            <h4 className="text-sm font-semibold mb-1 text-destructive flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" /> The Critic's Feedback
                            </h4>
                            <p className="text-sm font-medium">{critique.critique}</p>
                        </div>

                        {critique.correction && (
                            <div className="bg-green-500/10 p-4 rounded-md border border-green-500/20">
                                <h4 className="text-sm font-semibold mb-1 text-green-600 flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" /> Suggested Correction
                                </h4>
                                <p className="text-sm">{critique.correction}</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
