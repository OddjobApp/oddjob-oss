import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Shield, 
  Settings, 
  Activity, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Zap,
  RefreshCw,
  History,
  TrendingUp,
  Info,
  BellOff
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@domain-ui/core/ui/components/ui/tooltip';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { formatDistanceToNow } from 'date-fns';

interface AutoRescueConfig {
  enabled: boolean;
  autoRescueCategories: string[];
  minSeverity: 'error' | 'critical';
  cooldownMinutes: number;
  maxPerHour: number;
  autoApprove: boolean;
}

interface AutoRescueStats {
  totalAutoRescues: number;
  successfulRescues: number;
  avgResolutionTime: number;
  topCategories: Array<{ category: string; count: number }>;
}

interface AutoRescueHistory {
  id: number;
  alertId: number;
  category: string;
  severity: string;
  message: string;
  rescueSessionId: number;
  missionId?: number;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}

const DEFAULT_CATEGORIES = [
  { id: 'system_error', label: 'System Errors', description: 'Core system failures', enabled: true },
  { id: 'pipeline_failure', label: 'Pipeline Failures', description: 'Pipeline execution failures', enabled: true },
  { id: 'mission_stalled', label: 'Mission Stalled', description: 'Missions stuck in progress', enabled: true },
  { id: 'performance_degradation', label: 'Performance Issues', description: 'Slowdowns and timeouts', enabled: false },
  { id: 'integration_failure', label: 'Integration Failures', description: 'External service failures', enabled: true },
  { id: 'database_error', label: 'Database Errors', description: 'Database connection issues', enabled: true },
];

