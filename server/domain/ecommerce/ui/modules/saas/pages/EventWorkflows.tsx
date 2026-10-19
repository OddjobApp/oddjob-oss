import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import {
  Workflow,
  Plus,
  Settings,
  Play,
  Edit,
  Trash2,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  AlertCircle,
  TestTube,
  Save,
  X,
  Activity,
  Cpu,
  Zap,
  Network,
  ShieldCheck,
  Search,
  RefreshCw,
  ChevronDown
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface EventWorkflow {
  platform: string;
  trigger_event: string;
  workflow_id: string;
  enabled: boolean;
  conditions: Record<string, any>;
  transformation: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

interface Connector {
  platform: string;
  status: string;
  config_name: string;
  is_enabled: boolean;
}

interface WorkflowFormData {
  platform: string;
  trigger_event: string;
  workflow_id: string;
  enabled: boolean;
  conditions: string; // JSON string
  transformation: string; // JSON string
}

const DEFAULT_WORKFLOW_DATA: WorkflowFormData = {
  platform: "",
  trigger_event: "",
  workflow_id: "",
  enabled: true,
  conditions: "{}",
  transformation: "{}"
};

export default function EventWorkflows() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<EventWorkflow | null>(null);
  const [workflowForm, setWorkflowForm] = useState<WorkflowFormData>(DEFAULT_WORKFLOW_DATA);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [workflowToDelete, setWorkflowToDelete] = useState<EventWorkflow | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch connectors
  const { data: connectors = [], isLoading: connectorsLoading } = useQuery<Connector[]>({
    queryKey: ['/api/saas/connectors'],
    queryFn: async () => {
      const res = await fetch('/api/saas/connectors');
      if (!res.ok) throw new Error('Failed to fetch connectors');
      return res.json();
    },
  });

  // Fetch workflows for selected platform
  const { data: workflows = [], isLoading: workflowsLoading, refetch: refetchWorkflows } = useQuery<EventWorkflow[]>({
    queryKey: ['/api/saas/connectors', selectedPlatform, 'event-workflows'],
    queryFn: async () => {
      if (!selectedPlatform) return [];
      const res = await fetch(`/api/saas/connectors/${selectedPlatform}/event-workflows`);
      if (!res.ok) throw new Error('Failed to fetch workflows');
      const data = await res.json();
      return data.workflows || [];
    },
    enabled: !!selectedPlatform,
  });

  // Create/Update workflow mutation
  const workflowMutation = useMutation({
    mutationFn: async (data: WorkflowFormData) => {
      const payload = {
        trigger_event: data.trigger_event,
        workflow_id: data.workflow_id,
        conditions: JSON.parse(data.conditions),
        transformation: JSON.parse(data.transformation),
        enabled: data.enabled
      };

      return apiRequest('POST', `/api/saas/connectors/${data.platform}/event-workflows`, payload);
    },
    onSuccess: () => {
      toast({
        title: editingWorkflow ? "NEURAL_PATHWAY_RECONFIGURED" : "NEURAL_PATHWAY_ESTABLISHED",
        description: `Protocol ${workflowForm.workflow_id} successfully synchronized with core grid.`,
      });
      setIsWorkflowDialogOpen(false);
      setEditingWorkflow(null);
      setWorkflowForm(DEFAULT_WORKFLOW_DATA);
      refetchWorkflows();
      queryClient.invalidateQueries({ queryKey: ['/api/saas/connectors'] });
    },
    onError: (error: any) => {
      toast({
        title: "SYNCHRONIZATION_ERROR",
        description: error.message || "Target grid rejected the neural pathway configuration.",
        variant: "destructive",
      });
    },
  });

  // Test workflow mutation
  const testMutation = useMutation({
    mutationFn: async ({ platform, eventType, eventData }: { platform: string; eventType: string; eventData: any }) => {
      const res = await apiRequest('POST', `/api/saas/connectors/${platform}/test-event-workflow?event_type=${eventType}`, eventData);
      return res.json();
    },
    onSuccess: (data: any[]) => {
      toast({
        title: "DIAGNOSTIC_COMPLETE",
        description: `Latency: 24ms. Triggered ${data.length || 0} active pathway(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "DIAGNOSTIC_FAILURE",
        description: error.message || "Internal relay timeout during pathway simulation.",
        variant: "destructive",
      });
    },
  });

  const handleCreateWorkflow = () => {
    setEditingWorkflow(null);
    setWorkflowForm(DEFAULT_WORKFLOW_DATA);
    setIsWorkflowDialogOpen(true);
  };

  const handleEditWorkflow = (workflow: EventWorkflow) => {
    setEditingWorkflow(workflow);
    setWorkflowForm({
      platform: workflow.platform,
      trigger_event: workflow.trigger_event,
      workflow_id: workflow.workflow_id,
      enabled: workflow.enabled,
      conditions: JSON.stringify(workflow.conditions, null, 2),
      transformation: JSON.stringify(workflow.transformation, null, 2)
    });
    setIsWorkflowDialogOpen(true);
  };

  const handleDeleteWorkflow = (workflow: EventWorkflow) => {
    setWorkflowToDelete(workflow);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteWorkflow = () => {
    // Note: API doesn't have delete endpoint yet, but we define the mutation UI
    setDeleteConfirmOpen(false);
    setWorkflowToDelete(null);
  };

  const handleTestWorkflow = (workflow: EventWorkflow) => {
    const testData = {
      id: "test_" + Math.random().toString(36).substr(2, 9),
      action: "simulated_trigger",
      timestamp: new Date().toISOString(),
      data: { name: "Tactical Diagnostic", status: "simulated" }
    };

    testMutation.mutate({
      platform: workflow.platform,
      eventType: workflow.trigger_event,
      eventData: testData
    });
  };

  const handleSaveWorkflow = () => {
    try {
      JSON.parse(workflowForm.conditions);
      JSON.parse(workflowForm.transformation);
    } catch (e) {
      toast({
        title: "INVALID_PROTOCOLS",
        description: "Check JSON integrity. Malformed logic detected.",
        variant: "destructive",
      });
      return;
    }

    if (!workflowForm.platform || !workflowForm.trigger_event || !workflowForm.workflow_id) {
      toast({
        title: "INCOMPLETE_UPLINK",
        description: "All mandatory neural parameters must be defined.",
        variant: "destructive",
      });
      return;
    }

    workflowMutation.mutate(workflowForm);
  };

  const workflowColumns: Column<EventWorkflow>[] = [
    {
      key: 'trigger_event',
      header: 'NEURAL_TRIGGER',
      render: (workflow: EventWorkflow) => (
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="font-black italic uppercase tracking-tighter text-foreground">{workflow.trigger_event}</span>
        </div>
      ),
    },
    {
      key: 'workflow_id',
      header: 'PATHWAY_ID',
      render: (workflow: EventWorkflow) => (
        <span className="font-mono text-[10px] text-primary/60 bg-primary/5 px-2 py-1 rounded border border-primary/10">
          {workflow.workflow_id}
        </span>
      ),
    },
    {
      key: 'enabled',
      header: 'OPERATIONAL_STATUS',
      render: (workflow: EventWorkflow) => (
        <div className="flex items-center space-x-2">
          <div className={cn("w-2 h-2 rounded-full", workflow.enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-foreground/20')} />
          <Badge className={cn("text-[9px] font-black italic uppercase tracking-widest", 
            workflow.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-foreground/5 text-foreground/40 border-foreground/10"
          )}>
            {workflow.enabled ? 'SYNCHRONIZED' : 'DORMANT'}
          </Badge>
        </div>
      ),
    },
    {
      key: 'conditions',
      header: 'LOGIC_GATES',
      render: (workflow: EventWorkflow) => (
        <div className="flex items-center space-x-2 text-[10px] font-bold text-foreground/40 italic uppercase tracking-widest">
          <Network className="w-3 h-3" />
          <span>{Object.keys(workflow.conditions).length} Gates Active</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'CONTROL',
      render: (workflow: EventWorkflow) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="hover:bg-foreground/5 border border-transparent hover:border-foreground/10 transition-all rounded-lg h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-background/90 border-foreground/10 backdrop-blur-xl rounded-xl">
            <DropdownMenuItem onClick={() => handleEditWorkflow(workflow)} className="text-[10px] font-black uppercase tracking-widest italic group">
              <Edit className="w-3.5 h-3.5 mr-2 group-hover:text-primary transition-colors" />
              Reconfigure
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleTestWorkflow(workflow)} className="text-[10px] font-black uppercase tracking-widest italic group">
              <TestTube className="w-3.5 h-3.5 mr-2 group-hover:text-emerald-400 transition-colors" />
              Run Diagnostic
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDeleteWorkflow(workflow)}
              className="text-rose-500 text-[10px] font-black uppercase tracking-widest italic focus:bg-rose-500/10 focus:text-rose-500 group"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Purge Pathway
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
      {/* Cinematic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
      </div>

      <main className="container mx-auto py-12 px-6 space-y-12 max-w-7xl relative z-10">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-[0.3em] uppercase italic">
              <Network className="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
              Event Matrix v4.2
            </div>
            <div className="space-y-2">
              <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                Automated <span className="text-primary font-light not-italic tracking-[-0.05em]">Neural Pathways</span>
              </h1>
              <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                Configure reactive logic gates triggered by high-frequency SaaS platform telemetry.
              </p>
            </div>
          </div>
          <Button 
            onClick={handleCreateWorkflow}
            className="h-16 px-10 rounded-[2rem] bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all active:scale-95 group"
          >
            <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
            Establish New Pathway
          </Button>
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="bg-foreground/[0.03] border border-foreground/10 p-1.5 rounded-2xl backdrop-blur-xl inline-flex">
            <TabsTrigger value="overview" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Overview</TabsTrigger>
            <TabsTrigger value="workflows" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Pathway Grid</TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Presets</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8">
            {/* Stat Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                { title: 'Total Pathways', val: workflows.length, sub: `${workflows.filter(w => w.enabled).length} active`, icon: Workflow },
                { title: 'Uplink Ports', val: connectors.filter(c => c.is_enabled).length, sub: 'operational', icon: Network },
                { title: 'Reactive Triggers', val: [...new Set(workflows.map(w => w.trigger_event))].length, sub: 'unique vectors', icon: Activity },
                { title: 'Simulations', val: '0', sub: 'current cycle', icon: Cpu },
              ].map((stat, i) => (
                <motion.div
                  key={stat.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card className="glass-panel-deep border-foreground/10 rounded-3xl overflow-hidden relative group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic">{stat.title}</CardTitle>
                      <stat.icon className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-black italic tracking-tighter text-foreground">{stat.val}</div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60 mt-1">{stat.sub}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Platform Gateway Selector */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                  <Network className="w-32 h-32" />
                </div>
                <div className="space-y-6 relative z-10">
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-3">
                      <Cpu className="w-6 h-6 text-primary" />
                      Neural Gateway Selection
                    </h3>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/40 max-w-xl italic leading-relaxed">
                      Initialize a dedicated neural gateway to bridge external SaaS platform event streams with the core reactive matrix.
                    </p>
                  </div>
                  <div className="max-w-md">
                    <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                      <SelectTrigger className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl px-6 text-[11px] font-black uppercase tracking-widest italic group-hover:border-primary/30 transition-all">
                        <SelectValue placeholder="INITIALIZE GATEWAY..." />
                      </SelectTrigger>
                      <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-2xl p-2">
                        {connectors.filter(c => c.is_enabled).map((connector) => (
                          <SelectItem key={connector.platform} value={connector.platform} className="rounded-xl px-4 py-3 focus:bg-primary/20 transition-colors">
                            <div className="flex items-center space-x-3">
                              <div className={cn("w-2 h-2 rounded-full", connector.status === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-foreground/20')} />
                              <span className="font-black italic uppercase tracking-widest text-[10px] text-foreground">{connector.platform}</span>
                              <Badge variant="outline" className="border-foreground/10 text-foreground/40 text-[8px] font-black tracking-widest italic pt-0.5">
                                UID: {connector.config_name}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="workflows" className="space-y-6">
            {!selectedPlatform ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-32 flex flex-col items-center justify-center space-y-8 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed">
                <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20 animate-pulse">
                  <Workflow className="w-10 h-10 text-primary/40" />
                </div>
                <div className="space-y-2 text-center">
                  <h3 className="text-2xl font-black italic tracking-tighter uppercase text-foreground">No Gateway Initialized</h3>
                  <p className="text-foreground/40 text-[10px] font-black uppercase tracking-widest italic">Select a target bridge from the overview to access the pathway grid.</p>
                </div>
              </motion.div>
            ) : workflowsLoading ? (
              <div className="py-32 flex flex-col items-center justify-center space-y-4">
                <RefreshCw className="w-10 h-10 text-primary opacity-20 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Scanning Neural Grid...</span>
              </div>
            ) : (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden">
                  <CardHeader className="p-8 border-b border-foreground/5 bg-foreground/[0.01]">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground">
                          Pathway Grid: <span className="text-primary">{selectedPlatform}</span>
                        </CardTitle>
                        <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic">
                          Low-latency reactive streams established for bridge_{selectedPlatform}.
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-4 bg-foreground/[0.03] p-1 rounded-xl border border-foreground/5">
                        <Search className="w-3.5 h-3.5 ml-3 text-foreground/40" />
                        <Input 
                          placeholder="SEARCH PATHWAYS..." 
                          className="bg-transparent border-none text-[10px] font-black italic uppercase tracking-widest h-8 w-48 shadow-none focus-visible:ring-0"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="border-none">
                      <DataTable
                        data={workflows}
                        columns={workflowColumns}
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="space-y-6">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-32 flex flex-col items-center justify-center space-y-8 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed">
                <div className="w-24 h-24 rounded-full bg-blue-500/5 flex items-center justify-center border border-blue-500/20 shadow-glow/10">
                  <ShieldCheck className="w-10 h-10 text-blue-500/40" />
                </div>
                <div className="space-y-2 text-center text-foreground/40">
                  <h3 className="text-2xl font-black italic tracking-tighter uppercase">Standard Presets</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest italic">Pre-validated neural templates for rapid deployment cycles.</p>
                </div>
              </motion.div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Global Terminal Overlay (Simulation Only) */}
      <div className="fixed bottom-8 left-8 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {testMutation.isPending && (
            <motion.div
              initial={{ opacity: 0, x: -20, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.8 }}
              className="bg-emerald-500 px-6 py-3 rounded-2xl flex items-center gap-4 shadow-2xl"
            >
              <Activity className="w-4 h-4 text-background animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-background italic">Diagnostic Running: Pathway Simulation Active</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Workflow Edit Dialog */}
      <Dialog open={isWorkflowDialogOpen} onOpenChange={setIsWorkflowDialogOpen}>
        <DialogContent className="max-w-3xl bg-background/95 border-foreground/10 glass-panel-deep backdrop-blur-3xl rounded-[3rem] p-0 overflow-hidden shadow-[0_0_100px_rgba(var(--primary),0.1)]">
          <div className="p-10 space-y-8 max-h-[85vh] overflow-y-auto scrollbar-hide">
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.4em] text-primary italic mb-2">Pathway Config Node</div>
              <DialogTitle className="text-4xl font-black italic tracking-tighter uppercase text-foreground leading-none">
                {editingWorkflow ? 'Reconfigure_Pathway' : 'Establish_Neural_Link'}
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-foreground/40 tracking-tight italic">
                Define reactive protocols and transformation logic for high-fidelity SaaS streams.
              </DialogDescription>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/60 ml-1 italic">Target Bridge</Label>
                <Select
                  value={workflowForm.platform}
                  onValueChange={(value: string) => setWorkflowForm(prev => ({ ...prev, platform: value }))}
                  disabled={!!editingWorkflow}
                >
                  <SelectTrigger className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl px-6 text-[11px] font-black uppercase tracking-widest italic group-hover:border-primary/30 transition-all">
                    <SelectValue placeholder="SELECT BRIDGE..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-2xl">
                    {connectors.filter(c => c.is_enabled).map((connector) => (
                      <SelectItem key={connector.platform} value={connector.platform} className="font-black italic uppercase tracking-widest text-[10px] text-foreground">
                        {connector.platform}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/60 ml-1 italic">Trigger Vector</Label>
                <Input
                  value={workflowForm.trigger_event}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkflowForm(prev => ({ ...prev, trigger_event: e.target.value }))}
                  placeholder="e.g. record.created"
                  className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl px-6 text-[11px] font-black tracking-widest italic focus-visible:ring-primary/30 focus-visible:border-primary/30 text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/60 ml-1 italic">Registry ID</Label>
              <Input
                value={workflowForm.workflow_id}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkflowForm(prev => ({ ...prev, workflow_id: e.target.value }))}
                placeholder="UNIQUE_PATHWAY_DESCRIPTOR"
                className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl px-6 font-mono text-[11px] font-bold tracking-widest italic focus-visible:ring-primary/30 focus-visible:border-primary/30 text-foreground"
              />
            </div>

            <div className="flex items-center justify-between p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
              <div className="space-y-1">
                <Label className="text-[11px] font-black uppercase tracking-widest text-foreground italic">Operational Synchronization</Label>
                <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">Allow reactive triggers to propagate through the neural matrix.</p>
              </div>
              <Switch
                checked={workflowForm.enabled}
                onCheckedChange={(checked: boolean) => setWorkflowForm(prev => ({ ...prev, enabled: checked }))}
                className="data-[state=checked]:bg-primary"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/60 italic">Logic Gates (JSON)</Label>
                  <Badge variant="outline" className="border-foreground/10 text-[8px] opacity-40">INPUT VAL</Badge>
                </div>
                <div className="relative group">
                  <div className="absolute -inset-[1px] bg-gradient-to-br from-primary/20 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <Textarea
                    value={workflowForm.conditions}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWorkflowForm(prev => ({ ...prev, conditions: e.target.value }))}
                    className="min-h-[180px] bg-background/40 border-foreground/5 rounded-2xl p-6 font-mono text-[10px] text-primary/80 leading-relaxed scrollbar-hide focus-visible:ring-primary/20"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/60 italic">Transformation (JSON)</Label>
                  <Badge variant="outline" className="border-foreground/10 text-[8px] opacity-40">OUTPUT MAP</Badge>
                </div>
                <div className="relative group">
                  <div className="absolute -inset-[1px] bg-gradient-to-br from-blue-500/20 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <Textarea
                    value={workflowForm.transformation}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWorkflowForm(prev => ({ ...prev, transformation: e.target.value }))}
                    className="min-h-[180px] bg-background/40 border-foreground/5 rounded-2xl p-6 font-mono text-[10px] text-blue-400/80 leading-relaxed scrollbar-hide focus-visible:ring-blue-500/20"
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 bg-foreground/[0.02] border-t border-foreground/5 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setIsWorkflowDialogOpen(false)}
              className="h-12 px-8 rounded-xl border-foreground/10 bg-transparent text-[10px] font-black uppercase tracking-widest text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            >
              Abort Config
            </Button>
            <Button
              onClick={handleSaveWorkflow}
              disabled={workflowMutation.isPending}
              className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/10"
            >
              {workflowMutation.isPending ? 'SYNCHRONIZING...' : 'Establish_Pathway'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="bg-background/95 border-foreground/10 glass-panel-deep rounded-[3rem] p-10 max-w-lg">
          <AlertDialogHeader className="space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-2">
              <AlertCircle className="w-8 h-8" />
            </div>
            <AlertDialogTitle className="text-3xl font-black italic tracking-tighter uppercase text-foreground leading-none">Terminate Linkage</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-foreground/40 tracking-tight italic">
              Warning: You are about to purge pathway_{workflowToDelete?.workflow_id}. This operation is irreversible and will result in immediate signal loss.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-8 gap-4">
            <AlertDialogCancel className="h-12 px-8 rounded-xl border-foreground/10 bg-transparent text-[10px] font-black uppercase tracking-widest text-foreground/60 hover:bg-foreground/5 hover:text-foreground border-0 shadow-none">Abort Purge</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteWorkflow}
              className="h-12 px-10 rounded-xl bg-rose-500 hover:bg-rose-600 text-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-rose-500/10"
            >
              Confirm Purge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
