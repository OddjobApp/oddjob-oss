import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Loader2, ArrowLeft, Terminal, CheckCircle2, ShieldAlert, Key, Mail, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      return await res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(email);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden font-sans selection:bg-primary/30">
      {/* Cinematic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-20" />
        <div className="absolute inset-0 scanlines opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm px-6 relative z-10"
      >
        {/* Brand */}
        <div className="flex flex-col items-center mb-10">
          <motion.div 
             initial={{ scale: 0.8, opacity: 0 }}
             animate={{ scale: 1, opacity: 1 }}
             transition={{ delay: 0.2 }}
             className="w-16 h-16 rounded-[1.5rem] bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 shadow-2xl shadow-primary/20 relative group overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <Terminal className="w-8 h-8 text-primary shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
          </motion.div>
          
          <div className="text-center space-y-1">
            <h1 className="text-4xl font-black tracking-tighter text-foreground uppercase italic leading-none">
              Oddjob
            </h1>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/40 italic">
              OMNIA. UBIQUE. SIMUL.
            </p>
          </div>
        </div>

        <div className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-8 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          
          <AnimatePresence mode="wait">
            {mutation.isSuccess ? (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center py-4 gap-6"
              >
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-2xl shadow-emerald-500/20">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-black text-foreground uppercase italic tracking-tight">Transmission Sent</h2>
                  <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest leading-loose max-w-[240px] mx-auto">
                    If an identity exists for <span className="text-primary">{email.toUpperCase()}</span>, a recovery key has been dispatched.
                  </p>
                </div>
                <Link href="/auth/login" className="h-12 flex items-center justify-center px-8 rounded-xl bg-foreground/5 border border-foreground/10 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors italic">
                  Return To Gateway
                </Link>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="mb-8 space-y-1">
                  <h2 className="text-xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                    <Key className="w-5 h-5 text-primary" />
                    Key Recovery
                  </h2>
                  <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest leading-loose">Enter your uplink designated ID to receive a temporary access bypass.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                      Uplink ID (Email)
                    </Label>
                    <div className="relative group">
                       <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 group-focus-within:text-primary transition-colors" />
                       <Input
                         id="email"
                         type="email"
                         placeholder="designation@domain.net"
                         value={email}
                         onChange={(e) => setEmail(e.target.value)}
                         required
                         autoFocus
                         disabled={mutation.isPending}
                         className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl pl-12 text-[11px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all italic"
                       />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95 italic group" 
                    disabled={mutation.isPending || !email}
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="mr-3 h-4 w-4 animate-spin" />
                        DISPATCHING...
                      </>
                    ) : (
                      <>
                        Dispatch Recovery Key
                        <Activity className="w-4 h-4 ml-3 group-hover:scale-110 transition-transform" />
                      </>
                    )}
                  </Button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!mutation.isSuccess && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex justify-center mt-8"
          >
            <Link href="/auth/login" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-foreground/30 hover:text-foreground transition-colors italic">
              <ArrowLeft className="w-3.5 h-3.5" />
              AUTHENTICATION GATEWAY
            </Link>
          </motion.div>
        )}

        <div className="flex flex-col items-center mt-12 space-y-4">
           <div className="h-px w-12 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
           <p className="text-[9px] text-foreground/10 uppercase tracking-[0.5em] font-black italic">
             CORE SECURITY // RECOVERY PROCEDURE ACTIVE
           </p>
        </div>
      </motion.div>
    </div>
  );
}


