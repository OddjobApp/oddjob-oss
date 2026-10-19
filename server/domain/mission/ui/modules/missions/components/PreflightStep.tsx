import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { formSchema } from '../types/index.js';
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@domain-ui/core/ui/components/ui/sheet";
import { AlertTriangle, MessageSquareCode, Plus, Send, Terminal } from "lucide-react";

interface PreflightStepProps {
    dependencyResults: any;
    commandUplinkOpen: boolean;
    setCommandUplinkOpen: (val: boolean) => void;
    uplinkChat: any[];
    setUplinkChat: React.Dispatch<React.SetStateAction<any[]>>;
    uplinkInput: string;
    setUplinkInput: (val: string) => void;
    toast: any;
    synthesizeMutation: any;
    setCurrentStep: (step: number) => void;
    prevStep: () => void;
}

export function PreflightStep({
    dependencyResults,
    commandUplinkOpen,
    setCommandUplinkOpen,
    uplinkChat,
    setUplinkChat,
    uplinkInput,
    setUplinkInput,
    toast,
    synthesizeMutation,
    setCurrentStep,
    prevStep
}: PreflightStepProps) {
    const handleSend = () => {
        const val = uplinkInput.trim();
        if (!val) return;
        setUplinkChat(prev => [...prev, { role: 'user', content: val }]);
        setUplinkInput("");
        // Mock response for now to demonstrate UI
        setTimeout(() => {
            setUplinkChat(prev => [...prev, {
                role: 'assistant',
                content: `I've analyzed the ${dependencyResults?.missing?.[0]?.missingType || 'current'} blocker. You should proceed with the ${dependencyResults?.missing?.[0]?.remediation?.action || 'suggested'} remediation path or add a complementary agent to verify the output.`
            }]);
        }, 800);
    };

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 mb-2">
                <div className="flex items-center justify-between mb-3 text-amber-500">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        <h4 className="font-bold text-sm uppercase font-mono tracking-wider">Dependency Analysis</h4>
                    </div>
                    <Sheet open={commandUplinkOpen} onOpenChange={setCommandUplinkOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-[10px] border-amber-500/30 text-amber-500 hover:bg-amber-500/10 font-mono">
                                <MessageSquareCode className="w-3 h-3 mr-1" />
                                CONSULT MISSION COMMAND
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[400px] sm:w-[540px] bg-background border-border p-0 flex flex-col">
                            <SheetHeader className="p-6 border-b border-border">
                                <SheetTitle className="flex items-center gap-2 text-primary font-mono uppercase tracking-widest text-sm">
                                    <Terminal className="w-4 h-4" />
                                    Diagnostic Uplink
                                </SheetTitle>
                                <SheetDescription className="text-[10px] font-mono uppercase opacity-50">
                                    Consult mission command to resolve architecture blockers
                                </SheetDescription>
                            </SheetHeader>
                            <ScrollArea className="flex-1 p-6">
                                <div className="space-y-4">
                                    <div className="p-3 bg-card/50 border border-border rounded text-[11px] font-mono text-muted-foreground">
                                        <p className="text-amber-500 mb-2 font-bold select-none">&gt; ANALYZING BLOCKERS...</p>
                                        {dependencyResults?.missing?.map((m: any, i: number) => (
                                            <p key={i} className="mb-1 opacity-80">- MISSING_{m.missingType.toUpperCase()}: {m.message}</p>
                                        )) || <p>NO BLOCKERS DETECTED</p>}
                                    </div>

                                    {uplinkChat.map((msg, i) => (
                                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] p-3 rounded-lg text-xs leading-relaxed ${msg.role === 'user'
                                                ? 'bg-muted text-foreground'
                                                : 'bg-primary/10 border border-primary/20 text-primary font-mono'
                                                }`}>
                                                {msg.content}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                            <div className="p-4 bg-card/50 border-t border-border flex gap-2">
                                <Input
                                    value={uplinkInput}
                                    onChange={(e) => setUplinkInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSend();
                                    }}
                                    placeholder="Type directive..."
                                    className="bg-background border-border text-xs font-mono"
                                />
                                <Button size="icon" className="bg-primary shrink-0" onClick={handleSend}>
                                    <Send className="w-4 h-4" />
                                </Button>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed font-mono opacity-80">
                    Oddjob has performed a deep-scan of your team architecture. {dependencyResults?.missing?.length > 0 ? "Potential mission-critical blockers identified." : "Architecture verified stable."}
                </p>
            </div>

            <ScrollArea className="h-[250px] pr-4">
                <div className="space-y-3">
                    {dependencyResults?.missing?.length > 0 ? (
                        dependencyResults.missing.map((b: any, i: number) => (
                            <div key={i} className="flex flex-col gap-2 p-3 bg-card border border-border rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-500 font-mono py-0 h-4">
                                            {b.missingType.toUpperCase()}
                                        </Badge>
                                        <span className="text-xs font-bold text-foreground">{b.message}</span>
                                    </div>
                                </div>
                                {b.remediation && (
                                    <div className="flex justify-end pt-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-[10px] border-primary/30 text-primary hover:bg-primary/10"
                                            onClick={() => {
                                                if (b.remediation.action === 'create_credential') {
                                                    toast({ title: "Redirecting", description: `Please create a ${b.remediation.type || 'credential'} in the Credentials tab.` });
                                                } else if (b.remediation.action === 'synthesize_agent') {
                                                    synthesizeMutation.mutate({ role: "Missing Reference", index: -1 });
                                                }
                                            }}
                                        >
                                            <Plus className="w-3 h-3 mr-1" />
                                            {b.remediation.action.replace('_', ' ').toUpperCase()}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[150px] text-emerald-500 bg-emerald-500/5 rounded-xl border border-emerald-500/20 border-dashed">
                            <Badge className="bg-emerald-500 dark:text-white text-foreground mb-2">VALIDATED</Badge>
                            <p className="text-xs font-bold uppercase font-mono">All dependencies resolved</p>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className="flex justify-between pt-4 border-t border-border">
                <Button variant="ghost" onClick={prevStep} className="text-muted-foreground hover:text-foreground uppercase text-[10px] font-bold">
                    Back to Team
                </Button>
                <Button
                    onClick={() => setCurrentStep(4)}
                    disabled={dependencyResults?.missing?.length > 0}
                    className={`${dependencyResults?.missing?.length > 0 ? "bg-muted" : "bg-primary shadow-[0_0_20px_rgba(205,127,50,0.3)]"} hover:bg-primary/90 font-bold uppercase text-xs`}
                >
                    Review & Launch
                </Button>
            </div>
        </div>
    );
}