export default function AlertAutoRescueConfig() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('settings');
  const [localConfig, setLocalConfig] = useState<AutoRescueConfig | null>(null);

  // Fetch current configuration
  const { data: config, isLoading: configLoading } = useQuery<AutoRescueConfig>({
    queryKey: ['/api/alerts/auto-rescue/config'],
    queryFn: async () => {
      const res = await fetch('/api/alerts/auto-rescue/config', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    },
  });

  // Fetch statistics
  const { data: stats, isLoading: statsLoading } = useQuery<AutoRescueStats>({
    queryKey: ['/api/alerts/auto-rescue/stats'],
    queryFn: async () => {
      const res = await fetch('/api/alerts/auto-rescue/stats', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
  });

  // Fetch history
  const { data: history, isLoading: historyLoading } = useQuery<AutoRescueHistory[]>({
    queryKey: ['/api/alerts/auto-rescue/history'],
    queryFn: async () => {
      const res = await fetch('/api/alerts/auto-rescue/history', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
  });

  // Update configuration
  const updateConfigMutation = useMutation({
    mutationFn: async (newConfig: AutoRescueConfig) => {
      return await apiRequest('POST', '/api/alerts/auto-rescue/config', newConfig);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/auto-rescue/config'] });
      toast({
        title: 'Configuration Saved',
        description: 'Auto-rescue settings have been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Save Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Manual trigger mutation
  const manualTriggerMutation = useMutation({
    mutationFn: async (alertId: number) => {
      return await apiRequest('POST', `/api/alerts/${alertId}/trigger-rescue`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/auto-rescue/history'] });
      toast({
        title: 'Rescue Triggered',
        description: 'Manual rescue mission has been created.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Trigger Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCategoryToggle = useCallback((categoryId: string, enabled: boolean) => {
    if (!localConfig) return;
    
    const newCategories = enabled
      ? [...localConfig.autoRescueCategories, categoryId]
      : localConfig.autoRescueCategories.filter(c => c !== categoryId);
    
    setLocalConfig({ ...localConfig, autoRescueCategories: newCategories });
  }, [localConfig]);

  const handleSave = useCallback(() => {
    if (localConfig) {
      updateConfigMutation.mutate(localConfig);
    }
  }, [localConfig, updateConfigMutation]);

  // Initialize local config when data loads
  if (config && !localConfig) {
    setLocalConfig(config);
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Error</Badge>;
      case 'warning':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Warning</Badge>;
      default:
        return <Badge variant="secondary">{severity}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RESOLVED':
      case 'COMPLETED':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="w-3 h-3 mr-1" /> Resolved</Badge>;
      case 'ACTIVE':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Activity className="w-3 h-3 mr-1" /> Active</Badge>;
      case 'FAILED':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Auto-Rescue Configuration
          </h2>
          <p className="text-muted-foreground">
            Configure automatic rescue missions for critical system alerts
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant={localConfig?.enabled ? 'default' : 'secondary'}
                className="text-sm px-3 py-1"
              >
                {localConfig?.enabled ? (
                  <><Zap className="w-3 h-3 mr-1" /> Auto-Rescue Enabled</>
                ) : (
                  <><BellOff className="w-3 h-3 mr-1" /> Auto-Rescue Disabled</>
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {localConfig?.enabled 
                ? 'Critical alerts will automatically trigger rescue missions' 
                : 'Auto-rescue is currently disabled - manual intervention required'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <TrendingUp className="w-4 h-4 mr-2" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          {/* Master Toggle */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                Auto-Rescue Master Switch
              </CardTitle>
              <CardDescription>
                Enable or disable automatic rescue mission creation for all configured alert categories
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="master-toggle" className="text-base font-medium">
                    Enable Auto-Rescue
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When enabled, qualifying alerts will automatically create rescue missions
                  </p>
                </div>
                <Switch
                  id="master-toggle"
                  checked={localConfig?.enabled ?? false}
                  onCheckedChange={(checked) => 
                    setLocalConfig(prev => prev ? { ...prev, enabled: checked } : null)
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Alert Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Alert Categories
              </CardTitle>
              <CardDescription>
                Select which alert categories should trigger automatic rescue missions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {DEFAULT_CATEGORIES.map((category) => (
                  <div 
                    key={category.id} 
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`cat-${category.id}`} className="font-medium">
                          {category.label}
                        </Label>
                        {category.enabled && (
                          <Badge variant="outline" className="text-xs">Recommended</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{category.description}</p>
                    </div>
                    <Switch
                      id={`cat-${category.id}`}
                      checked={localConfig?.autoRescueCategories?.includes(category.id) ?? false}
                      onCheckedChange={(checked) => handleCategoryToggle(category.id, checked)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Thresholds & Limits
              </CardTitle>
              <CardDescription>
                Configure when and how often auto-rescue missions are created
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Minimum Severity */}
              <div className="space-y-3">
                <Label className="text-base font-medium">Minimum Severity</Label>
                <p className="text-sm text-muted-foreground">
                  Only alerts of this severity or higher will trigger auto-rescue
                </p>
                <div className="flex gap-2">
                  {(['error', 'critical'] as const).map((severity) => (
                    <Button
                      key={severity}
                      variant={localConfig?.minSeverity === severity ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setLocalConfig(prev => 
                        prev ? { ...prev, minSeverity: severity } : null
                      )}
                    >
                      {severity === 'error' ? <AlertTriangle className="w-4 h-4 mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                      {severity.charAt(0).toUpperCase() + severity.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Cooldown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">Cooldown Period</Label>
                  <span className="text-sm font-medium">{localConfig?.cooldownMinutes ?? 5} minutes</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Minimum time between auto-rescue missions for the same category
                </p>
                <Slider
                  value={[localConfig?.cooldownMinutes ?? 5]}
                  onValueChange={([value]) => setLocalConfig(prev => 
                    prev ? { ...prev, cooldownMinutes: value } : null
                  )}
                  min={1}
                  max={60}
                  step={1}
                />
              </div>

              <Separator />

              {/* Max Per Hour */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">Max Auto-Rescues Per Hour</Label>
                  <span className="text-sm font-medium">{localConfig?.maxPerHour ?? 10}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Maximum number of auto-rescue missions that can be created per hour
                </p>
                <Slider
                  value={[localConfig?.maxPerHour ?? 10]}
                  onValueChange={([value]) => setLocalConfig(prev => 
                    prev ? { ...prev, maxPerHour: value } : null
                  )}
                  min={1}
                  max={50}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>

          {/* Auto-Approve */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Auto-Approval (Advanced)
              </CardTitle>
              <CardDescription>
                Automatically approve rescue missions without human review
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="auto-approve" className="text-base font-medium">
                    Enable Auto-Approval
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When enabled, rescue missions will be immediately dispatched without approval
                  </p>
                  <p className="text-xs text-yellow-600">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Warning: This bypasses human review and may auto-execute recovery actions
                  </p>
                </div>
                <Switch
                  id="auto-approve"
                  checked={localConfig?.autoApprove ?? false}
                  onCheckedChange={(checked) => 
                    setLocalConfig(prev => prev ? { ...prev, autoApprove: checked } : null)
                  }
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setLocalConfig(config ?? null)}
                disabled={updateConfigMutation.isPending}
              >
                Reset
              </Button>
              <Button 
                onClick={handleSave}
                disabled={updateConfigMutation.isPending || !localConfig}
              >
                {updateConfigMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                ) : (
                  <><CheckCircle className="w-4 h-4 mr-2" /> Save Configuration</>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Auto-Rescues</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {statsLoading ? '-' : stats?.totalAutoRescues ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  All-time auto-created missions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {statsLoading ? '-' : 
                    stats?.totalAutoRescues 
                      ? Math.round((stats.successfulRescues / stats.totalAutoRescues) * 100) 
                      : 0}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Rescues resolved successfully
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {statsLoading ? '-' : 
                    stats?.avgResolutionTime 
                      ? `${Math.round(stats.avgResolutionTime / 60)}m` 
                      : 'N/A'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Average time to resolve
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Top Categories */}
          <Card>
            <CardHeader>
              <CardTitle>Top Alert Categories</CardTitle>
              <CardDescription>
                Most frequent sources of auto-rescue missions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : stats?.topCategories?.length ? (
                <div className="space-y-4">
                  {stats.topCategories.map((cat, idx) => (
                    <div key={cat.category} className="flex items-center gap-4">
                      <span className="text-sm font-medium w-6">{idx + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium capitalize">
                            {cat.category.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm text-muted-foreground">{cat.count} rescues</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all"
                            style={{ 
                              width: `${(cat.count / (stats.topCategories[0]?.count || 1)) * 100}%` 
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Info className="w-8 h-8 mx-auto mb-2" />
                  No auto-rescue data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                Auto-Rescue History
              </CardTitle>
              <CardDescription>
                Recent automatically created rescue missions and their outcomes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : history?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alert</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Rescue</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="max-w-xs">
                            <p className="font-medium truncate">{item.message}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {item.category.replace(/_/g, ' ')}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{getSeverityBadge(item.severity)}</TableCell>
                        <TableCell>
                          {item.rescueSessionId ? (
                            <a 
                              href={`/rescue/${item.rescueSessionId}`}
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              #{item.rescueSessionId}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger className="text-sm text-muted-foreground">
                                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                              </TooltipTrigger>
                              <TooltipContent>
                                {new Date(item.createdAt).toLocaleString()}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(`/rescue/${item.rescueSessionId}`, '_blank')}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-4" />
                  <p>No auto-rescue history found</p>
                  <p className="text-sm">Auto-rescue missions will appear here once triggered</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
