import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { 
  Bot, 
  Terminal, 
  Workflow, 
  Search, 
  Zap, 
  Star, 
  Code, 
  Shield, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Database,
  Globe,
  Plus,
  Activity,
  ShieldCheck,
  MoreVertical,
  Download,
  UserPlus,
  Cloud,
  Settings,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import ImportSkillModal from "@domain-ui/jobs/ui/modules/jobs/components/ImportSkillModal";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { THEME, combineClasses } from "@/theme";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Skill {
  id: number;
  name: string;
  description: string;
  language: string;
  isPublic: boolean;
  code: string;
  metadata?: any;
}

interface SkillHealth {
  reliabilityIndex: number;
  avgLatencyMs: number;
  totalRuns: number;
  lastFailure?: string;
}

interface SentinelSummary {
  totalMonitored: number;
  avgReliability: number;
  totalRecentFailures: number;
  evolutionCandidatesCount: number;
}

interface Blueprint {
  id: number;
  name: string;
  description: string;
  category: string;
  icon?: string;
  isFeatured: boolean;
  star_rating?: number;
}

interface Connector {
  platform: string;
  status: string;
  last_sync: string;
  is_enabled: boolean;
  config_name?: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 100
    }
  }
};

export default function UCIHub() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("skills");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: skills = [], isLoading: isLoadingSkills } = useQuery<Skill[]>({
    queryKey: ['/api/admin/skills'],
  });

  const { data: blueprints = [], isLoading: isLoadingBlueprints } = useQuery<Blueprint[]>({
    queryKey: ['/api/templates'],
  });

  const { data: connectors = [], isLoading: isLoadingConnectors } = useQuery<Connector[]>({
    queryKey: ['/api/saas/connectors'],
  });

  const provisionMutation = useMutation({
    mutationFn: async (skillId: number) => {
      const res = await apiRequest("POST", `/api/admin/skills/${skillId}/provision-agent`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Agent Provisioned",
        description: `Successfully created specialized agent draft: ${data.name}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Provisioning Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleExport = (skillId: number, format: 'openai' | 'openclaw') => {
    window.open(`/api/admin/skills/${skillId}/export?format=${format}`, '_blank');
  };

    const SentinelOverview = () => {
        const { data: summary } = useQuery<SentinelSummary>({
            queryKey: ["/api/admin/sentinel/summary"],
        });

        if (!summary) return null;

        const stats = [
            { label: "Total Monitored", value: summary.totalMonitored, icon: Activity, color: "text-foreground/40" },
            { label: "Eco Reliability", value: `${summary.avgReliability}%`, icon: ShieldCheck, color: summary.avgReliability >= 90 ? "text-emerald-400" : "text-amber-400" },
            { label: "Recent Failures", value: summary.totalRecentFailures, icon: AlertTriangle, color: summary.totalRecentFailures > 0 ? "text-rose-400" : "text-foreground/20" },
            { label: "Evolution Ready", value: summary.evolutionCandidatesCount, icon: Sparkles, color: "text-primary" },
        ];

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                {stats.map((s, idx) => (
                    <motion.div
                        key={s.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                    >
                        <Card className="glass-panel border-foreground/10 p-6 rounded-[2rem] relative overflow-hidden group shadow-xl hover:bg-foreground/[0.04] transition-all">
                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
                                <s.icon className="w-16 h-16 rotate-12" />
                            </div>
                            <div className="space-y-1 relative z-10">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">{s.label}</p>
                                <p className={cn("text-3xl font-black italic tracking-tighter uppercase leading-tight", s.color)}>
                                    {s.value}
                                </p>
                            </div>
                        </Card>
                    </motion.div>
                ))}
            </div>
        );
    };

  const SkillHealthDisplay = ({ skillId }: { skillId: number }) => {
    const { data: health, isLoading } = useQuery<SkillHealth>({
      queryKey: [`/api/admin/skills/${skillId}/health`],
    });

    if (isLoading) return <div className="h-4 w-24 bg-espresso/5 animate-pulse rounded" />;
    if (!health || health.totalRuns === 0) return <span className="text-[9px] text-muted-foreground font-mono italic whitespace-nowrap">Awaiting Telemetry...</span>;

    const getReliabilityColor = (idx: number) => {
      if (idx >= 90) return "text-emerald-500";
      if (idx >= 70) return "text-amber-500";
      return "text-rose-500";
    };

    return (
      <div className="flex items-center gap-3 text-[10px] font-bold tracking-tighter uppercase whitespace-nowrap">
        <div className="flex items-center gap-1">
          <ShieldCheck className={combineClasses("h-3 w-3", getReliabilityColor(health.reliabilityIndex))} />
          <span className="text-espresso/60">Reliability:</span>
          <span className={getReliabilityColor(health.reliabilityIndex)}>{health.reliabilityIndex}%</span>
        </div>
        <div className="flex items-center gap-1 border-l border-black/5 pl-2">
          <Activity className="h-3 w-3 text-espresso/40" />
          <span className="text-espresso/60">Lat:</span>
          <span className="text-espresso">{health.avgLatencyMs}ms</span>
        </div>
      </div>
    );
  };

  const filteredSkills = skills.filter((s: Skill) => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBlueprints = blueprints.filter((b: Blueprint) => 
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    b.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConnectors = connectors.filter((c: Connector) => 
    c.platform.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

            <main className="container mx-auto py-12 px-6 space-y-12 max-w-7xl relative z-10">
                {/* Header Section */}
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-12"
                >
                    <div className="space-y-6 max-w-3xl">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-[0.3em] uppercase italic">
                            <Sparkles className="w-3.5 h-3.5 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                            Unified Computer Intelligence v4
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                                UCI <span className="text-primary font-light not-italic tracking-[-0.05em]">Hub Galleries</span>
                            </h1>
                            <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                                Verifying specialized primitives, automated neural blueprints, and high-fidelity SaaS bridges for cross-domain operations.
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex flex-col gap-6 w-full lg:w-96">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-primary/5 blur-xl group-focus-within:bg-primary/10 transition-colors rounded-2xl" />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary italic" />
                            <Input 
                                placeholder="Scan Neural_Registry..." 
                                className="pl-12 bg-foreground/[0.03] border-foreground/10 text-foreground placeholder:text-foreground/20 focus-visible:ring-primary focus-visible:border-primary/50 h-16 rounded-[1.8rem] text-[11px] font-black uppercase tracking-widest shadow-2xl glass-panel-deep"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-6 px-6 text-[9px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                            <div className="flex items-center gap-2">
                                <span className="text-primary">{skills.length}</span> Skills
                            </div>
                            <div className="w-1 h-1 rounded-full bg-foreground/10" />
                            <div className="flex items-center gap-2">
                                <span className="text-primary">{blueprints.length}</span> Blueprints
                            </div>
                        </div>
                    </div>
                </motion.div>

      <SentinelOverview />

                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-12">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                        <TabsList className="bg-foreground/[0.03] border border-foreground/10 p-1.5 rounded-2xl h-16 w-fit glass-panel shadow-2xl">
                            {[
                                { value: 'skills',     icon: Terminal, label: 'Neural Primitives' },
                                { value: 'blueprints', icon: Workflow, label: 'Logic Gallery' },
                                { value: 'connectors', icon: Globe,    label: 'SaaS Bridges' },
                            ].map(tab => (
                                <TabsTrigger 
                                    key={tab.value}
                                    value={tab.value} 
                                    className="h-13 rounded-xl px-8 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-widest gap-3 transition-all italic"
                                >
                                    <tab.icon className="h-4 w-4" /> 
                                    {tab.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        
                        <AnimatePresence mode="wait">
                            {activeTab === 'skills' && (
                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex gap-4">
                                    <Button 
                                        variant="outline" 
                                        onClick={() => setIsImportModalOpen(true)}
                                        className="h-14 px-8 rounded-2xl glass-panel border-foreground/10 bg-foreground/[0.02] text-[10px] font-black uppercase tracking-widest hover:bg-foreground/10 transition-all active:scale-95 text-foreground"
                                    >
                                        <Download className="w-4 h-4 mr-3 text-primary" />
                                        Import Primitives
                                    </Button>
                                    <Button 
                                        onClick={() => setLocation("/admin/skill-registry")} 
                                        className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95"
                                    >
                                        <Plus className="w-4 h-4 mr-3" /> New System Skill
                                    </Button>
                                </motion.div>
                            )}
                            {activeTab === 'blueprints' && (
                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                    <Button 
                                        onClick={() => setLocation("/templates")} 
                                        className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95"
                                    >
                                        <Plus className="w-4 h-4 mr-3" /> Create Blueprint
                                    </Button>
                                </motion.div>
                            )}
                            {activeTab === 'connectors' && (
                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                    <Button 
                                        onClick={() => setLocation("/connections/saas")} 
                                        className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95"
                                    >
                                        <Plus className="w-4 h-4 mr-3" /> Link SaaS Bridge
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

        <TabsContent value="skills" className="m-0 focus-visible:outline-none">
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredSkills.map((skill: Skill) => (
              <motion.div key={skill.id} variants={itemVariants}>
                  <Card className="glass-panel-deep border-foreground/10 hover:shadow-primary/5 transition-all duration-500 group overflow-hidden relative flex flex-col h-full rounded-[2.5rem]">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute top-4 right-4 z-20">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-foreground/10 rounded-xl text-foreground/40 hover:text-foreground transition-colors">
                            <MoreVertical className="h-5 w-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 glass-panel border-foreground/10 bg-background/90 rounded-2xl p-2 select-none">
                          <DropdownMenuItem onClick={() => provisionMutation.mutate(skill.id)} className="cursor-pointer font-black uppercase text-[10px] tracking-widest h-12 rounded-xl focus:bg-primary/20 text-foreground transition-colors">
                            <UserPlus className="mr-3 h-4 w-4 text-primary" />
                            Provision Agent
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-foreground/10 mx-2 my-2" />
                          <DropdownMenuItem onClick={() => handleExport(skill.id, 'openai')} className="cursor-pointer font-black uppercase text-[10px] tracking-widest h-12 rounded-xl focus:bg-foreground/10 text-foreground/60 transition-colors">
                            <Download className="mr-3 h-4 w-4" />
                            Export OAI Action
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-foreground/10 mx-2 my-2" />
                          <DropdownMenuItem onClick={() => setLocation(`/admin/skill-registry?edit=${skill.id}`)} className="cursor-pointer font-black uppercase text-[10px] tracking-widest h-12 rounded-xl focus:bg-foreground/10 text-foreground/40 transition-colors">
                            <Settings className="mr-3 h-4 w-4" />
                            Registry Settings
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <CardHeader className="relative pb-4 pt-10 px-8">
                      <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-5 transition-opacity translate-x-4 -translate-y-4 pointer-events-none">
                        <Code className="w-32 h-32 rotate-12 text-primary" />
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 capitalize font-black text-[9px] tracking-[0.2em] h-6 px-3 rounded-lg flex items-center gap-2">
                           <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                           {skill.language}_ENV
                        </Badge>
                        {skill.isPublic && (
                          <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] tracking-[0.2em] font-black h-6 px-3 rounded-lg uppercase italic">
                            Verified
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none">
                        {skill.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed h-12 pt-2">
                        {skill.description || "Experimental Primitive_v1.0"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow pt-2 px-8">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 text-[10px] font-mono text-foreground/30 bg-foreground/[0.02] p-4 rounded-2xl border border-foreground/5 overflow-hidden shadow-inner group-hover:border-primary/20 transition-colors">
                          <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                          <code className="truncate italic">{skill.code.substring(0, 45)}...</code>
                        </div>
                        <div className="pt-2 border-t border-foreground/5">
                          <SkillHealthDisplay skillId={skill.id} />
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="pt-4 pb-8 px-8 flex-col items-stretch gap-4">
                      <Button 
                        className="w-full justify-between h-14 rounded-2xl bg-foreground/[0.03] border border-foreground/10 text-foreground font-black uppercase text-[10px] tracking-[0.2em] hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all active:scale-95 group/btn shadow-xl"
                        onClick={() => provisionMutation.mutate(skill.id)}
                        disabled={provisionMutation.isPending}
                      >
                        <span className="flex items-center gap-3 italic">
                           <Bot className="w-4 h-4" />
                           {provisionMutation.isPending ? "PROVISIONING..." : "Provision Specialized Agent"}
                        </span>
                        <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                      </Button>
                    </CardFooter>
                  </Card>
              </motion.div>
            ))}
          </motion.div>
        </TabsContent>

        <TabsContent value="blueprints" className="m-0 focus-visible:outline-none">
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {blueprints.map((blueprint: Blueprint) => {
              const requiresSkills = skills.filter(s => 
                (blueprint.category?.toLowerCase() === s.name.split('_')[0].toLowerCase()) ||
                (blueprint.description?.toLowerCase().includes(s.name.toLowerCase()))
              ).slice(0, 2);

              return (
                <motion.div key={blueprint.id} variants={itemVariants}>
                  <Card className="glass-panel-deep border-foreground/10 hover:shadow-primary/5 transition-all duration-500 group overflow-hidden relative flex flex-col h-full rounded-[2.5rem]">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <CardHeader className="relative pb-4 pt-10 px-8">
                      <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-5 transition-opacity translate-x-4 -translate-y-4 pointer-events-none">
                        <Zap className="w-32 h-32 -rotate-12 text-primary" />
                      </div>
                      <div className="flex items-center justify-between mb-4">
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 capitalize font-black text-[9px] tracking-[0.2em] h-6 px-3 rounded-lg flex items-center gap-2">
                           {blueprint.category}_LOGIC
                        </Badge>
                        <div className="flex items-center text-primary gap-1">
                          <Star className="w-3.5 h-3.5 fill-current shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
                          <span className="text-[10px] font-black italic">4.9</span>
                        </div>
                      </div>
                      <CardTitle className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none">
                        {blueprint.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed h-12 pt-2">
                        {blueprint.description || "Experimental Logic_v1.0"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow pt-2 px-8">
                      {requiresSkills.length > 0 && (
                        <div className="space-y-4 mb-6">
                          <div className="flex items-center justify-between">
                            <label className="text-[9px] uppercase text-foreground/20 font-black tracking-[0.2em] italic">Recommended Primitives</label>
                            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {requiresSkills.map(s => (
                              <Badge key={s.id} className="bg-foreground/[0.03] text-foreground/60 border border-foreground/10 text-[9px] font-black py-1 px-3 rounded-lg uppercase tracking-widest">
                                <Code className="w-3 h-3 mr-2 text-primary/50" /> {s.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-4">
                        <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic">
                          <span>Neutral Reliability</span>
                          <span className="text-primary">85%</span>
                        </div>
                        <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden border border-foreground/5">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: "85%" }}
                            className="h-full bg-primary shadow-[0_0_15px_rgba(var(--primary),0.5)]" 
                          />
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="pt-4 pb-8 px-8 flex gap-4 mt-auto">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1 h-12 rounded-2xl glass-panel border-foreground/10 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 hover:text-foreground hover:bg-foreground/10 transition-all active:scale-95" 
                        onClick={() => setLocation("/templates")}
                      >
                        Configuration
                      </Button>
                      <Button 
                        size="sm" 
                        className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] tracking-[0.2em] uppercase shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95"
                      >
                        Execute
                      </Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </TabsContent>

        <TabsContent value="connectors" className="m-0 focus-visible:outline-none">
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {filteredConnectors.map((conn: Connector) => (
              <motion.div key={conn.platform} variants={itemVariants}>
                <Card className="glass-panel-deep border-foreground/10 hover:shadow-primary/5 transition-all duration-500 group overflow-hidden relative flex flex-col h-full rounded-[2.5rem]">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <CardHeader className="relative pb-4 pt-10 px-8">
                    <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-5 transition-opacity translate-x-4 -translate-y-4 pointer-events-none">
                      <Globe className="w-32 h-32 text-primary" />
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <Badge variant="outline" className="bg-foreground/5 text-foreground/40 border-foreground/10 capitalize font-black text-[9px] tracking-[0.2em] h-6 px-3 rounded-lg uppercase">
                        {conn.platform}_BRIDGE
                      </Badge>
                      <Badge className={cn("text-[9px] tracking-[0.2em] font-black h-6 px-3 rounded-lg uppercase italic", conn.status === 'connected' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-foreground/5 text-foreground/20")}>
                        {conn.status}
                      </Badge>
                    </div>
                    <CardTitle className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none">
                      {conn.platform} Collective
                    </CardTitle>
                    <CardDescription className="line-clamp-2 text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed h-12 pt-2">
                      {conn.config_name || `Active ${conn.platform}_Integration_v4.5`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2 px-8 flex-grow">
                    <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/20 italic">
                      <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
                      Last Sync: {conn.last_sync ? new Date(conn.last_sync).toLocaleTimeString() : 'Awaiting_Signal'}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-4 pb-8 px-8 flex justify-between items-center group-hover:bg-primary/5 transition-colors border-t border-foreground/5">
                     <div className="flex items-center gap-3">
                       <ShieldCheck className="w-4 h-4 text-emerald-500" />
                       <span className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.1em] italic">Security Enforced</span>
                     </div>
                    <Button variant="ghost" size="sm" className="h-10 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-foreground hover:bg-foreground/10 transition-all hover:translate-x-1" onClick={() => setLocation("/connections/saas")}>
                      Terminal Link
                      <ChevronRight className="w-4 h-4 ml-3 text-primary" />
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            ))}
            {filteredConnectors.length === 0 && !isLoadingConnectors && (
              <div className="col-span-full py-32 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center space-y-8 text-center px-12">
                <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20 shadow-glow/10">
                    <Globe className="w-10 h-10 text-primary animate-pulse" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter italic">No SaaS Bridges Detected</h3>
                  <p className="text-foreground/40 text-sm font-bold uppercase tracking-widest max-w-md mx-auto">Establish initial uplink primitive to enable autonomous cross-system relay missions.</p>
                </div>
                <Button onClick={() => setLocation("/connections/saas")} className="h-14 px-12 rounded-[1.5rem] bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl transition-all active:scale-95">
                  Initialize Orbital Bridge
                </Button>
              </div>
            )}
          </motion.div>
        </TabsContent>
      </Tabs>
      </main>

      <ImportSkillModal 
        open={isImportModalOpen} 
        onOpenChange={setIsImportModalOpen} 
      />
    </div>
  );
}

