import { useState } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { useAuth } from '../hooks/use-auth.js';

interface RegisterProps {
  onBackToLogin: () => void;
}

export default function Register({ onBackToLogin }: RegisterProps) {
  const { registerMutation } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const labelClass = 'text-sm font-semibold text-foreground';
  const inputClass = 'min-h-[52px] rounded-2xl border-foreground/15 bg-foreground/[0.04] px-4 text-sm text-foreground placeholder:text-muted-foreground focus:ring-primary/40';
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    organizationName: '',
    tosAccepted: false,
    privacyPolicyAccepted: false,
  });

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tosAccepted || !form.privacyPolicyAccepted) return;
    registerMutation.mutate({
      username: form.username,
      email: form.email,
      password: form.password,
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      organizationName: form.organizationName.trim() || undefined,
      privacyPolicyAccepted: true,
      privacyPolicyVersion: '1.0.0',
      tosAccepted: true,
      tosVersion: '1.0.0',
    });
  };

  const errorMessage = registerMutation.isError
    ? (registerMutation.error as Error)?.message ?? 'Registration failed. Please try again.'
    : null;

  const canSubmit = form.tosAccepted && form.privacyPolicyAccepted && !registerMutation.isPending;

  return (
    <main className="min-h-screen bg-background px-4 py-10 font-sans text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto grid w-full max-w-6xl items-start gap-10 lg:grid-cols-2 lg:gap-12 lg:px-8">
        <section className="mx-auto w-full max-w-md">
          <a href="/overview" className="mb-6 flex items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <HatIcon className="h-12 w-12" />
            <span className="text-4xl font-bold tracking-tight">Oddjob</span>
          </a>
          <p className="mb-6 text-sm leading-6 text-muted-foreground">Plan, execute, approve, and replay autonomous work from one workspace.</p>
          <div className="rounded-2xl border border-foreground/15 bg-foreground/[0.04] p-5 sm:p-8">
            <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your details to get started with Oddjob.</p>
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className={labelClass}>Username</Label>
                <Input id="username" placeholder="Your username" value={form.username} onChange={e => set('username', e.target.value)} required minLength={3} autoComplete="username" autoFocus aria-describedby="username-hint" className={inputClass} />
                <p id="username-hint" className="text-sm text-muted-foreground">At least 3 characters.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email" className={labelClass}>Email</Label>
                <Input id="reg-email" type="email" placeholder="you@company.com" value={form.email} onChange={e => set('email', e.target.value)} required autoComplete="email" className={inputClass} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="firstName" className={labelClass}>First name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="firstName" value={form.firstName} onChange={e => set('firstName', e.target.value)} autoComplete="given-name" className={inputClass} /></div>
                <div className="space-y-2"><Label htmlFor="lastName" className={labelClass}>Last name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="lastName" value={form.lastName} onChange={e => set('lastName', e.target.value)} autoComplete="family-name" className={inputClass} /></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="organizationName" className={labelClass}>Organization name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="organizationName" placeholder="Your company or team" value={form.organizationName} onChange={e => set('organizationName', e.target.value)} maxLength={120} autoComplete="organization" aria-describedby="organization-hint" className={inputClass} />
                <p id="organization-hint" className="text-sm text-muted-foreground">We create this organization for you and make you its administrator. You can add your team afterwards.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password" className={labelClass}>Password</Label>
                <div className="relative">
                  <Input id="reg-password" type={showPassword ? 'text' : 'password'} placeholder="Create a password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} autoComplete="new-password" aria-describedby="password-hint" className={`${inputClass} pr-12`} />
                  <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
                <p id="password-hint" className="text-sm text-muted-foreground">At least 8 characters.</p>
              </div>
              <div className="space-y-4 border-t border-border pt-5">
                <div className="flex items-start gap-3"><Checkbox id="privacy" checked={form.privacyPolicyAccepted} onCheckedChange={v => set('privacyPolicyAccepted', v === true)} className="mt-1" /><Label htmlFor="privacy" className="text-sm font-normal leading-6">I authorize processing according to the <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Privacy Policy<span className="sr-only"> (opens in a new tab)</span></a>.</Label></div>
                <div className="flex items-start gap-3"><Checkbox id="tos" checked={form.tosAccepted} onCheckedChange={v => set('tosAccepted', v === true)} className="mt-1" /><Label htmlFor="tos" className="text-sm font-normal leading-6">I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Terms of Service<span className="sr-only"> (opens in a new tab)</span></a>.</Label></div>
              </div>
              {errorMessage && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive">{errorMessage}</p>}
              <Button type="submit" disabled={!canSubmit} className="min-h-[52px] w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">{registerMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : 'Create account'}</Button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground lg:text-left">Already have an account? <button type="button" onClick={onBackToLogin} className="min-h-11 rounded-md font-semibold text-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Sign in</button></p>
        </section>
        <aside className="hidden max-w-md space-y-6 lg:block">
          <h2 className="text-2xl font-semibold tracking-tight">Start with a clear goal.</h2>
          <p className="text-sm leading-6 text-muted-foreground">Bring your context, plan the work, and review the results in one workspace.</p>
          <div className="space-y-6 rounded-2xl border border-foreground/15 bg-foreground/[0.04] p-6">
            {[
              ['Durable missions', 'Plan, run, pause, and resume operational work.'],
              ['Approvals and evidence', 'Review proposed actions and inspect execution history.'],
              ['Knowledge and internal apps', 'Ground work in your sources and build interfaces for recurring workflows.'],
            ].map(([title, detail]) => <div key={title}><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p></div>)}
          </div>
          <a href="/getting-started" className="inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4">Read the getting-started guide</a>
        </aside>
        <footer className="flex flex-wrap justify-center gap-2 border-t border-border pt-6 lg:col-span-2">
          {[['About Oddjob', '/overview'], ['Support', '/contact'], ['Privacy', '/privacy'], ['Terms', '/terms']].map(([title, href]) => <a key={href} href={href} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{title}</a>)}
        </footer>
      </div>
    </main>
  );
}
