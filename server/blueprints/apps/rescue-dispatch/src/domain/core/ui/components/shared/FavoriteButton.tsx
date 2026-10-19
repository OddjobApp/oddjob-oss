/**
 * FavoriteButton Component
 * 
 * A star button for adding/removing items from favorites.
 * Uses the useFavorites hook for state management.
 */

import { memo } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFavorites, type FavoriteType } from '@domain-ui/core/ui/hooks/useFavorites';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@domain-ui/core/ui/components/ui/tooltip';

export interface FavoriteButtonProps {
    /** Item ID */
    id: number | string;
    /** Item type */
    type: FavoriteType;
    /** Item name (for display) */
    name: string;
    /** Size of the button */
    size?: 'sm' | 'md' | 'lg';
    /** Whether to show tooltip */
    showTooltip?: boolean;
    /** Additional className */
    className?: string;
}

const sizeClasses = {
    sm: 'h-7 w-7',
    md: 'h-8 w-8',
    lg: 'h-9 w-9',
};

const iconSizeClasses = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
};

/**
 * Memoized favorite button component.
 * Shows filled star when item is favorited.
 */
export const FavoriteButton = memo(function FavoriteButton({
    id,
    type,
    name,
    size = 'md',
    showTooltip = true,
    className,
}: FavoriteButtonProps) {
    const { isFavorite, toggleFavorite } = useFavorites();
    const favorited = isFavorite(id, type);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent row click when in a table
        e.preventDefault();
        toggleFavorite({ id, type, name });
    };

    const button = (
        <Button
            variant="ghost"
            size="icon"
            className={cn(
                sizeClasses[size],
                'transition-colors',
                favorited && 'text-yellow-500 hover:text-yellow-600',
                !favorited && 'text-muted-foreground hover:text-yellow-500',
                className
            )}
            onClick={handleClick}
            aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
            <Star
                className={cn(
                    iconSizeClasses[size],
                    favorited && 'fill-current'
                )}
            />
        </Button>
    );

    if (!showTooltip) return button;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {button}
                </TooltipTrigger>
                <TooltipContent>
                    <p>{favorited ? 'Remove from favorites' : 'Add to favorites'}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
});

export default FavoriteButton;

