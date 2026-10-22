import { AnnouncementsSignup } from '@/components/AnnouncementsSignup';
import { useState } from 'react';
import { Link } from 'wouter';
import { Activity, AppWindow, Eye, EyeOff, Fingerprint, Loader2, Lock, Route, ShieldCheck, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import { useAuth } from '../hooks/use-auth.js';

interface LoginProps {
  onRegisterClick?: () => void;
}

const WEB_LINKS = [
  ['About Oddjob', '/overview'],
  ['Support', '/contact'],
  ['Trust center', '/trust'],
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
];

const MARKETING_POINTS = [
  {
    title: 'Durable missions',
    detail: 'Plan, run, pause, resume, and inspect long-running operational work.',
    icon: Route,
  },
  {
    title: 'Governed execution',
    detail: 'Review risky actions, record human decisions, and replay execution evidence.',
    icon: ShieldCheck,
  },
  {
    title: 'Knowledge and internal apps',
    detail: 'Ground work in organizational context and turn repeatable workflows into operational apps.',
    icon: AppWindow,
  },
];

export default function Login({ onRegisterClick }: LoginProps) {
  const { loginMutation } = useAuth();
  const [designation, setDesignation] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ username: designation, password });
  };

  const errorMessage = loginMutation.isError
    ? (loginMutation.error as Error)?.message ?? 'Login failed. Please try again.'
    : null;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background font-sans text-foreground selection:bg-primary/30">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-20" />
        <div className="absolute inset-0 scanlines opacity-10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.16),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(2,2,2,1)_58%,rgba(15,23,42,0.96))]" />
      </div>

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl content-center items-start gap-10 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-2 lg:gap-x-12 lg:px-8"
      >
        <section className="mx-auto w-full max-w-md">
          <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="flex items-center gap-3" data-testid="login-brand-lockup">
              <div className="relative shrink-0">
                <div className="relative z-10 flex items-center justify-center rounded-full border border-foreground/20 bg-card p-[3.1px] shadow-md">
                  <HatIcon publicBackdrop className="h-[42px] w-[42px] drop-shadow-md" />
                </div>
                <div className="absolute -inset-2 rounded-full bg-primary/20 opacity-40 blur-xl" />
              </div>
              <h1 className="text-4xl font-black leading-none tracking-tighter text-foreground">Oddjob</h1>
            </div>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/70">Governed agentic operations</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-foreground/70">
              Plan, execute, approve, and replay autonomous work from one workspace.
            </p>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-foreground/15 bg-foreground/[0.04] p-5 sm:p-8">
            <div className="mb-7 space-y-2">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h2>
              <p className="text-sm leading-6 text-foreground/70">Use your Oddjob username or email and password.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="designation" className="ml-1 text-sm font-semibold text-foreground/85">
                  Username or email
                </Label>
                <div className="relative group">
                  <Fingerprint className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/60 transition-colors group-focus-within:text-primary" />
                  <Input
                    id="designation"
                    type="text"
                    placeholder="you@company.com"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    required
                    autoComplete="username"
                    autoFocus
                    className="min-h-[52px] rounded-2xl border-foreground/10 bg-foreground/[0.04] pl-12 text-sm text-foreground placeholder:text-foreground/60 focus:border-primary/30 focus:ring-primary/40"
                    data-testid="email-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="ml-1 flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-semibold text-foreground/85">
                    Password
                  </Label>
                  <Link href="/auth/forgot-password" className="inline-flex min-h-8 items-center rounded-md text-sm font-medium text-foreground/75 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/60 transition-colors group-focus-within:text-primary" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="min-h-[52px] rounded-2xl border-foreground/10 bg-foreground/[0.04] pl-12 pr-12 text-sm text-foreground placeholder:text-foreground/60 focus:border-primary/30 focus:ring-primary/40"
                    data-testid="password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(value => !value)}
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-foreground/70 transition hover:bg-foreground/10 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4"
                    role="alert"
                  >
                    <p className="flex items-start gap-2 text-sm leading-relaxed text-red-700 dark:text-red-200">
                      <Activity className="mt-0.5 h-4 w-4 shrink-0" />
                      {errorMessage}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                className="min-h-[52px] w-full rounded-2xl bg-primary text-sm font-black text-primary-foreground transition-colors hover:bg-primary/90"
                disabled={loginMutation.isPending}
                data-testid="login-button"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <span className="ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-card p-[1.5px]">
                      <HatIcon publicBackdrop className="h-5 w-5" />
                    </span>
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 flex items-start gap-2 border-t border-foreground/10 pt-5 text-sm leading-6 text-foreground/70">
              <ShieldCheck className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              Sign in securely to your organization's workspace.
            </p>
          </div>

          {onRegisterClick && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-6 text-center lg:text-left"
            >
              <p className="text-sm text-foreground/70">
                Need an account?{' '}
                <button
                  type="button"
                  onClick={onRegisterClick}
                  className="font-bold text-primary underline underline-offset-4 decoration-primary/25 transition-colors hover:text-primary/80"
                >
                  Create one
                </button>
              </p>
            </motion.div>
          )}
        </section>

        <section className="hidden lg:block">
          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <p className="text-2xl font-semibold leading-tight tracking-tight">
                Return to governed autonomous work.
              </p>
              <p className="max-w-sm text-sm leading-6 text-foreground/70">
                Continue durable missions with organization-scoped access, approval controls, knowledge grounding, and replayable evidence.
              </p>
            </div>

            <div className="rounded-2xl border border-foreground/15 bg-foreground/[0.04] p-6">
              <div className="mb-4 flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">Inside your workspace</span>
              </div>
              <div className="grid gap-4">
                {MARKETING_POINTS.map(point => {
                  const Icon = point.icon;
                  return (
                    <div key={point.title} className="flex gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-background/20 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">{point.title}</p>
                        <p className="mt-1 text-sm leading-6 text-foreground/70">{point.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


          </div>
        </section>

        <AnnouncementsSignup className="lg:col-span-2" />

          <footer className="flex flex-col items-center gap-3 border-t border-foreground/10 pt-6 lg:col-span-2">
            <div className="flex flex-wrap justify-center gap-2">
              {WEB_LINKS.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground/75 underline-offset-4 transition hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {label}
                </a>
              ))}
            </div>
            <p className="text-xs text-foreground/60">
              &copy; {new Date().getFullYear()} Oddjob
            </p>
          </footer>
      </motion.main>
    </div>
  );
}
