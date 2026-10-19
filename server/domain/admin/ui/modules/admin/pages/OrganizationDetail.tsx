import { useRoute } from 'wouter';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Shield, Crown, Plus, Settings, Activity, Brain, Zap, Network, Save, Database, Save as SaveIcon, Lock, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@domain-ui/core/ui/components/ui/dialog';
import { format } from "date-fns";
import { Calendar as CalendarIcon, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@domain-ui/core/ui/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@domain-ui/core/ui/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import type { AdminRole, Org as Organization } from "@shared/schema/auth";

import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { type DateRange } from "react-day-picker";

interface OrgUser {
  userId: string;
  username: string;
  email?: string;
}

const operationalRoles = ["operator", "approver", "auditor", "administrator"] as const;
type OperationalRole = typeof operationalRoles[number];

function OperationalRoleManagement({ orgId, strict, updateStrict, updatingStrict }: {
  orgId: number;
  strict: boolean;
  updateStrict: (value: boolean) => void;
  updatingStrict: boolean;
}) {
  const { toast } = useToast();
  const { data: usersData } = useQuery<{ users: OrgUser[] }>({
    queryKey: [`/api/admin/organizations/${orgId}/users`],
    queryFn: async () => (await apiRequest('GET', `/api/admin/organizations/${orgId}/users`)).json(),
  });
  const { data: roleData } = useQuery<{ assignments: { userId: string; role: OperationalRole }[] }>({
    queryKey: ['/api/auth/role-assignments', orgId],
    queryFn: async () => (await apiRequest('GET', `/api/auth/role-assignments?orgId=${orgId}`)).json(),
  });
  const assignments = roleData?.assignments || [];
  const saveRoles = useMutation({
    mutationFn: async ({ userId, roles }: { userId: string; roles: OperationalRole[] }) =>
      (await apiRequest('PUT', `/api/auth/role-assignments?orgId=${orgId}`, { userId, roles })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/role-assignments', orgId] });
      toast({ title: 'Operational roles updated' });
    },
    onError: (error: Error) => toast({ title: 'Role update failed', description: error.message, variant: 'destructive' }),
  });

  return <Card>
    <CardHeader>
      <div className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /><CardTitle>Separation of Duties</CardTitle></div>
      <CardDescription>Assign execution, approval, audit, and administration duties independently.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div><Label className="font-semibold">Strict role enforcement</Label><p className="text-xs text-muted-foreground">When off, authenticated members retain compatibility access. Assign roles before enabling.</p></div>
        <Switch checked={strict} onCheckedChange={updateStrict} disabled={updatingStrict || assignments.length === 0} />
      </div>
      {assignments.length === 0 && <p className="text-xs text-amber-600">Strict mode is unavailable until at least one operational role is assigned.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-4">Member</th>{operationalRoles.map(role => <th key={role} className="px-2 py-2 capitalize">{role}</th>)}</tr></thead>
        <tbody>{(usersData?.users || []).map(user => {
          const current = assignments.filter(item => item.userId === user.userId).map(item => item.role);
          return <tr key={user.userId} className="border-b last:border-0"><td className="py-3 pr-4"><div className="font-medium">{user.username}</div><div className="text-xs text-muted-foreground">{user.email || user.userId}</div></td>
            {operationalRoles.map(role => <td key={role} className="px-2 py-3"><Checkbox
              checked={current.includes(role)} disabled={saveRoles.isPending}
              aria-label={`${role} role for ${user.username}`}
              onCheckedChange={(checked) => saveRoles.mutate({ userId: user.userId, roles: checked ? [...current, role] : current.filter(item => item !== role) })}
            /></td>)}</tr>;
        })}</tbody>
      </table></div>
      <p className="text-xs text-muted-foreground">Operator executes missions; approver records decisions; auditor exports evidence; administrator receives all operational permissions. Existing organization and super administrators remain break-glass administrators.</p>
    </CardContent>
  </Card>;
}

function OrganizationSettingsTab({ orgId }: { orgId: number }) {
  const { toast } = useToast();
  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: [`/api/admin/organizations/${orgId}/settings`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/organizations/${orgId}/settings`);
      return res.json();
    }
  });

  const { data: orgData } = useQuery<any>({
    queryKey: [`/api/admin/organizations/${orgId}`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/organizations/${orgId}`);
      return res.json();
    }
  });

  const organization = orgData?.organization;

  const { data: policiesData } = useQuery<{ policies: any[] }>({
    queryKey: ['/api/admin/suppression-policies'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/suppression-policies');
      return res.json();
    }
  });

  const updateOrgMutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest('PUT', `/api/admin/organizations/${orgId}`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}`] });
      toast({ title: 'Organization Updated', description: 'Core details have been saved.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Update Failed', description: error.message, variant: 'destructive' });
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest('PATCH', `/api/admin/organizations/${orgId}/settings`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}/settings`] });
      toast({ title: 'Settings Updated', description: 'Organization configuration has been saved.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Update Failed', description: error.message, variant: 'destructive' });
    }
  });

  if (isLoading) return <div>Loading settings...</div>;

  const settings = settingsData?.settings || {};

  const updateSetting = (key: string, value: any) => {
    updateSettingsMutation.mutate({ [key]: value });
  };

  const policies = policiesData?.policies || [];

  return (
    <div className="space-y-6">
      <OperationalRoleManagement
        orgId={orgId}
        strict={settings.enterpriseRbacEnforced || false}
        updateStrict={(value) => updateSetting('enterpriseRbacEnforced', value)}
        updatingStrict={updateSettingsMutation.isPending}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/10 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <CardTitle>Agent Learning & Evolution</CardTitle>
            </div>
            <CardDescription>Enable autonomous improvement and trust-based knowledge sharing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-background/50 border border-primary/5">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold flex items-center gap-2">
                  Autoresearch
                  <Badge variant="outline" className="text-[10px] uppercase tracking-tighter bg-primary/10 text-primary border-primary/20">Alpha</Badge>
                </Label>
                <p className="text-sm text-muted-foreground">Agents self-improve by running shadow experiments and analyzing failures.</p>
              </div>
              <Switch 
                checked={settings.autoresearchEnabled || false} 
                onCheckedChange={(val: boolean) => updateSetting('autoresearchEnabled', val)}
                disabled={updateSettingsMutation.isPending}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-background/50 border border-primary/5">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold flex items-center gap-2">
                  TrustGraph
                  <Badge variant="outline" className="text-[10px] uppercase tracking-tighter bg-accent/10 text-accent-foreground border-accent/20">Beta</Badge>
                </Label>
                <p className="text-sm text-muted-foreground">Export mission knowledge into portable context cores for cross-agent learning.</p>
              </div>
              <Switch 
                checked={settings.trustgraphEnabled || false} 
                onCheckedChange={(val: boolean) => updateSetting('trustgraphEnabled', val)}
                disabled={updateSettingsMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle>Governance & Policy</CardTitle>
            </div>
            <CardDescription>Configure organizational guardrails and notification policies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Suppression Policy</Label>
              <Select 
                value={String(organization?.suppressionPolicyId || "")} 
                onValueChange={(val: string) => updateOrgMutation.mutate({ suppressionPolicyId: val ? parseInt(val) : null })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Default (No suppression)</SelectItem>
                  {policies.map(p => (
                    <SelectItem key={p.policy_id} value={String(p.policy_id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/50">
              <Label className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                Timezone
              </Label>
              <Select
                value={organization?.timezone || "__unset__"}
                onValueChange={(val: string) =>
                  // Empty string clears it; the API treats undefined as
                  // "leave alone" and "" as "unset", so send "" not null.
                  updateOrgMutation.mutate({ timezone: val === "__unset__" ? "" : val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Use viewer's local timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Use viewer's local timezone</SelectItem>
                  {ORG_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Sets locale-aware defaults such as the opening centre of spatial maps.
                Daylight saving is handled automatically; geographic defaults use standard time
                so they do not shift seasonally.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="space-y-0.5">
                <Label className="font-medium flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  MCP HTTP Access
                </Label>
                <p className="text-[11px] text-muted-foreground">Allows agents to communicate with external MCP servers via HTTP.</p>
              </div>
              <Switch 
                checked={settings.mcpHttpEnabled || false} 
                onCheckedChange={(val: boolean) => updateSetting('mcpHttpEnabled', val)}
                disabled={updateSettingsMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <CardTitle>Capability Allowlists</CardTitle>
            </div>
            <CardDescription>Restrict tool and mission availability for this organization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Allowed Agent Tools</Label>
              <Textarea 
                placeholder="e.g. web_search, terminal, database_query"
                className="h-24 font-mono text-xs"
                defaultValue={settings.allowedAgentTools?.join(', ') || ""}
                onBlur={(e) => {
                  const tools = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                  updateSetting('allowedAgentTools', tools);
                }}
              />
              <p className="text-[10px] text-muted-foreground italic">Comma-separated list of tool names available to agents.</p>
            </div>

            <div className="space-y-2">
              <Label>Allowed Job Types</Label>
              <Textarea 
                placeholder="e.g. research, cleanup, migration"
                className="h-24 font-mono text-xs"
                defaultValue={settings.allowedJobTypes?.join(', ') || ""}
                onBlur={(e) => {
                  const types = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                  updateSetting('allowedJobTypes', types);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <CardTitle>Core Capabilities</CardTitle>
            </div>
            <CardDescription>Enable or disable major platform modules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: 'knowledgeStoreEnabled', label: 'Knowledge Store', icon: Database, desc: 'Centralized vector storage for all organizational data.' },
              { key: 'knowledgeGraphEnabled', label: 'Knowledge Graph', icon: Network, desc: 'Relational mapping of entities and discovered concepts.' },
              { key: 'psychologistEnabled', label: 'Agent Psychologist', icon: Shield, desc: 'Advanced monitoring of agent mental models and bias.' },
              { key: 'skillImportEnabled', label: 'Skill Import', icon: Save, desc: 'Allow direct ingestion of third-party agent skills.' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-3">
                  <item.icon className="w-4 h-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label className="font-medium cursor-pointer" onClick={() => updateSetting(item.key, !settings[item.key])}>{item.label}</Label>
                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
                <Switch 
                  checked={settings[item.key] || false} 
                  onCheckedChange={(val: boolean) => updateSetting(item.key, val)}
                  disabled={updateSettingsMutation.isPending}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      
      <Card className="bg-secondary/10 border-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-secondary-foreground">
            <p className="font-semibold mb-1">Infrastructure Governance</p>
            <p className="opacity-80">These settings are applied globally to all missions within this organization. Changes to Agent Learning settings will affect new mission runs immediately, but existing runs will continue with their current configuration until they cycle.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DataExportTab({ orgId }: { orgId: number }) {
  const [pipelineId, setPipelineId] = useState<string>("");
  const [stepName, setStepName] = useState<string>("");
  const [date, setDate] = useState<DateRange | undefined>();
  const [isExporting, setIsExporting] = useState(false);

  // Fetch pipelines for this org
  const { data: pipelines = [] } = useQuery<any[]>({
    queryKey: ['/api/pipelines'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipelines');
      const all = await res.json();
      return all.filter((p: any) => p.organizationId === orgId);
    },
  });

  // Fetch steps when pipeline is selected
  const { data: pipelineDetails } = useQuery<any>({
    queryKey: [`/api/pipelines/${pipelineId}`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}`);
      return res.json();
    },
    enabled: !!pipelineId,
  });

  const uniqueStepNames = Array.from(new Set(pipelineDetails?.steps?.map((s: any) => s.name) || [])) as string[];

  const handleExport = async () => {
    if (!pipelineId || !stepName || !date?.from || !date?.to) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({
        pipelineId,
        stepName,
        startDate: date.from.toISOString(),
        endDate: date.to.toISOString(),
        status: 'success'
      });

      const response = await fetch(`/api/admin/organizations/${orgId}/export/executions?${params.toString()}`, {
        method: 'GET',
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export_${pipelineId}_${format(new Date(), 'yyyyMMdd')}.jsonl`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      // toast error
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Data Export</CardTitle>
        <CardDescription>Export pipeline execution data for LLM fine-tuning (JSONL format).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Pipeline</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger>
                <SelectValue placeholder="Select Pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Step Name</Label>
            <Select value={stepName} onValueChange={setStepName} disabled={!pipelineId}>
              <SelectTrigger>
                <SelectValue placeholder="Select Step" />
              </SelectTrigger>
              <SelectContent>
                {uniqueStepNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 flex flex-col">
            <Label>Date Range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("justify-start text-left font-normal", !date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(date.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  defaultMonth={date?.from}
                  selected={date}
                  onSelect={setDate}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="pt-4">
          <Button onClick={handleExport} disabled={isExporting || !pipelineId || !stepName || !date?.from || !date?.to}>
            {isExporting ? "Generating Export..." : "Download JSONL"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Selectable organization timezones.
 *
 * Prefers the runtime's full IANA list where available so the choice is not
 * artificially narrowed, falling back to a representative set on engines that
 * do not implement `Intl.supportedValuesOf` (it is not universally supported).
 * Values are IANA identifiers, never fixed offsets, so daylight saving is
 * resolved from the zone rather than baked into the stored value.
 */
const ORG_TIMEZONES: string[] = (() => {
  try {
    const supported = (Intl as any)?.supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch {
    /* Fall through to the static list. */
  }
  return [
    "UTC",
    "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Madrid",
    "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
    "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
  ];
})();

export default function OrganizationDetailPage() {
  const [, accountParams] = useRoute('/account-admin/organizations/:id');
  const [, legacyParams] = useRoute('/organizations/:id');
  const params = accountParams || legacyParams;
  const orgId = params?.id ? parseInt(params.id, 10) : null;
  const { toast } = useToast();
  const { user: currentUser, adminRole } = useAuth();
  const [orgForm, setOrgForm] = useState({ name: '' });
  const [assigningRoleTo, setAssigningRoleTo] = useState<string | null>(null);

  const { data: orgData, isLoading: orgLoading } = useQuery<{ organization: Organization }>({
    queryKey: [`/api/admin/organizations/${orgId}`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/organizations/${orgId}`);
      return res.json();
    },
    enabled: !!orgId,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: OrgUser[] }>({
    queryKey: [`/api/admin/organizations/${orgId}/users`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/organizations/${orgId}/users`);
      return res.json();
    },
    enabled: !!orgId,
  });

  // Fetch all admin roles (for super admin to see roles)
  const { data: adminRoles = [] } = useQuery<AdminRole[]>({
    queryKey: ['/api/admin/roles'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/roles');
      return res.json();
    },
    enabled: !!orgId && (currentUser?.username === 'admin' || adminRole?.isSuperAdmin),
  });

  const updateOrgMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: orgForm.name.trim() };
      const res = await apiRequest('PUT', `/api/admin/organizations/${orgId}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}`] });
      toast({ title: 'Organization updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update organization', description: error.message, variant: 'destructive' });
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest('DELETE', `/api/admin/organizations/${orgId}/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}/users`] });
      toast({ title: 'User removed from organization' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to remove user', description: error.message, variant: 'destructive' });
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: async (data: { userId: string; role: 'org_admin'; organizationId: number }) => {
      return await apiRequest('POST', '/api/admin/roles', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}/users`] });
      toast({ title: 'Role assigned', description: 'Admin role has been assigned successfully.' });
      setAssigningRoleTo(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to assign role', description: error.message, variant: 'destructive' });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (roleId: number) => {
      await apiRequest('DELETE', `/api/admin/roles/${roleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}/users`] });
      toast({ title: 'Role removed', description: 'Admin role has been removed successfully.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to remove role', description: error.message, variant: 'destructive' });
    },
  });

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [selecteduserIdToAdd, setSelectedUserIdToAdd] = useState<string>('');

  // Fetch all users for the "Add Member" dropdown
  const { data: allUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/users');
      return res.json();
    },
    enabled: isAddUserOpen,
  });



  const addUserMutation = useMutation({
    mutationFn: async () => {
      if (!selecteduserIdToAdd) return;
      await apiRequest('POST', `/api/admin/organizations/${orgId}/users`, { userId: selecteduserIdToAdd });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${orgId}/users`] });
      toast({ title: 'User added to organization' });
      setIsAddUserOpen(false);
      setSelectedUserIdToAdd('');
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to add user', description: error.message, variant: 'destructive' });
    },
  });

  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/knowledge/documents/reindex', { organizationId: orgId });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: 'Reindex Started', description: `Reindexing process initiated for ${data.count} documents.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Reindex Failed', description: error.message, variant: 'destructive' });
    }
  });

  const { data: reindexStatus } = useQuery({
    queryKey: [`/api/knowledge/documents/reindex/status`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/knowledge/documents/reindex/status`);
      return res.json();
    },
    enabled: !!orgId,
    refetchInterval: (query: any) => {
      const data = query.state.data as any;
      return data?.active ? 1000 : false;
    }
  });

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/admin/organizations/${orgId}/migrate`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: 'Migration Started', description: data.message || 'Data migration initiated successfully.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Migration Failed', description: error.message, variant: 'destructive' });
    }
  });

  const getRoleBadge = (userId: string) => {
    const role = adminRoles.find((ar: AdminRole) => ar.userId === userId);
    if (role?.role === 'super_admin') {
      return (
        <Badge variant="default" className="bg-yellow-100 text-yellow-800">
          <Crown className="w-3 h-3 mr-1" />
          Super Admin
        </Badge>
      );
    }
    if (role?.role === 'org_admin' && role.organizationId === orgId) {
      return (
        <Badge variant="default" className="bg-purple-100 text-purple-800">
          <Shield className="w-3 h-3 mr-1" />
          Org Admin
        </Badge>
      );
    }
    return null;
  };

  if (!orgId) {
    return <div>Invalid organization ID</div>;
  }

  if (orgLoading) {
    return <div>Loading...</div>;
  }

  if (!orgData?.organization) {
    return <div>Organization not found</div>;
  }

  const org = orgData.organization;
  const users = usersData?.users ?? [];

  // Filter users who are NOT already in the org
  const availableUsers = allUsers.filter((u: OrgUser) => !users.some((existing: OrgUser) => existing.userId === u.userId));

  // Separate org admins from regular users
  const orgAdmins = users.filter((u: OrgUser) => {
    const role = adminRoles.find((ar: AdminRole) => ar.userId === u.userId);
    return role?.role === 'org_admin' && role.organizationId === orgId;
  });
  const regularUsers = users.filter((u: OrgUser) => {
    const role = adminRoles.find((ar: AdminRole) => ar.userId === u.userId);
    return !(role?.role === 'org_admin' && role.organizationId === orgId);
  });

  if (!orgForm.name && org.name) {
    setOrgForm({ name: org.name });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Organization: {org.name}</h1>
        <p className="text-sm text-muted-foreground">
          Manage organization settings and users.
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="export">Data Export</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Organization Details</CardTitle>
                <CardDescription>Edit organization information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={orgForm.name}
                    onChange={(e) => setOrgForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Organization name"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!orgForm.name.trim()) {
                        toast({ title: 'Organization name required', variant: 'destructive' });
                        return;
                      }
                      updateOrgMutation.mutate();
                    }}
                    disabled={updateOrgMutation.isPending}
                  >
                    {updateOrgMutation.isPending ? 'Updating…' : 'Update Organization'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (confirm('Are you sure you want to migrate this organization? This may overwrite data.')) {
                        migrateMutation.mutate();
                      }
                    }}
                    disabled={migrateMutation.isPending}
                  >
                    {migrateMutation.isPending ? 'Migrating...' : 'Migrate Data'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirm('Reindex all knowledge documents? This ensures search is up-to-date.')) {
                        reindexMutation.mutate();
                      }
                    }}
                    disabled={reindexMutation.isPending || reindexStatus?.active}
                  >
                    {reindexMutation.isPending || reindexStatus?.active ? 'Reindexing...' : 'Reindex Knowledge'}
                  </Button>
                </div>

                {reindexStatus?.active && (
                  <div className="space-y-2 mt-4">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Reindexing process...</span>
                      <span>{reindexStatus.processed} / {reindexStatus.total}</span>
                    </div>
                    <Progress value={(reindexStatus.processed / reindexStatus.total) * 100} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Users</CardTitle>
                    <CardDescription>Users in this organization.</CardDescription>
                  </div>
                  <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Plus className="mr-2 h-4 w-4" /> Add Member
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add User to Organization</DialogTitle>
                        <DialogDescription>Select an existing user to add to {org.name}.</DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Label>User</Label>
                        <Select value={selecteduserIdToAdd} onValueChange={setSelectedUserIdToAdd}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a user..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableUsers.length === 0 ? (
                              <SelectItem value="none" disabled>No available users found</SelectItem>
                            ) : (
                              availableUsers.map((u: OrgUser) => (
                                <SelectItem key={u.userId} value={u.userId}>
                                  {u.username} ({u.email || 'No email'})
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddUserOpen(false)}>Cancel</Button>
                        <Button onClick={() => addUserMutation.mutate()} disabled={!selecteduserIdToAdd || addUserMutation.isPending}>
                          {addUserMutation.isPending ? "Adding..." : "Add User"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {usersLoading ? (
                  <p className="text-sm text-muted-foreground">Loading users…</p>
                ) : users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users in this organization.</p>
                ) : (
                  <>
                    {/* Organization Admins */}
                    {orgAdmins.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Organization Administrators</Label>
                        {orgAdmins.map((user: OrgUser) => {
                          const role = adminRoles.find((ar: AdminRole) => ar.userId === user.userId);
                          return (
                            <div key={user.userId} className="flex items-center justify-between rounded border px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div>
                                  <p className="font-medium">{user.username}</p>
                                  {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                                </div>
                                {getRoleBadge(user.userId)}
                              </div>
                              <div className="flex gap-2">
                                {(currentUser?.username === 'admin' || adminRole?.isSuperAdmin) && role && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      if (confirm(`Remove admin role from ${user.username}?`)) {
                                        removeRoleMutation.mutate(role.id);
                                      }
                                    }}
                                    disabled={removeRoleMutation.isPending}
                                  >
                                    Remove Role
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Remove ${user.username} from this organization?`)) {
                                      removeUserMutation.mutate(user.userId);
                                    }
                                  }}
                                  disabled={removeUserMutation.isPending}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                            {/* Regular Users */}
                            {regularUsers.length > 0 && (
                              <div className="space-y-2">
                                {orgAdmins.length > 0 && <Label className="text-sm font-semibold">Regular Users</Label>}
                                {regularUsers.map((user: OrgUser) => (
                                  <div key={user.userId} className="flex items-center justify-between rounded border px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <div>
                                        <p className="font-medium">{user.username}</p>
                                        {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                                      </div>
                                      {getRoleBadge(user.userId)}
                                    </div>
                                    <div className="flex gap-2">
                                      {(currentUser?.username === 'admin' || adminRole?.isSuperAdmin) && !adminRoles.find((ar: AdminRole) => ar.userId === user.userId) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAssigningRoleTo(user.userId)}
                                >
                                  Assign Admin
                                </Button>
                              )}
                              {assigningRoleTo === user.userId ? (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      assignRoleMutation.mutate({
                                        userId: user.userId,
                                        role: 'org_admin',
                                        organizationId: orgId!,
                                      });
                                    }}
                                    disabled={assignRoleMutation.isPending}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setAssigningRoleTo(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Remove ${user.username} from this organization?`)) {
                                      removeUserMutation.mutate(user.userId);
                                    }
                                  }}
                                  disabled={removeUserMutation.isPending}
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <OrganizationSettingsTab orgId={orgId} />
        </TabsContent>

        <TabsContent value="export" className="mt-6">
          <DataExportTab orgId={orgId} />
        </TabsContent>

      </Tabs>
    </div>
  );
}


