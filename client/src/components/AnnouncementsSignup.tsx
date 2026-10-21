import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The same published Form Agent serves every public announcements signup. */
export function AnnouncementsSignup({ className }: { className?: string }) {
  return (
    <section id="announcements" aria-labelledby="announcements-heading" className={cn('scroll-mt-6 rounded-3xl border border-border bg-card p-6 sm:p-10', className)}>
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Follow the build</p>
        <h2 id="announcements-heading" className="mt-3 text-3xl font-bold tracking-tight">Get Oddjob announcements</h2>
        <p className="mt-4 leading-7 text-muted-foreground">Interested in product news and release announcements? Sign up through Oddjob’s published form agent. Your email and consent are stored in the Oddjob organization.</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Read our <a href="/privacy" className="underline underline-offset-4">privacy policy</a>. No account is needed to sign up.</p>
      </div>
      <iframe src="/a/oddjob-announcements?embed=1" title="Sign up for Oddjob announcements" loading="lazy" className="mt-6 h-[640px] w-full rounded-2xl border border-border bg-background" />
      <a href="/a/oddjob-announcements" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Open the sign-up agent separately <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
    </section>
  );
}
