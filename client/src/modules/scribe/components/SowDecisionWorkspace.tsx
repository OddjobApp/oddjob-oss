import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Circle, GitBranch, HelpCircle, ListTree, MessageCircleQuestion, Pencil, Save, ShieldAlert, Sparkles, X } from "lucide-react";
import { ScribeAnnotation, ScribeNode } from "@shared/schema/scribe";
import { cn } from "@/lib/utils";

const SECTIONS = ["Purpose", "Scope of Services", "Deliverables", "Responsibilities", "Service Levels", "Fees & Payment", "Change Control", "Security", "Term & Termination", "Open Decisions"];
const MODES = ["Questions", "Structure", "Continuity", "Branches"] as const;
type Mode = (typeof MODES)[number];

interface Props {
  title: string; nodes: ScribeNode[]; activeNode: ScribeNode; annotations: ScribeAnnotation[];
  onSelectNode: (stationKey: string) => void; onSaveContent: (nodeId: number, content: string) => void;
}

function label(node: ScribeNode | undefined, index: number) {
  if (!node) return SECTIONS[index];
  const value = node.title.replace(/^\s*\d+[.)]?\s*/, "").trim();
  if (/overview|objective|purpose/i.test(value)) return "Purpose";
  if (/main body|scope/i.test(value)) return "Scope of Services";
  if (/summary|conclusion/i.test(value)) return "Deliverables";
  return value;
}

const GUIDE: Record<Mode, { title: string; body: string; action: string; icon: React.ElementType }> = {
  Questions: { title: "Clarify the boundaries", body: "Which services should be explicitly excluded so both parties share the same definition of scope?", action: "Answer in a note", icon: MessageCircleQuestion },
  Structure: { title: "Make this section scannable", body: "Consider separating included services, exclusions, and assumptions under distinct subheadings.", action: "Plan the structure", icon: ListTree },
  Continuity: { title: "Check a cross-reference", body: "This section mentions service levels, but the draft does not clearly connect them to reporting or remedies.", action: "Show related section", icon: ShieldAlert },
  Branches: { title: "Explore without replacing", body: "Test an alternative in a private branch. The manuscript stays unchanged unless you decide to merge it.", action: "Start a branch note", icon: GitBranch },
};

