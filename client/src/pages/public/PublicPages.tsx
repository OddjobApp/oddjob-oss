import { CapabilityShowcase } from "@/components/CapabilityShowcase";
import { ProductScreenshots } from '@/components/ProductScreenshots';
import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import ReactMarkdown from 'react-markdown';
import { ArrowRight, BookOpen, Layers, Route, ShieldCheck, MapPin } from 'lucide-react';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import privacy from '../../assets/docs/privacy-policy.md?raw';
import terms from '../../assets/docs/terms-of-service.md?raw';

const link = 'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const panel = 'rounded-2xl border border-border bg-card p-6 sm:p-8';
const capabilities = [
  { title: 'Durable missions', icon: Route, detail: 'Turn an operational goal into work that can pause, resume, delegate, and report progress.', example: 'Coordinate a recurring operations review, then inspect the results and execution history.' },
  { title: 'App Forge', icon: Layers, detail: 'Generate, validate, and evolve internal apps for recurring workflows.', example: 'Turn a repeatable intake process into an operational app with a dedicated interface.' },
  { title: 'Organizational knowledge', icon: BookOpen, detail: 'Ground work in reusable documents, mission memory, and connected knowledge.', example: 'Prepare a research brief using your team’s sources and review the supporting evidence.' },
  { title: 'Approvals and replay', icon: ShieldCheck, detail: 'Inspect actions, review approval requests, and follow execution evidence.', example: 'Review a proposed external action before approving it, then inspect the recorded outcome.' },
  { title: 'Spatial intelligence', icon: MapPin, detail: 'Use location-bearing signals and geofences to add spatial context to operational work.', example: 'Investigate a location-based signal while distinguishing known positions from uncertain ones.' },
];

function Actions() {
  return <div className="mt-8 flex flex-wrap gap-3"><a className={`${link} bg-primary px-5 text-primary-foreground hover:bg-primary/90`} href="/auth/signup">Create an account <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></a><a className={`${link} border border-border px-5`} href="/getting-started">Read the getting-started guide</a></div>;
}

export function Shell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => { document.title = `${title} | Oddjob`; window.scrollTo(0, 0); }, [title]);
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#public-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4">Skip to content</a>
    <header className="border-b border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <a href="/" className={`${link} gap-2 text-xl font-bold`} aria-label="Oddjob home"><HatIcon className="h-8 w-8" />Oddjob</a>
      <nav aria-label="Public navigation" className="flex flex-wrap gap-1">{[['Overview', '/overview'], ['Use cases', '/use-cases'], ['Get started', '/getting-started'], ['Support', '/contact'], ['Sign in', '/auth/login']].map(([label, href]) => <a key={href} href={href} className={`${link} ${location === href ? 'bg-muted' : ''}`} aria-current={location === href ? 'page' : undefined}>{label}</a>)}</nav>
    </div></header>
    <main id="public-main" className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Oddjob / Governed agentic operations</p>
      <h1 className="max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{intro}</p>
      <div className="mt-10 space-y-8">{children}</div>
    </main>
    <footer className="border-t border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8"><p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Oddjob</p><nav aria-label="Footer" className="flex flex-wrap">{[['Trust center', '/trust'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['Support', '/contact']].map(([label, href]) => <a key={href} className={link} href={href}>{label}</a>)}</nav></div></footer>
  </div>;
}

export function Overview() {
  return <Shell title="Give autonomous work a place to run." intro="Plan, execute, approve, and replay operational work across agents, tools, knowledge, and internal apps.">
    <Actions />
    <ProductScreenshots />
    <CapabilityShowcase />
    <section className={panel}><h2 className="text-2xl font-semibold">Start with a goal. Stay involved at the decisions.</h2><p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Bring the context, define the expected outcome, and review the proposed work. Follow progress, respond to approval requests, and inspect the result before using it.</p><a href="/use-cases" className={`${link} mt-4`}>Explore example workflows <ArrowRight className="ml-2 h-4 w-4" /></a></section>
    <p className="text-sm leading-6 text-muted-foreground">Available tools, integrations, and actions depend on your deployment, organization permissions, and configured connections. Visit the <a className="underline underline-offset-4" href="/trust">Trust Center</a> for reported system status and evidence.</p>
  </Shell>;
}

export function UseCases() {
  return <Shell title="From operational goals to reviewable results." intro="Use these examples to shape your first workflow. Choose the sources, connections, and approval boundaries that fit your organization."><div className="space-y-5">{capabilities.map(({ title, detail, example }, i) => <article className={panel} key={title}><p className="text-sm text-muted-foreground">0{i + 1} / Example workflow</p><h2 className="mt-3 text-2xl font-semibold">{title}</h2><p className="mt-3 leading-7">{example}</p><p className="mt-3 leading-7 text-muted-foreground">{detail}</p></article>)}</div><Actions /></Shell>;
}

