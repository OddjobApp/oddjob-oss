import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { 
  Activity, 
  GitBranch, 
  Clock, 
  ChevronRight, 
  Database, 
  Zap, 
  MessageSquare, 
  FileText,
  AlertCircle,
  Loader2,
  RefreshCcw,
  ArrowLeft
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface WorkstreamNode {
  id: string;
  type: string;
  label: string;
  sourceType: string;
  createdAt: string;
}

interface Workstream {
  id: string;
  name: string;
  type: 'mission' | 'source';
  status: 'active' | 'completed' | 'failed' | 'idle';
  lastActivity: string;
  nodes: WorkstreamNode[];
}

export default function WorkstreamFeed() {
  const [, setLocation] = useLocation();
  
  const { data: workstreams, isLoading, error, refetch, isFetching } = useQuery<Workstream[]>({
    queryKey: ["/api/workstreams"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workstreams");
      return res.json();
    },
    refetchInterval: 10000 // Poll every 10 seconds
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] text-muted-foreground">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="font-medium animate-pulse tracking-widest uppercase text-xs">Aggregating Temporal Telemetry...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive/20 bg-destructive/5 backdrop-blur-xl">
          <CardHeader>
            <div className="flex items-center gap-3 text-destructive mb-2">
              <AlertCircle className="w-6 h-6" />
              <CardTitle>Telemetry Link Severed</CardTitle>
            </div>
            <CardDescription>{(error as any).message || "Failed to fetch workstream data"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => refetch()} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Attempt Reconnection
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getSourceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'slack': return <MessageSquare className="w-4 h-4 text-blue-400" />;
      case 'jira': return <Zap className="w-4 h-4 text-primary" />;
      case 'confluence': return <FileText className="w-4 h-4 text-emerald-400" />;
      default: return <Database className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'running':
        return <Badge className="bg-primary/20 text-primary border-primary/30 animate-pulse">LIVE</Badge>;
      case 'completed':
        return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">NOMINAL</Badge>;
      case 'failed':
      case 'error':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30">FAULT</Badge>;
      case 'waiting_on_human':
      case 'waiting_on_file':
      case 'paused':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">WAITING</Badge>;
      default:
        return <Badge variant="outline" className="opacity-50">IDLE</Badge>;
    }
  };

  const safeFormatDistance = (dateStr: string | null | undefined) => {
    try {
      if (!dateStr) return "recently";
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return "recently";
      return formatDistanceToNow(date) + " ago";
    } catch (e) {
      return "recently";
    }
  };

  const safeFormatTime = (dateStr: string | null | undefined) => {
    try {
      if (!dateStr) return "--:--";
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return "--:--";
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return "--:--";
    }
  };

  return (
    <div className="max-w-full mx-auto px-4 py-6 space-y-6 animate-in fade-in duration-700">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/dashboard")}
            className="rounded-full hover:bg-foreground/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-4xl font-black tracking-tighter uppercase italic text-foreground flex items-center gap-3">
              <GitBranch className="w-10 h-10 text-primary" />
              Workstream Feed
            </h1>
            <p className="text-muted-foreground font-bold tracking-[0.2em] uppercase text-[10px] opacity-70">
              Real-time temporal knowledge graph telemetry.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-primary/50" />}
          <Button 
            onClick={() => refetch()} 
            variant="outline" 
            className="bg-foreground/5 border-foreground/10 hover:bg-foreground/10 text-xs font-black uppercase tracking-widest"
          >
            <RefreshCcw className="w-3 h-3 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {workstreams?.length === 0 ? (
          <Card className="bg-foreground/5 border-foreground/10 border-dashed py-12 flex flex-col items-center justify-center text-center">
            <Activity className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-lg font-bold text-muted-foreground">No Active Workstreams</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Launch a new mission or integrate SaaS sources to see real-time telemetry here.
            </p>
          </Card>
        ) : (
          workstreams?.map((ws) => (
            <Card key={ws.id} className="bg-foreground/5 border-foreground/10 hover:border-primary/30 transition-all group overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-foreground/5 border border-foreground/10`}>
                    {ws.type === 'mission' ? <Activity className="w-5 h-5 text-primary" /> : <Database className="w-5 h-5 text-blue-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">{ws.name}</CardTitle>
                      {getStatusBadge(ws.status)}
                    </div>
                    <CardDescription className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-60">
                      <Clock className="w-3 h-3" />
                      Updated {safeFormatDistance(ws.lastActivity)}
                    </CardDescription>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary"
                  onClick={() => setLocation(ws.type === 'mission' ? `/operations/missions/${ws.id}` : `/connections/saas`)}
                >
                  Inspect <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {ws.nodes?.map((node) => (
                      <div 
                        key={node.id} 
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 hover:border-primary/20 transition-colors cursor-default"
                        title={`${node.type}: ${node.label}`}
                      >
                        {getSourceIcon(node.sourceType)}
                        <span className="text-[10px] font-bold uppercase tracking-tighter text-foreground">{node.label}</span>
                        <span className="text-[8px] text-muted-foreground font-mono">{safeFormatTime(node.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
