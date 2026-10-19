import React, { useState } from "react";
import {
  DocumentBlockAST,
  DocumentBlock,
  PREBUILT_PRESENTATION_THEMES,
  PresentationDesignSystem,
} from "@shared/schema/document-block.schema.js";
import { presentationMediaService } from "@domain/knowledge/core/presentation-media.service.js";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Download,
  Palette,
  Sparkles,
  Wand2,
  CheckCircle2,
  TrendingUp,
  FileText,
  FileSpreadsheet,
  Printer,
  Link2,
  ShieldCheck,
  Edit3,
  Save,
  BookmarkPlus,
} from "lucide-react";

export interface DocumentPresentationViewerProps {
  ast: DocumentBlockAST;
  onThemeChange?: (themeId: string) => void;
  onASTChange?: (ast: DocumentBlockAST) => void;
}

export const DocumentPresentationViewer: React.FC<DocumentPresentationViewerProps> = ({
  ast: initialAst,
  onThemeChange,
  onASTChange,
}) => {
  const [ast, setAst] = useState<DocumentBlockAST>(initialAst);
  const [activeThemeId, setActiveThemeId] = useState<string>(ast.designSystem?.id || "dark_cyberpunk");
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"deck" | "magazine" | "document">("deck");
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedTitle, setEditedTitle] = useState<string>(ast.title);
  const [templateSavedMsg, setTemplateSavedMsg] = useState<string | null>(null);

  const handleSaveAsTemplate = async () => {
    try {
      const response = await fetch("/api/document-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ast.title || "Custom Presentation Template",
          description: `Generated ${ast.formatCategory || "presentation"} template with ${blocks.length} structured blocks.`,
          type: "presentation_deck",
          source: "direct",
          content: JSON.stringify(ast),
          category: ast.formatCategory || "general",
        }),
      });

      if (!response.ok) throw new Error("Failed to save template");

      setTemplateSavedMsg("Template Saved!");
      setTimeout(() => setTemplateSavedMsg(null), 3000);
    } catch (err: any) {
      console.error("Failed to save template:", err);
    }
  };

  const currentTheme: PresentationDesignSystem =
    PREBUILT_PRESENTATION_THEMES[activeThemeId] || ast.designSystem || PREBUILT_PRESENTATION_THEMES["dark_cyberpunk"];

  const blocks = ast.blocks || [];
  const currentBlock = blocks[currentSlideIndex] || blocks[0];

  const handleNext = () => {
    if (currentSlideIndex < blocks.length - 1) {
      setCurrentSlideIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex((prev) => prev - 1);
    }
  };

  const handleThemeSelect = (themeId: string) => {
    setActiveThemeId(themeId);
    const newTheme = PREBUILT_PRESENTATION_THEMES[themeId];
    if (newTheme) {
      const updatedBlocks = ast.blocks.map(b => {
        const topic = (b as any).headline || (b as any).title || ast.title;
        const themeMedia = presentationMediaService.generateSvgPlaceholder(topic, newTheme);
        if (b.type === "hero_header") return { ...b, imageUrl: themeMedia };
        if (b.type === "slide_frame") return { ...b, imageUrl: themeMedia };
        if (b.type === "magazine_ad") return { ...b, heroImageUrl: themeMedia };
        return b;
      });

      const updatedAst = {
        ...ast,
        designSystem: newTheme,
        blocks: updatedBlocks,
      };
      setAst(updatedAst);
      onASTChange?.(updatedAst);
    }

    if (onThemeChange) {
      onThemeChange(themeId);
    }
  };

  const handleSynthesizeVisuals = async () => {
    setIsSynthesizing(true);
    try {
      const enrichedAst = await presentationMediaService.synthesizeMediaForBlockAST({
        ...ast,
        designSystem: currentTheme,
      });
      setAst(enrichedAst);
      onASTChange?.(enrichedAst);
    } catch (err) {
      console.error("Failed to synthesize media assets", err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleExport = async (format: "docx" | "pptx" | "html" | "markdown" | "pdf") => {
    if (format === "pdf") {
      window.print();
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch("/api/document-templates/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ast, format }),
      });

      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (ast.title || "document").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      // The format key is not always the file extension, and `download` overrides the
      // server's Content-Disposition for blob URLs — markdown was saving as .markdown.
      const extensionByFormat: Record<string, string> = { markdown: "md" };
      a.download = `${safeName}.${extensionByFormat[format] ?? format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Export failed for format ${format}:`, err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveEdit = () => {
    const updatedAst = {
      ...ast,
      title: editedTitle,
    };
    setAst(updatedAst);
    setIsEditing(false);
    onASTChange?.(updatedAst);
  };

  const renderCitationsAndProvenance = (block?: DocumentBlock) => {
    if (!block) return null;
    const hasCitations = block.citations && block.citations.length > 0;
    const hasProvenance = Boolean(block.provenance);

    if (!hasCitations && !hasProvenance) return null;

    return (
      <div className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2" style={{ borderColor: currentTheme.colors.border }}>
        {hasCitations && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 flex items-center gap-1">
              <Link2 className="h-3 w-3" /> Sources:
            </span>
            {block.citations!.map((c, i) => (
              <span
                key={i}
                title={`Type: ${c.entityType} | Confidence: ${Math.round((c.confidenceScore ?? 1) * 100)}%`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border"
                style={{
                  backgroundColor: `${currentTheme.colors.primary}15`,
                  borderColor: `${currentTheme.colors.primary}40`,
                  color: currentTheme.colors.primary,
                }}
              >
                {c.entityName}
              </span>
            ))}
          </div>
        )}

        {hasProvenance && (
          <div className="inline-flex items-center gap-1 text-[11px] font-medium opacity-75">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Provenance: {block.provenance!.source} {block.provenance!.verified ? "(Verified)" : ""}</span>
          </div>
        )}
      </div>
    );
  };

  const handleImageError = (
    e: React.SyntheticEvent<HTMLImageElement, Event>,
    fallbackTopic?: string
  ) => {
    const target = e.currentTarget;
    const fallbackSvg = presentationMediaService.generateSvgPlaceholder(
      fallbackTopic || ast.title || "Executive Deliverable",
      currentTheme
    );
    if (target.src !== fallbackSvg) {
      target.src = fallbackSvg;
    }
  };

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all duration-300 ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none bg-background p-6" : "w-full border-border bg-background/95"
      }`}
      style={{
        backgroundColor: currentTheme.colors.background,
        color: currentTheme.colors.textPrimary,
        borderColor: currentTheme.colors.border,
      }}
    >
      {/* Top Header & Theme Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3" style={{ borderColor: currentTheme.colors.border }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" style={{ color: currentTheme.colors.primary }} />
          </div>
          <div>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="px-2 py-0.5 text-sm font-bold bg-white/10 border rounded focus:outline-none"
                  style={{ borderColor: currentTheme.colors.primary, color: currentTheme.colors.textPrimary }}
                />
                <button
                  onClick={handleSaveEdit}
                  className="p-1 rounded bg-primary text-white hover:opacity-90"
                  title="Save title"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-sm font-bold tracking-tight">{ast.title}</h3>
                <button
                  onClick={() => setIsEditing(true)}
                  className="opacity-50 hover:opacity-100 transition-opacity"
                  title="Edit title"
                >
                  <Edit3 className="h-3 w-3" />
                </button>
              </div>
            )}
            <p className="text-xs" style={{ color: currentTheme.colors.textSecondary }}>
              {ast.subtitle || `${blocks.length} Presentation Blocks • ${currentTheme.name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Controls */}
          <div className="flex rounded-lg border p-1" style={{ borderColor: currentTheme.colors.border }}>
            <button
              onClick={() => setViewMode("deck")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === "deck" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Slide Deck
            </button>
            <button
              onClick={() => setViewMode("magazine")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === "magazine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Continuous Doc
            </button>
          </div>

          {/* AI Synthesize Visuals Toolbar Button */}
          <button
            onClick={handleSynthesizeVisuals}
            disabled={isSynthesizing}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-50"
            style={{ borderColor: currentTheme.colors.primary, color: currentTheme.colors.primary }}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {isSynthesizing ? "Synthesizing..." : "AI Visuals"}
          </button>

          {/* Theme Selector Dropdown */}
          <div className="flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs" style={{ borderColor: currentTheme.colors.border }}>
            <Palette className="h-3.5 w-3.5" style={{ color: currentTheme.colors.primary }} />
            <select
              value={activeThemeId}
              onChange={(e) => handleThemeSelect(e.target.value)}
              className="bg-transparent font-medium focus:outline-none cursor-pointer"
              style={{ color: currentTheme.colors.textPrimary }}
            >
              {Object.values(PREBUILT_PRESENTATION_THEMES).map((t) => (
                <option key={t.id} value={t.id} className="bg-background text-foreground">
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Multi-Format Export Dropdown */}
          <div className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium" style={{ borderColor: currentTheme.colors.border }}>
            <Download className="h-3.5 w-3.5" />
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleExport(e.target.value as any);
                  e.target.value = "";
                }
              }}
              disabled={isExporting}
              className="bg-transparent font-medium focus:outline-none cursor-pointer"
              defaultValue=""
            >
              <option value="" disabled className="bg-background text-foreground">
                {isExporting ? "Exporting..." : "Export As..."}
              </option>
              <option value="pptx" className="bg-background text-foreground">📽️ PowerPoint (.pptx)</option>
              <option value="docx" className="bg-background text-foreground">📝 Word (.docx)</option>
              <option value="html" className="bg-background text-foreground">🌐 Standalone Web Deck (.html)</option>
              <option value="pdf" className="bg-background text-foreground">📄 Print / PDF</option>
              <option value="markdown" className="bg-background text-foreground">📋 Markdown (.md)</option>
            </select>
          </div>

          {/* Save as Template Button */}
          <button
            onClick={handleSaveAsTemplate}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-white/10 transition-colors"
            style={{ borderColor: currentTheme.colors.border }}
            title="Save AST as Reusable Organization Template"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            {templateSavedMsg || "Save Template"}
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flex items-center gap-1 rounded-lg border p-1 text-xs font-medium hover:bg-white/5 transition-colors"
            style={{ borderColor: currentTheme.colors.border }}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Presentation Content Display */}
      {viewMode === "deck" ? (
        <div className="relative flex min-h-[440px] flex-col justify-between p-10">
          {/* Active Slide Block Rendering */}
          <div className="mx-auto w-full max-w-5xl space-y-6">
            {currentBlock?.type === "hero_header" && (
              <div className="grid gap-8 md:grid-cols-2 items-center text-left">
                <div className="space-y-4">
                  <span
                    className="inline-block rounded-full px-3 py-1 text-xs font-bold tracking-widest uppercase"
                    style={{ backgroundColor: `${currentTheme.colors.primary}20`, color: currentTheme.colors.primary, border: `1px solid ${currentTheme.colors.border}` }}
                  >
                    {currentBlock.badgeText || "OFFICIAL DELIVERABLE"}
                  </span>
                  <h1
                    className="font-heading text-4xl font-extrabold tracking-tight md:text-5xl"
                    style={{
                      background: currentTheme.colors.gradient,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {currentBlock.headline}
                  </h1>
                  {currentBlock.subheadline && (
                    <p className="text-base leading-relaxed" style={{ color: currentTheme.colors.textSecondary }}>
                      {currentBlock.subheadline}
                    </p>
                  )}
                  {currentBlock.ctaText && (
                    <button
                      className="mt-2 px-5 py-2.5 rounded-lg font-bold text-xs text-white" // theme-lint-ignore -- presentation slide primary CTA button
                      style={{ backgroundColor: currentTheme.colors.primary }}
                    >
                      {currentBlock.ctaText} &rarr;
                    </button>
                  )}
                </div>

                {currentBlock.imageUrl && (
                  <div className="overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: currentTheme.colors.border }}>
                    <img
                      src={currentBlock.imageUrl}
                      alt={currentBlock.headline}
                      className="w-full h-auto object-cover"
                      onError={(e) => handleImageError(e, currentBlock.headline || currentBlock.title)}
                    />
                  </div>
                )}
              </div>
            )}

            {currentBlock?.type === "slide_frame" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-heading text-3xl font-extrabold" style={{ color: currentTheme.colors.textPrimary }}>
                    {currentBlock.headline}
                  </h2>
                  <span className="text-xs font-mono font-bold" style={{ color: currentTheme.colors.textSecondary }}>
                    SLIDE {currentBlock.slideNumber} / {blocks.length}
                  </span>
                </div>

                <div className="grid gap-8 md:grid-cols-2 items-start">
                  <div className="space-y-4">
                    {currentBlock.bodyMarkdown && (
                      <p className="text-sm leading-relaxed" style={{ color: currentTheme.colors.textSecondary }}>
                        {currentBlock.bodyMarkdown}
                      </p>
                    )}
                    {currentBlock.bulletPoints && currentBlock.bulletPoints.length > 0 && (
                      <div className="grid gap-3">
                        {currentBlock.bulletPoints.map((bp, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-3 rounded-lg border p-3.5 backdrop-blur-md"
                            style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}
                          >
                            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: currentTheme.colors.secondary }} />
                            <span className="text-xs font-medium">{bp}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {currentBlock.imageUrl && (
                    <div className="overflow-hidden rounded-xl border shadow-xl" style={{ borderColor: currentTheme.colors.border }}>
                      <img
                        src={currentBlock.imageUrl}
                        alt={currentBlock.headline}
                        className="w-full h-auto object-cover"
                        onError={(e) => handleImageError(e, currentBlock.headline || currentBlock.title)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {currentBlock?.type === "comparison_matrix" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold" style={{ color: currentTheme.colors.textPrimary }}>
                  {currentBlock.title || "Competitive Landscape"}
                </h2>
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: currentTheme.colors.border }}>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b" style={{ backgroundColor: `${currentTheme.colors.primary}30`, borderColor: currentTheme.colors.border }}>
                        <th className="p-3 font-bold">Dimension</th>
                        <th className="p-3 font-bold">{currentBlock.competitorName || "Standard"}</th>
                        <th className="p-3 font-bold" style={{ color: currentTheme.colors.secondary }}>{currentBlock.ourName || "Oddjob Engine"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: currentTheme.colors.border }}>
                      {currentBlock.rows.map((r, idx) => (
                        <tr key={idx} className={r.isOurAdvantage ? "bg-white/5" : ""}>
                          <td className="p-3 font-medium">{r.feature}</td>
                          <td className="p-3 opacity-75">{r.competitorValue}</td>
                          <td className="p-3 font-semibold" style={{ color: r.isOurAdvantage ? currentTheme.colors.secondary : undefined }}>
                            {r.ourValue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {currentBlock?.type === "timeline" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold">{currentBlock.title || "Execution Phases"}</h2>
                <div className="grid gap-4 md:grid-cols-4">
                  {currentBlock.events.map((ev, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border p-4 space-y-2"
                      style={{
                        backgroundColor: currentTheme.colors.surface,
                        borderColor: ev.status === "completed" ? currentTheme.colors.secondary : currentTheme.colors.border,
                      }}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: currentTheme.colors.accent }}>
                        {ev.dateOrPhase}
                      </span>
                      <h4 className="font-heading text-sm font-bold">{ev.title}</h4>
                      <p className="text-xs opacity-75">{ev.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentBlock?.type === "chart" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold">{currentBlock.title || "Analytics & Metrics"}</h2>
                {currentBlock.description && (
                  <p className="text-xs opacity-75 italic">{currentBlock.description}</p>
                )}
                <div className="rounded-xl border p-6 space-y-3" style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}>
                  {currentBlock.labels.map((lbl, idx) => {
                    const val = currentBlock.datasets[0]?.data[idx] ?? 0;
                    // Floor at 1 (as the server-side twin does): an all-zero dataset made
                    // maxVal 0, so val/maxVal was NaN and every bar got width: NaN%.
                    const maxVal = Math.max(...(currentBlock.datasets[0]?.data || [100]), 1);
                    const pct = Math.max(8, Math.min(100, (val / maxVal) * 100));
                    return (
                      <div key={idx} className="grid grid-cols-[120px_1fr_80px] items-center gap-4 text-xs">
                        <span className="font-semibold">{lbl}</span>
                        <div className="h-4 rounded bg-white/10 overflow-hidden">
                          <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: currentTheme.colors.primary }} />
                        </div>
                        <span className="font-mono text-right">{val} {currentBlock.unit || ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {currentBlock?.type === "diagram" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold">{currentBlock.title || "Architecture Flow"}</h2>
                <div className="rounded-xl border p-6 font-mono text-xs overflow-x-auto text-left" style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}>
                  <pre className="text-emerald-400">{currentBlock.code}</pre>
                </div>
                {currentBlock.caption && (
                  <p className="text-xs opacity-75 italic">{currentBlock.caption}</p>
                )}
              </div>
            )}

            {currentBlock?.type === "magazine_ad" && (
              <div className="grid gap-8 md:grid-cols-2 items-center">
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: currentTheme.colors.accent }}>
                    {currentBlock.accentTag || "EDITORIAL SPOTLIGHT"}
                  </span>
                  <h2 className="font-heading text-3xl font-black" style={{ color: currentTheme.colors.textPrimary }}>
                    {currentBlock.headline}
                  </h2>
                  <p className="text-sm leading-relaxed" style={{ color: currentTheme.colors.textSecondary }}>
                    {currentBlock.bodyText}
                  </p>
                </div>

                {currentBlock.heroImageUrl ? (
                  <div className="overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: currentTheme.colors.border }}>
                    <img
                      src={currentBlock.heroImageUrl}
                      alt={currentBlock.headline}
                      className="w-full h-auto object-cover"
                      onError={(e) => handleImageError(e, currentBlock.headline || currentBlock.title)}
                    />
                  </div>
                ) : currentBlock.quote ? (
                  <blockquote
                    className="rounded-xl border p-6 font-serif italic text-base"
                    style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border, borderLeft: `4px solid ${currentTheme.colors.primary}` }}
                  >
                    "{currentBlock.quote}"
                  </blockquote>
                ) : null}
              </div>
            )}

            {currentBlock?.type === "feature_grid" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold">{currentBlock.title || "Key Features"}</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  {currentBlock.cards.map((card, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border p-5 transition-transform hover:-translate-y-1"
                      style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}
                    >
                      {card.highlightTag && (
                        <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: currentTheme.colors.secondary }}>
                          {card.highlightTag}
                        </span>
                      )}
                      <h3 className="font-heading text-base font-bold mb-2">{card.title}</h3>
                      <p className="text-xs leading-relaxed" style={{ color: currentTheme.colors.textSecondary }}>
                        {card.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentBlock?.type === "stat_callout" && (
              <div className="space-y-6">
                <h2 className="font-heading text-3xl font-extrabold">{currentBlock.title || "Performance Metrics"}</h2>
                <div className="grid gap-6 md:grid-cols-3">
                  {currentBlock.stats.map((s, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border p-6 text-center"
                      style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}
                    >
                      <div className="font-heading text-5xl font-black mb-2" style={{ color: currentTheme.colors.primary }}>
                        {s.value}
                      </div>
                      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: currentTheme.colors.textSecondary }}>
                        {s.label}
                      </div>
                      {s.delta && (
                        <div className="mt-2 text-xs font-bold text-emerald-400 flex items-center justify-center gap-1">
                          <TrendingUp className="h-3.5 w-3.5" />
                          {s.delta}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Block Citations & Provenance Footer */}
            {renderCitationsAndProvenance(currentBlock)}
          </div>

          {/* Bottom Deck Navigation Bar */}
          <div className="mt-10 flex items-center justify-between border-t pt-4" style={{ borderColor: currentTheme.colors.border }}>
            <div className="text-xs font-semibold" style={{ color: currentTheme.colors.textSecondary }}>
              Block {currentSlideIndex + 1} of {blocks.length}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={currentSlideIndex === 0}
                className="flex h-9 w-9 items-center justify-center rounded-lg border transition-opacity disabled:opacity-30"
                style={{ borderColor: currentTheme.colors.border }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={handleNext}
                disabled={currentSlideIndex === blocks.length - 1}
                className="flex h-9 w-9 items-center justify-center rounded-lg border transition-opacity disabled:opacity-30"
                style={{ borderColor: currentTheme.colors.border }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Continuous Document View Mode */
        <div className="p-8 space-y-8 max-w-4xl mx-auto">
          {blocks.map((b, idx) => (
            <div key={idx} className="rounded-xl border p-8 space-y-4 text-left" style={{ backgroundColor: currentTheme.colors.surface, borderColor: currentTheme.colors.border }}>
              <div className="text-xs font-bold uppercase tracking-widest" style={{ color: currentTheme.colors.primary }}>
                BLOCK {idx + 1} &bull; {b.type}
              </div>
              <h3 className="font-heading text-2xl font-bold">{(b as any).headline || (b as any).title || "Document Section"}</h3>
              <p className="text-sm leading-relaxed" style={{ color: currentTheme.colors.textSecondary }}>
                {(b as any).bodyMarkdown || (b as any).bodyText || (b as any).subheadline || "Assembled block section."}
              </p>
              {(b as any).imageUrl || (b as any).heroImageUrl ? (
                <div className="overflow-hidden rounded-xl border shadow-lg mt-4" style={{ borderColor: currentTheme.colors.border }}>
                  <img
                    src={(b as any).imageUrl || (b as any).heroImageUrl}
                    alt="Block visual"
                    className="w-full h-auto object-cover"
                    onError={(e) => handleImageError(e, (b as any).headline || (b as any).title)}
                  />
                </div>
              ) : null}
              {renderCitationsAndProvenance(b)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
