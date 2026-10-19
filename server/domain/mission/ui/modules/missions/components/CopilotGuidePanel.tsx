import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Bot, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { OddjobCanonicalDemo, OddjobCopilotGuide } from "@shared/product/oddjob-capability-manifest";

type CopilotGuideResponse = {
    copilotGuide: OddjobCopilotGuide;
    canonicalDemos: OddjobCanonicalDemo[];
};

interface CopilotGuidePanelProps {
    onUsePrompt: (prompt: string) => void;
}

export function CopilotGuidePanel({ onUsePrompt }: CopilotGuidePanelProps) {
    const { data, isLoading, isError } = useQuery<CopilotGuideResponse>({
        queryKey: ["/api/system/copilot-guide"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/system/copilot-guide");
            return res.json();
        },
        staleTime: 5 * 60 * 1000,
    });

    const guidedDemos = useMemo(() => {
        if (!data) return [];
        const flowIds = new Set(data.copilotGuide.guidedFlows);
        return data.canonicalDemos.filter((demo) => flowIds.has(demo.id));
    }, [data]);

    const commands = data?.copilotGuide.commands.slice(0, 4) ?? [];

    if (isLoading) {
        return (
            <div className="mb-6 rounded-2xl border border-border bg-card/60 p-4">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted/60" />)}
                </div>
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4" />
                Copilot guide is unavailable. You can still create a mission manually.
            </div>
        );
    }

    return (
        <section className="mb-6 rounded-2xl border border-border bg-card/60 p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="max-w-3xl">
                    <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-black uppercase tracking-wider text-foreground">Copilot Mission Guide</h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.copilotGuide.firstRunPrompt}</p>
                </div>
                <Badge variant="outline" className="w-fit border-primary/40 text-[10px] uppercase tracking-wider text-primary">
                    Governed mode
                </Badge>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
                {guidedDemos.map((demo) => (
                    <button
                        key={demo.id}
                        type="button"
                        onClick={() => onUsePrompt(demo.guidedPrompt)}
                        className="rounded-xl border border-border bg-background/70 p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <h4 className="text-sm font-semibold text-foreground">{demo.title}</h4>
                            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{demo.outcome}</p>
                        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                            Use guided prompt
                        </div>
                    </button>
                ))}
            </div>

            <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {commands.map((command) => (
                    <div key={command.id} className="rounded-xl border border-border bg-background/50 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">{command.label}</span>
                            {command.requiresApproval ? (
                                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                            ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{command.intent}</p>
                        <div className="mt-3 flex items-center gap-2">
                            <Badge
                                variant="outline"
                                className={cn(
                                    "h-5 text-[9px] uppercase",
                                    command.riskLevel === "high" && "border-red-500/40 text-red-500",
                                    command.riskLevel === "medium" && "border-amber-500/40 text-amber-500",
                                    command.riskLevel === "low" && "border-green-500/40 text-green-500",
                                )}
                            >
                                {command.riskLevel}
                            </Badge>
                            {command.requiresApproval && (
                                <Badge variant="outline" className="h-5 border-amber-500/40 text-[9px] uppercase text-amber-500">
                                    approval
                                </Badge>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
