import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
  FlaskConical, 
  Play, 
  Plus, 
  Terminal, 
  Cpu, 
  Zap, 
  Activity, 
  ChevronRight, 
  Settings, 
  Trash2, 
  History,
  CheckCircle2,
  AlertCircle,
  Database,
  ArrowUpRight,
  Brain
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { EvaluationPromotionPanel } from "../components/EvaluationPromotionPanel";

export default function EvaluationStudio() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newSetName, setNewSetName] = useState("");
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [newInput, setNewInput] = useState("");
  const [newCriteria, setNewCriteria] = useState("");
  const [newMethod, setNewMethod] = useState("llm_judge");

  const { data: testSets = [], isLoading } = useQuery({
    queryKey: ["/api/evaluation-studio/test-sets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/evaluation-studio/test-sets");
      return res.json();
    },
  });

  const { data: cases = [], refetch: refetchCases } = useQuery({
    queryKey: ["/api/evaluation-studio/test-sets", selectedSetId, "cases"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/evaluation-studio/test-sets/${selectedSetId}/cases`);
      return res.json();
    },
    enabled: !!selectedSetId,
  });

  const createSetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/evaluation-studio/test-sets", {
        name: newSetName || "Untitled Test Set",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/evaluation-studio/test-sets"] });
      setNewSetName("");
      toast({ title: "Test set created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createCaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/evaluation-studio/test-sets/${selectedSetId}/cases`, {
        inputPrompt: newInput,
        expectedCriteria: newCriteria,
        method: newMethod,
      });
      return res.json();
    },
    onSuccess: () => {
      refetchCases();
      setNewInput("");
      setNewCriteria("");
      toast({ title: "Test case added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: async (testSetId: number) => {
      const res = await apiRequest("POST", `/api/evaluation-studio/test-sets/${testSetId}/run`);
      return { ...(await res.json()), testSetId };
    },
    onSuccess: (data) => {
      toast({ title: "Evaluation completed", description: `Run ID: ${data.runId}` });
      queryClient.invalidateQueries({
        queryKey: ["/api/evaluation-studio/test-sets", data.testSetId, "lifecycle"],
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importSystemTestsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/evaluation-studio/import-system-tests");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/evaluation-studio/test-sets"] });
      toast({ title: "System tests imported", description: `Created Test Set ID: ${data.setId}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const getMethodBadgeClass = (method: string) => {
    switch (method) {
      case 'llm_judge': return 'bg-primary/10 text-primary border-primary/20';
      case 'regex': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'keyword': return 'bg-foreground/5 text-foreground/40 border-foreground/10';
      default: return 'bg-foreground/5 text-foreground/20 border-foreground/5';
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      <main className="flex-1 flex flex-col gap-6">
        {/* Page Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Evaluation Studio</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Configure and run neural health evaluations</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => importSystemTestsMutation.mutate()}
              disabled={importSystemTestsMutation.isPending}
              className="gap-2"
            >
              <Database className="w-4 h-4" />
              Import Tests
            </Button>
            <Button className="gap-2">
              <Brain className="w-4 h-4" />
              Analyze
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="flex h-80 items-center justify-center">
            <Activity className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <section className="grid grid-cols-1 lg:grid-cols-4 gap-12 flex-1 min-h-0">
            {/* Test Set Registry Sidebar */}
            <aside className="lg:col-span-1 space-y-8 flex flex-col h-full">
                <Card className="bg-card border border-border overflow-hidden flex flex-col h-full">
                    <CardHeader className="p-8 pb-4">
                        <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                            <Settings size={14} className="text-primary" />
                            Set Registry_
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-8 pt-0 space-y-6 flex-1 flex flex-col min-h-0">
                        <div className="flex gap-2 p-1.5 bg-foreground/5 rounded-xl border border-foreground/5">
                            <Input
                                placeholder="NEW_SET_NAME..."
                                value={newSetName}
                                onChange={(e) => setNewSetName(e.target.value)}
                                className="bg-transparent border-none text-[10px] font-black uppercase italic tracking-widest shadow-none h-10 px-4"
                            />
                            <Button
                                size="icon"
                                onClick={() => createSetMutation.mutate()}
                                disabled={createSetMutation.isPending || !newSetName}
                                className="h-10 w-10 bg-foreground/5 hover:bg-primary hover:text-background rounded-lg transition-all"
                            >
                                <Plus size={16} />
                            </Button>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar space-y-3 pr-2">
                          {testSets.length === 0 ? (
                            <div className="text-center py-12 border border-foreground/5 border-dashed rounded-3xl">
                              <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">No Registry Data</p>
                            </div>
                          ) : (
                            testSets.map((set: any) => (
                              <motion.div
                                key={set.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className={cn(
                                  "group relative flex items-center justify-between p-5 rounded-2xl border transition-all cursor-pointer overflow-hidden",
                                  selectedSetId === set.id 
                                    ? "bg-primary text-background border-transparent shadow-glow" 
                                    : "bg-foreground/[0.02] border-foreground/5 text-foreground/40 hover:bg-foreground/[0.04] hover:border-foreground/10"
                                )}
                                onClick={() => setSelectedSetId(set.id)}
                              >
                                {selectedSetId === set.id && (
                                  <div className="absolute inset-0 bg-noise opacity-10" />
                                )}
                                <div className="min-w-0 flex-1 relative z-10">
                                  <p className="font-black italic text-[11px] uppercase truncate tracking-tighter">{set.name}</p>
                                  <p className={cn("text-[8px] font-bold uppercase tracking-widest mt-1", selectedSetId === set.id ? "text-background/60" : "text-foreground/10")}>Identity: #{set.id}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={cn("h-8 w-8 p-0 rounded-lg relative z-10", selectedSetId === set.id ? "hover:bg-background/10" : "hover:bg-foreground/5")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    runMutation.mutate(set.id);
                                  }}
                                  disabled={runMutation.isPending}
                                >
                                  <Play className={cn("w-4 h-4", selectedSetId === set.id ? "text-background" : "text-emerald-500 shadow-glow-emerald")} />
                                </Button>
                              </motion.div>
                            ))
                          )}
                        </div>
                    </CardContent>
                    <CardFooter className="p-8 border-t border-foreground/5 bg-background/20">
                      <div className="flex flex-col gap-4 w-full">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic">Global Metrics</p>
                        <div className="flex justify-between items-center text-[10px] font-black italic uppercase tracking-widest">
                          <span className="text-foreground/40">Total Sets</span>
                          <span className="text-foreground">{testSets.length}</span>
                        </div>
                      </div>
                    </CardFooter>
                </Card>
            </aside>

            {/* Test Case Lab - Main Section */}
            <div className="lg:col-span-3 space-y-12">
              <AnimatePresence mode="wait">
                {selectedSetId ? (
                  <motion.div
                    key="active-lab"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="space-y-12"
                  >
                    {/* Add Test Case HUD */}
                    <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl relative">
                       <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 to-transparent" />
                       <CardHeader className="p-10 pb-6 border-b border-foreground/5 flex flex-row items-center justify-between">
                         <div>
                           <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground mb-1">Observation Capture_</CardTitle>
                           <CardDescription className="text-[10px] font-bold text-foreground/40 italic uppercase tracking-widest">Register New Test Case To Nebula</CardDescription>
                         </div>
                         <Button
                            size="lg"
                            className="bg-emerald-500 text-background shadow-glow-emerald h-14 px-8 rounded-2xl font-black italic uppercase tracking-widest hover:scale-105 transition-all"
                            onClick={() => runMutation.mutate(selectedSetId)}
                            disabled={runMutation.isPending}
                          >
                           <Play className="w-4 h-4 mr-3" />
                           Execute Universal Audit_
                         </Button>
                       </CardHeader>
                       <CardContent className="p-10 space-y-10">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="h-3 w-1 bg-primary" />
                                <Label htmlFor="prompt" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Input Stimulus_</Label>
                              </div>
                              <div className="relative group">
                                <Terminal className="absolute left-4 top-4 h-4 w-4 text-foreground/20 group-focus-within:text-primary transition-colors" />
                                <textarea
                                  id="prompt"
                                  placeholder="SYSTEM_PROMPT_EMULATION..."
                                  value={newInput}
                                  onChange={(e) => setNewInput(e.target.value)}
                                  className="w-full h-32 bg-foreground/[0.03] border border-foreground/5 rounded-[1.5rem] pl-12 pr-6 pt-4 text-[11px] font-bold text-foreground italic tracking-tighter focus:ring-1 focus:ring-primary/20 outline-none transition-all group-hover:border-foreground/10"
                                />
                              </div>
                            </div>
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="h-3 w-1 bg-rose-500" />
                                <Label htmlFor="criteria" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Success Condition_</Label>
                              </div>
                              <div className="relative group">
                                <CheckCircle2 className="absolute left-4 top-4 h-4 w-4 text-foreground/20 group-focus-within:text-rose-500 transition-colors" />
                                <textarea
                                  id="criteria"
                                  placeholder="EXPECTED_OUTPUT_CRITERIA..."
                                  value={newCriteria}
                                  onChange={(e) => setNewCriteria(e.target.value)}
                                  className="w-full h-32 bg-foreground/[0.03] border border-foreground/5 rounded-[1.5rem] pl-12 pr-6 pt-4 text-[11px] font-bold text-foreground italic tracking-tighter focus:ring-1 focus:ring-rose-500/20 outline-none transition-all group-hover:border-foreground/10"
                                />
                              </div>
                            </div>
                         </div>

                         <div className="flex items-end justify-between p-8 bg-background/40 rounded-[2rem] border border-foreground/5 border-dashed">
                            <div className="flex-1 max-w-md space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="h-3 w-1 bg-foreground/20" />
                                <Label htmlFor="method" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Audit Protocol_</Label>
                              </div>
                              <div className="relative">
                                <Settings className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
                                <select
                                  id="method"
                                  title="Audit Protocol Selection"
                                  className="w-full h-14 bg-foreground/5 border border-foreground/10 rounded-xl pl-12 pr-4 text-[10px] font-black uppercase italic tracking-[0.2em] outline-none appearance-none cursor-pointer focus:border-primary/40 transition-all text-foreground"
                                  value={newMethod}
                                  onChange={(e) => setNewMethod(e.target.value)}
                                >
                                  <option value="llm_judge" className="bg-background text-foreground">LLM JUDGE // SEMANTIC</option>
                                  <option value="regex" className="bg-background text-foreground">REGEX MATCH // PATTERN</option>
                                  <option value="keyword" className="bg-background text-foreground">KEYWORD CHECK // TOKENS</option>
                                </select>
                                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 pointer-events-none rotate-90" />
                              </div>
                            </div>
                            <Button
                              className="h-16 px-10 rounded-2xl bg-foreground text-background hover:bg-primary transition-all text-[11px] font-black uppercase italic tracking-[0.3em] font-mono group"
                              onClick={() => createCaseMutation.mutate()}
                              disabled={createCaseMutation.isPending || !newInput || !newCriteria}
                            >
                              {createCaseMutation.isPending ? <Activity className="animate-spin w-4 h-4 mr-3" /> : <Plus className="w-4 h-4 mr-3" />}
                              REGISTER OBSERVATION_
                            </Button>
                         </div>
                       </CardContent>
                    </Card>

                    <EvaluationPromotionPanel testSetId={selectedSetId} />

                    {/* Case Ledger */}
                    <div className="space-y-8">
                      <div className="flex items-center justify-between px-4">
                        <div className="flex items-center gap-4">
                          <History className="text-foreground/20" size={20} />
                          <h4 className="text-[11px] font-black uppercase tracking-[0.4em] text-foreground/40 italic">Active Observational Ledger_ ({cases.length})</h4>
                        </div>
                        <div className="h-px flex-1 bg-foreground/5 mx-8" />
                        <span className="text-[10px] font-bold text-foreground/10 uppercase tracking-widest italic">Station // Alpha 1</span>
                      </div>

                      {cases.length === 0 ? (
                        <div className="h-60 flex flex-col items-center justify-center gap-6 glass-panel-deep rounded-[3rem] border-foreground/5 border-dashed">
                          <Activity className="w-12 h-12 text-foreground/10 animate-pulse" />
                          <p className="text-[11px] font-black uppercase tracking-[0.5em] text-foreground/20 italic">Ledger Awaiting Data Input</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {cases.map((c: any, idx: number) => (
                            <motion.div
                              key={c.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: idx * 0.05 }}
                            >
                              <Card className="glass-panel-deep border-foreground/5 hover:border-primary/20 transition-all group rounded-[2.5rem] overflow-hidden flex flex-col h-full shadow-xl">
                                <CardHeader className="p-8 pb-4">
                                  <div className="flex items-center justify-between mb-4">
                                     <Badge className={cn("px-4 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest italic border-none h-6 content-center", getMethodBadgeClass(c.method))}>
                                      {c.method.replace('_', ' ')}
                                     </Badge>
                                     <p className="text-[10px] font-black font-mono text-foreground/10 italic">#CASE_{c.id.toString().padStart(4, '0')}</p>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-8 pt-0 flex-1 space-y-6">
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-foreground/20">
                                      <Terminal size={12} />
                                      <span className="text-[8px] font-black uppercase tracking-widest italic">Input Stimulus</span>
                                    </div>
                                    <div className="p-4 bg-foreground/5 rounded-2xl border border-foreground/5">
                                      <p className="text-[11px] font-bold text-foreground/60 italic leading-relaxed line-clamp-3">{c.inputPrompt}</p>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-foreground/20">
                                      <CheckCircle2 size={12} />
                                      <span className="text-[8px] font-black uppercase tracking-widest italic">Success Vector</span>
                                    </div>
                                    <div className="p-4 bg-foreground/5 rounded-2xl border border-foreground/5">
                                      <p className="text-[11px] font-bold text-foreground/60 italic leading-relaxed line-clamp-3">{c.expectedCriteria}</p>
                                    </div>
                                  </div>
                                </CardContent>
                                <CardFooter className="p-8 border-t border-foreground/5 bg-background/20 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-all">
                                  <button className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-primary hover:animate-pulse transition-all">
                                    <ArrowUpRight size={14} />
                                    Details_
                                  </button>
                                  <button 
                                    className="text-rose-500/40 hover:text-rose-500 transition-all" 
                                    title="Delete Case"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </CardFooter>
                              </Card>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="inactive-lab"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center p-20 text-center gap-10 glass-panel-deep rounded-[4rem] border-foreground/5 border-dashed"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 bg-primary/20 blur-[100px] animate-pulse" />
                      <div className="p-10 rounded-full bg-foreground/5 border border-foreground/10 relative z-10">
                        <FlaskConical size={80} className="text-foreground/10 group-hover:text-primary transition-all animate-spin-slow" />
                      </div>
                    </div>
                    <div className="space-y-4 max-w-lg">
                      <h2 className="text-3xl font-black italic tracking-tighter uppercase text-foreground">Lab Station Idle_</h2>
                      <p className="text-[12px] font-bold text-foreground/20 italic uppercase tracking-widest leading-loose">
                        Synchronize with a test registry from the left to activate the observation lab. Execute deep-layer evaluations and verify neural integrity.
                      </p>
                    </div>
                    <div className="flex gap-4">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="w-12 h-1 bg-foreground/5 rounded-full" />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}
      </main>

      <style>{`
        .shadow-glow-emerald {
          filter: drop-shadow(0 0 10px rgba(16,185,129,0.5));
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
      `}</style>
    </div>
  );
}