export function GettingStarted() {
  const steps = [
    ['Join your workspace', 'Create an account or sign in. If you need access to an existing organization, ask its administrator to confirm your membership and role.'],
    ['Choose a small, clear goal', 'Start from the Launchpad. Describe the result you want, the scope of the work, and how you will judge success. A short research brief is a useful first task.'],
    ['Bring the right context', 'Add relevant organizational knowledge and use connections your workspace has configured. Only include sources you are authorized to use.'],
    ['Review the plan and approval boundaries', 'Check the proposed actions and available tools. Respond to approval requests when they arise and inspect any external changes before authorizing them.'],
    ['Follow progress and inspect the result', 'Open the mission to review progress, outputs, and execution evidence. Resolve blocked work and verify the result before relying on it.'],
    ['Make repeatable work reusable', 'When a workflow is useful repeatedly, explore App Forge for a dedicated internal app and retain relevant knowledge for future missions.'],
  ];
  return <Shell title="Your first mission starts with a clear outcome." intro="Get into your workspace, provide context, and keep the first run small enough to inspect."><ol className="space-y-5">{steps.map(([title, body], i) => <li key={title} className={panel}><p className="text-sm font-semibold text-muted-foreground">Step {i + 1}</p><h2 className="mt-2 text-xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-muted-foreground">{body}</p></li>)}</ol><a href="/auth/login?returnTo=%2Flaunchpad" className={`${link} bg-primary px-5 text-primary-foreground hover:bg-primary/90`}>Open your workspace <ArrowRight className="ml-2 h-4 w-4" /></a></Shell>;
}

export function Support() {
  return <Shell title="Find your next step." intro="Help with access, missions, connections, and the information to collect when something goes wrong."><div className="grid gap-5 md:grid-cols-2">
    <section className={panel}><h2 className="text-xl font-semibold">Cannot sign in?</h2><p className="mt-3 leading-7 text-muted-foreground">Reset a forgotten password. For organization membership or permissions, contact your workspace administrator.</p><a className={`${link} mt-4 underline`} href="/auth/forgot-password">Reset password</a></section>
    <section className={panel}><h2 className="text-xl font-semibold">A mission or connection is blocked</h2><p className="mt-3 leading-7 text-muted-foreground">Check the mission’s latest status and pending approvals. Ask your workspace administrator to verify connection access and available tools.</p><a className={`${link} mt-4 underline`} href="/trust">Check system status</a></section>
    <section className={panel}><h2 className="text-xl font-semibold">Prepare a useful issue report</h2><p className="mt-3 leading-7 text-muted-foreground">Share the page, time, mission or app identifier, expected result, and visible error with your workspace administrator. Include steps to reproduce; remove passwords, API keys, and private document contents.</p></section>
    <section className={panel}><h2 className="text-xl font-semibold">Privacy questions</h2><p className="mt-3 leading-7 text-muted-foreground">The Privacy Policy lists the contact for questions about personal information.</p><a className={`${link} mt-4 underline`} href="/privacy">Read the Privacy Policy</a></section>
    </div><a className={`${link} underline`} href="/getting-started">New to Oddjob? Start here</a></Shell>;
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  return <Shell title={isPrivacy ? 'Privacy Policy' : 'Terms of Service'} intro={isPrivacy ? 'Read the existing policy and understand the workspace features relevant to your information.' : 'Read the existing service terms and guidance for using Oddjob’s operational capabilities.'}>
    <aside className={panel}><h2 className="text-xl font-semibold">{isPrivacy ? 'Your workspace context' : 'Using agentic capabilities'}</h2><p className="mt-3 leading-7 text-muted-foreground">{isPrivacy ? 'Oddjob workflows can involve mission instructions, documents and organizational knowledge, connected services, generated apps, and execution history. Ask your workspace administrator which sources and connections are enabled for your organization.' : 'Review mission plans and outputs, use sources and connections you are authorized to access, and inspect proposed actions before approving them. Generated apps and agent outputs should be reviewed before operational use.'}</p><p className="mt-3 text-sm text-muted-foreground">This product guidance supplements the policy text below; it does not replace it.</p></aside>
    <article className={`${panel} max-w-4xl space-y-5`}><ReactMarkdown components={{ h1: () => null, h2: ({ children }) => <h2 className="pt-5 text-xl font-semibold">{children}</h2>, p: ({ children }) => <p className="leading-7 text-muted-foreground">{children}</p>, ul: ({ children }) => <ul className="list-disc space-y-2 pl-6 leading-7 text-muted-foreground">{children}</ul> }}>{isPrivacy ? privacy : terms}</ReactMarkdown></article>
  </Shell>;
}

export function PublicNotFound() {
  return <Shell title="This page could not be found." intro="The link may be outdated or the address may have been mistyped."><p data-public-not-found className="text-sm font-semibold text-muted-foreground">404 / Page not found</p><div className="flex flex-wrap gap-3"><a href="/overview" className={`${link} bg-primary px-5 text-primary-foreground hover:bg-primary/90`}>Explore Oddjob</a><a href="/auth/login" className={`${link} border border-border`}>Sign in</a><a href="/contact" className={link}>Get help</a></div></Shell>;
}
