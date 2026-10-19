import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Database, Wrench, FileJson, Layers, Cpu, FileText, Table, Search, ClipboardList, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepLineageProps {
  step: any;
  className?: string;
}

export function StepLineage({ step, className }: StepLineageProps) {
  // Extract tools from metadata or output if available
  const tools = step.metadata?.toolsUsed || [];
  const datasets = step.metadata?.datasetsUsed || [];
  const deliverables = step.metadata?.deliverables || [];
  const jobType = step.jobType || "LOGIC_CORE";

  return (
    <div className={cn("space-y-4 mt-3", className)}>
      {/* Execution Lineage Row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 min-w-[120px]">
          <Layers className="w-3 h-3 text-muted-foreground/40" />
          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Execution:</span>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="h-5 text-[8px] bg-indigo-500/5 border-indigo-500/20 text-indigo-400 font-bold uppercase tracking-tighter px-2">
            <Cpu className="w-2.5 h-2.5 mr-1" />
            {jobType}
          </Badge>

          {tools.length > 0 ? (
            tools.map((tool: string, i: number) => (
              <Badge key={i} variant="outline" className="h-5 text-[8px] bg-emerald-500/5 border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-tighter px-2">
                <Wrench className="w-2.5 h-2.5 mr-1" />
                {tool}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="h-5 text-[8px] bg-zinc-500/5 border-zinc-500/20 text-muted-foreground/60 font-bold uppercase tracking-tighter px-2 italic">
              Standard Logic
            </Badge>
          )}

          {datasets.length > 0 && (
            datasets.map((ds: string, i: number) => (
              <Badge key={i} variant="outline" className="h-5 text-[8px] bg-blue-500/5 border-blue-500/20 text-blue-400 font-bold uppercase tracking-tighter px-2">
                <Database className="w-2.5 h-2.5 mr-1" />
                {ds}
              </Badge>
            ))
          )}
        </div>
      </div>

      {/* Deliverables Row */}
      {deliverables.length > 0 && (
        <div className="flex items-center gap-4 border-t border-border/10 pt-3">
          <div className="flex items-center gap-2 min-w-[120px]">
            <FileText className="w-3 h-3 text-primary/40" />
            <span className="text-[9px] font-black uppercase tracking-widest text-primary/60">Deliverables:</span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {deliverables.map((item: any, i: number) => {
              const Icon = item.type === 'table' ? Table : 
                          item.type === 'capture' ? Search : 
                          item.type === 'jira' ? CheckSquare : 
                          item.type === 'summary' ? ClipboardList : FileJson;
              
              return (
                <Badge 
                  key={i} 
                  variant="outline" 
                  className="h-6 text-[8px] bg-primary/5 border-primary/20 text-primary font-black uppercase tracking-tight px-3 cursor-pointer hover:bg-primary/10 transition-colors"
                >
                  <Icon className="w-3 h-3 mr-2" />
                  {item.label || item.name || "UNNAMED_DELIVERABLE"}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
