import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
  Plus,
  Network,
  RefreshCw,
  Activity,
  ShieldCheck,
  Zap,
  ArrowRightLeft,
  Settings2,
  Database,
  Link,
  Cpu,
  Unlink,
  Radio
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";

import { SyncOverview } from "@domain-ui/ecommerce/ui/components/saas/SyncOverview";
import { SyncList } from "@domain-ui/ecommerce/ui/components/saas/SyncList";
import { SyncMonitoring } from "@domain-ui/ecommerce/ui/components/saas/SyncMonitoring";
import { IntegrationOnboarding } from "@domain-ui/ecommerce/ui/components/saas/IntegrationOnboarding";
import { SyncConfiguration as ISyncConfig, Connector, SyncFormData } from "@domain-ui/ecommerce/ui/components/saas/types";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";

const DEFAULT_SYNC_DATA: SyncFormData = {
  platform: "",
  enabled: true,
  sync_interval: 15,
  conflict_resolution: "last_write_wins",
  field_mappings: "{}",
  filters: "{}"
};

export default function SyncConfiguration() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [editingSync, setEditingSync] = useState<ISyncConfig | null>(null);
  const [syncForm, setSyncForm] = useState<SyncFormData>(DEFAULT_SYNC_DATA);
  const { selectedOrgId } = useOrgContext();
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

  // Fetch sync configurations
  const { data: syncConfigs = [], isLoading: syncsLoading } = useQuery<ISyncConfig[]>({
    queryKey: ['/api/saas/sync-configs'],
    queryFn: async () => {
      const res = await fetch('/api/saas/sync-configs');
      if (!res.ok) throw new Error('Failed to fetch sync configs');
      return res.json();
    },
  });

  // Create/Update sync mutation
  const syncMutation = useMutation({
    mutationFn: async (data: SyncFormData) => {
      const payload = {
        enabled: data.enabled,
        sync_interval: data.sync_interval,
        conflict_resolution: data.conflict_resolution,
        field_mappings: JSON.parse(data.field_mappings),
        filters: JSON.parse(data.filters)
      };

      return apiRequest('POST', `/api/saas/connectors/${data.platform}/sync-config`, payload);
    },
    onSuccess: () => {
      toast({
        title: editingSync ? "LINKAGE_RECALIBRATED" : "BIDIRECTIONAL_UPLINK_ESTABLISHED",
        description: `High-fidelity synchronization state achieved for ${syncForm.platform}.`,
      });
      setIsSyncDialogOpen(false);
      setEditingSync(null);
      setSyncForm(DEFAULT_SYNC_DATA);
      queryClient.invalidateQueries({ queryKey: ['/api/saas/sync-configs'] });
    },
    onError: (error: any) => {
      toast({
        title: "SIGNAL_INTERRUPTION",
        description: error.message || "Target bridge rejected the synchronization handshake.",
        variant: "destructive",
      });
    },
  });

  const handleCreateSync = () => {
    setEditingSync(null);
    setSyncForm(DEFAULT_SYNC_DATA);
    setIsSyncDialogOpen(true);
  };

  const handleEditSync = (sync: ISyncConfig) => {
    setEditingSync(sync);
    setSyncForm({
      platform: sync.platform,
      enabled: sync.enabled,
      sync_interval: sync.sync_interval,
      conflict_resolution: sync.conflict_resolution,
      field_mappings: JSON.stringify(sync.field_mappings, null, 2),
      filters: JSON.stringify(sync.filters, null, 2)
    });
    setIsSyncDialogOpen(true);
  };

  const handleSaveSync = () => {
    try {
      JSON.parse(syncForm.field_mappings);
      JSON.parse(syncForm.filters);
    } catch (e) {
      toast({
        title: "DATA_PARITY_ERROR",
        description: "Malformed configuration detected. Check JSON integrity.",
        variant: "destructive",
      });
      return;
    }

    if (!syncForm.platform) {
      toast({
        title: "TARGET_MISSING",
        description: "Specify a valid neural bridge for the synchronization linkup.",
        variant: "destructive",
      });
      return;
    }

    syncMutation.mutate(syncForm);
  };

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
              <Radio className="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
              Direct Linkage v2.0
            </div>
            <div className="space-y-2">
              <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                Bidirectional <span className="text-primary font-light not-italic tracking-[-0.05em]">Data Linkups</span>
              </h1>
              <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                Establish high-frequency synchronization tunnels with external platforms for seamless data parity.
              </p>
            </div>
          </div>
          <Button 
            onClick={handleCreateSync}
            className="h-16 px-10 rounded-[2rem] bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all active:scale-95 group"
          >
            <Link className="w-5 h-5 mr-3 group-hover:rotate-45 transition-transform" />
            Initialize Linkup
          </Button>
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-10">
          <TabsList className="bg-foreground/[0.03] border border-foreground/10 p-1.5 rounded-2xl backdrop-blur-xl inline-flex">
            <TabsTrigger value="overview" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Overview</TabsTrigger>
            <TabsTrigger value="links" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Active Grid</TabsTrigger>
            <TabsTrigger value="monitoring" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Live Handshakes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
             <SyncOverview syncConfigs={syncConfigs} connectors={connectors} />
          </TabsContent>

          <TabsContent value="links">
             <SyncList 
                syncConfigs={syncConfigs} 
                onEdit={handleEditSync} 
                isLoading={syncsLoading}
             />
          </TabsContent>

          <TabsContent value="monitoring">
             <SyncMonitoring />
          </TabsContent>
        </Tabs>
      </main>

      {/* Integration Onboarding Flow */}
      <IntegrationOnboarding 
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
        connectors={connectors}
        onComplete={(data) => {
          setSyncForm(data);
          syncMutation.mutate(data);
        }}
      />
    </div>
  );
}