export const SowDecisionWorkspace: React.FC<Props> = ({ title, nodes, activeNode, annotations, onSelectNode, onSaveContent }) => {
  const [draft, setDraft] = useState(activeNode.content || "");
  const [mode, setMode] = useState<Mode>("Questions");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  useEffect(() => { setDraft(activeNode.content || ""); setSaved(true); }, [activeNode.id, activeNode.content]);

  const corpus = nodes.map((node) => node.content || "").join(" ");
  const customer = corpus.match(/\b(Acme Cloud(?:, Inc\.)?)/i)?.[1];
  const displayTitle = /manuscript|agreement/i.test(title) && customer ? `Statement of Work · ${customer.replace(/, Inc\.$/i, "")}` : title;
  const activeIndex = Math.max(0, nodes.findIndex((node) => node.id === activeNode.id));
  const ready = nodes.filter((node) => (node.content || "").trim()).length;
  const openAnnotations = annotations.filter((item) => item.status === "open");
  const words = useMemo(() => draft.trim() ? draft.trim().split(/\s+/).length : 0, [draft]);
  const guide = GUIDE[mode]; const GuideIcon = guide.icon;

  const act = () => {
    if (mode === "Continuity") {
      const related = nodes.find((node) => /service level|report/i.test(`${node.title} ${node.content}`));
      if (related) onSelectNode(related.stationKey);
      return;
    }
    setWorkspaceOpen(true);
  };

  return <div className="flex min-h-0 flex-1 overflow-hidden bg-[#06101f] text-foreground" data-testid="sow-decision-workspace">
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-[#081321]">
      <div className="flex h-16 items-center justify-between border-b border-border px-5 font-mono text-[11px] font-bold uppercase tracking-wider"><span>SOW outline</span><ChevronDown className="h-4 w-4 text-muted-foreground" /></div>
      <nav aria-label="Statement of Work sections" className="flex-1 overflow-y-auto px-2 py-3">{SECTIONS.map((name, index) => {
        const node = nodes[index]; const active = node?.id === activeNode.id; const complete = Boolean(node && (node.content || "").trim());
        return <button key={name} type="button" disabled={!node} onClick={() => node && onSelectNode(node.stationKey)} className={cn("mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm", active ? "border-emerald-400 bg-emerald-500/10 text-white" : "border-transparent text-foreground/70 hover:bg-muted/50", !node && "cursor-default opacity-45")}>
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", active || complete ? "border-emerald-400 text-emerald-400" : "border-slate-500 text-muted-foreground")}>{complete ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2 fill-current" />}</span><span className="w-4 font-mono text-xs text-muted-foreground">{index + 1}</span><span className="truncate font-medium">{label(node, index)}</span>
        </button>;
      })}</nav>
      <div className="border-t border-border p-4"><p className="text-xs text-foreground/70">{ready} of {SECTIONS.length} sections drafted</p><p className="mt-1 text-xs text-muted-foreground">You control every word.</p></div>
    </aside>

    <section className="flex min-w-0 flex-1 flex-col bg-[#071426]">
      <header className="flex min-h-20 items-center justify-between border-b border-border px-8"><div className="min-w-0"><h2 className="truncate font-mono text-lg font-semibold">{displayTitle}</h2><p className="mt-1 text-sm text-muted-foreground">Drafting: {label(activeNode, activeIndex)} <Pencil className="ml-1 inline h-3.5 w-3.5" /></p></div><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{words} words</span><button type="button" disabled={saved} onClick={() => { onSaveContent(activeNode.id, draft); setSaved(true); }} className="flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:bg-muted disabled:text-muted-foreground"><Save className="h-4 w-4" />{saved ? "Saved" : "Save draft"}</button><button type="button" onClick={() => setAssistantOpen((value) => !value)} className="rounded-md border border-violet-500/50 px-3 py-2 text-sm text-violet-300"><Sparkles className="mr-2 inline h-4 w-4" />Assistant</button></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8"><div className="mx-auto max-w-4xl"><label htmlFor="scribe-manuscript" className="sr-only">Edit manuscript</label><textarea id="scribe-manuscript" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className="min-h-[620px] w-full resize-none rounded-xl border border-border bg-[#09182a] px-10 py-9 font-serif text-[18px] leading-8 text-foreground shadow-2xl outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30" placeholder="Write this section in your own words…" /><p className="mt-3 text-center text-xs text-muted-foreground">Scribe watches for structure and continuity. It never changes your manuscript without your action.</p></div></div>
    </section>

    {assistantOpen && <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-[#081321]" aria-label="Writing assistant">
      <div className="flex items-center justify-between border-b border-border p-4"><div><p className="font-mono text-xs font-bold uppercase tracking-wider">Writing assistant</p><p className="mt-1 text-xs text-muted-foreground">Guidance, never silent edits</p></div><button type="button" onClick={() => setAssistantOpen(false)} aria-label="Close writing assistant" className="p-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
      <div className="grid grid-cols-2 gap-1 border-b border-border p-3">{MODES.map((item) => <button key={item} type="button" onClick={() => { setMode(item); setWorkspaceOpen(false); }} className={cn("rounded px-2 py-2 text-xs", mode === item ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:bg-muted")}>{item}</button>)}</div>
      <div className="flex-1 overflow-y-auto p-4"><article className="rounded-xl border border-border bg-card/40 p-4"><GuideIcon className="h-5 w-5 text-violet-300" /><p className="mt-4 text-sm font-semibold">{guide.title}</p><p className="mt-2 text-sm leading-6 text-foreground/70">{guide.body}</p><button type="button" onClick={act} className="mt-4 w-full rounded-md border border-emerald-500/60 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10">{guide.action}</button></article>
        {workspaceOpen && <div className="mt-4 rounded-xl border border-violet-500/40 bg-violet-500/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Private workspace</p><textarea aria-label="Assistant note" className="mt-3 min-h-28 w-full rounded-md border border-border bg-background/50 p-3 text-sm outline-none focus:border-violet-400" placeholder={mode === "Branches" ? "Name the alternative you want to explore…" : "Capture your answer or planning note…"} /><p className="mt-2 text-xs text-muted-foreground">Separate from the manuscript.</p></div>}
        {openAnnotations.slice(0, 2).map((annotation) => <article key={annotation.id} className="mt-4 rounded-xl border border-amber-500/30 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Issue to review</p><p className="mt-2 text-sm font-semibold">{annotation.title}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{annotation.critiqueBody}</p></article>)}
        <div className="mt-5 flex gap-2 rounded-lg border border-border p-3 text-xs leading-5 text-muted-foreground"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><p>Suggestions remain outside the draft until you choose what belongs.</p></div>
      </div>
    </aside>}
  </div>;
};

export default SowDecisionWorkspace;
