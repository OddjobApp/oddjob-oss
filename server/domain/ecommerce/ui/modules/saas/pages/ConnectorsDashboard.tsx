import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import {
  Plus,
  Globe,
  Zap,
  CheckCircle,
  XCircle,
  AlertCircle,
  Settings,
  BarChart3,
  RefreshCw,
  Workflow,
  ArrowRightLeft,
  ExternalLink,
  Play,
  Save,
  Search,
  ChevronDown,
  Activity,
  Network,
  ShieldCheck,
  Cpu,
  Database
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
interface Connector {
  platform: string;
  status: string;
  last_sync: string | null;
  config_name: string;
  is_enabled: boolean;
  base_url?: string;
  username?: string;
  allowed_projects?: string[];
  error_message?: string;
}

interface ConnectorFormData {
  platform: string;
  config_name: string;
  // JIRA / Confluence API Key auth
  endpoint?: string;
  account?: string;
  api_key?: string;
  // Other platforms
  base_url?: string;
  api_token?: string;
  username?: string;
  password?: string;
  client_id?: string;
  client_secret?: string;
  tenant_id?: string;
  bot_token?: string;
  webhook_url?: string;
  access_token?: string;
  allowed_projects?: string;
  allowed_spaces?: string;
  target_storage?: "knowledge_store" | "dataset";
}

const DEFAULT_CONNECTOR_DATA: ConnectorFormData = {
  platform: "",
  config_name: "",
  endpoint: "",
  account: "",
  api_key: "",
  base_url: "",
  api_token: "",
  username: "",
  password: "",
  client_id: "",
  client_secret: "",
  tenant_id: "",
  bot_token: "",
  webhook_url: "",
  access_token: "",
  allowed_projects: "",
  allowed_spaces: "",
  target_storage: "knowledge_store"
};

const PLATFORM_CONFIGS = {
  jira: {
    name: "Jira",
    fields: ["endpoint", "account", "api_key", "allowed_projects", "target_storage", "additional_fields"],
    required: ["endpoint", "account", "api_key"]
  },
  confluence: {
    name: "Confluence",
    fields: ["endpoint", "account", "api_key", "allowed_spaces", "target_storage", "additional_fields"],
    required: ["endpoint", "account", "api_key"]
  },
  slack: {
    name: "Slack",
    fields: ["bot_token", "webhook_url"],
    required: ["bot_token"]
  },
  github: {
    name: "GitHub",
    fields: ["access_token"],
    required: ["access_token"]
  },
  teams: {
    name: "Microsoft Teams",
    fields: ["client_id", "client_secret", "tenant_id"],
    required: ["client_id", "client_secret", "tenant_id"]
  },
  resend: {
    name: "Resend",
    fields: ["api_token"],
    required: ["api_token"]
  },
  servicenow: {
    name: "ServiceNow",
    fields: ["endpoint", "username", "password", "target_storage"],
    required: ["endpoint", "username", "password"]
  }

};

export default function ConnectorsDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isAddConnectorOpen, setIsAddConnectorOpen] = useState(false);
  const [connectorForm, setConnectorForm] = useState<ConnectorFormData>(DEFAULT_CONNECTOR_DATA);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedOrgId } = useOrgContext();
  const [discoveredSpaces, setDiscoveredSpaces] = useState<{ key: string, name: string }[]>([]);
  const [isDiscoveringSpaces, setIsDiscoveringSpaces] = useState(false);
  const [discoveredFields, setDiscoveredFields] = useState<{ id: string, name: string }[]>([]);
  const [isDiscoveringFields, setIsDiscoveringFields] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");

  // Fetch connectors
  const { data: connectors = [], isLoading, refetch } = useQuery<Connector[]>({
    queryKey: ['/api/saas/connectors', selectedOrgId],
    queryFn: async () => {
      const url = selectedOrgId
        ? `/api/saas/connectors?organization_id=${selectedOrgId}`
        : '/api/saas/connectors';
      const res = await apiRequest('GET', url);
      return res.json();
    },
  });

  // Fetch workflow stats for each connector
  const { data: workflowStats = {} } = useQuery<Record<string, number>>({
    queryKey: ['/api/saas/workflow-stats', selectedOrgId],
    queryFn: async () => {
      const stats: Record<string, number> = {};
      for (const connector of connectors.filter(c => c.is_enabled)) {
        try {
          const url = selectedOrgId
            ? `/api/saas/connectors/${connector.platform}/event-workflows?organization_id=${selectedOrgId}`
            : `/api/saas/connectors/${connector.platform}/event-workflows`;
          const res = await apiRequest('GET', url);
          const data = await res.json();
          stats[connector.platform] = data.workflows?.length || 0;
        } catch (error) {
          stats[connector.platform] = 0;
        }
      }
      return stats;
    },
    enabled: connectors.length > 0,
  });

  // Fetch sync stats for each connector
  const { data: syncStats = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/saas/sync-stats', selectedOrgId],
    queryFn: async () => {
      const stats: Record<string, boolean> = {};
      for (const connector of connectors.filter(c => c.is_enabled)) {
        try {
          const url = selectedOrgId
            ? `/api/saas/connectors/${connector.platform}/bidirectional-sync?organization_id=${selectedOrgId}`
            : `/api/saas/connectors/${connector.platform}/bidirectional-sync`;
          await apiRequest('GET', url);
          stats[connector.platform] = true;
        } catch (error) {
          stats[connector.platform] = false;
        }
      }
      return stats;
    },
    enabled: connectors.length > 0,
  });

  // Knowledge Sync Mutation
  const knowledgeSyncMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await apiRequest("POST", `/api/saas/connectors/${platform}/sync-now`, {
        sync_type: "knowledge_store",
        parameters: {
          organization_id: selectedOrgId
        }
      });
      return res.json();
    },
    onSuccess: (data, platform) => {
      toast({
        title: "Knowledge Sync Initiated",
        description: `Synchronization for ${platform} has started.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/connectors'] });
      refetch();
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'connecting':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'bg-green-100 text-green-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'connecting':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const navigateToWorkflows = () => {
    setLocation('/connections/saas/workflows');
  };

  const navigateToSyncConfig = () => {
    setLocation('/connections/saas/sync-config');
  };

  const navigateToAnalytics = () => {
    setLocation('/connections/saas/analytics');
  };

  // Create connector mutation
  const createConnectorMutation = useMutation({
    mutationFn: async (data: ConnectorFormData) => {
      // Construct payload to match ConnectorConfigRequest
      const credentials: Record<string, any> = {
        // JIRA / Confluence API Key auth fields
        endpoint: data.endpoint,
        account: data.account,
        api_key: data.api_key || data.api_token, // prefer explicit api_key, fallback to api_token
        // Other platform fields
        base_url: data.base_url,
        username: data.username,
        password: data.password,
        client_id: data.client_id,
        client_secret: data.client_secret,
        tenant_id: data.tenant_id,
        bot_token: data.bot_token,
        webhook_url: data.webhook_url,
        access_token: data.access_token
      };

      // Filter out empty values
      Object.keys(credentials).forEach(key => {
        if (credentials[key] === undefined || credentials[key] === "") {
          delete credentials[key];
        }
      });

      const payload = {
        platform: data.platform,
        organization_id: selectedOrgId || 1,
        config: {
          name: data.config_name,
          enabled: true,
          allowed_projects: data.allowed_projects ? data.allowed_projects.split(",").map(p => p.trim()) : undefined,
          allowed_spaces: data.allowed_spaces ? data.allowed_spaces.split(",").map(s => s.trim()) : undefined,
          target_storage: data.target_storage,
          additional_fields: data.allowed_projects ? data.allowed_projects.split(",").map(f => f.trim()) : undefined
        },
        credentials: credentials
      };

      return apiRequest('POST', '/api/saas/create-connector', payload);
    },
    onSuccess: () => {
      toast({
        title: "Connector created",
        description: `The ${connectorForm.platform} connector has been created successfully.`,
      });
      setIsAddConnectorOpen(false);
      setConnectorForm(DEFAULT_CONNECTOR_DATA);
      queryClient.invalidateQueries({ queryKey: ['/api/saas/connectors'] });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create connector",
        variant: "destructive",
      });
    },
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async (data: ConnectorFormData) => {
      const url = selectedOrgId
        ? `/api/saas/connectors/${data.platform}/test?organization_id=${selectedOrgId}`
        : `/api/saas/connectors/${data.platform}/test`;
      return apiRequest('POST', url, {
        platform: data.platform,
        // JIRA / Confluence API Key auth
        endpoint: data.endpoint,
        account: data.account,
        api_key: data.api_key || data.api_token,
        // Other platforms
        base_url: data.base_url,
        username: data.username,
        client_id: data.client_id,
        client_secret: data.client_secret,
        tenant_id: data.tenant_id,
        bot_token: data.bot_token,
        access_token: data.access_token
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Connection test successful",
        description: "The connector configuration is valid and can connect to the platform.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Connection test failed",
        description: error.message || "Unable to connect to the platform. Please check your configuration.",
        variant: "destructive",
      });
    },
  });

  // Reconnect mutation
  const reconnectMutation = useMutation({
    mutationFn: async (platform: string) => {
      return apiRequest('POST', `/api/saas/connectors/${platform}/reconnect`, {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "Reconnection initiated",
        description: data.message || "Attempting to reconnect...",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/connectors'] });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Reconnection failed",
        description: error.message || "Failed to initiate reconnection",
        variant: "destructive",
      });
    },
  });

  const handleReconnect = (platform: string) => {
    reconnectMutation.mutate(platform);
  };

  const handleAddConnector = () => {
    setIsAddConnectorOpen(true);
  };

  const handleTestConnection = async () => {
    if (!connectorForm.platform) {
      toast({
        title: "Platform required",
        description: "Please select a platform first.",
        variant: "destructive",
      });
      return;
    }

    setIsTestingConnection(true);
    try {
      await testConnectionMutation.mutateAsync(connectorForm);
    } catch (error) {
      // Error handled by mutation's onError toast
      console.error("Connection test failed:", error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleDiscoverFields = async () => {
    if (!connectorForm.platform) return;
    // Require endpoint for JIRA/Confluence, base_url for others
    const isAtlassian = connectorForm.platform === 'jira' || connectorForm.platform === 'confluence';
    if (isAtlassian && !connectorForm.endpoint) return;
    if (!isAtlassian && !connectorForm.base_url) return;
    setIsDiscoveringFields(true);
    try {
      const res = await apiRequest("POST", `/api/saas/connectors/${connectorForm.platform}/discover/fields`, {
        credentials: isAtlassian ? {
          endpoint: connectorForm.endpoint,
          account: connectorForm.account,
          api_key: connectorForm.api_key
        } : {
          base_url: connectorForm.base_url,
          api_token: connectorForm.api_token,
          username: connectorForm.username
        },
        organization_id: selectedOrgId || 1
      });
      const data = await res.json();
      if (data.results) {
        setDiscoveredFields(data.results.map((f: any) => ({ id: f.id, name: f.name })));
        toast({
          title: "Fields Discovered",
          description: `Found ${data.results.length} available fields.`,
        });
      }
    } catch (error) {
      toast({
        title: "Field Discovery Failed",
        description: "Could not fetch fields. Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setIsDiscoveringFields(false);
    }
  };

  const toggleField = (fieldId: string) => {
    const currentFields = connectorForm.allowed_projects ? connectorForm.allowed_projects.split(",").map(f => f.trim()).filter(Boolean) : [];
    const newFields = currentFields.includes(fieldId)
      ? currentFields.filter(f => f !== fieldId)
      : [...currentFields, fieldId];
    setConnectorForm(prev => ({ ...prev, allowed_projects: newFields.join(", ") }));
  };

  const handleDiscoverSpaces = async () => {
    setIsDiscoveringSpaces(true);
    try {
      const res = await apiRequest("POST", `/api/saas/connectors/confluence/discover/spaces`, {
        credentials: {
          endpoint: connectorForm.endpoint,
          account: connectorForm.account,
          api_key: connectorForm.api_key
        },
        organization_id: selectedOrgId || 1
      });
      const data = await res.json();
      if (data.results) {
        setDiscoveredSpaces(data.results.map((s: any) => ({ key: s.key, name: s.name })));
        toast({
          title: "Spaces Discovered",
          description: `Found ${data.results.length} spaces.`,
        });
      }
    } catch (error) {
      toast({
        title: "Discovery Failed",
        description: "Could not fetch spaces. Please check your credentials and URL.",
        variant: "destructive",
      });
    } finally {
      setIsDiscoveringSpaces(false);
    }
  };

  const toggleSpace = (spaceKey: string) => {
    const currentSpaces = connectorForm.allowed_spaces ? connectorForm.allowed_spaces.split(",").map(s => s.trim()).filter(Boolean) : [];
    const newSpaces = currentSpaces.includes(spaceKey)
      ? currentSpaces.filter(s => s !== spaceKey)
      : [...currentSpaces, spaceKey];
    setConnectorForm(prev => ({ ...prev, allowed_spaces: newSpaces.join(", ") }));
  };

  const handleSaveConnector = () => {
    // Validate required fields
    const platformConfig = PLATFORM_CONFIGS[connectorForm.platform as keyof typeof PLATFORM_CONFIGS];
    if (!platformConfig) {
      toast({
        title: "Invalid platform",
        description: "Please select a valid platform.",
        variant: "destructive",
      });
      return;
    }

    const missingFields = platformConfig.required.filter(field => !connectorForm[field as keyof ConnectorFormData]);
    if (missingFields.length > 0) {
      toast({
        title: "Missing required fields",
        description: `Please fill in: ${missingFields.join(', ')}`,
        variant: "destructive",
      });
      return;
    }

    if (!connectorForm.config_name.trim()) {
      toast({
        title: "Configuration name required",
        description: "Please provide a name for this connector configuration.",
        variant: "destructive",
      });
      return;
    }

    createConnectorMutation.mutate(connectorForm);
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      config_name: "Configuration Name",
      endpoint: "Endpoint (e.g. https://yoursite.atlassian.net)",
      account: "Account Email",
      api_key: "API Key",
      base_url: "Base URL",
      api_token: "API Token",
      username: "Username",
      password: "Password",
      client_id: "Client ID",
      client_secret: "Client Secret",
      tenant_id: "Tenant ID",
      bot_token: "Bot Token",
      webhook_url: "Webhook URL",
      access_token: "Access Token",
      allowed_projects: "Allowed Projects (comma-separated)",
      allowed_spaces: "Allowed Spaces (comma-separated)",
      target_storage: "Target Storage"
    };
    if (field === 'endpoint' && connectorForm.platform === 'servicenow') {
      return "Instance URL (e.g. https://acme.service-now.com)";
    }
    return labels[field] || field;
  };

  const getFieldType = (field: string) => {
    if (field.includes('password') || field.includes('secret') || field.includes('token') || field === 'api_key') {
      return 'password';
    }
    if (field.includes('email') || field === 'username' || field === 'account') {
      return 'email';
    }
    if (field.includes('url') || field === 'endpoint') {
      return 'url';
    }
    return 'text';
  };

  const workflowColumns: Column<Connector>[] = [
    {
      key: 'platform',
      header: 'Platform',
      render: (connector: Connector) => (
        <div className="flex items-center space-x-2">
          <Globe className="w-4 h-4" />
          <span className="capitalize font-medium">{connector.platform}</span>
        </div>
      ),
    },
    {
      key: 'workflows',
      header: 'Workflows',
      render: (connector: Connector) => (
        <div className="flex items-center space-x-2">
          <Workflow className="w-4 h-4" />
          <span>{workflowStats[connector.platform] || 0}</span>
        </div>
      ),
    },
    {
      key: 'sync_enabled',
      header: 'Sync Configured',
      render: (connector: Connector) => (
        <div className="flex items-center space-x-2">
          {syncStats[connector.platform] ? (
            <>
              <CheckCircle className="w-4 h-4 text-green-500" />
              <Badge variant="outline" className="bg-green-50">Configured</Badge>
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-muted-foreground" />
              <Badge variant="outline">Not Configured</Badge>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (connector: Connector) => (
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/connections/saas/workflows?platform=${connector.platform}`)}
          >
            <Workflow className="w-3 h-3 mr-1" />
            Workflows
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/connections/saas/sync-config?platform=${connector.platform}`)}
          >
            <ArrowRightLeft className="w-3 h-3 mr-1" />
            Sync
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
             <Network className="w-4 h-4" />
             <span className="text-sm font-semibold tracking-wide">Integrations</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Manage Connections
          </h1>
          <p className="text-muted-foreground">
            Connect to external platforms to sync data and automate workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={navigateToAnalytics}
            className="h-12 px-6 bg-foreground/[0.02] border-foreground/5 hover:bg-foreground/5 hover:border-foreground/10 rounded-xl text-[10px] font-black uppercase tracking-widest italic transition-all group"
          >
            <BarChart3 className="w-4 h-4 mr-3 text-primary group-hover:scale-110 transition-transform" />
            VITAL ANALYTICS
          </Button>
          <Button 
            onClick={handleAddConnector}
            className="h-12 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-bold transition-all shadow-xl shadow-primary/10 active:scale-95 group"
          >
            <Plus className="w-4 h-4 mr-2 group-hover:rotate-90 transition-transform" />
            Add Connection
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <TabsList className="h-14 bg-foreground/[0.02] border border-foreground/5 p-1.5 rounded-2xl gap-2 inline-flex backdrop-blur-xl">
          {[
            { value: 'overview', label: 'Matrix Overview' },
            { value: 'connectors', label: 'Active Connectors' },
            { value: 'workflows', label: 'Event Protocols' },
            { value: 'sync', label: 'Data Parity' }
          ].map((tab) => (
            <TabsTrigger 
              key={tab.value}
              value={tab.value} 
              className="h-full px-6 rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:border-primary/20 border border-transparent transition-all"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-8 outline-none mt-0">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total Integrations', value: connectors.length, sub: `${connectors.filter(c => c.status === 'connected').length} Active`, icon: Globe, color: 'primary' },
              { label: 'Active Syncs', value: connectors.filter(c => c.last_sync).length, sub: 'Nominal Flow', icon: Zap, color: 'emerald-500' },
              { label: 'Automated Workflows', value: Object.values(workflowStats).reduce((sum, count) => sum + count, 0), sub: 'Event-based automations', icon: Workflow, color: 'blue-500' },
              { label: 'Sync Configurations', value: Object.values(syncStats).filter(Boolean).length, sub: 'Bidirectional data flows', icon: ArrowRightLeft, color: 'bronze-500' }
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-panel-deep border-foreground/5 p-6 rounded-[2rem] relative overflow-hidden group hover:border-foreground/10 transition-all"
              >
                <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform`}>
                   <stat.icon className="w-12 h-12" />
                </div>
                <div className="space-y-4 relative z-10">
                   <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full bg-${stat.color} shadow-glow animate-pulse`} />
                      <p className="text-[9px] font-black text-foreground/30 uppercase tracking-[0.3em] italic">{stat.label}</p>
                   </div>
                   <div className="space-y-1">
                      <div className="text-3xl font-black text-foreground italic tracking-tighter">{stat.value}</div>
                      <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">{stat.sub}</p>
                   </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Recent Activity */}
          <div className="glass-panel-deep border-foreground/5 rounded-[2.5rem] p-8 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-30" />
            <div className="flex items-center justify-between mb-10">
               <div className="space-y-1">
                  <h3 className="text-xl font-black text-foreground uppercase italic tracking-tight">Node Activity Monitor</h3>
                  <p className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest italic">Real-time downlink telemetry and protocol events.</p>
               </div>
               <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                     <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                     <span className="text-[8px] font-black text-emerald-500 uppercase italic">Live Feed</span>
                  </div>
               </div>
            </div>
            
            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-foreground/5 rounded-[2rem] bg-foreground/[0.01]">
              <div className="relative mb-6">
                <Globe className="w-16 h-16 text-foreground/5 opacity-50" />
                <motion.div 
                   animate={{ rotate: 360 }}
                   transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                   className="absolute inset-[-10px] border border-dashed border-primary/20 rounded-full"
                />
              </div>
              <p className="text-[11px] font-black text-foreground/20 uppercase tracking-[0.4em] italic mb-1">Null Traffic Detected</p>
              <p className="text-[9px] font-bold text-foreground/10 uppercase tracking-widest italic">Activity protocols will populate upon node activation.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="connectors" className="space-y-8 outline-none mt-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <RefreshCw className="w-10 h-10 animate-spin text-primary/40 mb-4" />
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Scanning Uplinks...</p>
            </div>
          ) : connectors.length === 0 ? (
            <div className="glass-panel-deep border-foreground/5 rounded-[2.5rem] p-12 text-center relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
               <Globe className="w-20 h-20 mx-auto mb-6 text-foreground/5" />
               <h3 className="text-2xl font-black text-foreground uppercase italic tracking-tight mb-2">Zero Connectors Found</h3>
               <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest mb-8 max-w-sm mx-auto leading-relaxed"> No platform uplinks established. Initialize a new connection to bridge external data nodes. </p>
               <Button 
                 onClick={handleAddConnector}
                 className="h-12 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-[0.2em] italic transition-all group"
               >
                 <Plus className="w-4 h-4 mr-3 group-hover:rotate-90 transition-transform" />
                 INITIALIZE FIRST UPLINK
               </Button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {connectors.map((connector) => (
                <Card key={connector.platform} className="flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                           <Globe className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <CardTitle className="capitalize text-lg font-bold">{connector.platform}</CardTitle>
                          <CardDescription className="text-xs">{connector.config_name}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={connector.status === 'connected' ? 'default' : connector.status === 'error' ? 'destructive' : 'secondary'} className="capitalize">
                        {connector.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <div className="text-sm text-muted-foreground space-y-2">
                        <div className="flex justify-between">
                            <span>Last Sync:</span>
                            <span>{connector.last_sync ? new Date(connector.last_sync).toLocaleTimeString() : 'Never'}</span>
                        </div>
                        {connector.error_message && (
                            <p className="text-xs text-red-500">Error: {connector.error_message}</p>
                        )}
                    </div>
                  </CardContent>
                  <CardFooter className="grid grid-cols-3 gap-2">
                      <Button 
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setConnectorForm(prev => ({
                                ...DEFAULT_CONNECTOR_DATA,
                                platform: connector.platform,
                                config_name: connector.config_name,
                                base_url: connector.base_url || "",
                                username: connector.username || "",
                                allowed_projects: connector.allowed_projects ? connector.allowed_projects.join(", ") : "",
                                allowed_spaces: (connector as any).allowed_spaces ? (connector as any).allowed_spaces.join(", ") : "",
                            }));
                            setIsAddConnectorOpen(true);
                          }}
                          title="Settings"
                      >
                          <Settings className="w-4 h-4" />
                      </Button>
                      <Button 
                          variant="outline"
                          size="sm"
                          onClick={() => knowledgeSyncMutation.mutate(connector.platform)}
                          disabled={knowledgeSyncMutation.isPending || !connector.is_enabled}
                          title="Run Sync"
                      >
                          <Zap className={`w-4 h-4 ${knowledgeSyncMutation.isPending && knowledgeSyncMutation.variables === connector.platform ? 'animate-pulse' : ''}`} />
                      </Button>
                      <Button 
                          variant="outline"
                          size="sm"
                          onClick={() => handleReconnect(connector.platform)}
                          disabled={reconnectMutation.isPending}
                          title="Refresh Connection"
                      >
                          <RefreshCw className={`w-4 h-4 ${reconnectMutation.isPending ? 'animate-spin' : ''}`} />
                      </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="workflows" className="space-y-8 outline-none mt-0">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-8 mb-8">
            <div className="space-y-1">
              <h3 className="text-xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                 <Workflow className="w-5 h-5 text-primary" />
                 Event Protocols
              </h3>
              <p className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest italic leading-relaxed"> orchestration of event-driven synchronization chains. </p>
            </div>
            <Button 
               onClick={navigateToWorkflows}
               className="h-10 px-6 bg-foreground/[0.03] border border-foreground/10 hover:bg-foreground/5 hover:border-foreground/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all italic group"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-2 group-hover:scale-110 transition-transform" />
              DEPLOY WORKFLOW MANAGER
            </Button>
          </div>

          <div className="glass-panel-deep border-foreground/5 rounded-[2rem] p-8">
            {isLoading ? (
               <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-primary/40" />
               </div>
            ) : (
                <DataTable
                  data={connectors.filter(c => c.is_enabled)}
                  columns={workflowColumns}
                />
            )}
          </div>
        </TabsContent>

        <TabsContent value="sync" className="space-y-8 outline-none mt-0">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-8 mb-8">
            <div className="space-y-1">
              <h3 className="text-xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                 <ArrowRightLeft className="w-5 h-5 text-primary" />
                 Data Parity Registry
              </h3>
              <p className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest italic leading-relaxed"> bidirectional state transfer configurations per active uplink. </p>
            </div>
            <Button 
               onClick={navigateToSyncConfig}
               className="h-10 px-6 bg-foreground/[0.03] border border-foreground/10 hover:bg-foreground/5 hover:border-foreground/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all italic group"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-2 group-hover:scale-110 transition-transform" />
              DEPLOY SYNC MANAGER
            </Button>
          </div>

          <div className="glass-panel-deep border-foreground/5 rounded-[2rem] p-8">
            {isLoading ? (
               <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-primary/40" />
               </div>
            ) : (
                <DataTable
                  data={connectors.filter(c => c.is_enabled)}
                  columns={workflowColumns} 
                />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Connector Dialog */}
      <Dialog open={isAddConnectorOpen} onOpenChange={setIsAddConnectorOpen}>
        <DialogContent className="max-w-2xl bg-background border-foreground/10 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
          <div className="absolute inset-0 cinematic-grid opacity-10 pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          
          <DialogHeader className="p-8 pb-4 relative z-10">
            <div className="flex items-center gap-4 mb-4">
               <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
                  <Database className="w-6 h-6 text-primary" />
               </div>
               <div>
                  <DialogTitle className="text-2xl font-bold text-foreground">Add New Connection</DialogTitle>
                  <DialogDescription>Configure a new connection to a SaaS platform.</DialogDescription>
               </div>
            </div>
          </DialogHeader>
 
          <div className="p-8 pt-4 space-y-8 relative z-10 max-h-[70vh] overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label className="text-sm text-muted-foreground">Platform</Label>
                <Select
                  value={connectorForm.platform}
                  onValueChange={(value) => setConnectorForm(prev => ({ ...prev, platform: value }))}
                >
                  <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest">
                    <SelectValue placeholder="INITIALIZE_SELECT" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-foreground/10">
                    {Object.entries(PLATFORM_CONFIGS).map(([key, config]) => (
                      <SelectItem key={key} value={key} className="text-[10px] font-bold uppercase italic tracking-widest focus:bg-primary/20 focus:text-primary transition-colors cursor-pointer p-3">
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
 
              <div className="space-y-3">
                <Label htmlFor="config_name" className="text-sm text-muted-foreground">Configuration Name</Label>
                <Input
                  id="config_name"
                  value={connectorForm.config_name}
                  onChange={(e) => setConnectorForm(prev => ({ ...prev, config_name: e.target.value }))}
                  placeholder="e.g. PRODUX_JIRA_01"
                  className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all shadow-inner"
                />
              </div>
            </div>
 
            {connectorForm.platform && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-6 pt-6 border-t border-foreground/5"
              >
                <div className="flex items-center gap-2 mb-2">
                   <Settings className="w-3.5 h-3.5 text-primary" />
                   <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/80 italic"> Node Parameters: {PLATFORM_CONFIGS[connectorForm.platform as keyof typeof PLATFORM_CONFIGS]?.name.toUpperCase()} </h4>
                </div>
 
                <div className="grid grid-cols-1 gap-6">
                  {PLATFORM_CONFIGS[connectorForm.platform as keyof typeof PLATFORM_CONFIGS]?.fields.map((field) => (
                    <div key={field} className="space-y-3">
                      <Label htmlFor={field} className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic block mb-1.5">
                        {getFieldLabel(field).toUpperCase().replace(/ /g, '_')}
                        {PLATFORM_CONFIGS[connectorForm.platform as keyof typeof PLATFORM_CONFIGS]?.required.includes(field) && (
                          <span className="text-primary ml-1 font-black">!</span>
                        )}
                      </Label>
                      {field === 'target_storage' ? (
                        <Select
                          value={connectorForm.target_storage}
                          onValueChange={(value: any) => setConnectorForm(prev => ({ ...prev, target_storage: value }))}
                        >
                          <SelectTrigger id={field} className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest">
                            <SelectValue placeholder="STORAGE_SELECT" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-foreground/10">
                            <SelectItem value="knowledge_store" className="text-[10px] font-bold uppercase italic tracking-widest p-3">KNOWLEDGE STORE (UNSTRUCTURED)</SelectItem>
                            <SelectItem value="dataset" className="text-[10px] font-bold uppercase italic tracking-widest p-3">RELATIONAL DATASET (STRUCTURED)</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : field === 'allowed spaces' ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Input
                              id={field}
                              value={connectorForm.allowed_spaces || ''}
                              onChange={(e) => setConnectorForm(prev => ({ ...prev, allowed_spaces: e.target.value }))}
                              placeholder="PROJ, OPS, HELP"
                              className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest placeholder:text-foreground/10"
                            />
                            <Button
                              type="button"
                              onClick={handleDiscoverSpaces}
                              disabled={isDiscoveringSpaces || !connectorForm.endpoint || !connectorForm.api_key}
                              className="h-12 px-6 bg-foreground/5 border border-foreground/10 hover:border-primary/40 rounded-xl text-[9px] font-black uppercase italic transition-all"
                            >
                              {isDiscoveringSpaces ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                              DISCOVER
                            </Button>
                          </div>
                          {discoveredSpaces.length > 0 && (
                            <div className="border border-foreground/5 rounded-2xl p-4 max-h-48 overflow-y-auto grid grid-cols-2 gap-3 bg-foreground/[0.01] custom-scrollbar">
                              {discoveredSpaces.map(space => (
                                <div key={space.key} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-foreground/[0.03] transition-colors group cursor-pointer" onClick={() => toggleSpace(space.key)}>
                                  <Checkbox
                                    id={`space-${space.key}`}
                                    checked={connectorForm.allowed_spaces?.includes(space.key)}
                                    onCheckedChange={() => toggleSpace(space.key)}
                                    className="border-foreground/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                  />
                                  <label className="text-[9px] font-black uppercase tracking-widest text-foreground/40 group-hover:text-foreground/80 transition-colors truncate italic">
                                    {space.name} ({space.key})
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : field === 'additional fields' || (connectorForm.platform === 'jira' && field === 'allowed projects') ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Input
                              id={field}
                              value={connectorForm.allowed_projects || ''}
                              onChange={(e) => setConnectorForm(prev => ({ ...prev, allowed_projects: e.target.value }))}
                              placeholder="summary, status, customfield_10001"
                              className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest placeholder:text-foreground/10"
                            />
                            <Button
                              type="button"
                              onClick={handleDiscoverFields}
                              disabled={isDiscoveringFields || !(connectorForm.endpoint || connectorForm.base_url)}
                              className="h-12 px-6 bg-foreground/5 border border-foreground/10 hover:border-primary/40 rounded-xl text-[9px] font-black uppercase italic transition-all"
                            >
                              {isDiscoveringFields ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                              DISCOVER FIELDS
                            </Button>
                          </div>
                          
                          {discoveredFields.length > 0 && (
                            <div className="space-y-4">
                              <Input 
                                placeholder="SEARCH_FIELDS..."
                                value={fieldSearch}
                                onChange={(e) => setFieldSearch(e.target.value)}
                                className="h-10 bg-foreground/[0.02] border-foreground/5 rounded-lg text-[9px] font-bold uppercase italic tracking-widest"
                              />
                              <div className="border border-foreground/5 rounded-2xl p-4 max-h-60 overflow-y-auto grid grid-cols-2 gap-3 bg-foreground/[0.01] custom-scrollbar">
                                {discoveredFields
                                  .filter(f => f.name.toLowerCase().includes(fieldSearch.toLowerCase()) || f.id.toLowerCase().includes(fieldSearch.toLowerCase()))
                                  .slice(0, 100) // Performance cap for display
                                  .map(f => (
                                  <div key={f.id} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-foreground/[0.03] transition-colors group cursor-pointer" onClick={() => toggleField(f.id)}>
                                    <Checkbox
                                      id={`field-${f.id}`}
                                      checked={connectorForm.allowed_projects?.includes(f.id)}
                                      onCheckedChange={() => toggleField(f.id)}
                                      className="border-foreground/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                    />
                                    <label className="text-[9px] font-black uppercase tracking-widest text-foreground/40 group-hover:text-foreground/80 transition-colors truncate italic">
                                      {f.name} <span className="text-foreground/10 ml-1">({f.id})</span>
                                    </label>
                                  </div>
                                ))}
                                {discoveredFields.length > 100 && <div className="col-span-2 text-center text-[8px] text-foreground/20 uppercase italic">And {discoveredFields.length - 100} more...</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <Input
                          id={field}
                          type={getFieldType(field)}
                          value={connectorForm[field as keyof ConnectorFormData] || ''}
                          onChange={(e) => setConnectorForm(prev => ({ ...prev, [field]: e.target.value }))}
                          placeholder={`Enter_${field.toUpperCase()}`}
                          autoComplete="off"
                          className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all font-mono"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
 
          <div className="p-8 border-t border-foreground/5 flex items-center justify-end gap-3 relative z-10 bg-foreground/[0.02]">
            <Button
              variant="outline"
              onClick={() => setIsAddConnectorOpen(false)}
              disabled={createConnectorMutation.isPending || testConnectionMutation.isPending}
              className="h-12 px-8 border-foreground/10 text-[10px] font-black uppercase tracking-widest text-foreground/40 hover:bg-foreground/5 transition-all italic rounded-xl"
            >
              ABORT INITIALIZATION
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!connectorForm.platform || testConnectionMutation.isPending || createConnectorMutation.isPending}
              className="h-12 px-8 border-primary/20 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/10 transition-all italic rounded-xl group"
            >
              {isTestingConnection ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" />
              )}
              VERIFY CONNECTION
            </Button>
            <Button
              onClick={handleSaveConnector}
              disabled={createConnectorMutation.isPending}
              className="h-12 px-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 italic active:scale-95 transition-all group"
            >
              {createConnectorMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
              )}
              ESTABLISH UPLINK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

