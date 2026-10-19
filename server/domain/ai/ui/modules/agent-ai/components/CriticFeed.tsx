
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { AlertCircle, CheckCircle, XCircle, BrainCircuit } from "lucide-react";
import { format } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@domain-ui/core/ui/components/ui/accordion";

type Critique = {
    id: number;
    interactionId: number;
    criticism: string;
    score: string;
    issues: string[]; // jsonb comes as array
    correction: string | null;
    createdAt: string;
};

export const CriticFeed: React.FC = () => {
    const { data: critiques, isLoading } = useQuery<Critique[]>({
        queryKey: ["agent-critiques"],
        queryFn: async () => {
            const res = await fetch("/api/agent-critiques?limit=20");
            if (!res.ok) throw new Error("Failed to fetch");
            return res.json();
        },
        refetchInterval: 5000, // Poll every 5s for real-time feel
    });

    if (isLoading) return <div className="text-sm text-muted-foreground">Loading critiques...</div>;

    if (!critiques?.length) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed rounded-lg text-muted-foreground">
                <BrainCircuit className="w-12 h-12 mb-4 opacity-50" />
                <p>No critiques recorded yet.</p>
                <p className="text-xs">The Internal Critic is watching...</p>
            </div>
        );
    }

    return (
        <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-4">
                {critiques.map((c) => {
                    const score = parseFloat(c.score);
                    const isGood = score >= 0.7; // 7/10
                    const isBad = score < 0.5;

                    return (
                        <Card key={c.id} className={`border-l-4 ${isGood ? 'border-l-green-500' : isBad ? 'border-l-red-500' : 'border-l-yellow-500'}`}>
                            <CardHeader className="py-3 px-4 pb-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {isGood ? <CheckCircle className="w-4 h-4 text-green-500" /> :
                                            isBad ? <XCircle className="w-4 h-4 text-red-500" /> :
                                                <AlertCircle className="w-4 h-4 text-yellow-500" />}
                                        <span className="font-semibold text-sm">Interaction #{c.interactionId}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {format(new Date(c.createdAt), "HH:mm:ss")}
                                    </span>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 py-2 text-sm space-y-2">
                                <div className="flex items-center justify-between">
                                    <Badge variant={isGood ? "outline" : isBad ? "destructive" : "secondary"}>
                                        Score: {score.toFixed(1)}/10
                                    </Badge>
                                    <div className="flex gap-1">
                                        {Array.isArray(c.issues) && c.issues.map((issue, idx) => (
                                            <Badge key={idx} variant="outline" className="text-[10px] px-1 h-5">
                                                {issue}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-foreground leading-relaxed">{c.criticism}</p>
                                {c.correction && (
                                    <Accordion type="single" collapsible>
                                        <AccordionItem value="correction" className="border-none">
                                            <AccordionTrigger className="py-1 text-xs text-blue-500 hover:text-blue-600">
                                                View Suggested Correction
                                            </AccordionTrigger>
                                            <AccordionContent className="bg-muted/30 p-2 rounded text-xs mt-1">
                                                {c.correction}
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </ScrollArea>
    );
};
