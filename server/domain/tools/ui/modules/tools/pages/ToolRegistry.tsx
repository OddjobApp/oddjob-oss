import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { type ApiSpec } from "@shared/schema/integrations";
import type { Org as Organization } from "@shared/schema/auth";
import { Link } from "wouter";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Plus, Upload, Check, Settings, Globe, ShieldOff, ShieldCheck, Pencil, Trash2, Cpu, Search, FileCode, Terminal, Layers, Database, Activity } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { format } from "date-fns";

interface BuiltinTool {
    name: string;
    label: string;
    group: string;
    description: string;
    adminOnly: boolean;
    source: "builtin";
    riskLevel?: string;
    schema?: any;
}

export default function ToolRegistry() {
    const { data: specs, isLoading: specsLoading } = useQuery<ApiSpec[]>({
        queryKey: ["/api/specs/management"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/specs/management");
            if (!res.ok) throw new Error("Failed to fetch specs");
            return res.json();
        },
    });

    const { data: builtinTools, isLoading: builtinsLoading } = useQuery<BuiltinTool[]>({
        queryKey: ["/api/tools/builtin"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/tools/builtin");
            if (!res.ok) throw new Error("Failed to fetch builtin tools");
            return res.json();
        },
    });

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [hideDeprecated, setHideDeprecated] = useState(true);
    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState<"builtin" | "custom">("builtin");

    const isLoading = specsLoading || builtinsLoading;

    const filteredSpecs = specs?.filter(s => {
        if (hideDeprecated && s.status === "deprecated") return false;
        if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.description || "").toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const filteredBuiltins = builtinTools?.filter(t => {
        if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.label.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const groupedBuiltins = filteredBuiltins?.reduce((acc, tool) => {
        if (!acc[tool.group]) acc[tool.group] = [];
        acc[tool.group].push(tool);
        return acc;
    }, {} as Record<string, BuiltinTool[]>);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30 flex flex-col">
      {/* Cinematic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 cinematic-grid opacity-15" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/5 blur-[160px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay" />
      </div>

      <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-end justify-between gap-10 border-b border-foreground/5 pb-10"
        >
          <div className="space-y-6 flex-1">
            <div className="flex items-center gap-4">
                <div className="p-3.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-2xl shadow-primary/10">
                   <Cpu className="w-7 h-7 text-primary shadow-glow" />
                </div>
                <div>
                   <h1 className="text-5xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                     Node <span className="text-primary font-light not-italic tracking-[-0.05em]">Capability Matrix</span>
                   </h1>
                   <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/30 italic mt-2 ml-1">
                      Orchestrating OS Primitives & High-Fidelity API Specifications.
                   </p>
                </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
             <div className="flex flex-col items-end gap-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500 italic">SYSTEM SYNC: ACTIVE</span>
                <div className="flex gap-1">
                   {[...Array(5)].map((_, i) => (
                      <div key={i} className="w-4 h-1 bg-emerald-500/20 rounded-full overflow-hidden">
                         <motion.div 
                            className="h-full bg-emerald-500" 
                            animate={{ x: ["-100%", "100%"] }} 
                            transition={{ repeat: Infinity, duration: 2, delay: i * 0.2, ease: "linear" }}
                         />
                      </div>
                   ))}
                </div>
             </div>
             {activeTab === "custom" && (
                <Button onClick={() => setIsAddOpen(true)} className="h-16 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.25em] shadow-2xl shadow-primary/20 transition-all active:scale-95 group italic">
                  <Plus className="h-5 w-5 mr-3 group-hover:rotate-90 transition-transform" />
                  INIT MODULE
                </Button>
             )}
          </div>
        </motion.div>

        <div className="flex flex-1 gap-12 min-h-0">
          {/* Tactical Sidebar HUD */}
          <div className="w-80 space-y-8 hidden lg:block">
            <div className="glass-panel-deep border-foreground/5 rounded-[3rem] p-10 space-y-10 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
              
              <div className="space-y-4">
                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Capability Search</Label>
                <div className="relative group/input">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20 group-focus-within/input:text-primary transition-colors" />
                  <input
                    type="text"
                    placeholder="QUERY_REGISTRY..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/10 rounded-2xl pl-12 pr-4 h-14 text-[11px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all italic"
                  />
                </div>
              </div>

              {activeTab === "custom" && (
                <div className="space-y-4 pt-10 border-t border-foreground/5">
                  <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Refinement Filters</Label>
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-foreground/[0.02] border border-foreground/5 group/toggle hover:border-foreground/10 transition-colors cursor-pointer" onClick={() => setHideDeprecated(!hideDeprecated)}>
                    <span className="text-[10px] font-black uppercase tracking-widest text-foreground/40 group-hover/toggle:text-foreground/60 transition-colors italic">Hide Decommissioned</span>
                    <Checkbox
                        id="hide-deprecated"
                        checked={hideDeprecated}
                        onCheckedChange={(checked) => setHideDeprecated(checked as boolean)}
                        className="border-foreground/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-md"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-6 pt-10 border-t border-foreground/5">
                 <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Security Uplink</Label>
                 <div className="p-6 rounded-[2rem] bg-emerald-500/[0.02] border border-emerald-500/10 space-y-3 relative group/status overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20 group-hover/status:bg-emerald-500/40 transition-colors" />
                    <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500/60 uppercase tracking-widest italic">
                        <ShieldCheck className="w-4 h-4 shadow-glow" /> Protocol Hardened
                    </div>
                    <p className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.2em] leading-relaxed italic">
                        ALL BUILT-IN CAPABILITIES ARE ISOLATED IN VIRTUALIZED RUNTIME ENVIRONMENTS.
                    </p>
                 </div>
              </div>

              <div className="space-y-3 pt-4">
                 <div className="flex items-center justify-between px-2">
                    <span className="text-[8px] font-black text-foreground/20 uppercase tracking-widest italic">Registry Load</span>
                    <span className="text-[8px] font-black text-primary uppercase tracking-widest italic">42%</span>
                 </div>
                 <div className="h-1 bg-foreground/5 rounded-full overflow-hidden">
                    <motion.div 
                       className="h-full bg-primary" 
                       initial={{ width: 0 }} 
                       animate={{ width: "42%" }} 
                       transition={{ duration: 1 }}
                    />
                 </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col space-y-12 min-h-0">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
              <div className="flex items-center justify-center mb-12">
                 <TabsList className="h-20 bg-foreground/[0.03] p-2 rounded-[2.5rem] border border-foreground/10 gap-3 w-fit">
                   <TabsTrigger value="builtin" className="h-full px-12 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.3em] transition-all italic data-[state=active]:shadow-2xl data-[state=active]:shadow-primary/20">
                     <Terminal className="w-4 h-4 mr-3" />
                     OS Primitives
                   </TabsTrigger>
                   <TabsTrigger value="custom" className="h-full px-12 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.3em] transition-all italic data-[state=active]:shadow-2xl data-[state=active]:shadow-primary/20">
                     <Layers className="w-4 h-4 mr-3" />
                     Custom Uplinks
                   </TabsTrigger>
                 </TabsList>
              </div>

            <AnimatePresence mode="wait">
               {activeTab === "builtin" && (
                 <motion.div 
                    key="builtin"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-16"
                 >
                   {isLoading ? (
                     <div className="flex flex-col items-center justify-center py-40 space-y-8 glass-panel-deep border-foreground/5 rounded-[4rem]">
                        <div className="relative">
                           <div className="w-20 h-20 border-2 border-primary/20 rounded-full animate-ping" />
                           <div className="absolute inset-0 w-20 h-20 border-4 border-t-primary border-transparent rounded-full animate-spin" />
                        </div>
                        <span className="text-[12px] font-black uppercase tracking-[0.5em] text-primary italic animate-pulse">Scanning Capability Grid...</span>
                     </div>
                   ) : !groupedBuiltins || Object.keys(groupedBuiltins).length === 0 ? (
                     <div className="text-center py-40 glass-panel-deep border-foreground/5 rounded-[4rem] border-2 border-dashed flex flex-col items-center justify-center space-y-10 text-center px-12">
                       <div className="w-24 h-24 rounded-full bg-foreground/5 flex items-center justify-center border border-foreground/10 shadow-2xl">
                         <ShieldOff className="w-12 h-12 text-foreground/10" />
                       </div>
                       <div className="space-y-4">
                         <h3 className="text-3xl font-black text-foreground uppercase tracking-tighter italic">Registry Void Detected</h3>
                         <p className="text-foreground/30 text-[11px] font-black uppercase tracking-[0.3em] max-w-sm mx-auto italic">RECONNECT TO CORE INFRASTRUCTURE TO RESTORE PRIMITIVE ACCESS.</p>
                       </div>
                     </div>
                   ) : (
                     Object.entries(groupedBuiltins).sort(([a], [b]) => a.localeCompare(b)).map(([group, tools], groupIndex) => (
                       <div key={group} className="space-y-10">
                         <div className="flex items-center gap-8">
                           <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                           <h2 className="text-[14px] font-black uppercase tracking-[0.5em] text-primary italic flex items-center gap-4">
                             <div className="w-3 h-3 rounded-full bg-primary shadow-glow animate-pulse" />
                             {group}_DOMAIN
                           </h2>
                           <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                         </div>
    
                         <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
                           {tools.map((tool, i) => (
                             <motion.div
                               key={tool.name}
                               initial={{ opacity: 0, scale: 0.95 }}
                               animate={{ opacity: 1, scale: 1 }}
                               transition={{ delay: (groupIndex * 0.1) + (i * 0.05) }}
                             >
                               <BuiltinToolDetailDialog tool={tool}>
                               <Card className="glass-panel-deep border-foreground/5 hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-700 overflow-hidden relative group h-full rounded-[3rem]">
                                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                 <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                 
                                 <CardHeader className="pb-6 pt-10 px-10 relative">
                                   <div className="flex items-center justify-between mb-6">
                                     <div className="px-3.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[9px] font-black tracking-[0.2em] uppercase text-foreground/40 italic">
                                       NATIVE UNIT
                                     </div>
                                     {tool.adminOnly ? (
                                       <div className="px-3.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] tracking-[0.2em] font-black uppercase italic flex items-center gap-2">
                                         <ShieldOff className="w-3 h-3" /> RESTRICTED
                                       </div>
                                     ) : (
                                       <div className="px-3.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] tracking-[0.2em] font-black uppercase italic flex items-center gap-2">
                                         <ShieldCheck className="w-3 h-3" /> VERIFIED
                                       </div>
                                     )}
                                   </div>
                                   <CardTitle className="text-xl font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors uppercase font-mono truncate leading-none">
                                     {tool.name}
                                   </CardTitle>
                                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60 italic mt-2 truncate">
                                     {tool.label}
                                   </p>
                                 </CardHeader>
    
                                 <CardContent className="px-10 pb-10 flex flex-col justify-between h-[160px]">
                                   <p className="text-[11px] text-foreground/40 font-medium italic leading-relaxed uppercase tracking-wider line-clamp-4">
                                     {tool.description}
                                   </p>
                                   
                                   <div className="mt-8 flex items-center justify-between pt-6 border-t border-foreground/5">
                                      <div className="flex items-center gap-3">
                                         <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-primary transition-colors shadow-glow" />
                                         <span className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.3em] italic group-hover:text-foreground/40 transition-colors">OS SYNC NOMINAL</span>
                                      </div>
                                      <div className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5 group-hover:bg-primary/10 group-hover:border-primary/20 transition-all duration-500">
                                         <Cpu className="w-5 h-5 text-foreground/10 group-hover:text-primary transition-all group-hover:rotate-[360deg] duration-1000" />
                                      </div>
                                   </div>
                                 </CardContent>
                               </Card>
                               </BuiltinToolDetailDialog>
                             </motion.div>
                           ))}
                         </div>
                       </div>
                     ))
                   )}
                 </motion.div>
               )}

               {activeTab === "custom" && (
                 <motion.div 
                    key="custom"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-12"
                 >
                   {isLoading ? (
                     <div className="flex flex-col items-center justify-center py-40 space-y-8 glass-panel-deep border-foreground/5 rounded-[4rem]">
                        <div className="relative">
                           <div className="w-20 h-20 border-2 border-primary/20 rounded-full animate-ping" />
                           <div className="absolute inset-0 w-20 h-20 border-4 border-t-primary border-transparent rounded-full animate-spin" />
                        </div>
                        <span className="text-[12px] font-black uppercase tracking-[0.5em] text-primary italic animate-pulse">RECONSTRUCTING UPLINK REPOSITORY...</span>
                     </div>
                   ) : filteredSpecs?.length === 0 ? (
                     <div className="text-center py-40 glass-panel-deep border-foreground/5 rounded-[4rem] border-2 border-dashed flex flex-col items-center justify-center space-y-10 text-center px-12">
                       <div className="w-24 h-24 rounded-full bg-foreground/5 flex items-center justify-center border border-foreground/10 shadow-2xl">
                         <Globe className="w-12 h-12 text-foreground/10" />
                       </div>
                       <div className="space-y-4">
                         <h3 className="text-3xl font-black text-foreground uppercase tracking-tighter italic">Zero Uplinks Established</h3>
                         <p className="text-foreground/30 text-[11px] font-black uppercase tracking-[0.3em] max-w-sm mx-auto italic">INITIALIZE NEW API MODULES TO EXPAND AGENT OPERATIONAL RANGE.</p>
                       </div>
                       <Button onClick={() => setIsAddOpen(true)} className="mt-4 h-14 px-10 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-[0.3em] text-[10px] italic shadow-2xl shadow-primary/20">
                          INITIALIZE UPLINK
                       </Button>
                     </div>
                   ) : (
                     <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
                       {[...(filteredSpecs || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((spec, i) => (
                         <SpecCard key={spec.id} spec={spec} delay={i * 0.05} />
                       ))}
                     </div>
                   )}
                 </motion.div>
               )}
            </AnimatePresence>

            <AddToolDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
          </Tabs>
        </div>
        </div>
      </main>

      {/* Footer System HUD */}
      <footer className="h-16 border-t border-foreground/5 flex items-center justify-between px-10 bg-background/40 backdrop-blur-xl relative z-20">
         <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
               <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
               <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 italic">Registry Latency: 0.14ms</span>
            </div>
            <div className="flex items-center gap-3">
               <Database className="w-3.5 h-3.5 text-primary" />
               <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 italic">Sync Buffer: NOMINAL</span>
            </div>
         </div>
         <div className="flex items-center gap-4">
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/10 italic">Secure Environment X9</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500/40 shadow-glow" />
         </div>
      </footer>
    </div>
  );
}

function SpecCard({ spec, delay }: { spec: ApiSpec, delay: number }) {
    const [isAccessOpen, setIsAccessOpen] = useState(false);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Check if legacy (older than 1 month)
    const isLegacy = new Date(spec.createdAt).getTime() < (Date.now() - 30 * 24 * 60 * 60 * 1000);

    const publishMutation = useMutation({
        mutationFn: async (status: string) => {
            await apiRequest("PUT", `/api/specs/management/${spec.id}`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/specs/management"] });
            toast({ title: "Module Status Updated", description: `Uplink state set to ${status.toUpperCase()}` });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async () => {
            await apiRequest("DELETE", `/api/specs/management/${spec.id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/specs/management"] });
            toast({ title: "Module Decommissioned", description: "API signature permanentely erased from registry." });
        },
        onError: (err: any) => {
            toast({ title: "Decommissioning Failed", description: err.message, variant: "destructive" });
        }
    });

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay }}
        >
            <Card className="glass-panel-deep border-foreground/5 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-700 overflow-hidden relative group flex flex-col h-full rounded-[3.5rem]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute top-0 right-0 p-10 opacity-0 group-hover:opacity-[0.03] transition-all scale-75 group-hover:scale-100 pointer-events-none group-hover:rotate-12">
                   <Globe className="w-32 h-32 text-primary" />
                </div>
                
                <CardHeader className="relative pb-6 pt-12 px-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="px-3.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[9px] font-black tracking-[0.2em] uppercase text-foreground/40 italic">
                        {spec.isSystemLevel ? "CORE_BRIDGE" : "EXT_UPLINK"}
                      </div>
                    </div>
                    <div className={cn(
                      "text-[9px] tracking-[0.3em] font-black px-4 py-1.5 rounded-xl uppercase italic border shadow-inner transition-all",
                      spec.status === 'published' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/10" : 
                      spec.status === 'deprecated' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                      "bg-foreground/5 text-foreground/20 border-foreground/10"
                    )}>
                      {spec.status}
                    </div>
                  </div>
                  <CardTitle className="text-3xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none truncate mb-2">
                    {spec.name}
                  </CardTitle>
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20 italic group-hover:text-foreground/40 transition-colors">
                    SIG ID: {spec.id.toString().slice(0, 16).toUpperCase()}
                  </p>
                </CardHeader>

                <CardContent className="px-10 pb-6 flex-grow">
                   <div className="min-h-[64px]">
                      <p className="text-[12px] text-foreground/40 font-medium italic leading-relaxed line-clamp-3 uppercase tracking-wider group-hover:text-foreground/60 transition-colors">
                           {spec.description || "NO_DESCRIPTION_PROVIDED_BY_SOURCE_ENTITY"}
                      </p>
                   </div>
                   
                   <div className="mt-10 grid grid-cols-2 gap-6 p-6 rounded-[2rem] bg-foreground/[0.01] border border-foreground/5 group-hover:bg-foreground/[0.03] transition-all group-hover:border-foreground/10">
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase text-foreground/10 tracking-[0.3em] italic">SYNC ESTABLISHED</p>
                        <p className="text-[11px] font-black italic tracking-tight text-foreground/60 group-hover:text-foreground transition-colors tabular-nums">
                            {format(new Date(spec.createdAt), "dd_MM_yyyy").toUpperCase()}
                        </p>
                      </div>
                      <div className="space-y-1 border-l border-foreground/5 pl-6 group-hover:border-primary/20 transition-colors">
                        <p className="text-[9px] font-black uppercase text-foreground/10 tracking-[0.3em] italic">PROTOCOL VERSION</p>
                        <p className="text-[11px] font-black italic tracking-tight text-primary/40 group-hover:text-primary/70 transition-colors uppercase">v1.2.9 STABLE</p>
                      </div>
                   </div>
                </CardContent>

                <CardFooter className="pt-6 pb-12 px-10 flex items-center justify-between border-t border-foreground/5 bg-foreground/[0.01] group-hover:bg-foreground/[0.02] transition-colors mt-auto">
                   <div className="flex items-center gap-3">
                       <Button variant="outline" onClick={() => setIsAccessOpen(true)} className="h-12 rounded-xl border-foreground/10 bg-foreground/5 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/60 hover:text-foreground hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all px-6 active:scale-95 italic group/access">
                          <ShieldCheck className="w-3.5 h-3.5 mr-2 text-emerald-500/60 group-hover/access:text-emerald-500 transition-colors" />
                          ACCESS HUB
                       </Button>
                       <EditToolDialog spec={spec} />
                   </div>

                    <div className="flex items-center gap-2">
                        <AnimatePresence mode="wait">
                           {spec.status === "draft" && (
                               <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                  <Button size="icon" className="h-12 w-12 rounded-xl border border-foreground/5 bg-foreground/3 hover:bg-blue-500/10 transition-all text-foreground/20 hover:text-blue-400 group/btn" onClick={() => publishMutation.mutate("testing")} title="Initialize Testing">
                                     <Upload className="h-4 w-4 transition-transform group-hover/btn:-translate-y-1" />
                                  </Button>
                               </motion.div>
                           )}
                           {spec.status === "testing" && (
                               <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                  <Button size="icon" className="h-12 w-12 rounded-xl border border-foreground/5 bg-foreground/3 hover:bg-emerald-500/10 transition-all text-foreground/20 hover:text-emerald-500 group/btn" onClick={() => publishMutation.mutate("published")} title="Commit to Registry">
                                     <Check className="h-4 w-4 transition-transform group-hover/btn:scale-125" />
                                  </Button>
                               </motion.div>
                           )}
                           {spec.status === "published" && (
                               <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                  <Button size="icon" className="h-12 w-12 rounded-xl border border-foreground/5 bg-foreground/3 hover:bg-amber-500/10 transition-all text-foreground/20 hover:text-amber-500 group/btn" onClick={() => publishMutation.mutate("deprecated")} title="Deactivate Module">
                                     <ShieldOff className="h-4 w-4 transition-transform group-hover/btn:rotate-12" />
                                  </Button>
                               </motion.div>
                           )}
                        </AnimatePresence>

                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="icon" className="h-12 w-12 rounded-xl border border-foreground/5 bg-foreground/3 hover:bg-red-500/15 transition-all text-foreground/20 hover:text-red-500 group/trash">
                                    <Trash2 className="h-4 w-4 transition-all group-hover/trash:scale-110" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="glass-panel-deep border-foreground/10 rounded-[3rem] p-12 max-w-xl">
                                <AlertDialogHeader className="space-y-8">
                                    <div className="w-20 h-20 rounded-[2rem] bg-red-500/10 flex items-center justify-center border border-red-500/20 mx-auto shadow-2xl">
                                        <Trash2 className="h-10 w-10 text-red-500 animate-pulse" />
                                    </div>
                                    <div className="space-y-3">
                                       <AlertDialogTitle className="text-4xl font-black italic text-center uppercase tracking-tighter text-foreground">Execute Erasure?</AlertDialogTitle>
                                       <AlertDialogDescription className="text-center text-foreground/30 text-[11px] font-black uppercase tracking-[0.3em] leading-relaxed italic">
                                           DELETING <span className="text-foreground/60">[{spec.name}]</span> WILL PERMANENTELY ERASE THIS CAPABILITY FROM THE SYSTEM REPOSITORY. THIS ACTION IS IRREVERSIBLE.
                                       </AlertDialogDescription>
                                    </div>
                                </AlertDialogHeader>
                                <div className="mt-12 flex gap-4">
                                    <AlertDialogCancel className="h-16 flex-1 rounded-2xl glass-panel-deep border-foreground/10 text-[10px] font-black uppercase tracking-[0.3em] transition-all hover:bg-foreground/5 italic">ABORT COMMAND</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMutation.mutate()} className="h-16 flex-1 rounded-2xl bg-red-500 hover:bg-red-600 text-foreground text-[10px] font-black uppercase tracking-[0.3em] transition-all shadow-xl shadow-red-500/20 italic">EXECUTE WIPE</AlertDialogAction>
                                </div>
                            </AlertDialogContent>
                        </AlertDialog>
                   </div>
                </CardFooter>
            </Card>

            <ManageAccessDialog
                spec={spec}
                open={isAccessOpen}
                onOpenChange={setIsAccessOpen}
            />
        </motion.div>
    );
}

function AddToolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [jsonContent, setJsonContent] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const createMutation = useMutation({
        mutationFn: async () => {
            let parsed;
            try {
                parsed = JSON.parse(jsonContent);
            } catch (e) {
                throw new Error("Invalid Protocol Schema Structure.");
            }

            const res = await apiRequest("POST", "/api/specs/management", {
                name,
                description,
                content: parsed,
                status: "draft",
                isSystemLevel: true, 
            });
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Module Initialized", description: "Capabilitiy uplink registered in registry." });
            onOpenChange(false);
            queryClient.invalidateQueries({ queryKey: ["/api/specs/management"] });
            setName("");
            setDescription("");
            setJsonContent("");
        },
        onError: (err: any) => {
            toast({ title: "Initialization Failed", description: err.message, variant: "destructive" });
        },
    });

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            setJsonContent(text);
            try {
                const obj = JSON.parse(text);
                if (obj.info?.title && !name) setName(obj.info.title);
                if (obj.info?.description && !description) setDescription(obj.info.description);
            } catch (e) {}
        };
        reader.readAsText(file);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl bg-background border-foreground/10 rounded-[3.5rem] p-0 overflow-hidden shadow-2xl">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent shadow-[0_0_20px_rgba(var(--primary),0.5)]" />
                
                <DialogHeader className="p-12 pb-6">
                    <div className="flex items-center gap-6 mb-4">
                        <div className="w-16 h-16 rounded-[2rem] bg-primary/10 border border-primary/20 flex items-center justify-center shadow-2xl shadow-primary/10">
                            <Plus className="w-8 h-8 text-primary group-hover:rotate-90 transition-transform" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-4xl font-black italic uppercase tracking-tighter text-foreground">Initialize New Uplink</DialogTitle>
                            <DialogDescription className="text-[11px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                COMMENCING UPLOAD OF HIGH-FIDELITY MODULE SPECIFICATION
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="px-12 py-8 space-y-10">
                    <div className="grid grid-cols-2 gap-10">
                        <div className="space-y-3">
                            <Label htmlFor="module-designation" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Module Designation</Label>
                            <Input 
                                id="module-designation"
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                placeholder="E.G._TITAN_CORE_V1" 
                                className="h-16 bg-foreground/[0.03] border-foreground/10 rounded-2xl text-[12px] font-black tracking-widest uppercase italic text-foreground placeholder:text-foreground/10 focus:border-primary/40 focus:bg-foreground/[0.05] transition-all"
                            />
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="source-spec-upload" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Source Specification</Label>
                            <div className="relative group/upload h-16">
                                <div className="absolute inset-0 bg-foreground/[0.03] border border-foreground/10 rounded-2xl flex items-center px-6 gap-4 group-hover/upload:bg-foreground/[0.05] group-hover/upload:border-primary/40 transition-all pointer-events-none">
                                    <Upload className="w-5 h-5 text-foreground/20 group-hover/upload:text-primary group-hover/upload:-translate-y-1 transition-all" />
                                    <span className="text-[11px] font-black tracking-widest uppercase text-foreground/20 group-hover/upload:text-foreground/60 transition-colors italic">SELECT JSON MANIFEST</span>
                                </div>
                                <input 
                                    id="source-spec-upload"
                                    type="file" 
                                    accept=".json" 
                                    onChange={handleFileUpload} 
                                    aria-label="Upload JSON Manifest"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label htmlFor="description-brief" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Description Brief</Label>
                        <Input 
                            id="description-brief"
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            placeholder="BRIEFING ON MODULE OPERATIONAL CAPABILITIES..." 
                            className="h-16 bg-foreground/[0.03] border-foreground/10 rounded-2xl text-[12px] font-black tracking-widest uppercase italic text-foreground placeholder:text-foreground/10 focus:border-primary/40 transition-all"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between mb-1 px-2">
                            <Label htmlFor="capability-manifest" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic text-primary/60">Capability Manifest (JSON)</Label>
                            <div className="flex items-center gap-2">
                                <span className={cn("text-[9px] font-black tracking-widest uppercase italic transition-colors", jsonContent ? "text-emerald-500" : "text-foreground/10")}>
                                   {jsonContent ? "PROTOCOL_STaged" : "WAITING_FOR_PAYLOAD"}
                                </span>
                                <div className={cn("w-2 h-2 rounded-full", jsonContent ? "bg-emerald-500 animate-pulse shadow-glow" : "bg-foreground/10")} />
                            </div>
                        </div>
                        <div className="relative">
                            <div className="absolute top-6 right-8 opacity-[0.03] pointer-events-none">
                                <FileCode className="w-32 h-32 text-primary" />
                            </div>
                            <Textarea
                                id="capability-manifest"
                                value={jsonContent}
                                onChange={(e) => setJsonContent(e.target.value)}
                                className="font-mono text-[13px] h-72 bg-background/60 border border-foreground/10 rounded-[2.5rem] p-10 text-emerald-500/80 focus:border-primary/40 focus:ring-0 selection:bg-primary/20 resize-none overflow-y-auto custom-scrollbar leading-relaxed"
                                placeholder="{ ... SCHEMA_PROTOCOL ... }"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-12 pt-8 bg-foreground/[0.02] border-t border-foreground/5 flex gap-6">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-16 px-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] italic text-foreground/30 hover:text-foreground hover:bg-foreground/5 transition-all">
                        ABORT INIT
                    </Button>
                    <Button 
                        onClick={() => createMutation.mutate()} 
                        disabled={createMutation.isPending || !name || !jsonContent}
                        className="h-16 px-16 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-primary/20 transition-all active:scale-95 italic group"
                    >
                        {createMutation.isPending ? "PROCESSING..." : (
                           <>
                               COMMENCE UPLINK
                               <Check className="w-4 h-4 ml-3 group-hover:scale-125 transition-transform" />
                           </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function EditToolDialog({ spec }: { spec: ApiSpec }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(spec.name);
    const [description, setDescription] = useState(spec.description || "");
    const [jsonContent, setJsonContent] = useState(JSON.stringify(spec.content, null, 2));
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const updateMutation = useMutation({
        mutationFn: async () => {
            let parsed;
            try {
                parsed = JSON.parse(jsonContent);
            } catch (e) {
                throw new Error("Invalid Protocol Syntax.");
            }

            const res = await apiRequest("PUT", `/api/specs/management/${spec.id}`, {
                name,
                description,
                content: parsed,
            });
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Configuration Updated", description: "Node parameters successfully re-synced." });
            setOpen(false);
            queryClient.invalidateQueries({ queryKey: ["/api/specs/management"] });
        },
        onError: (err: any) => {
            toast({ title: "Reconfiguration Failed", description: err.message, variant: "destructive" });
        },
    });

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            setJsonContent(text);
        };
        reader.readAsText(file);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="h-12 rounded-xl border-foreground/10 bg-foreground/5 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/60 hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-all px-6 active:scale-95 italic group/edit">
                    <Pencil className="mr-2 h-3.5 w-3.5 text-primary/60 group-hover/edit:text-primary transition-colors" /> RECONFIGURE
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl bg-background border-foreground/10 rounded-[3.5rem] p-0 overflow-hidden shadow-2xl">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                
                <DialogHeader className="p-12 pb-6">
                    <div className="flex items-center gap-6 mb-4">
                        <div className="w-16 h-16 rounded-[2rem] bg-primary/10 border border-primary/20 flex items-center justify-center shadow-2xl shadow-primary/10">
                            <Pencil className="w-8 h-8 text-primary group-hover:rotate-12 transition-transform" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-4xl font-black italic uppercase tracking-tighter text-foreground">Patch Capability Node</DialogTitle>
                            <DialogDescription className="text-[11px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                MODIFYING SYSTEM SIGNATURE AND OPERATIONAL PARAMETERS
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="px-12 py-8 space-y-10">
                    <div className="grid grid-cols-2 gap-10">
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Module Designation</Label>
                            <Input 
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                className="h-16 bg-foreground/[0.03] border-foreground/10 rounded-2xl text-[12px] font-black tracking-widest uppercase italic text-foreground focus:border-primary/40 focus:bg-foreground/[0.05] transition-all"
                            />
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="edit-node-identity" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Node Identity</Label>
                            <Input 
                                id="edit-node-identity"
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                className="h-16 bg-foreground/[0.03] border-foreground/10 rounded-2xl text-[12px] font-black tracking-widest uppercase italic text-foreground focus:border-primary/40 transition-all"
                            />
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="edit-patch-json" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Overwrite Source</Label>
                            <div className="relative group/upload h-16">
                                <div className="absolute inset-0 bg-foreground/[0.03] border border-foreground/10 rounded-2xl flex items-center px-6 gap-4 group-hover/upload:bg-foreground/[0.05] group-hover/upload:border-primary/40 transition-all pointer-events-none">
                                    <Upload className="w-5 h-5 text-foreground/20 group-hover/upload:text-primary transition-all" />
                                    <span className="text-[11px] font-black tracking-widest uppercase text-foreground/20 group-hover/upload:text-foreground/60 transition-colors italic">UPLOAD PATCH JSON</span>
                                </div>
                                <input 
                                    id="edit-patch-json"
                                    type="file" 
                                    accept=".json" 
                                    onChange={handleFileUpload} 
                                    aria-label="Upload Patch JSON"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label htmlFor="edit-log-description" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-2 text-primary/60">Log Description</Label>
                        <Input 
                            id="edit-log-description"
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            className="h-16 bg-foreground/[0.03] border-foreground/10 rounded-2xl text-[12px] font-black tracking-widest uppercase italic text-foreground focus:border-primary/40 transition-all"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between mb-1 px-2">
                            <Label htmlFor="edit-spec-payload" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic text-primary/60">Spec Payload (JSON)</Label>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-black tracking-widest uppercase italic text-emerald-500 animate-pulse">PROTOCOL READY</span>
                                <div className={cn("w-2 h-2 rounded-full", jsonContent ? "bg-emerald-500 animate-pulse shadow-glow" : "bg-foreground/10")} />
                            </div>
                        </div>
                        <div className="relative">
                            <Textarea
                                id="edit-spec-payload"
                                value={jsonContent}
                                onChange={(e) => setJsonContent(e.target.value)}
                                className="font-mono text-[13px] h-72 bg-background/60 border border-foreground/10 rounded-[2.5rem] p-10 text-primary/80 focus:border-primary/40 focus:ring-0 selection:bg-primary/20 resize-none overflow-y-auto custom-scrollbar leading-relaxed"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-12 pt-8 bg-foreground/[0.02] border-t border-foreground/5 flex gap-6">
                    <Button variant="ghost" onClick={() => setOpen(false)} className="h-16 px-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] italic text-foreground/30 hover:text-foreground transition-all">
                        CANCEL PATCH
                    </Button>
                    <Button 
                        onClick={() => updateMutation.mutate()} 
                        disabled={updateMutation.isPending || !name || !jsonContent}
                        className="h-16 px-16 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-primary/20 transition-all active:scale-95 italic group"
                    >
                        {updateMutation.isPending ? "PATCHING..." : "COMMIT_CHANGES"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ManageAccessDialog({ spec, open, onOpenChange }: { spec: ApiSpec; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { data: orgsData } = useQuery<{ organizations: Organization[] }>({
        queryKey: ["/api/admin/organizations"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/organizations");
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: open,
    });

    const { data: accessData, refetch } = useQuery<{ orgId: number; settings: any; enabledAt: string }[] | undefined>({
        queryKey: [`/api/specs/management/${spec.id}/access`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/specs/management/${spec.id}/access`);
            if (!res.ok) return [];
            return res.json();
        },
        enabled: open,
    });

    const AccessMap = new Map(accessData?.map(a => [a.orgId, a]));
    const [selectedOrgs, setSelectedOrgs] = useState<number[]>([]);
    const { toast } = useToast();

    useEffect(() => {
        if (accessData) {
            setSelectedOrgs(accessData.map(a => a.orgId));
        }
    }, [accessData]);

    const accessMutation = useMutation({
        mutationFn: async () => {
            await apiRequest("POST", `/api/specs/management/${spec.id}/access`, {
                orgIds: selectedOrgs
            });
        },
        onSuccess: () => {
            toast({ title: "Permissions Synchronized", description: "Node access matrix has been updated across the grid." });
            if (refetch) refetch();
            onOpenChange(false);
        },
        onError: (err: any) => {
            toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
        }
    });

    const toggleOrg = (orgId: number) => {
        setSelectedOrgs(prev =>
            prev.includes(orgId)
                ? prev.filter(id => id !== orgId)
                : [...prev, orgId]
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl bg-background border-foreground/10 rounded-[3.5rem] p-0 overflow-hidden shadow-2xl flex flex-col h-[800px]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.4)]" />
                
                <DialogHeader className="p-12 pb-6">
                    <div className="flex items-center gap-6 mb-4">
                        <div className="w-16 h-16 rounded-[2rem] bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-2xl shadow-emerald-500/10">
                            <ShieldCheck className="w-8 h-8 text-emerald-500 shadow-glow" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-4xl font-black italic uppercase tracking-tighter text-foreground">Access Uplink Matrix</DialogTitle>
                            <DialogDescription className="text-[11px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                                ORCHESTRATING RESOURCE PERMISSIONS ACROSS THE NODE GRID
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-12 py-6 space-y-6 custom-scrollbar">
                    {orgsData?.organizations?.map((org, index) => {
                        const isSelected = selectedOrgs.includes(org.id);
                        return (
                            <motion.div
                                key={org.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.05 }}
                            >
                                <AccessRow
                                    org={org}
                                    specId={spec.id}
                                    access={AccessMap.get(org.id)}
                                    isSelected={isSelected}
                                    onToggle={() => toggleOrg(org.id)}
                                />
                            </motion.div>
                        );
                    })}
                </div>

                <DialogFooter className="p-12 pt-8 bg-foreground/[0.02] border-t border-foreground/5 flex gap-6">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-16 px-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] italic text-foreground/30 hover:text-foreground transition-all">
                        ABORT SYNC
                    </Button>
                    <Button 
                        onClick={() => accessMutation.mutate()} 
                        disabled={accessMutation.isPending}
                        className="h-16 px-16 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-foreground text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-emerald-500/20 transition-all active:scale-95 italic group"
                    >
                        {accessMutation.isPending ? "SYNCING..." : "COMMIT_MATRIX"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AccessRow({ org, specId, access, isSelected, onToggle }: { org: Organization, specId: number, access?: { settings: any }, isSelected: boolean, onToggle: () => void }) {
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [baseUrl, setBaseUrl] = useState(access?.settings?.baseURL || "");
    const { toast } = useToast();

    useEffect(() => {
        if (access?.settings?.baseURL) {
            setBaseUrl(access.settings.baseURL);
        }
    }, [access]);

    const saveSettings = async () => {
        try {
            await apiRequest("PUT", `/api/specs/management/${specId}/access/${org.id}`, {
                settings: { baseURL: baseUrl }
            });
            toast({ title: "Node Protocol Saved", description: "Base URL override stored in registry." });
            setIsConfigOpen(false);
        } catch (e) {
            toast({ title: "Save Failed", variant: "destructive" });
        }
    };

    return (
        <div className={cn(
            "group rounded-[2rem] border transition-all duration-500 overflow-hidden relative",
            isSelected ? "border-emerald-500/40 bg-emerald-500/[0.04] shadow-2xl shadow-emerald-500/5" : "border-foreground/5 bg-foreground/[0.02] hover:border-foreground/10"
        )}>
            <div className="flex items-center justify-between p-6 px-10">
                <div className="flex items-center gap-8 cursor-pointer flex-1" onClick={onToggle}>
                    <div className={cn(
                        "w-10 h-10 rounded-xl border flex items-center justify-center transition-all duration-500",
                        isSelected ? "bg-emerald-500 border-emerald-500 shadow-glow-emerald rotate-[360deg]" : "border-foreground/10 bg-foreground/5"
                    )}>
                        {isSelected ? <Check className="h-5 w-5 text-foreground" /> : <div className="w-2 h-2 rounded-full bg-foreground/10" />}
                    </div>
                    <div className="space-y-1">
                        <span className="text-[13px] font-black uppercase tracking-widest text-foreground italic group-hover:text-emerald-500/80 transition-colors">{org.name}</span>
                        <p className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.2em] italic">NODE SIG: {org.id.toString().padStart(6, '0')}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                  {isSelected && (
                     <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-500 uppercase tracking-widest italic animate-pulse">
                        UPLINK GRANTED
                     </div>
                  )}
                  {access && (
                      <Button 
                          size="icon" 
                          onClick={() => setIsConfigOpen(!isConfigOpen)}
                          className={cn(
                              "h-12 w-12 rounded-xl transition-all duration-500",
                              isConfigOpen ? "bg-primary text-primary-foreground shadow-glow" : "bg-foreground/5 text-foreground/20 hover:text-foreground hover:bg-foreground/10"
                          )}
                      >
                          <Settings className={cn("h-5 w-5 transition-transform duration-700", isConfigOpen && "rotate-90")} />
                      </Button>
                  )}
                </div>
            </div>

            <AnimatePresence>
              {isConfigOpen && access && (
                  <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-foreground/5 bg-background/40 p-10 space-y-6"
                  >
                      <div className="space-y-4">
                          <Label htmlFor={`endpoint-override-${org.id}`} className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 italic ml-2">Protocol Uplink Endpoint Override</Label>
                          <div className="flex gap-6">
                              <Input
                                  id={`endpoint-override-${org.id}`}
                                  value={baseUrl}
                                  onChange={(e) => setBaseUrl(e.target.value)}
                                  placeholder="HTTPS://API.SECURE.NODE_UPLINK.IO"
                                  className="h-16 bg-background border-foreground/10 rounded-2xl text-[12px] font-mono tracking-widest text-emerald-500/90 italic flex-1 focus:border-emerald-500/40"
                              />
                              <Button 
                                  onClick={saveSettings}
                                  className="h-16 px-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[11px] font-black uppercase tracking-[0.3em] italic hover:bg-emerald-500 hover:text-foreground transition-all shadow-2xl shadow-emerald-500/10"
                              >
                                  SAVE CONFIG
                              </Button>
                          </div>
                      </div>
                  </motion.div>
              )}
            </AnimatePresence>
        </div>
    );
}

function BuiltinToolDetailDialog({ tool, children }: { tool: BuiltinTool, children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (open) {
            console.log("[ToolRegistry] Detail View Opened for:", tool);
        }
    }, [open, tool]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <div className="h-full cursor-pointer group/dialog-wrap">
                    {children}
                </div>
            </DialogTrigger>
            <DialogContent className="max-w-4xl bg-background border-foreground/10 rounded-[3.5rem] p-0 overflow-hidden shadow-2xl">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                <DialogHeader className="p-12 pb-6 border-b border-foreground/5">
                    <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="px-3.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[9px] font-black tracking-[0.2em] uppercase text-foreground/40 italic">
                                    {tool.group}_DOMAIN
                                </div>
                                <div className="px-3.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] tracking-[0.2em] font-black uppercase italic flex items-center gap-2">
                                    <ShieldCheck className="w-3 h-3" /> VERIFIED
                                </div>
                                {tool.adminOnly && (
                                    <div className="px-3.5 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 text-[9px] tracking-[0.2em] font-black uppercase italic">
                                        RESTRICTED
                                    </div>
                                )}
                                {tool.riskLevel && (
                                    <div className={cn("px-3.5 py-1.5 rounded-lg border text-[9px] tracking-[0.2em] font-black uppercase italic", 
                                        tool.riskLevel === 'high' ? "bg-red-500/10 border-red-500/20 text-red-500" :
                                        tool.riskLevel === 'medium' ? "bg-amber-500/10 border-amber-500/20 text-amber-500" :
                                        "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                    )}>
                                        RISK: {tool.riskLevel.toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <DialogTitle className="text-5xl font-black tracking-tighter text-foreground font-mono leading-none border-l-4 border-primary pl-6 py-2 bg-foreground/5 rounded-r-xl">
                                {tool.name}
                            </DialogTitle>
                            <DialogDescription className="text-[16px] font-bold uppercase tracking-[0.2em] text-primary mt-6 ml-1">
                                {tool.label}
                            </DialogDescription>
                        </div>
                        <div className="w-16 h-16 rounded-[2rem] bg-foreground/5 border border-foreground/10 flex items-center justify-center shadow-inner">
                            <Terminal className="w-8 h-8 text-primary/40" />
                        </div>
                    </div>
                </DialogHeader>

                <div className="p-12 space-y-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-[length:100px] mix-blend-overlay">
                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic flex items-center gap-2">
                           <Activity className="w-3 h-3" /> Module Description
                        </Label>
                        <p className="text-[13px] text-foreground/80 font-medium leading-relaxed border-l-2 border-primary/40 pl-6">
                            {tool.description}
                        </p>
                    </div>

                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic flex items-center gap-2">
                            <FileCode className="w-4 h-4" /> I/O Schema Specification
                        </Label>
                        <div className="relative group/json">
                            <Textarea
                                readOnly
                                value={tool.schema ? JSON.stringify(tool.schema, null, 2) : "NO SCHEMA SPECIFICATION"}
                                className="font-mono text-[13px] h-[350px] bg-background border border-foreground/10 rounded-[2.5rem] p-10 text-emerald-500/90 focus:border-primary/40 focus:ring-0 selection:bg-primary/20 resize-none overflow-y-auto custom-scrollbar leading-relaxed"
                            />
                            <div className="absolute top-6 right-8 opacity-[0.4] transition-opacity">
                                <Terminal className="w-5 h-5 text-emerald-500/50" />
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
