import React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
    value: number;
    onChange: (value: number) => void;
    max?: number;
    disabled?: boolean;
    className?: string;
}

export function StarRating({
    value,
    onChange,
    max = 5,
    disabled = false,
    className,
}: StarRatingProps) {
    const [hoverValue, setHoverValue] = React.useState<number | null>(null);

    return (
        <div className={cn("flex gap-1", className)}>
            {Array.from({ length: max }).map((_, i) => {
                const ratingValue = i + 1;
                const isFilled = (hoverValue !== null ? hoverValue : value) >= ratingValue;

                return (
                    <button
                        key={i}
                        type="button"
                        className={cn(
                            "focus:outline-none transition-colors",
                            disabled && "cursor-not-allowed opacity-50"
                        )}
                        onClick={() => !disabled && onChange(ratingValue)}
                        onMouseEnter={() => !disabled && setHoverValue(ratingValue)}
                        onMouseLeave={() => !disabled && setHoverValue(null)}
                        disabled={disabled}
                    >
                        <Star
                            className={cn(
                                "w-6 h-6",
                                isFilled ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                            )}
                        />
                    </button>
                );
            })}
        </div>
    );
}
