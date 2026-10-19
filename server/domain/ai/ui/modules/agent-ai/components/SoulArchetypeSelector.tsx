import React from "react";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Ghost, Shield, Zap, Target } from "lucide-react";
import { OceanTraits } from "@shared/schema/agent-deployments";

export const ARCHETYPES = [
  {
    id: "Lead Directive",
    name: "Lead Directive",
    description: "Authoritative command tone, action-oriented, disciplined.",
    icon: Target,
    traits: { o: 60, c: 90, e: 70, a: 50, n: 20 },
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    id: "Ghost Analyst",
    name: "Ghost Analyst",
    description: "Clinical, detached, highly analytical. Detached from dialogue.",
    icon: Ghost,
    traits: { o: 90, c: 70, e: 20, a: 40, n: 30 },
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    id: "The Quartermaster",
    name: "The Quartermaster",
    description: "Focus on efficiency, logistics, and technical reliability.",
    icon: Shield,
    traits: { o: 50, c: 95, e: 40, a: 80, n: 10 },
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
];

interface SoulArchetypeSelectorProps {
  selectedId?: string;
  onSelect: (id: string, traits: OceanTraits) => void;
}

export function SoulArchetypeSelector({ selectedId, onSelect }: SoulArchetypeSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {ARCHETYPES.map((archetype) => {
        const Icon = archetype.icon;
        const isSelected = selectedId === archetype.id;

        return (
          <Card
            key={archetype.id}
            className={`cursor-pointer transition-all hover:scale-[1.02] border-2 ${
              isSelected ? "border-primary bg-primary/5" : "border-transparent"
            }`}
            onClick={() => onSelect(archetype.id, archetype.traits as any)}
          >
            <CardContent className="p-4 flex flex-col items-center text-center space-y-2">
              <div className={`p-3 rounded-full ${archetype.bg}`}>
                <Icon className={`w-6 h-6 ${archetype.color}`} />
              </div>
              <h3 className="font-bold text-sm tracking-tight">{archetype.name}</h3>
              <p className="text-xs text-muted-foreground leading-tight">
                {archetype.description}
              </p>
              {isSelected && (
                <Badge variant="secondary" className="mt-1 text-[10px] h-4">
                  Active Profile
                </Badge>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
