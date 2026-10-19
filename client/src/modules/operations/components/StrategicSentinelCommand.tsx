import React, { useState } from "react";
import { 
    Zap, Sparkles, Code, Play, 
    CheckCircle2, XCircle, Loader2,
    Terminal, Info
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface StrategicSentinelCommandProps {
    onTriggerCreated?: (trigger: any) => void;
}

export function StrategicSentinelCommand({ onTriggerCreated }: StrategicSentinelCommandProps) {
    const { toast } = useToast();
    const [prompt, setPrompt] = useState("");
    const [translating, setTranslating] = useState(false);
    const [translatedFilter, setTranslatedFilter] = useState<string | null>(null);
    const [mockPayload, setMockPayload] = useState('{\n  "order": {\n    "value": 150,\n    "status": "pending"\n  }\n}');
    const [simulating, setSimulating] = useState(false);
    const [simResult, setSimResult] = useState<{ match: boolean; error?: string } | null>(null);

    const handleTranslate = async () => {
        if (!prompt.trim()) return;
        setTranslating(true);
        setSimResult(null);
        try {
            const res = await apiRequest("POST", "/api/pipelines/triggers/translate", { prompt });
            const data = await res.json();
            setTranslatedFilter(data.filterCondition);
            toast({ title: "Translation Complete", description: "AI has generated the technical filter logic." });
        } catch (err: any) {
            toast({ title: "Translation Failed", description: err.message, variant: "destructive" });
        } finally {
            setTranslating(false);
        }
    };

    const handleSimulate = async () => {
        if (!translatedFilter) return;
        setSimulating(true);
        try {
            let payloadObj;
            try {
                payloadObj = JSON.parse(mockPayload);
            } catch {
                throw new Error("Invalid JSON in mock payload");
            }

            const res = await apiRequest("POST", "/api/pipelines/triggers/simulate", {
                filterCondition: translatedFilter,
                mockEvent: {
                    eventType: "order.created",
                    payload: payloadObj
                }
            });
            const data = await res.json();
            setSimResult(data);
        } catch (err: any) {
            setSimResult({ match: false, error: err.message });
        } finally {
            setSimulating(false);
        }
    };

    return (
        <Card className="bg-black/40 border-primary/20 border-2 shadow-2xl shadow-primary/5 backdrop-blur-3xl overflow-hidden">
            <CardHeader className="border-b border-white/5 pb-4 bg-foreground/[0.03]">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary animate-pulse" /> Sentinel Command
                        </CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                            NATURAL LANGUAGE TRIGGER ORCHESTRATION
                        </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-[9px] font-black border-primary/40 text-primary uppercase">
                        AI-Powered
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
                {/* NL Input */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Human Directive</Label>
                        <span className="text-[9px] text-primary/40 font-mono italic">natural language input</span>
                    </div>
                    <div className="relative">
                        <Textarea 
                            placeholder="e.g., When the order value exceeds 100 and status is pending..."
                            className="bg-black/40 border-white/10 min-h-[80px] text-xs font-medium focus:ring-primary/20 pr-12"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                        <Button 
                            size="icon" 
                            className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-primary hover:bg-primary/90"
                            onClick={handleTranslate}
                            disabled={translating || !prompt.trim()}
                        >
                            {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        </Button>
                    </div>
                </div>

                {/* Translated Logic */}
                {translatedFilter && (
                    <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary/60 flex items-center gap-2">
                                    <Code className="w-3.5 h-3.5" /> Synthesized Logic
                                </Label>
                                <span className="text-[9px] text-muted-foreground font-mono">filter engine ready</span>
                            </div>
                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 font-mono text-[11px] text-primary group relative">
                                {translatedFilter}
                                <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                            </div>
                        </div>

                        {/* Simulation Area */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Mock Payload (JSON)</Label>
                                <Textarea 
                                    className="bg-black/60 border-white/5 h-[120px] font-mono text-[10px] text-foreground/70"
                                    value={mockPayload}
                                    onChange={(e) => setMockPayload(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Simulation Result</Label>
                                <div className="h-[120px] rounded-xl bg-black/60 border border-white/5 flex flex-col items-center justify-center p-4 text-center">
                                    {simulating ? (
                                        <Loader2 className="w-6 h-6 animate-spin text-primary/40" />
                                    ) : simResult ? (
                                        <div className="space-y-2">
                                            {simResult.error ? (
                                                <>
                                                    <XCircle className="w-8 h-8 text-red-500 mx-auto" />
                                                    <p className="text-[10px] text-red-400 font-bold uppercase">{simResult.error}</p>
                                                </>
                                            ) : simResult.match ? (
                                                <>
                                                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                                                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Logic: MATCHED</p>
                                                    <p className="text-[9px] text-muted-foreground italic">Pipeline would trigger</p>
                                                </>
                                            ) : (
                                                <>
                                                    <XCircle className="w-8 h-8 text-amber-500/40 mx-auto" />
                                                    <p className="text-[10px] text-amber-500/60 font-bold uppercase tracking-widest">Logic: FILTERED</p>
                                                    <p className="text-[9px] text-muted-foreground italic">Pipeline would ignore</p>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-2 opacity-30">
                                            <Terminal className="w-6 h-6 mx-auto" />
                                            <p className="text-[9px] font-bold uppercase">Ready for test</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button 
                                variant="outline" 
                                className="flex-1 rounded-full border-white/10 text-[10px] font-black uppercase tracking-widest h-10 hover:bg-foreground/5"
                                onClick={handleSimulate}
                                disabled={simulating}
                            >
                                <Play className="w-3.5 h-3.5 mr-2" /> Run Simulation
                            </Button>
                            <Button 
                                className="flex-1 rounded-full bg-primary hover:bg-primary/90 text-[10px] font-black uppercase tracking-widest h-10 shadow-lg shadow-primary/20"
                                onClick={() => {
                                    if (onTriggerCreated) onTriggerCreated({ filterCondition: translatedFilter, prompt });
                                    toast({ title: "Trigger Committed", description: "Strategic sentinel logic active." });
                                    setTranslatedFilter(null);
                                    setPrompt("");
                                }}
                            >
                                <Zap className="w-3.5 h-3.5 mr-2" /> Deploy Trigger
                            </Button>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 pt-2 opacity-40">
                    <Info className="w-3 h-3" />
                    <span className="text-[8px] font-bold uppercase tracking-[0.1em] italic">The Sentinel uses System 2 reasoning to map intent to technical boolean algebra.</span>
                </div>
            </CardContent>
        </Card>
    );
}
