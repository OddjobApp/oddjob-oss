import React, { useMemo } from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Sparkles, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@domain-ui/core/ui/components/ui/tooltip";
import { OceanTraits } from "@shared/schema/agent-deployments";

interface SoulConfigPanelProps {
  traits: OceanTraits;
  onChange: (traits: OceanTraits) => void;
  archetype?: string;
}

export function SoulConfigPanel({ traits, onChange, archetype }: SoulConfigPanelProps) {
  const handleTraitChange = (key: keyof OceanTraits, value: number[]) => {
    onChange({
      ...traits,
      [key]: value[0],
    });
  };

  const traitDefinitions = [
    { key: "o", label: "Openness", desc: "Curiosity and unconventional thinking." },
    { key: "c", label: "Conscientiousness", desc: "Methodical planning and organization." },
    { key: "e", label: "Extraversion", desc: "Sociability and engagement levels." },
    { key: "a", label: "Agreeableness", desc: "Cooperation and tone of voice." },
    { key: "n", label: "Neuroticism", desc: "Caution and threat awareness." },
  ];

  // Logic to simulate the prompt preview (client-side version of SoulService.generateSoulPrompt)
  const promptPreview = useMemo(() => {
    let p = `### ODDJOB PROTOCOL: SOUL LAYER [ARCHETYPE: ${archetype || "Custom"}]\n`;
    if (traits.o > 80) p += "- Maintain high intellectual curiosity...\n";
    if (traits.c > 80) p += "- Be extremely methodical...\n";
    if (traits.e < 30) p += "- Remain laconic and professional...\n";
    if (traits.a > 70) p += "- Prioritize operative safety...\n";
    if (traits.n > 60) p += "- Exercise high caution...\n";
    return p + "### END PROTOCOL";
  }, [traits, archetype]);

  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Soul Manifest (OCEAN)
        </CardTitle>
        <CardDescription className="text-xs">
          Fine-tune the agent's psychometric behavioral steering.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 space-y-6">
        <div className="grid grid-cols-1 gap-6">
          {traitDefinitions.map((trait) => (
            <div key={trait.key} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider">
                    {trait.label}
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="max-w-xs text-xs">{trait.desc}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <span className="text-xs font-mono text-primary bg-primary/10 px-1.5 rounded">
                  {traits[trait.key as keyof OceanTraits]}%
                </span>
              </div>
              <Slider
                value={[traits[trait.key as keyof OceanTraits]]}
                max={100}
                step={1}
                onValueChange={(val) => handleTraitChange(trait.key as keyof OceanTraits, val)}
                className="py-1"
              />
            </div>
          ))}
        </div>

        <div className="pt-4 border-t border-dashed">
          <Label className="text-[10px] uppercase text-muted-foreground mb-2 block">
            Steering Prompt Preview
          </Label>
          <div className="bg-muted/50 rounded-md p-3 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap border border-muted">
            {promptPreview}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
