import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { 
  History, 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink,
  Code,
  Activity
} from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';

interface EventLogViewerProps {
  pipelineId: number;
}

export default function EventLogViewer({ pipelineId }: EventLogViewerProps) {
  const [, setLocation] = useLocation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: logs = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/pipelines/${pipelineId}/trigger-logs`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pipelines/${pipelineId}/trigger-logs`);
      return res.json();
    },
    refetchInterval: 5000 // Poll every 5 seconds for new events
  });

  if (isLoading) {
    return (
      <div className="p-12 text-center border border-cyan-500/10 bg-background/20 rounded-lg">
        <Activity className="w-8 h-8 text-cyan-500/50 mx-auto animate-spin mb-3" />
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Intercepting event stream...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tighter text-cyan-400 uppercase italic flex items-center gap-2">
            <History className="w-5 h-5" />
            Event Audit Log
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Live feed of reactive evaluations and triggers</p>
        </div>
      </div>

      <Card className="border-muted-foreground/20 bg-background/40 backdrop-blur-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-cyan-950/20">
            <TableRow className="border-muted-foreground/10 hover:bg-transparent">
              <TableHead className="w-[180px] text-[10px] font-bold text-cyan-500/70 uppercase">Timestamp</TableHead>
              <TableHead className="text-[10px] font-bold text-cyan-500/70 uppercase">Event Type</TableHead>
              <TableHead className="text-[10px] font-bold text-cyan-500/70 uppercase">Result</TableHead>
              <TableHead className="text-[10px] font-bold text-cyan-500/70 uppercase">Outcome</TableHead>
              <TableHead className="text-right text-[10px] font-bold text-cyan-500/70 uppercase">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground uppercase text-[10px] tracking-widest italic">
                  No event activity detected in current cycle
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <React.Fragment key={log.id}>
                  <TableRow 
                    className={`border-muted-foreground/5 hover:bg-cyan-500/5 transition-colors cursor-pointer ${expandedId === log.id ? 'bg-cyan-500/5' : ''}`}
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <TableCell className="text-[10px] text-muted-foreground">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <span className="text-[10px] font-bold text-foreground uppercase">{log.eventType}</span>
                    </TableCell>
                    <TableCell>
                      {log.evaluationResult ? (
                        <Badge variant="outline" className="text-[9px] bg-green-500/10 text-green-400 border-green-500/30 gap-1 px-1">
                          <CheckCircle2 className="w-2 h-2" /> MATCH
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-400 border-red-500/30 gap-1 px-1">
                          <XCircle className="w-2 h-2" /> FILTERED
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge outcome={log.outcome} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:text-cyan-400">
                        {expandedId === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                  <AnimatePresence>
                    {expandedId === log.id && (
                      <TableRow className="bg-background/60 border-none hover:bg-background/60">
                        <TableCell colSpan={5} className="p-0">
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 grid grid-cols-2 gap-4 border-l-2 border-cyan-500/50 m-2 bg-background/50 rounded-r">
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[9px] font-bold text-cyan-500/50 uppercase block mb-1">Payload Context</span>
                                  <ScrollArea className="h-32 w-full bg-background/40 border border-foreground/5 rounded p-2">
                                    <pre className="text-[9px] text-muted-foreground font-mono leading-tight">
                                      {JSON.stringify(log.eventPayload, null, 2)}
                                    </pre>
                                  </ScrollArea>
                                </div>
                              </div>
                              <div className="space-y-4">
                                <div>
                                  <span className="text-[9px] font-bold text-cyan-500/50 uppercase block mb-1">Evaluation Logic</span>
                                  <div className="p-2 bg-background/40 border border-foreground/5 rounded">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Code className="w-3 h-3 text-cyan-500" />
                                      <span className="text-[9px] text-cyan-100 font-mono italic">
                                        {log.filterCondition || 'true'}
                                      </span>
                                    </div>
                                    <div className={`text-[9px] font-bold uppercase mt-1 ${log.evaluationResult ? 'text-green-400' : 'text-red-400'}`}>
                                      Result: {log.evaluationResult ? 'TRUE (TRIGGERED)' : 'FALSE (BLOCKED)'}
                                    </div>
                                  </div>
                                </div>

                                {log.errorMessage && (
                                  <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400">
                                    <div className="flex items-center gap-2 mb-1">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span className="text-[9px] font-bold uppercase">Evaluation Error</span>
                                    </div>
                                    <p className="text-[10px] italic leading-tight">{log.errorMessage}</p>
                                  </div>
                                )}

                                {log.executionId && (
                                  <Button 
                                    size="sm" 
                                    className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-[9px] font-bold uppercase tracking-widest border border-cyan-500/30"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLocation(`/operations/workstream-executions/${log.executionId}`);
                                    }}
                                  >
                                    <ExternalLink className="w-3 h-3 mr-2" />
                                    View Triggered Run
                                  </Button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        </TableCell>
                      </TableRow>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StatusBadge({ outcome }: { outcome: string }) {
  switch (outcome) {
    case 'executed':
      return (
        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/40 text-[9px] uppercase font-bold">
          Pipeline Started
        </Badge>
      );
    case 'filtered':
      return (
        <Badge variant="secondary" className="bg-muted text-muted-foreground border-border text-[9px] uppercase font-bold">
          Filtered
        </Badge>
      );
    case 'debouncing':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/40 text-[9px] uppercase font-bold">
          Debouncing
        </Badge>
      );
    case 'error':
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-[9px] uppercase font-bold">
          System Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[9px] uppercase font-bold">
          {outcome}
        </Badge>
      );
  }
}
