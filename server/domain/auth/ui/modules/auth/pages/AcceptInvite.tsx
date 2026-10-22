import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

export default function AcceptInvite() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    tosAccepted: false,
    privacyPolicyAccepted: false,
  });

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const verifyQuery = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/invites/verify?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error('Invite link is invalid or expired');
      return await res.json();
    },
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (!token) {
      toast({ title: 'Invalid link', description: 'Missing invite token.', variant: 'destructive' });
      setLocation('/auth/login');
    }
  }, [token, setLocation, toast]);

  useEffect(() => {
    if (verifyQuery.data?.invite?.email && !form.email) {
      set('email', verifyQuery.data.invite.email);
    }
  }, [verifyQuery.data, form.email]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/invites/accept', {
        token,
        username: form.username,
        email: form.email,
        password: form.password,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        tosAccepted: true,
        privacyPolicyAccepted: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Invite acceptance failed' }));
        throw new Error(err.message || 'Invite acceptance failed');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: 'Welcome', description: 'Your account has been created.' });
      window.location.href = '/launchpad?login=1';
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tosAccepted || !form.privacyPolicyAccepted) return;
    acceptMutation.mutate();
  };

  const canSubmit =
    !!form.username && form.username.length >= 3 &&
    !!form.email &&
    !!form.password && form.password.length >= 8 &&
    form.tosAccepted &&
    form.privacyPolicyAccepted &&
    !acceptMutation.isPending;

  const orgName = verifyQuery.data?.organization?.name || 'your organization';
  const inviteRole = verifyQuery.data?.invite?.role || 'member';
  const isError = verifyQuery.isError || (verifyQuery.data && !verifyQuery.data.valid);

  const labelClass = 'text-sm font-semibold text-foreground';
  const inputClass = 'min-h-[52px] rounded-2xl border-foreground/15 bg-foreground/[0.04] px-4 text-sm text-foreground placeholder:text-muted-foreground focus:ring-primary/40';

  return (
    <main className="min-h-screen bg-background px-4 py-10 font-sans text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <a href="/overview" className="mb-6 flex items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <HatIcon publicBackdrop className="h-12 w-12" />
          <span className="text-4xl font-bold tracking-tight">Oddjob</span>
        </a>

        <div className="rounded-2xl border border-foreground/15 bg-foreground/[0.04] p-5 sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight">Accept invitation</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create your account to join <span className="font-semibold text-foreground">{orgName}</span> as a{' '}
            <span className="font-semibold text-foreground">{inviteRole}</span>.
          </p>

          {verifyQuery.isLoading ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying invite...
            </div>
          ) : isError ? (
            <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive">
              This invite link is invalid, expired, or has already been used.
            </div>
          ) : acceptMutation.isSuccess ? (
            <div className="mt-8 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Account created. Redirecting you to Oddjob...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className={labelClass}>Username</Label>
                <Input
                  id="username"
                  placeholder="Your username"
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  required
                  minLength={3}
                  autoComplete="username"
                  autoFocus
                  className={inputClass}
                />
                <p className="text-sm text-muted-foreground">At least 3 characters.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className={labelClass}>Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                  autoComplete="email"
                  className={inputClass}
                />
                {verifyQuery.data?.invite?.email && (
                  <p className="text-sm text-muted-foreground">This invite was sent to {verifyQuery.data.invite.email}.</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className={labelClass}>First name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="firstName" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="given-name" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className={labelClass}>Last name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="lastName" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="family-name" className={inputClass} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className={labelClass}>Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-sm text-muted-foreground">At least 8 characters.</p>
              </div>

              <div className="space-y-4 border-t border-border pt-5">
                <div className="flex items-start gap-3">
                  <Checkbox id="privacy" checked={form.privacyPolicyAccepted} onCheckedChange={(v) => set('privacyPolicyAccepted', v === true)} className="mt-1" />
                  <Label htmlFor="privacy" className="text-sm font-normal leading-6">
                    I authorize processing according to the{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Privacy Policy</a>.
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="tos" checked={form.tosAccepted} onCheckedChange={(v) => set('tosAccepted', v === true)} className="mt-1" />
                  <Label htmlFor="tos" className="text-sm font-normal leading-6">
                    I agree to the{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Terms of Service</a>.
                  </Label>
                </div>
              </div>

              {acceptMutation.isError && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive">
                  {(acceptMutation.error as Error)?.message || 'Invite acceptance failed. Please try again.'}
                </p>
              )}

              <Button type="submit" disabled={!canSubmit} className="min-h-[52px] w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                {acceptMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : 'Accept invitation'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
