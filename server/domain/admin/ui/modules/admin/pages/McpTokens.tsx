/**
 * MCP API Tokens Management Page
 * 
 * Admin UI for creating and managing MCP API tokens with RBAC permissions.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@domain-ui/core/ui/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@domain-ui/core/ui/components/ui/alert-dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
    Trash2,
    Copy,
    Check,
    Shield,
    Clock,
    Activity,
    Eye,
    EyeOff,
    Settings,
    RefreshCw,
    AlertTriangle,
    Download,
    ShieldCheck,
    Globe,
    Plus,
    Server,
    Key,
    Database,
    ShieldAlert
} from "lucide-react";

interface McpToken {
    id: number;
    name: string;
    description?: string;
    tokenPrefix: string;
    userId: string;
    organizationId: number;
    permissions: string[];
    resourceScoping: Record<string, string[]>;
    isActive: boolean;
    expiresAt?: string;
    lastUsedAt?: string;
    usageCount: number;
    createdAt: string;
}

interface PermissionGroup {
    [key: string]: string[];
}

export default function McpTokens() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newTokenVisible, setNewTokenVisible] = useState(false);
    const [createdToken, setCreatedToken] = useState<string | null>(null);
    const [tokenCopied, setTokenCopied] = useState(false);
    const [editingToken, setEditingToken] = useState<McpToken | null>(null);

    // Form state
    const [tokenName, setTokenName] = useState("");
    const [tokenDescription, setTokenDescription] = useState("");
    const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
    const [resourceScoping, setResourceScoping] = useState<Record<string, string[]>>({});

    // Fetch tokens
    const { data: tokensData, isLoading: tokensLoading } = useQuery<{ tokens: McpToken[] }>({
        queryKey: ["/api/mcp/tokens"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/mcp/tokens");
            return res.json();
        },
    });

    // Fetch available permissions
    const { data: permissionsData } = useQuery<{ permissions: string[]; groups: PermissionGroup }>({
        queryKey: ["/api/mcp/permissions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/mcp/permissions");
            return res.json();
        },
    });

    // Fetch org settings
    const { data: orgSettings } = useQuery<{ mcpHttpEnabled: boolean }>({
        queryKey: ["/api/mcp/org-settings"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/mcp/org-settings");
            return res.json();
        },
    });

    // Create token mutation
    const createTokenMutation = useMutation({
        mutationFn: async (data: { name: string; description?: string; permissions: string[]; resourceScoping: Record<string, string[]> }) => {
            const res = await apiRequest("POST", "/api/mcp/tokens", data);
            return res.json();
        },
        onSuccess: (result: { token: any; rawToken: string }) => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp/tokens"] });
            setCreatedToken(result.rawToken);
            setNewTokenVisible(true);
            toast({ title: "Token created", description: "Your new API token has been created." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message || "Failed to create token", variant: "destructive" });
        },
    });

    // Update token mutation
    const updateTokenMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number; data: { name?: string; description?: string; permissions?: string[]; resourceScoping?: Record<string, string[]>; isActive?: boolean } }) => {
            const res = await apiRequest("PATCH", `/api/mcp/tokens/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp/tokens"] });
            setEditingToken(null);
            toast({ title: "Token updated", description: "Token permissions have been updated." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message || "Failed to update token", variant: "destructive" });
        },
    });

    // Revoke token mutation
    const revokeTokenMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("POST", `/api/mcp/tokens/${id}/revoke`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp/tokens"] });
            toast({ title: "Token revoked", description: "The token has been revoked and can no longer be used." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message || "Failed to revoke token", variant: "destructive" });
        },
    });

    // Delete token mutation
    const deleteTokenMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("DELETE", `/api/mcp/tokens/${id}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp/tokens"] });
            toast({ title: "Token deleted", description: "The token has been permanently deleted." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message || "Failed to delete token", variant: "destructive" });
        },
    });

    // Update org settings mutation
    const updateOrgSettingsMutation = useMutation({
        mutationFn: async (mcpHttpEnabled: boolean) => {
            const res = await apiRequest("PATCH", "/api/mcp/org-settings", { mcpHttpEnabled });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp/org-settings"] });
            toast({ title: "Settings updated", description: "MCP HTTP access settings have been updated." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message || "Failed to update settings", variant: "destructive" });
        },
    });

    const tokens: McpToken[] = tokensData?.tokens || [];
    const permissionGroups: PermissionGroup = permissionsData?.groups || {};
    const mcpEnabled = orgSettings?.mcpHttpEnabled ?? false;

    const handleCreateToken = () => {
        if (!tokenName.trim()) {
            toast({ title: "Error", description: "Token name is required", variant: "destructive" });
            return;
        }
        createTokenMutation.mutate({
            name: tokenName,
            description: tokenDescription || undefined,
            permissions: selectedPermissions,
            resourceScoping,
        });
    };

    const handleEditToken = (token: McpToken) => {
        setEditingToken(token);
        setTokenName(token.name);
        setTokenDescription(token.description || "");
        setSelectedPermissions(token.permissions);
        setResourceScoping(token.resourceScoping || {});
        setCreateDialogOpen(true);
    };

    const handleCopyToken = async () => {
        if (createdToken) {
            await navigator.clipboard.writeText(createdToken);
            setTokenCopied(true);
            setTimeout(() => setTokenCopied(false), 2000);
        }
    };

    const handleCloseNewTokenDialog = () => {
        setNewTokenVisible(false);
        setCreatedToken(null);
        setCreateDialogOpen(false);
        setEditingToken(null);
        setTokenName("");
        setTokenDescription("");
        setSelectedPermissions([]);
        setResourceScoping({});
    };

    const togglePermission = (permission: string) => {
        setSelectedPermissions(prev =>
            prev.includes(permission)
                ? prev.filter(p => p !== permission)
                : [...prev, permission]
        );
    };

    const selectAllInGroup = (permissions: string[]) => {
        const allSelected = permissions.every(p => selectedPermissions.includes(p));
        if (allSelected) {
            setSelectedPermissions(prev => prev.filter(p => !permissions.includes(p)));
        } else {
            setSelectedPermissions(prev => [...new Set([...prev, ...permissions])]);
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return "Never";
        return new Date(dateString).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getPermissionColor = (permission: string): string => {
        if (permission.includes("admin")) return "bg-red-500";
        if (permission.includes("write") || permission.includes("execute")) return "bg-amber-500";
        return "bg-blue-500";
    };

    return (
        <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
            {/* Cinematic Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 cinematic-grid opacity-20" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay" />
            </div>

            <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
                {/* Header */}
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8"
                >
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-[0.3em] uppercase italic">
                            <Key className="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                            Access Matrix Alpha
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                                MCP <span className="text-primary font-light not-italic tracking-[-0.05em]">API Gateways</span>
                            </h1>
                            <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                                Managing high-fidelity neural uplinks and permission-scoped authorization tokens.
                            </p>
                        </div>
                    </div>

                    <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-16 px-10 rounded-[2rem] bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all active:scale-95 group">
                                <Plus className="h-5 w-5 mr-3 group-hover:rotate-90 transition-transform" />
                                Generate New Uplink
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl bg-background/95 border-foreground/10 glass-panel-deep backdrop-blur-3xl rounded-[3rem] p-0 overflow-hidden shadow-[0_0_100px_rgba(var(--primary),0.1)]">
                            <DialogHeader className="p-10 pb-0">
                                <DialogTitle className="text-3xl font-black italic tracking-tighter uppercase text-foreground">Provision Uplink Primitive</DialogTitle>
                                <DialogDescription className="text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed pt-2">
                                    Configure authorization boundaries and resource scoping for external system bridges.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-10 space-y-8">
                                {createdToken ? (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                        <div className="p-6 rounded-3xl bg-amber-500/10 border border-amber-500/20 shadow-[0_0_30px_rgba(245,158,11,0.1)]">
                                            <div className="flex items-center gap-3 text-amber-500 mb-4">
                                                <AlertTriangle className="h-5 w-5 animate-pulse" />
                                                <span className="text-[10px] font-black uppercase tracking-widest italic">Critical Security Protocol</span>
                                            </div>
                                            <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/60 mb-6 italic leading-relaxed">
                                                This token is temporary and will be permanently scrubbed from the active view following handshake confirmation.
                                            </p>
                                            <div className="flex items-center gap-3">
                                                <Input
                                                    value={createdToken}
                                                    readOnly
                                                    className="h-14 bg-background/40 border-foreground/5 font-mono text-primary text-xs rounded-2xl tracking-tight"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleCopyToken}
                                                    className="h-14 w-14 rounded-2xl bg-primary/20 border border-primary/20 text-primary hover:bg-primary transition-all shadow-glow"
                                                >
                                                    {tokenCopied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                                                </Button>
                                            </div>
                                        </div>
                                        <Button onClick={handleCloseNewTokenDialog} className="w-full h-14 rounded-2xl bg-foreground/5 border border-foreground/10 text-[10px] font-black uppercase tracking-widest hover:bg-foreground/10 transition-all">
                                            Handshake Confirmed
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-8">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-3">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">Primitive Label</Label>
                                                <Input
                                                    placeholder="NEURAL_BRIDGE_01"
                                                    value={tokenName}
                                                    onChange={(e) => setTokenName(e.target.value)}
                                                    className="h-14 rounded-2xl bg-foreground/[0.03] border-foreground/10 text-[11px] font-bold uppercase tracking-wider focus:border-primary/50 transition-all shadow-inner"
                                                />
                                            </div>
                                            <div className="space-y-3">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">System Context</Label>
                                                <Input
                                                    placeholder="ONYX_INTEGRATION_ALPHA"
                                                    value={tokenDescription}
                                                    onChange={(e) => setTokenDescription(e.target.value)}
                                                    className="h-14 rounded-2xl bg-foreground/[0.03] border-foreground/10 text-[11px] font-bold uppercase tracking-wider focus:border-primary/50 transition-all shadow-inner"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">Permission Matrix</Label>
                                            <Tabs defaultValue="knowledge" className="w-full">
                                                <TabsList className="h-12 bg-foreground/[0.03] border border-foreground/10 rounded-xl p-1 gap-1 mb-6">
                                                    {Object.keys(permissionGroups).map(group => (
                                                        <TabsTrigger key={group} value={group} className="flex-1 rounded-lg text-[9px] font-black uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all italic">
                                                            {group}
                                                        </TabsTrigger>
                                                    ))}
                                                    <TabsTrigger value="scoping" className="flex-1 rounded-lg text-[9px] font-black uppercase tracking-widest data-[state=active]:bg-emerald-500 data-[state=active]:text-foreground transition-all italic">
                                                        Scoping
                                                    </TabsTrigger>
                                                </TabsList>

                                                {Object.entries(permissionGroups).map(([group, permissions]) => (
                                                    <TabsContent key={group} value={group} className="animate-in fade-in duration-300">
                                                        <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                            {permissions.map(permission => (
                                                                <div key={permission} className="flex items-center gap-3 p-3 rounded-xl border border-foreground/5 bg-foreground/[0.01] hover:bg-foreground/5 transition-all cursor-pointer group/perm" onClick={() => togglePermission(permission)}>
                                                                    <Checkbox
                                                                        id={permission}
                                                                        checked={selectedPermissions.includes(permission)}
                                                                        onCheckedChange={() => togglePermission(permission)}
                                                                        className="border-foreground/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                                    />
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[9px] font-black uppercase tracking-wider text-foreground group-hover/perm:text-primary transition-colors">{permission.split(":")[1]}</span>
                                                                        <span className="text-[8px] font-bold text-foreground/20 uppercase tracking-tighter italic">{permission.split(":")[0]}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </TabsContent>
                                                ))}

                                                <TabsContent value="scoping" className="space-y-4 animate-in fade-in duration-300">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest italic">Neural Scoping Rules</p>
                                                        <Button variant="ghost" size="sm" onClick={() => {
                                                            const key = prompt("Enter Permission Boundary (e.g., document:read):");
                                                            if (key) setResourceScoping(prev => ({ ...prev, [key]: ["*"] }));
                                                        }} className="h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500 hover:text-foreground transition-all">
                                                            Insert Bound
                                                        </Button>
                                                    </div>
                                                    <div className="space-y-4 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                                                        {Object.entries(resourceScoping).map(([perm, rules]) => (
                                                            <div key={perm} className="p-4 rounded-2xl border border-foreground/5 bg-foreground/[0.01] space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-emerald-500/30 text-emerald-400 font-mono italic">{perm}</Badge>
                                                                    <Button variant="ghost" size="sm" onClick={() => {
                                                                        const next = { ...resourceScoping };
                                                                        delete next[perm];
                                                                        setResourceScoping(next);
                                                                    }} className="h-6 w-6 rounded-full hover:bg-rose-500/10 text-rose-500 transition-all">
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                                <Textarea
                                                                    className="min-h-[60px] bg-background/20 border-foreground/5 font-mono text-[10px] text-foreground/40 focus:text-emerald-400 transition-all rounded-xl"
                                                                    value={rules.join("\n")}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value.split("\n").filter(r => r.trim());
                                                                        setResourceScoping(prev => ({ ...prev, [perm]: val }));
                                                                    }}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </TabsContent>
                                            </Tabs>
                                        </div>

                                        <Button
                                            onClick={handleCreateToken}
                                            disabled={createTokenMutation.isPending}
                                            className="w-full h-16 rounded-[1.5rem] bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] text-[11px] shadow-glow active:scale-95 transition-all"
                                        >
                                            {createTokenMutation.isPending ? "Generating..." : "Generate Access Primitive"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
                </motion.div>

                {/* Body Content - Systems Vitality & Token Matrix */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <CardHeader className="pb-4 pt-10 px-10">
                            <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                                <Server className="h-6 w-6 text-primary" />
                                System Vitality Settings
                            </CardTitle>
                            <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic pt-1">
                                Operational control of external neural uplinks via HTTP/SSE protocols.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-10 pb-10">
                            <div className="flex items-center justify-between p-6 rounded-[2rem] bg-foreground/[0.02] border border-foreground/5 shadow-inner">
                                <div className="space-y-1">
                                    <Label className="text-sm font-black italic uppercase tracking-wider text-foreground">Enable Uplink Protocol</Label>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/20 leading-relaxed max-w-lg italic">
                                        When activated, external entities can establish bridges to the neural array using verified Bearer tokens.
                                        Target Ref: <code className="text-primary italic bg-primary/5 px-2 py-0.5 rounded">http://localhost:3001/uplink</code>
                                    </p>
                                </div>
                                <Switch
                                    checked={mcpEnabled}
                                    onCheckedChange={(checked) => updateOrgSettingsMutation.mutate(checked)}
                                    disabled={updateOrgSettingsMutation.isPending}
                                    className="data-[state=checked]:bg-primary"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Tokens List Section */}
                <div className="space-y-8">
                    <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-foreground/10" />
                        <h2 className="text-[10px] font-black uppercase tracking-[0.5em] text-foreground/20 italic">Verified Uplink Registry</h2>
                        <div className="h-px flex-1 bg-foreground/10" />
                    </div>

                    {tokensLoading ? (
                        <div className="flex items-center justify-center py-24">
                            <RefreshCw className="h-10 w-10 animate-spin text-primary opacity-20" />
                        </div>
                    ) : tokens.length === 0 ? (
                        <div className="text-center py-32 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center space-y-8 px-12">
                            <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20">
                                <Key className="h-10 w-10 text-primary animate-pulse" />
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter italic">No Uplinks Configured</h3>
                                <p className="text-foreground/40 text-[10px] font-black uppercase tracking-widest max-w-sm mx-auto italic">Generate a high-fidelity access key to begin external system integration.</p>
                            </div>
                            <Button onClick={() => setCreateDialogOpen(true)} className="h-14 px-12 rounded-[1.5rem] bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl active:scale-95 transition-all">
                                Provision Initial Key
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6">
                            <AnimatePresence>
                                {tokens.map((token, idx) => (
                                    <motion.div
                                        key={token.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        className={cn(
                                            "glass-panel-deep border overflow-hidden relative rounded-[2.5rem] group transition-all duration-500",
                                            !token.isActive ? "border-foreground/5 opacity-40 grayscale" : "border-foreground/10 hover:border-primary/30"
                                        )}
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                        
                                        <div className="p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                                            <div className="space-y-4 flex-1">
                                                <div className="flex items-center gap-4 flex-wrap">
                                                    <h3 className="text-2xl font-black italic tracking-tighter uppercase text-foreground group-hover:text-primary transition-colors">{token.name}</h3>
                                                    <Badge className={cn(
                                                        "text-[9px] tracking-[0.2em] font-black h-6 px-3 rounded-lg uppercase italic border",
                                                        token.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-foreground/5 text-foreground/40 border-foreground/10"
                                                    )}>
                                                        {token.isActive ? "ACTIVE_SIGNAL" : "SIGNAL_REVOKED"}
                                                    </Badge>
                                                </div>
                                                
                                                {token.description && (
                                                    <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/40 italic leading-relaxed max-w-2xl">{token.description}</p>
                                                )}
                                                
                                                <div className="flex items-center gap-8 text-[9px] font-black uppercase tracking-widest text-foreground/20 italic mt-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-primary/60 font-mono tracking-normal">{token.tokenPrefix}...</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 border-l border-foreground/5 pl-8">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        PROVISIONED: {formatDate(token.createdAt)}
                                                    </div>
                                                    <div className="flex items-center gap-2 border-l border-foreground/5 pl-8">
                                                        <Activity className="h-3.5 w-3.5" />
                                                        THROUGHPUT: {token.usageCount} UNITS
                                                    </div>
                                                </div>
                                                
                                                <div className="flex flex-wrap gap-2 mt-4">
                                                    {(token.permissions as string[]).map(perm => {
                                                        const [dom, op] = perm.split(':');
                                                        return (
                                                            <Badge key={perm} variant="outline" className="bg-foreground/[0.02] border-foreground/10 text-[8px] font-black tracking-widest px-3 py-1 rounded-md text-foreground/60">
                                                                <span className="text-primary/80 mr-1">{dom}</span>_{op}
                                                            </Badge>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 self-end lg:self-center">
                                                {token.isActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-12 rounded-xl bg-foreground/[0.03] border border-foreground/10 text-[10px] font-black uppercase tracking-widest text-foreground hover:bg-foreground/10 transition-all"
                                                        onClick={() => handleEditToken(token)}
                                                    >
                                                        Refactor Rules
                                                    </Button>
                                                )}
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-12 w-12 rounded-xl bg-rose-500/5 border border-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-foreground transition-all shadow-xl"
                                                        >
                                                            <Trash2 className="h-5 w-5" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent className="bg-background/95 border-foreground/10 glass-panel-deep rounded-[2rem]">
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground">Permanent Deletion</AlertDialogTitle>
                                                            <AlertDialogDescription className="text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed pt-2">
                                                                This operation will irrevocably scrub the uplink primitive from the registry. No signal recovery possible.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter className="pt-6">
                                                            <AlertDialogCancel className="rounded-xl border-foreground/10 font-bold uppercase text-[10px] tracking-widest">Abort Scrub</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() => deleteTokenMutation.mutate(token.id)}
                                                                className="rounded-xl bg-rose-500 hover:bg-rose-600 font-bold uppercase text-[10px] tracking-widest"
                                                            >
                                                                Confirm Scrub
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>

                {/* Connection Protocol Guide */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group">
                        <CardHeader className="pb-4 pt-10 px-10">
                            <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                                <Settings className="h-6 w-6 text-primary" />
                                Uplink Integration Protocol
                            </CardTitle>
                            <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic pt-1">
                                Reference documentation for manual neural bridge establishment.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-10 pb-10 space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary italic">01</div>
                                        <h4 className="text-[11px] font-black uppercase tracking-wider text-foreground">Initialize Signal</h4>
                                    </div>
                                    <div className="bg-background/40 border border-foreground/10 rounded-xl p-4 font-mono text-[10px] text-primary/80">
                                        npm run mcp:http
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary italic">02</div>
                                        <h4 className="text-[11px] font-black uppercase tracking-wider text-foreground">Bridge Endpoints</h4>
                                    </div>
                                    <div className="bg-background/40 border border-foreground/10 rounded-xl p-4 space-y-2 font-mono text-[10px] text-foreground/60">
                                        <div className="flex justify-between border-b border-foreground/5 pb-1"><span>BASE:</span> <span className="text-primary/60">http://localhost:3001</span></div>
                                        <div className="flex justify-between border-b border-foreground/5 pb-1"><span>SSE:</span> <span className="text-primary/60">/sse</span></div>
                                        <div className="flex justify-between"><span>AUTH:</span> <span className="text-primary/60">Bearer &lt;TOKEN&gt;</span></div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary italic">03</div>
                                        <h4 className="text-[11px] font-black uppercase tracking-wider text-foreground">Handshake Test</h4>
                                    </div>
                                    <div className="bg-background/40 border border-foreground/10 rounded-xl p-4 font-mono text-[10px] text-foreground/40 overflow-x-auto">
                                        curl -H "Authorization: Bearer &lt;token&gt;" .../health
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                        <div className="absolute bottom-4 right-8 opacity-5">
                            <ShieldAlert className="w-24 h-24 text-primary" />
                        </div>
                    </Card>
                </motion.div>
            </main>
        </div>
    );
}
