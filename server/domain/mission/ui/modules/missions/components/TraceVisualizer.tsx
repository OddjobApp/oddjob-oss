import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Activity, CheckCircle2, XCircle } from 'lucide-react';

interface TraceVisualizerProps {
    dynamicTrace: any[];
}

export function TraceVisualizer({ dynamicTrace = [] }: TraceVisualizerProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (isPlaying && currentStep < dynamicTrace.length - 1) {
            timer = setTimeout(() => {
                setCurrentStep(prev => prev + 1);
            }, 1000); // Step every 1 second
        } else if (currentStep >= dynamicTrace.length - 1) {
            setIsPlaying(false);
        }
        return () => clearTimeout(timer);
    }, [isPlaying, currentStep, dynamicTrace.length]);

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleReset = () => {
        setCurrentStep(0);
        setIsPlaying(false);
    };
    const handleNext = () => {
        if (currentStep < dynamicTrace.length - 1) {
            setCurrentStep(currentStep + 1);
        }
    };
    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const currentItem = dynamicTrace[currentStep] || {};

    return (
        <Card className="bg-card/40 border border-foreground/5 overflow-hidden shadow-2xl rounded-[3rem] backdrop-blur-3xl">
            <CardHeader className="bg-muted/30 border-b border-border/50 flex flex-row items-center justify-between py-6 px-8">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-[1rem] bg-primary/10 flex items-center justify-center border border-primary/20">
                        <Activity className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary block mb-1">Trace Visualizer</span>
                        <CardTitle className="text-foreground text-xl tracking-tight uppercase font-black italic">Execution Replay</CardTitle>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={handlePrev} disabled={currentStep === 0}>
                        <SkipBack className="w-4 h-4" />
                    </Button>
                    {isPlaying ? (
                        <Button variant="outline" size="icon" onClick={handlePause}>
                            <Pause className="w-4 h-4" />
                        </Button>
                    ) : (
                        <Button variant="outline" size="icon" onClick={handlePlay} disabled={dynamicTrace.length === 0 || currentStep >= dynamicTrace.length - 1}>
                            <Play className="w-4 h-4" />
                        </Button>
                    )}
                    <Button variant="outline" size="icon" onClick={handleNext} disabled={dynamicTrace.length === 0 || currentStep >= dynamicTrace.length - 1}>
                        <SkipForward className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleReset}>
                        <RotateCcw className="w-4 h-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-8">
                <div className="mb-6">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                        <span>Step {dynamicTrace.length > 0 ? currentStep + 1 : 0} of {dynamicTrace.length}</span>
                        <span>{currentItem.timestamp ? new Date(currentItem.timestamp).toLocaleTimeString() : "N/A"}</span>
                    </div>
                    <input 
                        type="range" 
                        min="0" 
                        max={Math.max(0, dynamicTrace.length - 1)} 
                        value={currentStep} 
                        onChange={(e) => setCurrentStep(parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                        disabled={dynamicTrace.length === 0}
                    />
                </div>

                <div className="p-6 rounded-[1.5rem] bg-muted/20 border border-border/40 min-h-[200px]">
                    <div className="flex items-center justify-between mb-4">
                        <Badge className="bg-primary/10 text-primary border border-primary/20 font-black text-[10px] tracking-[0.3em] uppercase px-3 py-1 rounded-full">
                            {currentItem.event || currentItem.type || "N/A"}
                        </Badge>
                        {currentItem.status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                        {currentItem.status === 'failure' && <XCircle className="w-5 h-5 text-red-500" />}
                    </div>
                    <div className="text-[13px] text-foreground/80 font-mono leading-relaxed bg-background/50 p-4 rounded-[1rem] border border-border/40 break-words shadow-inner">
                        {typeof (currentItem.note || currentItem.data) === 'string' 
                            ? (currentItem.note || currentItem.data) 
                            : JSON.stringify(currentItem.note || currentItem.data, null, 2)}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
