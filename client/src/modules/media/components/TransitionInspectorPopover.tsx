import React, { useState } from "react";
import { Check, Clock, Sparkles, SlidersHorizontal, ArrowRightLeft } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ShotTransition } from "../types";

export interface TransitionInspectorPopoverProps {
  shotNumber: number;
  currentTransition: ShotTransition;
  currentDurationSeconds?: number;
  maxAllowedDuration?: number;
  onApply: (transition: ShotTransition, durationSeconds: number) => void;
  onApplyToAll?: (transition: ShotTransition, durationSeconds: number) => void;
  children: React.ReactNode;
}

interface TransitionPreset {
  id: ShotTransition;
  label: string;
  glyph: string;
  defaultDuration: number;
  description: string;
}

const PRESETS: TransitionPreset[] = [
  { id: "cut", label: "Hard Cut", glyph: "∣", defaultDuration: 0, description: "Instant cut with zero frame overlap" },
  { id: "crossfade", label: "Crossfade", glyph: "✕", defaultDuration: 0.75, description: "Smooth blend dissolving from outgoing to incoming shot" },
  { id: "dip_to_black", label: "Dip to Black", glyph: "◼", defaultDuration: 1.0, description: "Fades out to black and ramps up into the new shot" },
];

const DURATION_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];

export function TransitionInspectorPopover({
  shotNumber,
  currentTransition,
  currentDurationSeconds,
  maxAllowedDuration = 3.0,
  onApply,
  onApplyToAll,
  children,
}: TransitionInspectorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ShotTransition>(currentTransition);
  const [duration, setDuration] = useState<number>(() => {
    if (currentTransition === "cut") return 0;
    return currentDurationSeconds ?? (currentTransition === "dip_to_black" ? 1.0 : 0.75);
  });

  const activePreset = PRESETS.find((p) => p.id === selectedType) ?? PRESETS[0];
  const safeMax = Math.max(0.2, Number(maxAllowedDuration.toFixed(2)));

  const handleSelectType = (type: ShotTransition) => {
    setSelectedType(type);
    if (type === "cut") {
      setDuration(0);
    } else if (duration === 0) {
      const preset = PRESETS.find((p) => p.id === type);
      setDuration(Math.min(preset?.defaultDuration ?? 0.75, safeMax));
    }
  };

  const handleSave = () => {
    const finalDuration = selectedType === "cut" ? 0 : Math.min(Math.max(0.1, duration), safeMax);
    onApply(selectedType, finalDuration);
    setOpen(false);
  };

  const handleSaveAll = () => {
    const finalDuration = selectedType === "cut" ? 0 : Math.min(Math.max(0.1, duration), safeMax);
    onApplyToAll?.(selectedType, finalDuration);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 rounded-xl border border-border/80 bg-popover p-3.5 shadow-xl"
        align="center"
        sideOffset={6}
        data-testid={`transition-popover-${shotNumber}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-xs font-semibold text-foreground">
                Cut after Shot {shotNumber}
              </h4>
            </div>
            <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
              {activePreset.glyph} {selectedType}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((preset) => {
              const isSelected = selectedType === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectType(preset.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center transition-all",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                  data-testid={`transition-preset-${preset.id}`}
                >
                  <span className="font-mono text-base font-bold leading-none">{preset.glyph}</span>
                  <span className="text-[10px] font-medium leading-tight">{preset.label}</span>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {activePreset.description}
          </p>

          {selectedType !== "cut" && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/20 p-2.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={`transition-duration-${shotNumber}`}
                  className="flex items-center gap-1 text-[11px] font-medium text-foreground"
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  Duration
                </label>
                <div className="flex items-center gap-1 font-mono text-xs font-semibold text-primary">
                  <span>{duration.toFixed(2)}s</span>
                  {safeMax < 3.0 && (
                    <span className="text-[9px] text-muted-foreground">
                      (max {safeMax}s)
                    </span>
                  )}
                </div>
              </div>

              <input
                id={`transition-duration-${shotNumber}`}
                type="range"
                min={0.1}
                max={safeMax}
                step={0.05}
                value={Math.min(duration, safeMax)}
                onChange={(e) => setDuration(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-primary"
                data-testid="transition-duration-slider"
              />

              <div className="flex flex-wrap gap-1 pt-1">
                {DURATION_PRESETS.filter((p) => p <= safeMax).map((presetDuration) => (
                  <button
                    key={presetDuration}
                    type="button"
                    onClick={() => setDuration(presetDuration)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors",
                      Math.abs(duration - presetDuration) < 0.01
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {presetDuration}s
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-1.5 pt-1">
            {onApplyToAll && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={handleSaveAll}
                title="Apply this transition to every cut in this scene"
                data-testid="apply-to-all-transitions-btn"
              >
                Apply to Scene
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleSave}
                data-testid="apply-transition-btn"
              >
                <Check className="h-3 w-3" />
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
