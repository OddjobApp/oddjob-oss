/**
 * CopyButton Component
 * 
 * A button that copies text to clipboard with visual feedback.
 */

import { memo, useState, useCallback } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@domain-ui/core/ui/components/ui/tooltip';

export interface CopyButtonProps {
    /** Text to copy to clipboard */
    value: string;
    /** Size of the button */
    size?: 'sm' | 'md' | 'lg';
    /** Variant style */
    variant?: 'ghost' | 'outline' | 'default';
    /** Show tooltip */
    showTooltip?: boolean;
    /** Custom tooltip text */
    tooltipText?: string;
    /** Callback after successful copy */
    onCopy?: () => void;
    /** Additional className */
    className?: string;
    /** Label to show next to icon */
    label?: string;
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
 * Memoized copy button component.
 * Shows checkmark feedback after copying.
 */
export const CopyButton = memo(function CopyButton({
    value,
    size = 'md',
    variant = 'ghost',
    showTooltip = true,
    tooltipText = 'Copy to clipboard',
    onCopy,
    className,
    label,
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            onCopy?.();
            
            // Reset after 2 seconds
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [value, onCopy]);

    const button = (
        <Button
            variant={variant}
            size={label ? 'sm' : 'icon'}
            className={cn(
                !label && sizeClasses[size],
                'transition-colors',
                copied && 'text-green-500',
                className
            )}
            onClick={handleCopy}
            aria-label={copied ? 'Copied!' : tooltipText}
        >
            {copied ? (
                <Check className={cn(iconSizeClasses[size], label && 'mr-1.5')} />
            ) : (
                <Copy className={cn(iconSizeClasses[size], label && 'mr-1.5')} />
            )}
            {label && <span>{copied ? 'Copied!' : label}</span>}
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
                    <p>{copied ? 'Copied!' : tooltipText}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
});

/**
 * Inline copy button for use within text
 */
export const InlineCopyButton = memo(function InlineCopyButton({
    value,
    className,
}: {
    value: string;
    className?: string;
}) {
    return (
        <CopyButton
            value={value}
            size="sm"
            variant="ghost"
            className={cn('h-5 w-5 p-0 hover:bg-transparent', className)}
        />
    );
});

/**
 * Copy text with inline display
 */
export const CopyableText = memo(function CopyableText({
    value,
    displayValue,
    className,
    mono = false,
}: {
    value: string;
    displayValue?: string;
    className?: string;
    mono?: boolean;
}) {
    return (
        <span className={cn('inline-flex items-center gap-1', className)}>
            <span className={cn(mono && 'font-mono text-sm')}>
                {displayValue || value}
            </span>
            <InlineCopyButton value={value} />
        </span>
    );
});

export default CopyButton;
