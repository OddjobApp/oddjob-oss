import { useMemo, useState } from "react";
import { Bot, Check, ChevronRight, Code2, MessageSquare, Sparkles, Workflow } from "lucide-react";
import { SmartLink } from "@domain-ui/core/ui/components/shared/SmartLink";
import { Button } from "@domain-ui/core/ui/components/ui/button";
const paths = [
  { id: "automate", title: "Automate an operational process", description: "Model a repeatable process as a governed Cycle.", icon: Workflow, href: "/cycles/new", cta: "Build a Cycle", steps: ["Choose a Cycle blueprint", "Connect required credentials", "Run readiness checks", "Launch the first governed run"] },
  { id: "agent", title: "Deploy a governed agent", description: "Create an agent with tools, budget, and approval boundaries.", icon: Bot, href: "/agents/new", cta: "Create an agent", steps: ["Define the outcome", "Select tools and knowledge", "Set governance limits", "Test before publishing"] },
  { id: "app", title: "Build an internal app", description: "Generate and deploy a focused workbench through App Forge.", icon: Code2, href: "/apps/forge", cta: "Open App Forge", steps: ["Describe the user outcome", "Review the generated blueprint", "Validate integrations", "Deploy the workbench"] },
  { id: "connect", title: "Connect Slack or Teams", description: "Bring governed automation into an existing communication channel.", icon: MessageSquare, href: "/connections/integrations", cta: "Check integrations", steps: ["Add platform credentials", "Verify webhook security", "Test delivery", "Enable for a workflow"] },
];
function loadCompleted(): string[] { try { return JSON.parse(localStorage.getItem("oddjob:onboarding:completed") || "[]"); } catch { return []; } }
export default function OutcomeOnboarding() {
  const [selected, setSelected] = useState(() => localStorage.getItem("oddjob:onboarding:path") || "automate");
  const [completed, setCompleted] = useState<string[]>(loadCompleted);
  const path = useMemo(() => paths.find((item) => item.id === selected) || paths[0], [selected]);
  const selectPath = (id: string) => { setSelected(id); localStorage.setItem("oddjob:onboarding:path", id); };
  const toggle = (step: string) => { const key = `${path.id}:${step}`; const next = completed.includes(key) ? completed.filter((item) => item !== key) : [...completed, key]; setCompleted(next); localStorage.setItem("oddjob:onboarding:completed", JSON.stringify(next)); };
  const progress = path.steps.filter((step) => completed.includes(`${path.id}:${step}`)).length;
  return <div className="mx-auto max-w-6xl space-y-8">
    <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-7"><div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Sparkles className="h-3.5 w-3.5" />Outcome quickstart</div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">What do you want Oddjob to accomplish?</h1><p className="mt-2 max-w-2xl text-muted-foreground">Choose a result. We’ll guide you through the shortest production-ready path using the builders and controls already in the platform.</p></header>
    <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <section className="grid gap-3 sm:grid-cols-2">{paths.map((item) => { const Icon = item.icon; const active = item.id === path.id; return <button key={item.id} onClick={() => selectPath(item.id)} className={`rounded-xl border p-5 text-left transition ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40"}`}><Icon className={`h-6 w-6 ${active ? "text-primary" : "text-muted-foreground"}`} /><h2 className="mt-4 font-semibold text-foreground">{item.title}</h2><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></button>; })}</section>
      <aside className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your readiness path</p><h2 className="mt-1 text-lg font-semibold text-foreground">{path.title}</h2></div><span className="text-sm text-muted-foreground">{progress}/{path.steps.length}</span></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(progress / path.steps.length) * 100}%` }} /></div>
        <ol className="mt-6 space-y-3">{path.steps.map((step, index) => { const done = completed.includes(`${path.id}:${step}`); return <li key={step}><button onClick={() => toggle(step)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>{done ? <Check className="h-4 w-4" /> : index + 1}</span><span className={done ? "text-sm text-muted-foreground line-through" : "text-sm text-foreground"}>{step}</span></button></li>; })}</ol>
        <Button asChild className="mt-6 w-full"><SmartLink href={path.href}>{path.cta}<ChevronRight className="ml-2 h-4 w-4" /></SmartLink></Button><p className="mt-3 text-center text-xs text-muted-foreground">Progress is saved in this browser.</p>
      </aside>
    </div>
  </div>;
}
