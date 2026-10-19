/**
 * RefreshButton Component
 * 
 * A button for manually refreshing data with loading state and animation.
 */

import { memo, useState, useCallback } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@domain-ui/core/ui/components/ui/tooltip';

export interface RefreshButtonProps {
    /** Callback to refresh data - can be async */
    onRefresh: () => void | Promise<void>;
    /** External loading state (e.g., from useQuery) */
    isLoading?: boolean;
    /** Size of the button */
    size?: 'sm' | 'md' | 'lg';
    /** Variant style */
    variant?: 'ghost' | 'outline' | 'default';
    /** Show tooltip */
    showTooltip?: boolean;
    /** Custom tooltip text */
    tooltipText?: string;
    /** Additional className */
    className?: string;
    /** Label to show next to icon */
    label?: string;
    /** Disable the button */
    disabled?: boolean;
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
 * Memoized refresh button component.
 * Shows spinning animation while loading.
 */
export const RefreshButton = memo(function RefreshButton({
    onRefresh,
    isLoading: externalLoading = false,
    size = 'md',
    variant = 'ghost',
    showTooltip = true,
    tooltipText = 'Refresh',
    className,
    label,
    disabled = false,
}: RefreshButtonProps) {
    const [internalLoading, setInternalLoading] = useState(false);
    const isLoading = externalLoading || internalLoading;

    const handleRefresh = useCallback(async () => {
        if (isLoading || disabled) return;
        
        setInternalLoading(true);
        try {
            await onRefresh();
        } finally {
            // Add slight delay to show animation
            setTimeout(() => setInternalLoading(false), 300);
        }
    }, [onRefresh, isLoading, disabled]);

    const button = (
        <Button
            variant={variant}
            size={label ? 'sm' : 'icon'}
            className={cn(
                !label && sizeClasses[size],
                className
            )}
            onClick={handleRefresh}
            disabled={isLoading || disabled}
            aria-label={tooltipText}
        >
            <RefreshCw 
                className={cn(
                    iconSizeClasses[size],
                    label && 'mr-1.5',
                    isLoading && 'animate-spin'
                )} 
            />
            {label && <span>{isLoading ? 'Refreshing...' : label}</span>}
        </Button>
    );

    if (!showTooltip || label) return button;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {button}
                </TooltipTrigger>
                <TooltipContent>
                    <p>{isLoading ? 'Refreshing...' : tooltipText}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
});

/**
 * Hook for refresh button with query integration
 */
export function useRefreshWithQuery(refetchFn: () => Promise<any>) {
    const [isRefreshing, setIsRefreshing] = useState(false);

    const refresh = useCallback(async () => {
        setIsRefreshing(true);
        try {
            await refetchFn();
        } finally {
            setIsRefreshing(false);
        }
    }, [refetchFn]);

    return { refresh, isRefreshing };
}

export default RefreshButton;
