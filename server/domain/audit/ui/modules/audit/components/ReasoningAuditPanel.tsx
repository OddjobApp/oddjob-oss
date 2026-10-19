
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { 
  ShieldCheck, 
  AlertTriangle, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Terminal,
  ChevronDown,
  ChevronUp,
  FileCode,
  ShieldAlert
} from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from "@/lib/utils";

interface ReasoningAuditEntry {
  id: number;
  traceId: string;
  reasoningProtocol: string;
  rawReasoning: string;
  status: 'pending' | 'flagged' | 'safe';
  severity: number;
  createdAt: string;
}

interface ReasoningAuditPanelProps {
  audits: ReasoningAuditEntry[];
  onAuditAction?: (auditId: number, action: 'safe' | 'flagged', notes?: string) => void;
}

export const ReasoningAuditPanel: React.FC<ReasoningAuditPanelProps> = ({ audits, onAuditAction }) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'safe': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'flagged': return <ShieldAlert className="w-4 h-4 text-red-500" />;
      default: return <AlertTriangle className="w-4 h-4 text-amber-500 opacity-50" />;
    }
  };

  const getSeverityColor = (severity: number) => {
    if (severity > 7) return "text-red-500";
    if (severity > 4) return "text-amber-500";
    return "text-emerald-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-lg shadow-primary/10">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/60 block pb-1">Safety & Compliance</span>
            <h3 className="text-xl font-black text-foreground uppercase italic tracking-tight">Reasoning Audit Log</h3>
          </div>
        </div>
        <div className="flex gap-2">
           <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-black text-[9px] uppercase tracking-widest px-4 py-1.5 rounded-full">
             SAFE: {audits.filter(a => a.status === 'safe').length}
           </Badge>
           <Badge className="bg-red-500/10 text-red-500 border-red-500/20 font-black text-[9px] uppercase tracking-widest px-4 py-1.5 rounded-full">
             FLAGGED: {audits.filter(a => a.status === 'flagged').length}
           </Badge>
        </div>
      </div>

      <div className="space-y-4">
        {audits.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-foreground/5 rounded-[3rem] bg-foreground/[0.01]">
             <Search className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
             <p className="text-xs font-black uppercase tracking-widest text-muted-foreground/40 italic">No reasoning segments captured for this run</p>
          </div>
        ) : (
          audits.map((audit) => (
            <Card 
              key={audit.id} 
              className={cn(
                "bg-card/40 border transition-all duration-300 rounded-[2rem] overflow-hidden",
                audit.status === 'flagged' ? "border-red-500/30 shadow-lg shadow-red-500/5" : "border-foreground/5 hover:border-primary/20"
              )}
            >
              <div 
                className="p-6 flex items-center justify-between cursor-pointer group"
                onClick={() => setExpandedId(expandedId === audit.id ? null : audit.id)}
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner transition-colors",
                    audit.status === 'flagged' ? "bg-red-500/10 border-red-500/20" : "bg-primary/10 border-primary/20"
                  )}>
                    {getStatusIcon(audit.status)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                       <span className={cn("text-[9px] font-black uppercase tracking-widest", getSeverityColor(audit.severity))}>
                         Severity {audit.severity}/10
                       </span>
                       <span className="text-[10px] text-muted-foreground/40 font-bold">•</span>
                       <span className="text-[10px] text-muted-foreground/40 font-black uppercase tracking-widest">
                         {new Date(audit.createdAt).toLocaleTimeString()}
                       </span>
                    </div>
                    <h4 className="text-[12px] font-black uppercase tracking-tight text-foreground truncate max-w-md">
                      Protocol: <span className="text-primary italic">{audit.reasoningProtocol}</span>
                    </h4>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                   <div className="text-[9px] font-mono text-muted-foreground/40 uppercase bg-background/40 px-3 py-1 rounded-full border border-foreground/5">
                     TRACE: {audit.traceId.substring(0, 8)}...
                   </div>
                   {expandedId === audit.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />}
                </div>
              </div>

              {expandedId === audit.id && (
                <div className="px-8 pb-8 pt-2 animate-in slide-in-from-top-2 duration-300">
                   <div className="relative group/code">
                      <div className="absolute top-4 right-4 z-20">
                         <div className="flex gap-2">
                           <Button 
                             size="sm" 
                             variant="outline" 
                             className="h-8 bg-emerald-500 text-foreground border-none font-black text-[9px] uppercase tracking-widest px-4 rounded-xl hover:bg-emerald-400"
                             onClick={(e) => { e.stopPropagation(); onAuditAction?.(audit.id, 'safe'); }}
                           >
                             <CheckCircle2 className="w-3 h-3 mr-2" /> Mark safe
                           </Button>
                           <Button 
                             size="sm" 
                             variant="outline" 
                             className="h-8 bg-red-500 text-foreground border-none font-black text-[9px] uppercase tracking-widest px-4 rounded-xl hover:bg-red-400"
                             onClick={(e) => { e.stopPropagation(); onAuditAction?.(audit.id, 'flagged'); }}
                           >
                             <AlertTriangle className="w-3 h-3 mr-2" /> Flag
                           </Button>
                         </div>
                      </div>
                      
                      <ScrollArea className="h-[300px] w-full bg-background/60 rounded-[1.5rem] border border-foreground/5 font-mono text-[11px] leading-relaxed relative">
                         <div className="p-6">
                            <div className="flex items-center gap-2 mb-4 text-muted-foreground/30">
                               <Terminal className="w-3 h-3" />
                               <span className="uppercase font-black text-[9px] tracking-widest">Raw Reasoning Segment</span>
                            </div>
                            <pre className="whitespace-pre-wrap text-emerald-400/90 selection:bg-emerald-500/20">
                               {audit.rawReasoning}
                            </pre>
                         </div>
                      </ScrollArea>
                      
                      <div className="mt-6 flex items-start gap-3 p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                         <FileCode className="w-4 h-4 text-primary mt-1 opacity-40 shrink-0" />
                         <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                            System analyzed this segment using **Dynamic Policy Guard**. No immediate rule violations detected, but high impact keywords (e.g. 'delete', 'execute', 'overwrite') may have triggered capture.
                         </p>
                      </div>
                   </div>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
