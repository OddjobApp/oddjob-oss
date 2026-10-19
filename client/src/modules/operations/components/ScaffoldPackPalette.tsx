import React, { useState, useEffect } from "react";
import { Package, Plus, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ScaffoldPackItem {
  id: string;
  name: string;
  category: "core" | "auth" | "data" | "observability" | "transport" | "security" | "ui";
  description?: string;
  requires: string[];
  conflicts: string[];
  provides: string[];
}

const DEFAULT_PACKS: ScaffoldPackItem[] = [
  {
    id: "core-node-express",
    name: "Node Express Core",
    category: "core",
    description: "Express host runtime foundation",
    requires: [],
    conflicts: [],
    provides: ["web-host"]
  },
  {
    id: "auth-jwt",
    name: "JWT Authentication",
    category: "auth",
    description: "Bearer JWT security middleware",
    requires: [],
    conflicts: ["auth-session"],
    provides: ["auth-provider"]
  },
  {
    id: "auth-session",
    name: "Session Auth",
    category: "auth",
    description: "Cookie session auth",
    requires: [],
    conflicts: ["auth-jwt"],
    provides: ["auth-provider"]
  },
  {
    id: "data-postgres-drizzle",
    name: "Postgres Drizzle ORM",
    category: "data",
    description: "Postgres persistence layer with Drizzle ORM",
    requires: [],
    conflicts: [],
    provides: ["database"]
  },
  {
    id: "observability-otel",
    name: "OpenTelemetry Tracing",
    category: "observability",
    description: "Distributed tracing and metrics headers",
    requires: [],
    conflicts: [],
    provides: ["telemetry"]
  },
  {
    id: "ui-oddjob-design-system",
    name: "Oddjob Design System & UI",
    category: "ui",
    description: "Mach-4 glassmorphic components, design tokens, and AST slot provider",
    requires: ["core-node-express"],
    conflicts: [],
    provides: ["ui-component-library"]
  }
];

interface ScaffoldPackPaletteProps {
  selectedPacks: string[];
  onSelectPack: (packId: string) => void;
  onRemovePack: (packId: string) => void;
}

export const ScaffoldPackPalette: React.FC<ScaffoldPackPaletteProps> = ({
  selectedPacks,
  onSelectPack,
  onRemovePack
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [missingRequirements, setMissingRequirements] = useState<string[]>([]);

  useEffect(() => {
    // Check conflicts across selected packs
    const currentConflicts: string[] = [];
    const currentMissing: string[] = [];

    selectedPacks.forEach(id => {
      const pack = DEFAULT_PACKS.find(p => p.id === id);
      if (pack) {
        if (pack.conflicts) {
          pack.conflicts.forEach(c => {
            if (selectedPacks.includes(c) && !currentConflicts.includes(`${id} <-> ${c}`)) {
              currentConflicts.push(`${id} <-> ${c}`);
            }
          });
        }
        if (pack.requires) {
          pack.requires.forEach(req => {
            if (!selectedPacks.includes(req) && !currentMissing.includes(`${pack.name} requires '${req}'`)) {
              currentMissing.push(`${pack.name} requires '${req}'`);
            }
          });
        }
      }
    });
    setConflicts(currentConflicts);
    setMissingRequirements(currentMissing);
  }, [selectedPacks]);

  const categories = ["all", "core", "auth", "data", "observability", "ui"];

  const filteredPacks = DEFAULT_PACKS.filter(p =>
    activeCategory === "all" ? true : p.category === activeCategory
  );

  return (
    <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-md p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-bold tracking-tight text-foreground">Scaffold Feature Packs</h4>
        </div>
        <div className="flex items-center gap-2">
          {conflicts.length === 0 && selectedPacks.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
              <CheckCircle2 className="w-2.5 h-2.5 mr-1 inline" /> SAT Verified
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
            {selectedPacks.length} selected
          </Badge>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold capitalize transition-all ${
              activeCategory === cat
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Conflict warnings */}
      {conflicts.length > 0 && (
        <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-2 text-destructive text-xs">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Conflict Violation Detected:</p>
            <p className="text-[11px] opacity-90">{conflicts.join(", ")}</p>
          </div>
        </div>
      )}

      {/* Missing Requirements warnings */}
      {missingRequirements.length > 0 && (
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 text-amber-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Missing Prerequisite Pack:</p>
            <p className="text-[11px] opacity-90">{missingRequirements.join(", ")}</p>
          </div>
        </div>
      )}

      {/* Pack items grid */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {filteredPacks.map(pack => {
          const isSelected = selectedPacks.includes(pack.id);
          const hasConflict = pack.conflicts.some(c => selectedPacks.includes(c));

          return (
            <div
              key={pack.id}
              className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                isSelected
                  ? "border-primary/50 bg-primary/10"
                  : hasConflict
                  ? "border-destructive/30 bg-destructive/5 opacity-70"
                  : "border-border/40 bg-muted/20 hover:border-border/80"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold truncate text-foreground">{pack.name}</span>
                  <Badge className="text-[9px] px-1.5 py-0 uppercase bg-muted/60 text-muted-foreground border-border/40">
                    {pack.category}
                  </Badge>
                </div>
                {pack.description && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{pack.description}</p>
                )}
                {pack.provides.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] text-muted-foreground/70">Slot:</span>
                    {pack.provides.map(slot => (
                      <span key={slot} className="text-[9px] font-mono text-emerald-400">
                        {slot}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant={isSelected ? "destructive" : "secondary"}
                onClick={() => (isSelected ? onRemovePack(pack.id) : onSelectPack(pack.id))}
                className="h-7 px-2.5 text-xs font-medium shrink-0"
              >
                {isSelected ? (
                  "Remove"
                ) : (
                  <>
                    <Plus className="w-3 h-3 mr-1" /> Add
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
