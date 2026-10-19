import React, { useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { BookMarked, Check, Copy, Edit3, Globe, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ProductionView } from "@shared/media-studio";
import type { ProjectStyleBible } from "@shared/style-bible";
import { promoteToProjectStyleBible, updateProjectStyleBible, useProjectStyleBible } from "./api";
import { useStudioToast } from "./feedback";
import { FOCUS_RING } from "./StatusIcon";

export interface ProjectStyleBibleCardProps {
  production: ProductionView;
  className?: string;
}

export function ProjectStyleBibleCard(props: ProjectStyleBibleCardProps) {
  const hasClient = Boolean(React.useContext(QueryClientContext));
  if (!hasClient || !props.production.projectId) {
    return (
      <ProjectStyleBibleCardView
        production={props.production}
        className={props.className}
        bible={props.production.projectStyleBible ?? null}
        isLoading={false}
        onPromote={async () => {}}
        onSaveEdit={async () => {}}
      />
    );
  }
  return <ProjectStyleBibleCardConnected {...props} />;
}

function ProjectStyleBibleCardConnected({ production, className }: ProjectStyleBibleCardProps) {
  const notify = useStudioToast();
  const { data: projectBible, isLoading, refetch } = useProjectStyleBible(production.projectId);
  const bible: ProjectStyleBible | null = projectBible ?? production.projectStyleBible ?? null;

  const handlePromote = async () => {
    if (!production.projectId) return;
    try {
      await promoteToProjectStyleBible(production.id);
      await refetch();
      notify("Promoted Look to Project Space", "All future productions and scenes in this Project Space will inherit this visual Bible.");
    } catch (err: any) {
      notify("Failed to promote look", err?.message ?? "An error occurred");
    }
  };

  const handleSaveEdit = async (updated: Partial<ProjectStyleBible>) => {
    if (!production.projectId) return;
    try {
      await updateProjectStyleBible(production.projectId, {
        look: updated.look ?? "",
        period: updated.period,
        costumeGuidelines: updated.costumeGuidelines,
        negativePrompt: updated.negativePrompt,
        defaultAspectRatio: production.aspectRatio,
        defaultVideoEngine: production.video.engine,
        canonicalCharacters: bible?.canonicalCharacters ?? [],
      });
      await refetch();
      notify("Updated Project Style Bible", "Project Space visual guidelines updated.");
    } catch (err: any) {
      notify("Failed to update Bible", err?.message ?? "An error occurred");
    }
  };

  return (
    <ProjectStyleBibleCardView
      production={production}
      className={className}
      bible={bible}
      isLoading={isLoading}
      onPromote={handlePromote}
      onSaveEdit={handleSaveEdit}
    />
  );
}

interface ProjectStyleBibleCardViewProps {
  production: ProductionView;
  className?: string;
  bible: ProjectStyleBible | null;
  isLoading: boolean;
  onPromote: () => Promise<void>;
  onSaveEdit: (updated: Partial<ProjectStyleBible>) => Promise<void>;
}

function ProjectStyleBibleCardView({
  production,
  className,
  bible,
  isLoading,
  onPromote,
  onSaveEdit,
}: ProjectStyleBibleCardViewProps) {
  const [promoting, setPromoting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLook, setEditLook] = useState(bible?.look ?? production.style ?? "");
  const [editPeriod, setEditPeriod] = useState(bible?.period ?? "");
  const [editCostumes, setEditCostumes] = useState(bible?.costumeGuidelines ?? "");
  const [editNegative, setEditNegative] = useState(bible?.negativePrompt ?? "");
  const [savingEdit, setSavingEdit] = useState(false);

  if (!production.projectId) {
    return (
      <div data-testid="project-style-bible-local" className={cn("rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground", className)}>
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          Room-Local Production
        </div>
        <p className="mt-1">
          This film production is local to this Crew session. Assign this room to a Project Space to enable shared Style Bibles and inherited character continuity.
        </p>
      </div>
    );
  }

  const isAligned = Boolean(bible?.look?.trim() && production.style?.trim() === bible.look.trim());

  return (
    <div data-testid="project-style-bible-card" className={cn("grid gap-2.5 rounded-lg border border-border/80 bg-card p-3", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-primary" aria-hidden />
          <h4 className="text-xs font-semibold text-foreground">Project Space Style Bible</h4>
        </div>
        <div className="flex items-center gap-1.5">
          {isAligned ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px]">
              <Check className="mr-1 h-3 w-3" /> Inherited
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Production Custom Look
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading Project Style Bible...
        </div>
      ) : bible && (bible.look || bible.period || bible.costumeGuidelines) ? (
        <div className="grid gap-2 text-xs">
          {bible.period && (
            <div>
              <span className="font-medium text-muted-foreground">Period: </span>
              <span className="text-foreground">{bible.period}</span>
            </div>
          )}
          {bible.look && (
            <div>
              <span className="font-medium text-muted-foreground">Master Look: </span>
              <span className="text-foreground italic font-serif">"{bible.look}"</span>
            </div>
          )}
          {bible.costumeGuidelines && (
            <div>
              <span className="font-medium text-muted-foreground">Costumes & Wardrobe: </span>
              <span className="text-foreground">{bible.costumeGuidelines}</span>
            </div>
          )}
          {bible.negativePrompt && (
            <div>
              <span className="font-medium text-muted-foreground">Defect Exclusions: </span>
              <span className="font-mono text-[11px] text-muted-foreground">{bible.negativePrompt}</span>
            </div>
          )}
          {bible.canonicalCharacters && bible.canonicalCharacters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground">Anchors:</span>
              {bible.canonicalCharacters.map((c) => (
                <Badge key={c.name} variant="secondary" className="text-[10px]">
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded border border-dashed border-border/70 p-2 text-xs text-muted-foreground">
          No Style Bible has been established for this Project Space yet. You can promote this production's look to serve as the master Bible.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={promoting || !production.style?.trim()}
          onClick={async () => {
            setPromoting(true);
            try {
              await onPromote();
            } finally {
              setPromoting(false);
            }
          }}
          title="Save this production's look and approved characters as the master Project Space Style Bible"
        >
          {promoting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-1.5 h-3.5 w-3.5 text-primary" />}
          Save as Project Style Bible
        </Button>

        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setEditLook(bible?.look ?? production.style ?? "");
                setEditPeriod(bible?.period ?? "");
                setEditCostumes(bible?.costumeGuidelines ?? "");
                setEditNegative(bible?.negativePrompt ?? "");
              }}
            >
              <Edit3 className="mr-1.5 h-3.5 w-3.5" />
              Configure Bible
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Project Space Style Bible</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Define the persistent visual rules, period accuracy, and costume constraints for all productions in this Project Space.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2 text-xs">
              <label className="grid gap-1">
                <span className="font-medium text-foreground">Historical Period / Era</span>
                <Input
                  value={editPeriod}
                  onChange={(e) => setEditPeriod(e.target.value)}
                  placeholder="e.g. 1920s Weimar, Edo Period Japan, 1980s Cold War"
                  className="h-8 text-xs"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-medium text-foreground">Visual Look & Cinematography</span>
                <Textarea
                  value={editLook}
                  onChange={(e) => setEditLook(e.target.value)}
                  rows={2}
                  placeholder="e.g. 35mm anamorphic, chiaroscuro, muted amber and teal, subtle halation"
                  className="text-xs"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-medium text-foreground">Costume & Wardrobe Constraints</span>
                <Textarea
                  value={editCostumes}
                  onChange={(e) => setEditCostumes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Heavy wool coats, tailored waistcoats, starched collars, no synthetic fabrics"
                  className="text-xs"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-medium text-foreground">Defect Exclusions (Negative Prompt)</span>
                <Input
                  value={editNegative}
                  onChange={(e) => setEditNegative(e.target.value)}
                  placeholder="e.g. modern buildings, wristwatches, zippers, asphalt, plastic"
                  className="h-8 text-xs"
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={savingEdit}
                onClick={async () => {
                  setSavingEdit(true);
                  try {
                    await onSaveEdit({
                      look: editLook.trim(),
                      period: editPeriod.trim() || undefined,
                      costumeGuidelines: editCostumes.trim() || undefined,
                      negativePrompt: editNegative.trim() || undefined,
                    });
                    setEditing(false);
                  } finally {
                    setSavingEdit(false);
                  }
                }}
              >
                {savingEdit ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Save Project Bible
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
