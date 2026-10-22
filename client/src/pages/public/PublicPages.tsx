import { CapabilityShowcase } from "@/components/CapabilityShowcase";
import { ProductScreenshots } from '@/components/ProductScreenshots';
import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import ReactMarkdown from 'react-markdown';
import { ArrowRight } from 'lucide-react';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import privacy from '../../assets/docs/privacy-policy.md?raw';
import terms from '../../assets/docs/terms-of-service.md?raw';

const link = 'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const panel = 'rounded-2xl border border-border bg-card p-6 sm:p-8';
const capabilities = [
  {
    "group": "Collaborate and decide",
    "title": "CREW rooms",
    "detail": "Bring people and specialist agents into one shared workspace.",
    "example": "Review a launch plan together, capture decisions, and work with forms or app surfaces beside the conversation.",
    "requires": "Organization membership, permitted agent tools, and an organization-owned AI provider key.",
    "doc": "docs/FEATURES.md#crew-multi-agent-rooms"
  },
  {
    "group": "Collaborate and decide",
    "title": "Durable missions",
    "detail": "Carry a goal through planning, execution, pauses, and review.",
    "example": "Prepare an operations review, pause for missing information, then resume with the recorded context.",
    "requires": "A scoped mission, configured agents and tools, and any required approvals.",
    "doc": "docs/feature-documentation/core-features/05-missions-system.md"
  },
  {
    "group": "Collaborate and decide",
    "title": "Approvals and execution evidence",
    "detail": "Keep proposed actions and recorded outcomes available for inspection.",
    "example": "Review an external action before authorizing it, then inspect the tool results and execution history.",
    "requires": "Approval policies and execution recording; available evidence depends on the action and runtime.",
    "doc": "docs/specs/agent-governance.md"
  },
  {
    "group": "Automate recurring work",
    "title": "Pipelines",
    "detail": "Connect jobs into reusable sequences with data passed between steps.",
    "example": "Collect records, transform them into a summary, and route the output through a review step.",
    "requires": "Configured job types, credentials, workers, and permissions for each step.",
    "doc": "docs/feature-documentation/core-features/02-pipelines-system.md"
  },
  {
    "group": "Automate recurring work",
    "title": "Schedules",
    "detail": "Run configured pipelines on a recurring timetable.",
    "example": "Prepare a weekly report in the organization’s timezone and inspect the resulting run history.",
    "requires": "An enabled schedule, a runnable pipeline, and a healthy scheduling worker.",
    "doc": "docs/feature-documentation/core-features/04-scheduling-system.md"
  },
  {
    "group": "Automate recurring work",
    "title": "Business cycles",
    "detail": "Coordinate recurring work across phases, dependencies, and app handoffs.",
    "example": "Stage a product launch cycle with research, a readiness review, and a workbench completion gate.",
    "requires": "A staged cycle with its required inputs, integrations, budget, and activation approval.",
    "doc": "docs/feature-documentation/cycle-blueprint-builder.md"
  },
  {
    "group": "Build interfaces and collect inputs",
    "title": "App Forge",
    "detail": "Create and evolve dedicated interfaces for repeatable workflows.",
    "example": "Start from a blueprint for field dispatch, research, or software delivery, then review the generated app.",
    "requires": "Blueprint maturity varies. Generated code needs review and an approved execution environment; local generated-app builds are blocked in production.",
    "doc": "docs/guides/blueprint-maturity.md"
  },
  {
    "group": "Build interfaces and collect inputs",
    "title": "Published agents and forms",
    "detail": "Offer a focused public experience with structured inputs.",
    "example": "Collect announcement sign-ups or intake details through a published form; disable free-text chat for a guided flow.",
    "requires": "A configured and published agent, form fields, consent, and an appropriate submission destination.",
    "doc": "docs/developer-guides/PRODUCT_SCREENSHOTS.md"
  },
  {
    "group": "Ground work in context",
    "title": "Organizational knowledge",
    "detail": "Reuse documents, retrieved context, and mission memory.",
    "example": "Prepare a brief from team documents and inspect the sources behind the response.",
    "requires": "Accessible documents, successful extraction and indexing, and an organization provider key where AI or embeddings are required.",
    "doc": "docs/feature-documentation/core-features/03-knowledge-system.md"
  },
  {
    "group": "Ground work in context",
    "title": "Structured datasets",
    "detail": "Give recurring work a consistent set of records and fields.",
    "example": "Track intake requests in a dataset and use its structured records as workflow inputs.",
    "requires": "A defined dataset schema, authorized records, and configured tools for the intended queries or changes.",
    "doc": "docs/platform/05-component-and-tooling-guides/knowledge-garden-and-dataset-schemas.md"
  },
  {
    "group": "Ground work in context",
    "title": "Spatial intelligence",
    "detail": "Use geographic boundaries and location conditions in operational rules.",
    "example": "Check whether a request is within service coverage and outside a restricted zone before review.",
    "requires": "Location-bearing inputs and configured geographic rules. The public interactive example uses fictional boundaries.",
    "doc": "docs/FEATURES.md#eulerian-hexagonal-uber-h3-spatial-command-deck"
  },
  {
    "group": "Connect tools and channels",
    "title": "Connected services and MCP",
    "detail": "Bring authorized external tools into the workspace.",
    "example": "Use connected mail, documents, or business systems as inputs to a task, with the permissions granted to that connection.",
    "requires": "Provider-specific setup, credentials or OAuth consent, enabled APIs, and the intended organization or project scope.",
    "doc": "docs/developer-guides/ORG_OAUTH_APPS.md"
  },
  {
    "group": "Connect tools and channels",
    "title": "Organization email with AgentMail",
    "detail": "Connect a dedicated inbox for organizational and room communication.",
    "example": "Keep room notifications and their replies associated with the right organization and project.",
    "requires": "Each organization connects its own inbox and API key; webhook permissions and outbound approval rules still apply.",
    "doc": "docs/developer-guides/ORG_AGENTMAIL.md"
  },
  {
    "group": "Connect tools and channels",
    "title": "Computer use and human takeover",
    "detail": "Work through a browser interface when a direct integration is insufficient.",
    "example": "Let an agent carry out a supervised browser task, take over when needed, and review a captured procedure for reuse.",
    "requires": "An administrator-enabled computer-use runtime, an organization desktop, a provider key, and authorized access to the target service.",
    "doc": "server/knowledge/features/computer-use.md"
  },
  {
    "group": "Create and review media",
    "title": "Scribe and Media Studio",
    "detail": "Move from scripted scenes to generated takes, review, and assembly.",
    "example": "Develop a scene, compare candidate takes, and review selected material before assembling a reel.",
    "requires": "Configured media providers or ComfyUI, required models and credentials, generation budget, and review gates. Provider capabilities vary.",
    "doc": "docs/FEATURES.md#governed-ai-film-production--comfyui-media-studio"
  }
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
  const groups = Array.from(new Set(capabilities.map(item => item.group)));
  return <Shell title="From operational goals to reviewable results." intro="Explore documented Oddjob capabilities through practical workflows. Each example lists the setup it needs; availability depends on your deployment, connections, permissions, and provider configuration.">
    <nav aria-label="Capability categories" className="flex flex-wrap gap-2">{groups.map((group, i) => <a key={group} className={`${link} border border-border`} href={`#capability-group-${i}`}>{group}</a>)}</nav>
    {groups.map((group, i) => <section key={group} id={`capability-group-${i}`} aria-labelledby={`capability-heading-${i}`} className="scroll-mt-6 space-y-5">
      <h2 id={`capability-heading-${i}`} className="text-2xl font-semibold">{group}</h2>
      <div className="grid items-start gap-5 md:grid-cols-2">{capabilities.filter(item => item.group === group).map(({ title, detail, example, requires, doc }) => <article className={panel} key={title}>
        <h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-muted-foreground">{detail}</p>
        <p className="mt-4 leading-7"><strong>Try it:</strong> {example}</p>
        <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">What you need:</strong> {requires}</p>
        <a href={`https://github.com/OddjobApp/oddjob-oss/blob/main/${doc}`} target="_blank" rel="noopener noreferrer" className={`${link} mt-3 underline underline-offset-4`} aria-label={`Read ${title} documentation`}>Read the documentation <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></a>
        {title === 'Spatial intelligence' && <a href="/overview#spatial-rules-demo" className={`${link} mt-2 underline underline-offset-4`}>Try the geographic rules demo</a>}
        {title === 'Published agents and forms' && <a href="/a/oddjob-announcements" className={`${link} mt-2 underline underline-offset-4`}>Try the announcements form</a>}
      </article>)}</div>
    </section>)}
    <aside className={panel}><h2 className="text-xl font-semibold">Choose a workflow your workspace is ready to run.</h2><p className="mt-3 leading-7 text-muted-foreground">These examples describe capabilities, not a claim that every integration or runtime is active here. AI features use organization-owned provider keys. Blueprint labels describe template maturity; review prerequisites before operational use. Roadmaps, proposals, and historical reports are not treated as shipped features.</p><a href="https://github.com/OddjobApp/oddjob-oss/blob/main/docs/README.md" target="_blank" rel="noopener noreferrer" className={`${link} mt-3 underline underline-offset-4`}>Browse the documentation index</a></aside>
    <Actions />
  </Shell>;
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
