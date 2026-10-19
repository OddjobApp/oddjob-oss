import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Search, Sparkles, GitMerge } from "lucide-react";

type SearchMode = "semantic" | "keyword" | "hybrid";

interface SearchModeToggleProps {
    value: SearchMode;
    onChange: (mode: SearchMode) => void;
}

export function SearchModeToggle({ value, onChange }: SearchModeToggleProps) {
    const modes: Array<{ value: SearchMode; label: string; icon: React.ReactNode; description: string }> = [
        {
            value: "keyword",
            label: "Keyword",
            icon: <Search className="h-4 w-4" />,
            description: "Traditional text matching"
        },
        {
            value: "semantic",
            label: "Semantic",
            icon: <Sparkles className="h-4 w-4" />,
            description: "AI-powered meaning search"
        },
        {
            value: "hybrid",
            label: "Hybrid",
            icon: <GitMerge className="h-4 w-4" />,
            description: "Best of both worlds"
        }
    ];

    return (
        <div className="space-y-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <span className="text-sm font-medium">Search Mode:</span>
                <Badge variant="outline" className="w-fit text-xs">
                    {modes.find(m => m.value === value)?.description}
                </Badge>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {modes.map((mode) => (
                    <Button
                        key={mode.value}
                        variant={value === mode.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => onChange(mode.value)}
                        className="justify-center"
                    >
                        {mode.icon}
                        <span className="ml-2">{mode.label}</span>
                    </Button>
                ))}
            </div>
        </div>
    );
}
