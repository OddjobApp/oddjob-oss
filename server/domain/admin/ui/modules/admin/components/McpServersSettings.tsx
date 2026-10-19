import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@domain-ui/core/ui/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@domain-ui/core/ui/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@domain-ui/core/ui/components/ui/table";
import {
    Plus,
    Server,
    RefreshCw,
    Trash2,
    Edit,
    Plug,
    Activity,
    Cpu,
    Database,
    ShieldCheck,
    Settings
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

interface McpServer {
    id: number;
    name: string;
    description?: string;
    transport: "stdio" | "sse";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    status: "active" | "inactive" | "error" | "connecting";
    error?: string;
    lastConnectedAt?: string;
}

export default function McpServersSettings() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<McpServer | null>(null);

    // --- Queries ---
    const { data: servers, isLoading } = useQuery<McpServer[]>({
        queryKey: ["/api/mcp-servers"],
        refetchInterval: 5000 // Poll for status updates
    });

    // --- Mutations ---
    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("POST", "/api/mcp-servers", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp-servers"] });
            setIsAddDialogOpen(false);
            toast({ title: "Node Initialized", description: "MCP Server protocol established." });
        },
        onError: (e: Error) => {
            toast({ title: "Initialization Failed", description: e.message, variant: "destructive" });
        }
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number; data: any }) => {
            const res = await apiRequest("PATCH", `/api/mcp-servers/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp-servers"] });
            setEditingServer(null);
            toast({ title: "Protocol Updated", description: "Node configuration synced." });
        },
        onError: (e: Error) => {
            toast({ title: "Update Error", description: e.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/mcp-servers/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp-servers"] });
            toast({ title: "Node Decommissioned", description: "MCP Server connection terminated." });
        }
    });

    const connectMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("POST", `/api/mcp-servers/${id}/connect`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp-servers"] });
            toast({ title: "Uplink Secure", description: "Successfully connected to MCP Server." });
        },
        onError: (e: Error) => {
            toast({ title: "Uplink Failed", description: e.message, variant: "destructive" });
        }
    });

    const disconnectMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("POST", `/api/mcp-servers/${id}/disconnect`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/mcp-servers"] });
            toast({ title: "Uplink Terminated", description: "Disconnected from protocol." });
        }
    });

    // --- Form Handling ---
    const ServerForm = ({ initialData, onSubmit, onCancel }: { initialData?: Partial<McpServer>, onSubmit: (data: any) => void, onCancel: () => void }) => {
        const [formData, setFormData] = useState({
            name: initialData?.name || "",
            description: initialData?.description || "",
            transport: initialData?.transport || "stdio",
            command: initialData?.command || "",
            args: (initialData?.args || []).join(" "),
            url: initialData?.url || "",
            env: initialData?.env ? JSON.stringify(initialData.env, null, 2) : "{}"
        });

        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            let env = {};
            try {
                env = JSON.parse(formData.env || "{}");
            } catch (e) {
                toast({ title: "Invalid Protocol Schema", description: "Environment variables must be valid JSON", variant: "destructive" });
                return;
            }
            const args = formData.args.split(" ").filter(Boolean);
            onSubmit({ ...formData, args, env });
        };

        return (
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Node Designation</Label>
                        <Input
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            required
                            placeholder="RESONANCE_V3"
                            className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Transport Bridge</Label>
                        <Select
                            value={formData.transport}
                            onValueChange={(val: "stdio" | "sse") => setFormData({ ...formData, transport: val })}
                        >
                            <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground uppercase italic tracking-widest">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-background border-foreground/10">
                                <SelectItem value="stdio" className="text-[10px] font-bold uppercase italic tracking-widest cursor-pointer">STDIO (LOCAL HOST)</SelectItem>
                                <SelectItem value="sse" className="text-[10px] font-bold uppercase italic tracking-widest cursor-pointer">SSE (REMOTE NODE)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    {formData.transport === "stdio" ? (
                        <motion.div 
                            key="stdio"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-6"
                        >
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Exec Command</Label>
                                <Input
                                    value={formData.command}
                                    onChange={e => setFormData({ ...formData, command: e.target.value })}
                                    required
                                    placeholder="npx"
                                    className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground italic tracking-widest font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Runtime Arguments</Label>
                                <Input
                                    value={formData.args}
                                    onChange={e => setFormData({ ...formData, args: e.target.value })}
                                    placeholder="-y @modelcontextprotocol/server-memory"
                                    className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground italic tracking-widest font-mono"
                                />
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div 
                            key="sse"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-2"
                        >
                            <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Node Address URL</Label>
                            <Input
                                value={formData.url}
                                onChange={e => setFormData({ ...formData, url: e.target.value })}
                                required
                                placeholder="https://external-node.io/sse"
                                className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground italic tracking-widest font-mono"
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Payload Environment (JSON)</Label>
                    <Textarea
                        value={formData.env}
                        onChange={e => setFormData({ ...formData, env: e.target.value })}
                        className="bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-bold text-foreground italic tracking-widest font-mono min-h-[120px]"
                    />
                </div>

                <div className="flex items-center justify-end gap-3 pt-6 border-t border-foreground/5 bg-foreground/[0.01] -mx-8 -mb-8 p-8">
                    <Button variant="outline" type="button" onClick={onCancel} className="h-12 px-8 border-foreground/10 text-[10px] font-black uppercase tracking-widest italic rounded-xl">ABORT</Button>
                    <Button type="submit" className="h-12 px-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 italic">COMMIT PROTOCOL</Button>
                </div>
            </form>
        );
    };

    return (
        <div className="space-y-10">
            <div className="glass-panel-deep border-foreground/5 rounded-[2.5rem] relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                
                <CardHeader className="p-10 border-b border-foreground/5">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shadow-2xl shadow-primary/10">
                                   <Server className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                   <CardTitle className="text-3xl font-black text-foreground uppercase italic tracking-tighter">Node Registry</CardTitle>
                                   <CardDescription className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 italic">
                                      Model Context Protocol Grid Orchestrator.
                                   </CardDescription>
                                </div>
                            </div>
                        </div>
                        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                            <DialogTrigger asChild>
                                <Button className="h-12 px-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 italic active:scale-95 transition-all group">
                                    <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
                                    INITIALIZE NODE
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl bg-background border-foreground/10 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                                <DialogHeader className="p-8 pb-4">
                                    <DialogTitle className="text-2xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                                       <Cpu className="w-6 h-6 text-primary" />
                                       New Node Protocol
                                    </DialogTitle>
                                    <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-foreground/30 italic"> Configure secure bridge to external protocol provider. </DialogDescription>
                                </DialogHeader>
                                <div className="p-8 pt-4">
                                   <ServerForm
                                       onSubmit={(data) => createMutation.mutate(data)}
                                       onCancel={() => setIsAddDialogOpen(false)}
                                   />
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                           <RefreshCw className="w-12 h-12 animate-spin text-primary/40 mb-4" />
                           <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">Scanning Node Grid...</p>
                        </div>
                    ) : servers?.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-32 opacity-20 group-hover:opacity-40 transition-opacity">
                            <Database className="w-20 h-20 mb-6" />
                            <p className="text-[11px] font-black uppercase tracking-[0.5em] italic">Zero Active Nodes</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest mt-2 italic">Waiting for node configuration initialization.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-foreground/[0.02]">
                                    <TableRow className="border-foreground/5 hover:bg-transparent">
                                        <TableHead className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic h-14 px-10">Uplink Stat</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic h-14">Designation</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic h-14">Bridge Type</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic h-14">Terminal Cwd</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic h-14 text-right px-10">Protocols</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {servers?.map((server, i) => (
                                        <motion.tr 
                                            key={server.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="border-foreground/5 hover:bg-foreground/[0.02] transition-colors group/row"
                                        >
                                            <TableCell className="px-10 py-6">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full shadow-glow ${
                                                        server.status === "active" ? "bg-emerald-500 animate-pulse" : 
                                                        server.status === "error" ? "bg-red-500" : 
                                                        "bg-foreground/20"
                                                    }`} />
                                                    <span className={`text-[10px] font-black uppercase tracking-widest italic ${
                                                        server.status === "active" ? "text-emerald-500" : 
                                                        server.status === "error" ? "text-red-500" : 
                                                        "text-foreground/40"
                                                    }`}>{server.status}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-bold text-foreground uppercase italic tracking-tight text-sm">
                                                {server.name}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-2 py-1">
                                                    {server.transport.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-[10px] font-mono text-foreground/40 group-hover/row:text-foreground/80 transition-colors">
                                                {server.transport === "stdio"
                                                    ? `${server.command} ${server.args?.join(" ")}`.slice(0, 50) + "..."
                                                    : server.url
                                                }
                                            </TableCell>
                                            <TableCell className="text-right px-10">
                                                <div className="flex items-center justify-end gap-2">
                                                    <AnimatePresence mode="wait">
                                                        {server.status === "active" ? (
                                                            <Button
                                                                size="sm"
                                                                onClick={() => disconnectMutation.mutate(server.id)}
                                                                disabled={disconnectMutation.isPending}
                                                                className="h-9 w-9 p-0 bg-foreground/5 border border-foreground/5 hover:border-red-500/40 hover:bg-red-500/10 transition-all rounded-lg group/btn"
                                                            >
                                                                <RefreshCw className={`w-3.5 h-3.5 text-foreground/40 group-hover/btn:text-red-500 transition-colors ${disconnectMutation.isPending ? 'animate-spin' : ''}`} />
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                onClick={() => connectMutation.mutate(server.id)}
                                                                disabled={connectMutation.isPending}
                                                                className="h-9 w-9 p-0 bg-foreground/5 border border-foreground/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all rounded-lg group/btn"
                                                            >
                                                                <RefreshCw className={`w-3.5 h-3.5 text-foreground/40 group-hover/btn:text-emerald-500 transition-colors ${connectMutation.isPending ? 'animate-spin' : ''}`} />
                                                            </Button>
                                                        )}
                                                    </AnimatePresence>

                                                    <Dialog open={editingServer?.id === server.id} onOpenChange={(o) => !o && setEditingServer(null)}>
                                                        <DialogTrigger asChild>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => setEditingServer(server)}
                                                                className="h-9 w-9 p-0 bg-foreground/5 border border-foreground/5 hover:border-primary/40 hover:bg-primary/10 transition-all rounded-lg"
                                                            >
                                                                <Edit className="w-3.5 h-3.5 text-foreground/40 group-hover:text-primary transition-colors" />
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="max-w-2xl bg-background border-foreground/10 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                                                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                                                            <DialogHeader className="p-8 pb-4">
                                                                <DialogTitle className="text-2xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                                                                   <Settings className="w-6 h-6 text-primary" />
                                                                   Edit Node Status
                                                                </DialogTitle>
                                                            </DialogHeader>
                                                            <div className="p-8 pt-4">
                                                                {editingServer?.id === server.id && (
                                                                    <ServerForm
                                                                        initialData={server}
                                                                        onSubmit={(data) => updateMutation.mutate({ id: server.id, data })}
                                                                        onCancel={() => setEditingServer(null)}
                                                                    />
                                                                )}
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>

                                                    <Button
                                                        size="sm"
                                                        className="h-9 w-9 p-0 bg-foreground/5 border border-foreground/5 hover:border-red-500/40 hover:bg-red-500/20 transition-all rounded-lg group/trash"
                                                        onClick={() => {
                                                            if (confirm("Terminate this node protocol permanentely?")) {
                                                                deleteMutation.mutate(server.id);
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 text-red-500/40 group-hover:trash:text-red-500 transition-colors" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </motion.tr>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </div>
            
            <div className="flex items-center gap-10 opacity-30 px-4">
               <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  <span className="text-[8px] font-black uppercase tracking-[0.3em] italic text-foreground/40">Sec Bridge: Nominal</span>
               </div>
               <div className="flex items-center gap-2">
                  <Activity className="w-3 h-3 text-primary" />
                  <span className="text-[8px] font-black uppercase tracking-[0.3em] italic text-foreground/40">Packet Flow: Optimized</span>
               </div>
            </div>
        </div>
    );
}
