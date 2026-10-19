import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { OddjobCopilotCommand, OddjobCopilotGuide } from "@shared/product/oddjob-capability-manifest";

type CopilotGuideResponse = {
  copilotGuide: OddjobCopilotGuide;
};

interface CopilotCommandPaletteProps {
  compact?: boolean;
  onSelectPrompt: (prompt: string) => void;
  surface?: "mission_create" | "mission_chat" | "copilot";
  missionId?: number;
  missionRunId?: number;
}

export function CopilotCommandPalette({ compact = false, onSelectPrompt, surface = "mission_chat", missionId, missionRunId }: CopilotCommandPaletteProps) {
  const { data, isLoading, isError } = useQuery<CopilotGuideResponse>({
    queryKey: ["/api/system/copilot-guide"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/system/copilot-guide");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const commands = useMemo(() => data?.copilotGuide.commands.slice(0, compact ? 3 : 6) ?? [], [compact, data]);
  const trustQuestions = useMemo(() => data?.copilotGuide.trustQuestions.slice(0, compact ? 2 : 4) ?? [], [compact, data]);

  if (isLoading) {
    return <div className="border-t border-border bg-background/60 px-3 py-3 text-[10px] text-muted-foreground">Loading Copilot guidance…</div>;
  }

  if (isError || !data) {
    return <div className="border-t border-border bg-background/60 px-3 py-3 text-[10px] text-amber-600">Copilot guidance is unavailable. Mission chat remains available.</div>;
  }

  if (commands.length === 0 && trustQuestions.length === 0) return null;

  return (
    <div className="border-t border-border bg-background/60 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Copilot Commands</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {commands.map((command) => (
          <button
            key={command.id}
            type="button"
            onClick={() => {
              onSelectPrompt(buildCommandPrompt(command));
              void apiRequest("POST", "/api/system/copilot-guide/commands/events", {
                commandId: command.id,
                surface,
                missionId,
                missionRunId,
              }).catch(() => undefined);
            }}
            className="min-w-[180px] rounded-lg border border-border bg-card/70 p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            title={command.userFacingResult}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-foreground">{command.label}</span>
              {command.requiresApproval ? (
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{command.intent}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "h-4 px-1.5 text-[8px] uppercase",
                  command.riskLevel === "high" && "border-red-500/40 text-red-500",
                  command.riskLevel === "medium" && "border-amber-500/40 text-amber-500",
                  command.riskLevel === "low" && "border-green-500/40 text-green-500",
                )}
              >
                {command.riskLevel}
              </Badge>
              <span className="truncate text-[8px] uppercase tracking-wider text-muted-foreground">
                {command.pillar}
              </span>
            </div>
          </button>
        ))}
      </div>
      {trustQuestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {trustQuestions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectPrompt(item.question)}
              className="rounded-full border border-border px-2 py-1 text-[9px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {item.question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function buildCommandPrompt(command: OddjobCopilotCommand) {
  const approval = command.requiresApproval
    ? "Explain the approval requirement, affected objects, and what changes if I approve before taking action."
    : "Show the evidence and recommended next step before taking action.";
  return `${command.label}: ${command.intent} ${approval}`;
}
