import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Label } from "@domain-ui/core/ui/components/ui/label";

interface SimilaritySliderProps {
    value: number;
    onChange: (value: number) => void;
}

export function SimilaritySlider({ value, onChange }: SimilaritySliderProps) {
    const getLabel = (val: number) => {
        if (val >= 0.9) return "Very Strict";
        if (val >= 0.7) return "Moderate";
        if (val >= 0.5) return "Loose";
        return "Very Loose";
    };

    const getDescription = (val: number) => {
        if (val >= 0.9) return "Only highly similar results";
        if (val >= 0.7) return "Balanced quality and quantity";
        if (val >= 0.5) return "More results, lower precision";
        return "Maximum results, minimal filtering";
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <Label htmlFor="similarity-slider" className="text-sm font-medium">
                    Similarity Threshold
                </Label>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary">
                        {(value * 100).toFixed(0)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {getLabel(value)}
                    </span>
                </div>
            </div>

            <Slider
                id="similarity-slider"
                value={[value]}
                onValueChange={([v]) => onChange(v)}
                min={0.3}
                max={1.0}
                step={0.05}
                className="w-full"
            />

            <div className="flex justify-between text-xs text-muted-foreground">
                <span>More Results</span>
                <span>Higher Quality</span>
            </div>

            <p className="text-xs text-muted-foreground italic">
                {getDescription(value)}
            </p>
        </div>
    );
}
