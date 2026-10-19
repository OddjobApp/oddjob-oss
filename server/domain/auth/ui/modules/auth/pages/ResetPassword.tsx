import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Loader2, ArrowLeft, Terminal, CheckCircle2, ShieldCheck, Lock, Activity, Hammer } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ResetPassword() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    if (!token) {
      toast({
        title: "Invalid link",
        description: "Missing reset token. Please request a new link.",
        variant: "destructive",
      });
      setLocation("/auth/forgot-password");
    }
  }, [token, setLocation, toast]);

  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, newPassword: password });
      return await res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");

    if (newPassword.length < 8) {
      setValidationError("PASSWORD_UNDERLENGTH: MIN_8_CHARS_REQUIRED");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("PARITY_MISMATCH: PASSWORDS_MUST_MATCH");
      return;
    }

    mutation.mutate(newPassword);
  };

  if (!token) return null;

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
                  <h2 className="text-xl font-black text-foreground uppercase italic tracking-tight">Key Updated</h2>
                  <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest leading-loose max-w-[240px] mx-auto">
                    Security credentials have been reconfigured. Gateway access is now authorized with new parameters.
                  </p>
                </div>
                <Link href="/auth/login" className="h-12 flex items-center justify-center px-8 rounded-xl bg-primary text-[10px] font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 italic">
                  Establish Session
                </Link>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="mb-8 space-y-1">
                  <h2 className="text-xl font-black text-foreground uppercase italic tracking-tight flex items-center gap-3">
                    <Hammer className="w-5 h-5 text-primary" />
                    Forge New Key
                  </h2>
                  <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest leading-loose">Initialize credential restoration protocol. Ensure maximum parity.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                      New Access Key
                    </Label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 group-focus-within:text-primary transition-colors" />
                      <Input
                        id="new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="min_8_characters"
                        required
                        minLength={8}
                        autoFocus
                        disabled={mutation.isPending}
                        className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl pl-12 text-[11px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all italic"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                      Confirm Access Key
                    </Label>
                    <div className="relative group">
                      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 group-focus-within:text-primary transition-colors" />
                      <Input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="repeat_key_parameters"
                        required
                        minLength={8}
                        disabled={mutation.isPending}
                        className="h-14 bg-foreground/[0.03] border-foreground/10 rounded-2xl pl-12 text-[11px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all italic"
                      />
                    </div>
                  </div>

                  {validationError && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                      <p className="text-[10px] text-red-400 font-black uppercase tracking-widest leading-relaxed italic flex items-center gap-2">
                        <Activity className="w-3 h-3 animate-pulse" />
                        {validationError}
                      </p>
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95 italic group" 
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="mr-3 h-4 w-4 animate-spin" />
                        RECONFIGURING...
                      </>
                    ) : (
                      <>
                        Reconfigure Credentials
                        <ShieldCheck className="w-4 h-4 ml-3 group-hover:scale-110 transition-transform" />
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
              ABORT PROCEDURE
            </Link>
          </motion.div>
        )}

        <div className="flex flex-col items-center mt-12 space-y-4">
           <div className="h-px w-12 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
           <p className="text-[9px] text-foreground/10 uppercase tracking-[0.5em] font-black italic">
             CORE SECURITY // CREDENTIAL FORGE LOCKED
           </p>
        </div>
      </motion.div>
    </div>
  );
}


