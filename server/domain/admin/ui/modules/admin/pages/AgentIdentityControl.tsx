import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { Bot, CheckCircle2, Fingerprint, KeyRound, PackageCheck, PauseCircle, RefreshCw, Shield, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentIdentity {
  id: string;
  organizationId: number;
  agentId: string;
  displayName: string;
  ownerId: string;
  environment: string;
  status: string;
  riskLevel: string;
  policyBundleId?: string | null;
  metadata?: Record<string, unknown>;
  lastReviewedAt?: string | null;
  createdAt: string;
}

interface PermissionGrant {
  id: string;
  tool: string;
  action: string;
  resource: string;
  effect: string;
  requiresApproval: boolean;
  expiresAt?: string | null;
  createdAt: string;
}

interface PolicyBundleGrant {
  tool: string;
  action: string;
  resource: string;
  effect: string;
  requiresApproval: boolean;
  expiresInDays?: number;
}

interface PolicyBundle {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  riskLevel: string;
  grants: PolicyBundleGrant[];
  updatedAt: string;
}

interface AuditEvent {
  id: number;
  tool: string;
  action: string;
  resource: string;
  decision: string;
  riskLevel: string;
  policyCodes: string[];
  createdAt: string;
}

interface IdentityDetail {
  identity: AgentIdentity;
  grants: PermissionGrant[];
  auditEvents: AuditEvent[];
}

function riskBadge(risk: string) {
  if (risk === "critical" || risk === "high") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (risk === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function statusBadge(status: string) {
  if (status === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "suspended" || status === "revoked") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return "border-border/30 bg-muted/10 text-foreground";
}

function sourceLabel(identity?: AgentIdentity) {
  const type = identity?.metadata?.principalType;
  return typeof type === "string" ? type.replace(/_/g, " ") : "agent";
}

export default function AgentIdentityControl() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [grantForm, setGrantForm] = useState({
    tool: "",
    action: "read",
    resource: "*",
    effect: "allow",
    requiresApproval: false,
    expiresAt: "",
  });
  const [bundleForm, setBundleForm] = useState({
    name: "",
    description: "",
    riskLevel: "medium",
    tool: "",
    action: "read",
    resource: "*",
    effect: "allow",
    requiresApproval: true,
    expiresInDays: "",
  });

  const identitiesQuery = useQuery<{ identities: AgentIdentity[]; count: number }>({
    queryKey: ["/api/governor/agent-identities"],
  });

  const identities = identitiesQuery.data?.identities ?? [];
  const selectedIdentityId = selectedId ?? identities[0]?.id ?? null;

  const detailQuery = useQuery<IdentityDetail>({
    queryKey: ["/api/governor/agent-identities", selectedIdentityId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/governor/agent-identities/${selectedIdentityId}`);
      return res.json();
    },
    enabled: !!selectedIdentityId,
  });

  const policyBundlesQuery = useQuery<{ bundles: PolicyBundle[]; count: number }>({
    queryKey: ["/api/governor/agent-policy-bundles"],
  });

  const updateStatus = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/governor/agent-identities/${selectedIdentityId}/status`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities", selectedIdentityId] });
    },
  });

  const createGrant = useMutation({
    mutationFn: async () => {
      const body = {
        tool: grantForm.tool.trim(),
        action: grantForm.action.trim(),
        resource: grantForm.resource.trim() || "*",
        effect: grantForm.effect,
        requiresApproval: grantForm.requiresApproval,
        ...(grantForm.expiresAt ? { expiresAt: new Date(grantForm.expiresAt).toISOString() } : {}),
      };
      const res = await apiRequest("POST", `/api/governor/agent-identities/${selectedIdentityId}/grants`, body);
      return res.json();
    },
    onSuccess: () => {
      setGrantForm({ tool: "", action: "read", resource: "*", effect: "allow", requiresApproval: false, expiresAt: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities", selectedIdentityId] });
    },
  });

  const expireGrant = useMutation({
    mutationFn: async (grantId: string) => {
      const res = await apiRequest("PATCH", `/api/governor/agent-identities/${selectedIdentityId}/grants/${grantId}/expire`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities", selectedIdentityId] });
    },
  });

  const createPolicyBundle = useMutation({
    mutationFn: async () => {
      const grant: PolicyBundleGrant = {
        tool: bundleForm.tool.trim(),
        action: bundleForm.action.trim(),
        resource: bundleForm.resource.trim() || "*",
        effect: bundleForm.effect,
        requiresApproval: bundleForm.requiresApproval,
        ...(bundleForm.expiresInDays ? { expiresInDays: Number(bundleForm.expiresInDays) } : {}),
      };
      const res = await apiRequest("POST", "/api/governor/agent-policy-bundles", {
        name: bundleForm.name.trim(),
        description: bundleForm.description.trim() || undefined,
        riskLevel: bundleForm.riskLevel,
        grants: [grant],
      });
      return res.json();
    },
    onSuccess: () => {
      setBundleForm({
        name: "",
        description: "",
        riskLevel: "medium",
        tool: "",
        action: "read",
        resource: "*",
        effect: "allow",
        requiresApproval: true,
        expiresInDays: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-policy-bundles"] });
    },
  });

  const applyPolicyBundle = useMutation({
    mutationFn: async (policyBundleId: string) => {
      const res = await apiRequest("POST", `/api/governor/agent-identities/${selectedIdentityId}/apply-policy-bundle`, { policyBundleId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-identities", selectedIdentityId] });
    },
  });

  const filteredIdentities = useMemo(() => {
    if (statusFilter === "all") return identities;
    return identities.filter((identity) => identity.status === statusFilter);
  }, [identities, statusFilter]);

  const detail = detailQuery.data;
  const selected = detail?.identity ?? identities.find((identity) => identity.id === selectedIdentityId);
  const policyBundles = policyBundlesQuery.data?.bundles ?? [];

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-6 flex flex-col gap-4 border-b border-foreground/10 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2">
              <Fingerprint className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
            </div>
            <h1 className="text-2xl font-black uppercase italic tracking-tight text-foreground">Agent Identity Control</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Manage agent principals, permission grants, review status, and recent governance decisions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", "active", "draft", "suspended", "revoked"].map((status) => (
            <Button
              key={status}
              size="sm"
              variant={statusFilter === status ? "default" : "outline"}
              onClick={() => setStatusFilter(status)}
              className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
            >
              {status}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <Card className="border-foreground/10 bg-foreground/[0.04]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight text-foreground">
              <Bot className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              Identities
              <Badge variant="outline" className="ml-2 border-foreground/10 bg-foreground/5 text-[10px] text-foreground">
                {filteredIdentities.length}
              </Badge>
            </CardTitle>
            <CardDescription>Click an identity to inspect grants and audit events.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[680px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-foreground/10 hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Agent</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Source</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Risk</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIdentities.map((identity) => (
                    <TableRow
                      key={identity.id}
                      onClick={() => setSelectedId(identity.id)}
                      className={cn(
                        "cursor-pointer border-foreground/10 hover:bg-foreground/[0.06]",
                        selectedIdentityId === identity.id && "bg-cyan-400/[0.08]",
                      )}
                    >
                      <TableCell>
                        <div className="font-bold text-foreground">{identity.displayName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{identity.agentId}</div>
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">{sourceLabel(identity)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-black uppercase", riskBadge(identity.riskLevel))}>
                          {identity.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-black uppercase", statusBadge(identity.status))}>
                          {identity.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-foreground/10 bg-foreground/[0.04]">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">
                  {selected?.displayName ?? "Select an identity"}
                </CardTitle>
                <CardDescription className="mt-1 font-mono text-[11px]">
                  {selected?.agentId ?? "No identity selected"}
                </CardDescription>
              </div>
              {selected && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ lastReviewedAt: new Date().toISOString() })}
                    className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                  >
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                    Reviewed
                  </Button>
                  {selected.status === "active" ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ status: "suspended" })}
                      className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                    >
                      <PauseCircle className="mr-2 h-3.5 w-3.5" />
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ status: "active" })}
                      className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                    >
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      Activate
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selected ? (
              <Tabs defaultValue="grants">
                <TabsList className="mb-4 grid w-full grid-cols-4 bg-background/20">
                  <TabsTrigger value="grants">Grants</TabsTrigger>
                  <TabsTrigger value="bundles">Bundles</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                </TabsList>

                <TabsContent value="grants">
                  <ScrollArea className="h-[560px]">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
                        <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">
                          <KeyRound className="h-3.5 w-3.5" />
                          Add Grant
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            value={grantForm.tool}
                            onChange={(event) => setGrantForm((form) => ({ ...form, tool: event.target.value }))}
                            placeholder="tool, e.g. github"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            value={grantForm.action}
                            onChange={(event) => setGrantForm((form) => ({ ...form, action: event.target.value }))}
                            placeholder="action, e.g. read"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            value={grantForm.resource}
                            onChange={(event) => setGrantForm((form) => ({ ...form, resource: event.target.value }))}
                            placeholder="resource"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            type="datetime-local"
                            value={grantForm.expiresAt}
                            onChange={(event) => setGrantForm((form) => ({ ...form, expiresAt: event.target.value }))}
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            {["allow", "deny"].map((effect) => (
                              <Button
                                key={effect}
                                type="button"
                                size="sm"
                                variant={grantForm.effect === effect ? "default" : "outline"}
                                onClick={() => setGrantForm((form) => ({ ...form, effect }))}
                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                              >
                                {effect}
                              </Button>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              variant={grantForm.requiresApproval ? "default" : "outline"}
                              onClick={() => setGrantForm((form) => ({ ...form, requiresApproval: !form.requiresApproval }))}
                              className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                            >
                              Approval {grantForm.requiresApproval ? "on" : "off"}
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            disabled={!grantForm.tool.trim() || !grantForm.action.trim() || createGrant.isPending}
                            onClick={() => createGrant.mutate()}
                            className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                          >
                            Add Grant
                          </Button>
                        </div>
                      </div>

                      {(detail?.grants ?? []).map((grant) => (
                        <div key={grant.id} className={cn("rounded-xl border border-foreground/10 bg-background/20 p-4", isGrantExpired(grant) && "opacity-55")}>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="font-mono text-sm font-bold text-foreground">
                              {grant.tool}.{grant.action}
                            </div>
                            <div className="flex items-center gap-2">
                              {isGrantExpired(grant) && (
                                <Badge variant="outline" className="border-border/30 bg-muted/10 text-[10px] font-black uppercase text-foreground">
                                  Expired
                                </Badge>
                              )}
                              <Badge variant="outline" className={cn("text-[10px] font-black uppercase", grant.effect === "deny" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                                {grant.effect}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">Resource: {grant.resource}</div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                              {grant.requiresApproval && (
                                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">
                                  <ShieldAlert className="mr-1 h-3 w-3" />
                                  Approval required
                                </Badge>
                              )}
                              {grant.expiresAt && (
                                <Badge variant="outline" className="border-foreground/10 bg-foreground/5 text-[10px] font-black uppercase text-muted-foreground">
                                  Expires {new Date(grant.expiresAt).toLocaleString()}
                                </Badge>
                              )}
                            </div>
                            {!isGrantExpired(grant) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={expireGrant.isPending}
                                onClick={() => expireGrant.mutate(grant.id)}
                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                Expire
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="bundles">
                  <ScrollArea className="h-[560px]">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
                        <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">
                          <PackageCheck className="h-3.5 w-3.5" />
                          Create Policy Bundle
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            value={bundleForm.name}
                            onChange={(event) => setBundleForm((form) => ({ ...form, name: event.target.value }))}
                            placeholder="bundle name"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <select
                            value={bundleForm.riskLevel}
                            onChange={(event) => setBundleForm((form) => ({ ...form, riskLevel: event.target.value }))}
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none"
                          >
                            {["low", "medium", "high", "critical"].map((risk) => (
                              <option key={risk} value={risk}>{risk}</option>
                            ))}
                          </select>
                          <input
                            value={bundleForm.description}
                            onChange={(event) => setBundleForm((form) => ({ ...form, description: event.target.value }))}
                            placeholder="description"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground md:col-span-2"
                          />
                          <input
                            value={bundleForm.tool}
                            onChange={(event) => setBundleForm((form) => ({ ...form, tool: event.target.value }))}
                            placeholder="tool, e.g. github"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            value={bundleForm.action}
                            onChange={(event) => setBundleForm((form) => ({ ...form, action: event.target.value }))}
                            placeholder="action, e.g. read"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            value={bundleForm.resource}
                            onChange={(event) => setBundleForm((form) => ({ ...form, resource: event.target.value }))}
                            placeholder="resource"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={bundleForm.expiresInDays}
                            onChange={(event) => setBundleForm((form) => ({ ...form, expiresInDays: event.target.value }))}
                            placeholder="expires in days"
                            className="h-10 rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            {["allow", "deny"].map((effect) => (
                              <Button
                                key={effect}
                                type="button"
                                size="sm"
                                variant={bundleForm.effect === effect ? "default" : "outline"}
                                onClick={() => setBundleForm((form) => ({ ...form, effect }))}
                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                              >
                                {effect}
                              </Button>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              variant={bundleForm.requiresApproval ? "default" : "outline"}
                              onClick={() => setBundleForm((form) => ({ ...form, requiresApproval: !form.requiresApproval }))}
                              className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                            >
                              Approval {bundleForm.requiresApproval ? "on" : "off"}
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            disabled={!bundleForm.name.trim() || !bundleForm.tool.trim() || !bundleForm.action.trim() || createPolicyBundle.isPending}
                            onClick={() => createPolicyBundle.mutate()}
                            className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                          >
                            Create Bundle
                          </Button>
                        </div>
                      </div>

                      {policyBundles.map((bundle) => (
                        <div key={bundle.id} className="rounded-xl border border-foreground/10 bg-background/20 p-4">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-foreground">{bundle.name}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{bundle.description || "No description"}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Badge variant="outline" className={cn("text-[10px] font-black uppercase", riskBadge(bundle.riskLevel))}>
                                {bundle.riskLevel}
                              </Badge>
                              <Badge variant="outline" className={cn("text-[10px] font-black uppercase", statusBadge(bundle.status))}>
                                {bundle.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {bundle.grants.map((grant, index) => (
                              <div key={`${bundle.id}-${index}`} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
                                <div className="font-mono text-xs font-bold text-foreground">{grant.tool}.{grant.action}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                                  <span>{grant.resource}</span>
                                  <span>{grant.effect}</span>
                                  {grant.requiresApproval && <span>approval</span>}
                                  {grant.expiresInDays && <span>{grant.expiresInDays}d expiry</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            disabled={bundle.status !== "active" || applyPolicyBundle.isPending}
                            onClick={() => applyPolicyBundle.mutate(bundle.id)}
                            className="mt-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                          >
                            Apply To Identity
                          </Button>
                        </div>
                      ))}
                      {policyBundles.length === 0 && (
                        <div className="rounded-xl border border-foreground/10 bg-background/20 p-6 text-sm text-muted-foreground">No policy bundles yet.</div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="audit">
                  <ScrollArea className="h-[560px]">
                    <div className="space-y-3">
                      {(detail?.auditEvents ?? []).map((event) => (
                        <div key={event.id} className="rounded-xl border border-foreground/10 bg-background/20 p-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="font-mono text-sm font-bold text-foreground">
                              {event.tool}.{event.action}
                            </div>
                            <Badge variant="outline" className={cn("text-[10px] font-black uppercase", statusBadge(event.decision))}>
                              {event.decision}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{event.resource}</div>
                          <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString()} / {event.policyCodes?.join(", ") || "no policy codes"}
                          </div>
                        </div>
                      ))}
                      {detail?.auditEvents?.length === 0 && (
                        <div className="rounded-xl border border-foreground/10 bg-background/20 p-6 text-sm text-muted-foreground">No audit events yet.</div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="profile">
                  <div className="space-y-3">
                    <InfoRow label="Environment" value={selected.environment} />
                    <InfoRow label="Owner" value={selected.ownerId} />
                    <InfoRow label="Source" value={sourceLabel(selected)} />
                    <InfoRow label="Policy bundle" value={selected.policyBundleId ?? "None"} />
                    <InfoRow label="Last reviewed" value={selected.lastReviewedAt ? new Date(selected.lastReviewedAt).toLocaleString() : "Not reviewed"} />
                    <InfoRow label="Created" value={new Date(selected.createdAt).toLocaleString()} />
                    <div className="rounded-xl border border-foreground/10 bg-background/20 p-4">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <Shield className="h-3.5 w-3.5" />
                        Source Metadata
                      </div>
                      <div className="space-y-2">
                        {Object.entries(selected.metadata ?? {}).slice(0, 12).map(([key, value]) => (
                          <InfoRow key={key} label={key.replace(/([a-z])([A-Z])/g, "$1 $2")} value={String(value)} />
                        ))}
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex h-[560px] items-center justify-center rounded-xl border border-foreground/10 bg-background/20 text-sm text-muted-foreground">
                No identities found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function isGrantExpired(grant: PermissionGrant) {
  return !!grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now();
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-foreground/10 bg-background/20 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="truncate text-right text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
