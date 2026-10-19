/**
 * BulkActionsToolbar Component
 * 
 * Displays a toolbar with bulk actions when items are selected.
 * Supports enable/disable, delete, and custom actions.
 */

import { memo } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { 
    X, 
    CheckCircle, 
    XCircle, 
    Trash2, 
    MoreHorizontal,
    Power,
    PowerOff
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@domain-ui/core/ui/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@domain-ui/core/ui/components/ui/alert-dialog';

export interface BulkAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
    requiresConfirmation?: boolean;
    confirmationTitle?: string;
    confirmationDescription?: string;
    onClick: () => void | Promise<void>;
}

export interface BulkActionsToolbarProps {
    /** Number of selected items */
    selectedCount: number;
    /** Callback to clear selection */
    onClearSelection: () => void;
    /** Whether bulk operations are in progress */
    isLoading?: boolean;
    /** Primary actions shown as buttons */
    primaryActions?: BulkAction[];
    /** Secondary actions shown in dropdown */
    secondaryActions?: BulkAction[];
    /** Custom className */
    className?: string;
}

/**
 * Memoized bulk actions toolbar component.
 * Only shows when items are selected.
 */
export const BulkActionsToolbar = memo(function BulkActionsToolbar({
    selectedCount,
    onClearSelection,
    isLoading = false,
    primaryActions = [],
    secondaryActions = [],
    className = '',
}: BulkActionsToolbarProps) {
    if (selectedCount === 0) return null;

    const renderAction = (action: BulkAction, asMenuItem = false) => {
        const content = asMenuItem ? (
            <DropdownMenuItem
                key={action.id}
                onClick={action.onClick}
                disabled={isLoading}
                className={action.variant === 'destructive' ? 'text-destructive' : ''}
            >
                {action.icon && <span className="mr-2">{action.icon}</span>}
                {action.label}
            </DropdownMenuItem>
        ) : (
            <Button
                key={action.id}
                variant={action.variant || 'outline'}
                size="sm"
                onClick={action.onClick}
                disabled={isLoading}
            >
                {action.icon && <span className="mr-1.5">{action.icon}</span>}
                {action.label}
            </Button>
        );

        if (action.requiresConfirmation) {
            return (
                <AlertDialog key={action.id}>
                    <AlertDialogTrigger asChild>
                        {asMenuItem ? (
                            <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                disabled={isLoading}
                                className={action.variant === 'destructive' ? 'text-destructive' : ''}
                            >
                                {action.icon && <span className="mr-2">{action.icon}</span>}
                                {action.label}
                            </DropdownMenuItem>
                        ) : (
                            <Button
                                variant={action.variant || 'outline'}
                                size="sm"
                                disabled={isLoading}
                            >
                                {action.icon && <span className="mr-1.5">{action.icon}</span>}
                                {action.label}
                            </Button>
                        )}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {action.confirmationTitle || `${action.label}?`}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {action.confirmationDescription || 
                                    `This will ${action.label.toLowerCase()} ${selectedCount} selected item${selectedCount > 1 ? 's' : ''}.`}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={action.onClick}>
                                {action.label}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            );
        }

        return content;
    };

    return (
        <div className={`flex items-center gap-3 p-3 bg-muted/50 border rounded-lg ${className}`}>
            {/* Selection count */}
            <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-medium">
                    {selectedCount} selected
                </Badge>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearSelection}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Clear selection</span>
                </Button>
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Primary actions */}
            <div className="flex items-center gap-2">
                {primaryActions.map(action => renderAction(action))}
            </div>

            {/* Secondary actions dropdown */}
            {secondaryActions.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isLoading}>
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">More actions</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {secondaryActions.map((action, index) => (
                            <>
                                {renderAction(action, true)}
                                {index < secondaryActions.length - 1 && 
                                    action.variant === 'destructive' && 
                                    <DropdownMenuSeparator />}
                            </>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
});

/**
 * Preset actions for common bulk operations
 */
export const createBulkEnableAction = (onEnable: () => void | Promise<void>): BulkAction => ({
    id: 'enable',
    label: 'Enable',
    icon: <Power className="h-4 w-4" />,
    variant: 'outline',
    onClick: onEnable,
});

export const createBulkDisableAction = (onDisable: () => void | Promise<void>): BulkAction => ({
    id: 'disable',
    label: 'Disable',
    icon: <PowerOff className="h-4 w-4" />,
    variant: 'outline',
    onClick: onDisable,
});

export const createBulkDeleteAction = (
    onDelete: () => void | Promise<void>,
    itemCount: number
): BulkAction => ({
    id: 'delete',
    label: 'Delete',
    icon: <Trash2 className="h-4 w-4" />,
    variant: 'destructive',
    requiresConfirmation: true,
    confirmationTitle: 'Delete selected items?',
    confirmationDescription: `This will permanently delete ${itemCount} item${itemCount > 1 ? 's' : ''}. This action cannot be undone.`,
    onClick: onDelete,
});

export default BulkActionsToolbar;
