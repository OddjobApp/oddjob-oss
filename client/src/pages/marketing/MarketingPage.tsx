import { CapabilityShowcase } from "@/components/CapabilityShowcase";
import { ProductScreenshots } from '@/components/ProductScreenshots';
import { AnnouncementsSignup } from '@/components/AnnouncementsSignup';
import { useEffect } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { HatIcon } from "@domain-ui/core/ui/components/shared/HatIcon";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";


/** Public homepage shared by the marketing, login and core SPA entries. */
export default function MarketingPage() {
  useEffect(() => { document.title = "Oddjob — Give your next big idea a crew"; }, []);
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:bg-background focus:p-4">Skip to content</a>
    <header className="border-b border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <a href="/" className="flex min-h-11 items-center gap-2 text-xl font-bold" aria-label="Oddjob home"><HatIcon className="h-8 w-8" />Oddjob</a>
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-5 text-sm font-medium"><a className="hover:underline" href="/use-cases">Use cases</a><a className="hover:underline" href="/getting-started">Get started</a><a className="hover:underline" href="#announcements">Announcements</a><a className={button} href="/auth/login">Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" /></a></nav>
    </div></header>
    <main id="main" className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="grid gap-12 py-16 sm:py-24 lg:grid-cols-2 lg:items-center"><div>
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Open source. Built for work together.</p>
        <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">Give your next big idea a crew.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">Oddjob is a workspace for people and AI agents to turn goals into missions, work with shared knowledge, and build useful apps—with people involved at the decisions.</p>
        <div className="mt-8 flex flex-wrap gap-3"><a href="/auth/signup" className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>Start your first mission <ArrowRight className="h-4 w-4" aria-hidden="true" /></a><a href="/docs" className={button}><BookOpen className="h-4 w-4" aria-hidden="true" />Explore the documentation</a></div>
      </div><aside className="rounded-3xl border border-border bg-card p-7 sm:p-10" aria-label="An example Oddjob workflow">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">One idea → a reviewable result</p><h2 className="mt-5 text-2xl font-semibold">“Help us prepare our next product launch.”</h2>
        <ol className="mt-8 space-y-6">{[
          ["Bring the context", "Add the brief, relevant documents, and configured connections."],
          ["Give the crew a mission", "Set the goal and scope. Follow progress and respond to approval requests."],
          ["Review what happened", "Inspect the output and execution evidence before putting it to use."],
        ].map(([title, text], i) => <li key={title} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{i + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}</ol><p className="mt-7 text-xs text-muted-foreground">Illustrative workflow. Available actions depend on your configuration.</p>
      </aside></section>
    <ProductScreenshots />
      <CapabilityShowcase />
      <section className="grid gap-6 py-10 md:grid-cols-2"><h2 className="max-w-md text-3xl font-bold tracking-tight">Your workspace.<br />Your context. Your decisions.</h2><div className="space-y-4 leading-7 text-muted-foreground"><p>Connect the tools your organization uses, bring your own AI provider credentials, and decide who can access the work.</p><p>Follow mission history and approval requests as work moves forward. Inspect the output and execution evidence before relying on the result.</p><p>Oddjob is open source under Apache 2.0. Explore the code, contribute, or run your own deployment.</p><a href="/overview" className="inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline underline-offset-4">Explore Oddjob <ArrowRight className="h-4 w-4" aria-hidden="true" /></a></div></section>
      <AnnouncementsSignup className="my-14" />
    </main>
    <footer className="border-t border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-8 text-sm text-muted-foreground sm:px-8"><p>Oddjob · Built in the open.</p><nav aria-label="Footer navigation" className="flex flex-wrap gap-5"><a href="/trust">Trust Center</a><a href="/contact">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/docs">Documentation</a></nav></div></footer>
  </div>;
}
