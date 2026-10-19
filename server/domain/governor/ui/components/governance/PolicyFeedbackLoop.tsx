import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { AlertCircle, ThumbsDown, ShieldAlert, Sparkles, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@domain-ui/core/ui/components/ui/dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface NegativeFeedback {
    id: number;
    content: string;
    feedback: string;
    feedbackReason: string;
    createdAt: string;
    jobId?: number;
}

interface ProposedPolicy {
    name: string;
    description: string;
    type: string;
    configuration: any;
}

export function PolicyFeedbackLoop() {
    const [feedbacks, setFeedbacks] = useState<NegativeFeedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<number | null>(null);
    const [proposedPolicy, setProposedPolicy] = useState<ProposedPolicy | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        fetchFeedback();
    }, []);

    const fetchFeedback = async () => {
        try {
            const response = await fetch('/api/scoring/feedback/negative?limit=10');
            if (response.ok) {
                const data = await response.json();
                setFeedbacks(data);
            }
        } catch (error) {
            console.error("Failed to fetch feedback:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleGeneratePolicy = async (feedback: NegativeFeedback) => {
        setGenerating(feedback.id);
        try {
            // Context is a mix of the content and the user's feedback
            const context = `Agent Output: "${feedback.content.substring(0, 500)}..." \n\n User Feedback: "${feedback.feedback || 'Thumbs Down'} - Reason: ${feedback.feedbackReason || 'Unknown'}"`;

            const response = await fetch('/api/scoring/feedback/generate-policy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedbackId: feedback.id, context })
            });

            if (!response.ok) throw new Error("Failed to generate policy");

            const policy = await response.json();
            setProposedPolicy(policy);
            setIsDialogOpen(true);

        } catch (error) {
            toast({
                title: "Generation Failed",
                description: "Could not generate a policy from this feedback.",
                variant: "destructive"
            });
        } finally {
            setGenerating(null);
        }
    };

    const handleApplyPolicy = async () => {
        if (!proposedPolicy) return;

        try {
            // Save the policy (using existing rules endpoint)
            const response = await fetch('/api/governor/policies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: proposedPolicy.name,
                    description: proposedPolicy.description,
                    type: 'system', // Differentiate from manual custom policies
                    organizationId: 1, // Fallback for Phase 2
                    rules: [{
                        type: proposedPolicy.type,
                        configuration: proposedPolicy.configuration,
                        isEnabled: false // Default to disabled for safety
                    }]
                })
            });

            if (!response.ok) throw new Error("Failed to save policy");

            toast({
                title: "Policy Created",
                description: `Rule "${proposedPolicy.name}" has been created (Disabled).`,
            });
            setIsDialogOpen(false);
        } catch (error) {
            toast({
                title: "Save Failed",
                description: "Could not save the new policy rule.",
                variant: "destructive"
            });
        }
    };

    if (loading) return <div>Loading feedback...</div>;

    if (feedbacks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <CheckCircle className="w-12 h-12 mb-4 text-green-500" />
                <p>No recent negative feedback. Systems are nominal.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-orange-500" />
                Recent Incidents & Feedback
            </h3>
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                <div className="space-y-4">
                    {feedbacks.map((f) => (
                        <Card key={f.id} className="bg-destructive/10 border-destructive/20">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="destructive" className="flex gap-1 items-center">
                                            <ThumbsDown className="w-3 h-3" /> {f.feedbackReason || "Negative Feedback"}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</span>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        onClick={() => handleGeneratePolicy(f)}
                                        disabled={generating === f.id}
                                    >
                                        {generating === f.id ? <Sparkles className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                        Generate Fix
                                    </Button>
                                </div>
                                <CardTitle className="text-sm font-medium mt-2">
                                    User Feedback: "{f.feedback}"
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-sm text-muted-foreground bg-background/50 p-2 rounded border">
                                    <span className="font-semibold text-xs uppercase tracking-wider block mb-1">Agent Output:</span>
                                    {f.content.substring(0, 200)}...
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </ScrollArea>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-blue-500" />
                            AI Suggested Policy
                        </DialogTitle>
                        <DialogDescription>
                            Based on the feedback, the AI recommends the following governance rule to prevent recurrence.
                        </DialogDescription>
                    </DialogHeader>

                    {proposedPolicy && (
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Name:</span>
                                <span className="col-span-3">{proposedPolicy.name}</span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Type:</span>
                                <span className="col-span-3"><Badge variant="outline">{proposedPolicy.type}</Badge></span>
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <span className="font-bold text-right mt-2">Description:</span>
                                <p className="col-span-3 text-sm text-muted-foreground bg-muted p-2 rounded">
                                    {proposedPolicy.description}
                                </p>
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <span className="font-bold text-right mt-2">Config:</span>
                                <pre className="col-span-3 text-xs bg-background text-foreground p-2 rounded overflow-x-auto">
                                    {JSON.stringify(proposedPolicy.configuration, null, 2)}
                                </pre>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Discard</Button>
                        <Button onClick={handleApplyPolicy}>Create Rule (Disabled)</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

