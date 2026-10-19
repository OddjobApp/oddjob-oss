import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import {
  Presentation,
  FileText,
  Plus,
  Trash2,
  Users,
  Check,
  Palette,
  Layout,
  ExternalLink,
  Sparkles,
  Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type DeckFormat = "slide_deck" | "pdf" | "word" | "excel" | "diagram";
export type SlideLayoutArchetype = "title_hero" | "problem_statement" | "metrics_kpi_grid" | "architecture_diagram" | "comparative_table" | "cta_conclusion";

export interface DeckSectionItem {
  id: string;
  title: string;
  layout: SlideLayoutArchetype;
}

export const FORMATS: Array<{ id: DeckFormat; label: string; hint: string }> = [
  { id: "slide_deck", label: "Slide Deck", hint: "Themed presentation AST" },
  { id: "pdf", label: "PDF", hint: "Print-ready document" },
  { id: "word", label: "Word (.docx)", hint: "Editable document" },
  { id: "excel", label: "Excel (.xlsx)", hint: "Metrics workbook" },
  { id: "diagram", label: "Diagram", hint: "Mermaid architecture" },
];

export const AUDIENCES = [
  { id: "executive", label: "Executive / Board" },
  { id: "technical", label: "Technical / Engineering" },
  { id: "customer", label: "Customer / External" },
  { id: "internal", label: "Internal Team" },
];

export const PRESENTATION_THEMES = [
  { id: "cyber_dark", name: "Oddjob Cyber Dark", accent: "#a855f7" },
  { id: "corporate_light", name: "Corporate Light Minimal", accent: "#2563eb" },
  { id: "obsidian_gold", name: "Executive Obsidian Gold", accent: "#eab308" },
  { id: "emerald_tech", name: "BioTech Emerald", accent: "#10b981" }
];

export const LAYOUT_ARCHETYPES: { id: SlideLayoutArchetype; label: string }[] = [
  { id: "title_hero", label: "Hero Title & Subtitle" },
  { id: "problem_statement", label: "Problem vs Solution" },
  { id: "metrics_kpi_grid", label: "Metrics & KPI Grid" },
  { id: "architecture_diagram", label: "System Architecture DAG" },
  { id: "comparative_table", label: "Comparative Feature Matrix" },
  { id: "cta_conclusion", label: "Call to Action / Next Steps" }
];

interface DocumentDeckPodProps {
  stageId?: string;
  title?: string;
  defaultDeckTitle?: string;
  defaultMissionTitle?: string;
  defaultDeliverables?: string[];
  defaultFormats?: DeckFormat[];
  defaultAudience?: string;
  defaultTheme?: string;
  onStageComplete?: (payload: {
    stageId: string;
    deckTitle: string;
    formats: DeckFormat[];
    audience: string;
    sections: string[];
    sectionItems?: DeckSectionItem[];
    theme?: string;
    openInScribeStudio?: boolean;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

export default function DocumentDeckPod({
  stageId = "stage-presentation-deck",
  title = "Deck & Document Studio",
  defaultDeckTitle,
  defaultMissionTitle,
  defaultDeliverables,
  defaultFormats = ["slide_deck"],
  defaultAudience = "executive",
  defaultTheme = "cyber_dark",
  onStageComplete,
  className,
}: DocumentDeckPodProps) {
  const [deckTitle, setDeckTitle] = useState(
    defaultDeckTitle || defaultMissionTitle || "Executive Briefing",
  );
  const [formats, setFormats] = useState<DeckFormat[]>(defaultFormats);
  const [audience, setAudience] = useState(defaultAudience);
  const [theme, setTheme] = useState(defaultTheme);
  const [openInScribeStudio, setOpenInScribeStudio] = useState(false);

  // Maintain structured section items while preserving sections: string[]
  const [sectionItems, setSectionItems] = useState<DeckSectionItem[]>(() => {
    const raw = (defaultDeliverables ?? []).slice(0, 6);
    return raw.map((title, idx) => ({
      id: `sec-${idx + 1}`,
      title,
      layout: (idx === 0 ? "title_hero" : idx === raw.length - 1 ? "cta_conclusion" : "metrics_kpi_grid") as SlideLayoutArchetype
    }));
  });

  const [newSection, setNewSection] = useState("");
  const [newSectionLayout, setNewSectionLayout] = useState<SlideLayoutArchetype>("problem_statement");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-deck-title" && payload?.title) {
      setDeckTitle(payload.title);
    } else if (action === "toggle-format" && payload?.format) {
      toggleFormat(payload.format);
    } else if (action === "set-audience" && payload?.audience) {
      setAudience(payload.audience);
    } else if (action === "set-theme" && payload?.theme) {
      setTheme(payload.theme);
    } else if (action === "add-section" && payload?.title) {
      const newItem: DeckSectionItem = {
        id: `sec-${sectionItems.length + 1}`,
        title: payload.title,
        layout: payload.layout || "problem_statement"
      };
      setSectionItems(prev => [...prev, newItem]);
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  const toggleFormat = (id: DeckFormat) => {
    setFormats((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((f) => f !== id) : prev) : [...prev, id],
    );
  };

  const addSection = () => {
    const trimmed = newSection.trim();
    if (!trimmed) return;
    const newItem: DeckSectionItem = {
      id: `sec-${sectionItems.length + 1}`,
      title: trimmed,
      layout: newSectionLayout
    };
    setSectionItems((prev) => [...prev, newItem]);
    setNewSection("");
  };

  const removeSection = (id: string) => {
    setSectionItems((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSectionLayout = (id: string, layout: SlideLayoutArchetype) => {
    setSectionItems((prev) => prev.map((s) => s.id === id ? { ...s, layout } : s));
  };

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const stringSections = sectionItems.map(s => s.title);

    const payload = {
      stageId,
      deckTitle,
      formats,
      audience,
      sections: stringSections,
      sectionItems,
      theme,
      openInScribeStudio,
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) onStageComplete(payload);

    emitWorkbenchSaved(
      stageId,
      `Deck "${deckTitle}" — ${formats.join(", ")} for ${audience} (${sectionItems.length} slides, ${theme} theme)`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card
      className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)}
      data-testid="document-deck-pod"
    >
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-fuchsia-500/10 text-fuchsia-500">
              <Presentation className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Configure presentation deliverables, slide layout archetypes, design themes, and Scribe export
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase bg-fuchsia-500/5 text-fuchsia-600 border-fuchsia-500/20"
          >
            {formats.length} format{formats.length === 1 ? "" : "s"} / {sectionItems.length} slides
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-fuchsia-500" />
            Title
          </label>
          <Input
            value={deckTitle}
            onChange={(e) => setDeckTitle(e.target.value)}
            className="h-8 text-xs"
            data-testid="deck-title-input"
          />
        </div>

        {/* Output Formats */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-foreground">Output formats</label>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => {
              const active = formats.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleFormat(f.id)}
                  title={f.hint}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600"
                      : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {active && <Check className="w-3 h-3" />}
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Audience & Design Theme Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-fuchsia-500" />
              Audience
            </label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {AUDIENCES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-fuchsia-500" />
              Visual Theme
            </label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {PRESENTATION_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Sections & Slide Layout Archetypes */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
            <Layout className="w-3.5 h-3.5 text-fuchsia-500" />
            Deck Slides & Layout Archetypes
          </label>
          {sectionItems.length > 0 && (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {sectionItems.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-muted-foreground w-4 text-center">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                      {s.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={s.layout}
                      onChange={(e) => updateSectionLayout(s.id, e.target.value as SlideLayoutArchetype)}
                      className="h-6 rounded border border-border bg-background px-1.5 text-[10px] font-mono text-muted-foreground"
                    >
                      {LAYOUT_ARCHETYPES.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeSection(s.id)}
                      className="shrink-0 text-muted-foreground/60 hover:text-red-500 p-0.5"
                      aria-label={`Remove section ${s.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5 pt-1">
            <Input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSection();
                }
              }}
              placeholder="Add slide section title…"
              className="h-8 text-xs"
            />
            <select
              value={newSectionLayout}
              onChange={(e) => setNewSectionLayout(e.target.value as SlideLayoutArchetype)}
              className="h-8 rounded border border-border bg-background px-2 text-xs font-mono"
            >
              {LAYOUT_ARCHETYPES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={addSection} className="h-8 px-2 shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Scribe Studio Hand-off */}
        <div
          onClick={() => setOpenInScribeStudio(!openInScribeStudio)}
          className={cn(
            "rounded-lg border p-2.5 flex items-center justify-between cursor-pointer transition-colors text-xs",
            openInScribeStudio
              ? "border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300"
              : "border-border/50 bg-muted/20 text-muted-foreground"
          )}
        >
          <div className="flex items-center gap-2">
            <ExternalLink className="w-3.5 h-3.5 text-fuchsia-500" />
            <span className="font-medium text-[11px]">Open directly in Scribe Studio for interactive WYSIWYG editing</span>
          </div>
          <div className={cn(
            "h-4 w-4 rounded-full border grid place-items-center",
            openInScribeStudio ? "border-fuchsia-500 bg-fuchsia-500 text-white" : "border-muted-foreground/40"
          )}>
            {openInScribeStudio && <Check className="h-2.5 w-2.5" />}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            The room generates each format and returns it as a deliverable
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isSubmitting || !deckTitle.trim()}
            className="h-8 px-4 text-xs bg-fuchsia-600 text-white hover:bg-fuchsia-500"
            data-testid="document-deck-confirm"
          >
            {isSubmitting ? "Sending…" : "Generate Deliverables"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
