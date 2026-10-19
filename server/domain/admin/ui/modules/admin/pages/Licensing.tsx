import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
  Loader2, 
  ShieldCheck, 
  ShieldAlert, 
  Key, 
  Zap, 
  CheckCircle2, 
  Terminal, 
  Lock, 
  Unlock, 
  Globe, 
  Activity,
  Cpu,
  ArrowUpRight,
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface LicenseStatus {
    type: "community" | "trial" | "enterprise" | "expired";
    plan: string;
    seats: number | string;
    features: string[];
    isActive: boolean;
    expiresAt?: string;
    daysRemaining: number | null;
    customerName?: string;
}

export default function Licensing() {
    const [licenseKey, setLicenseKey] = useState("");
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: status, isLoading } = useQuery<LicenseStatus>({
        queryKey: ["/api/licensing/status"],
    });

    const activateMutation = useMutation({
        mutationFn: async (key: string) => {
            const res = await fetch("/api/licensing/activate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || "Failed to activate license");
            }
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "License Activated",
                description: "Your enterprise license has been successfully applied.",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/licensing/status"] });
            setLicenseKey("");
        },
        onError: (err: Error) => {
            toast({
                title: "Activation Failed",
                description: err.message,
                variant: "destructive",
            });
        },
    });

    const trialMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch("/api/licensing/trial", { method: "POST" });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || "Failed to start trial");
            }
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Trial Started",
                description: "Your 30-day trial is now active with full features.",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/licensing/status"] });
        },
        onError: (err: Error) => {
            toast({
                title: "Trial Failed",
                description: err.message,
                variant: "destructive",
            });
        },
    });

    const isTrial = status?.type === "trial";
    const isActive = status?.isActive;
    const isExpired = status?.type === "expired";
    const isCommunity = status?.type === "community";

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">

            <main className="flex-1 flex flex-col gap-6">
                {/* Page Header */}
                <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Licensing</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">Manage license activation and compliance</p>
                    </div>
                    <div className="flex gap-2">
                      {isCommunity && !isTrial && (
                        <Button
                            onClick={() => trialMutation.mutate()}
                            disabled={trialMutation.isPending}
                            className="gap-2"
                        >
                            <Zap className="w-4 h-4" />
                            Start Enterprise Trial
                        </Button>
                      )}
                    </div>
                </header>

                {isLoading ? (
                  <div className="flex h-80 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : (
                  <section className="grid grid-cols-1 lg:grid-cols-4 gap-12 flex-1 min-h-0">
                    {/* Compliance Sidebar */}
                    <aside className="lg:col-span-1 space-y-8">
                        <Card className="bg-card border border-border overflow-hidden">
                            <CardHeader className="p-8 pb-4">
                                <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                                    <Key size={14} className="text-primary" />
                                    Activation Registry
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 pt-0 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic ml-2">License Key</label>
                                    <div className="relative group">
                                        <Terminal className="absolute left-4 top-4 h-4 w-4 text-foreground/20 group-hover:text-primary transition-colors" />
                                        <textarea
                                            placeholder="PASTE_ENCRYPTED_KEY..."
                                            value={licenseKey}
                                            onChange={(e) => setLicenseKey(e.target.value)}
                                            className="w-full h-32 bg-foreground/[0.03] border border-foreground/5 rounded-xl pl-12 pr-4 pt-4 text-[10px] font-mono tracking-widest uppercase italic focus:ring-primary/40 focus:border-primary/20 resize-none outline-none"
                                        />
                                    </div>
                                </div>

                                <Button
                                    onClick={() => activateMutation.mutate(licenseKey)}
                                    disabled={activateMutation.isPending || !licenseKey}
                                    className="w-full h-12 rounded-xl bg-foreground/5 hover:bg-primary hover:text-primary-foreground border border-foreground/10 text-[10px] font-black uppercase italic tracking-widest transition-all shadow-xl group"
                                >
                                    {activateMutation.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                                    Apply Integrity Key
                                </Button>

                                <div className="pt-6 border-t border-foreground/5 space-y-4">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic text-foreground/40">
                                        <span>Registry State</span>
                                        <Badge variant="outline" className={cn("text-[8px] font-black tracking-widest italic border-none", isActive ? "text-emerald-500" : "text-rose-500")}>
                                          {isActive ? "SYNCHRONIZED" : "DE-SYNCED"}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic text-foreground/40">
                                        <span>Encryption Tier</span>
                                        <span className="text-foreground font-black italic">{status?.plan?.toUpperCase() || "NONE"}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="p-8 bg-emerald-500/5 rounded-[2.5rem] border border-emerald-500/10 flex items-center gap-5 group cursor-help transition-all hover:bg-emerald-500/10">
                            <div className="p-4 bg-emerald-500/20 rounded-2xl group-hover:rotate-12 transition-transform shadow-glow-emerald">
                                <ShieldCheck className="w-6 h-6 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-500 mb-1">Compliance Verified</p>
                                <p className="text-[9px] text-foreground/40 leading-relaxed font-bold italic uppercase tracking-tighter">
                                    All System Modules // Operative
                                </p>
                            </div>
                        </div>
                    </aside>

                    {/* Main Compliance Panel */}
                    <div className="lg:col-span-3 space-y-12">
                        {/* HUD Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                                <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden h-full">
                                    <div className="absolute top-0 left-0 w-full h-0.5 bg-primary/20 opacity-50" />
                                    <CardContent className="p-10 flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/20 italic mb-1">Seat Registry</p>
                                            <div className="text-5xl font-black font-mono tracking-tighter italic text-foreground">
                                                {status?.seats || "0"}
                                            </div>
                                            <p className="text-[8px] font-bold text-foreground/10 uppercase tracking-widest mt-1 italic">Authorized Personas</p>
                                        </div>
                                        <div className="p-5 bg-foreground/5 rounded-[2rem] border border-foreground/5">
                                          <Users className="w-10 h-10 text-foreground/20" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                                <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden h-full">
                                    <div className="absolute top-0 left-0 w-full h-0.5 bg-rose-500/20 opacity-50" />
                                    <CardContent className="p-10 flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/20 italic mb-1">Temporal Window</p>
                                            <div className="text-5xl font-black font-mono tracking-tighter italic text-foreground">
                                                {status?.daysRemaining != null ? `${status?.daysRemaining}d` : "∞"}
                                            </div>
                                            <p className="text-[8px] font-bold text-foreground/10 uppercase tracking-widest mt-1 italic">Remaining Operational Time</p>
                                        </div>
                                        <div className="p-5 bg-foreground/5 rounded-[2rem] border border-foreground/5">
                                          <Activity className="w-10 h-10 text-foreground/20" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>

                        {/* Features Matrix */}
                        <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl">
                          <CardHeader className="p-10 pb-6 border-b border-foreground/5">
                            <CardTitle className="text-lg font-black italic tracking-[0.2em] uppercase text-foreground/60 flex items-center gap-3">
                              <Cpu className="text-primary w-5 h-5" />
                              Module Entitlements Matrix_
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {(status?.features || ["CORE_SYSTEM", "ADMIN_PANEL"]).map((feature, idx) => (
                                <motion.div
                                  key={feature}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="flex items-center gap-5 p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5 group hover:bg-foreground/[0.04] hover:border-primary/20 transition-all"
                                >
                                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-glow-emerald">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-[11px] font-black uppercase tracking-widest text-foreground italic group-hover:text-primary transition-colors">
                                      {feature === '*' ? 'GLOBAL_SYSTEM_ENTITLEMENT' : feature.replace(/_/g, ' ')}
                                    </p>
                                    <p className="text-[8px] font-bold uppercase tracking-widest text-foreground/10 italic">Module Active // Authorized</p>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-foreground/10 group-hover:text-primary transition-all opacity-0 group-hover:opacity-100" />
                                </motion.div>
                              ))}
                            </div>
                          </CardContent>
                          <CardFooter className="p-10 border-t border-foreground/5 bg-background/20 flex justify-between items-center">
                            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/10 italic">SYSTEM INTEGRITY: 100%_SECURE</p>
                            <Button variant="outline" className="h-10 px-6 rounded-xl border-foreground/10 text-[9px] font-black uppercase italic tracking-widest hover:bg-foreground/5 transition-all">
                              Download Compliance Sbom
                            </Button>
                          </CardFooter>
                        </Card>
                    </div>
                  </section>
                )}
            </main>

            <style>{`
                .shadow-glow-emerald {
                    filter: drop-shadow(0 0 10px rgba(16,185,129,0.5));
                }
                .shadow-glow-rose {
                    filter: drop-shadow(0 0 10px rgba(244,63,94,0.5));
                }
            `}</style>
        </div>
    );
}

// Helper icons
function Users({ className, ...props }: any) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

