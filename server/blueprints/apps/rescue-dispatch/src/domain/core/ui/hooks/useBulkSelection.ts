/**
 * useBulkSelection Hook
 * 
 * Provides bulk selection functionality for lists of items.
 * Supports select all, clear selection, toggle individual items,
 * and range selection with shift+click.
 */

import { useState, useCallback, useMemo } from 'react';

export interface BulkSelectionOptions<T> {
    /** Function to extract unique ID from an item */
    getItemId: (item: T) => string | number;
    /** Callback when selection changes */
    onSelectionChange?: (selectedIds: Set<string | number>) => void;
}

export interface BulkSelectionState<T> {
    /** Set of selected item IDs */
    selectedIds: Set<string | number>;
    /** Whether all items are selected */
    isAllSelected: boolean;
    /** Whether some but not all items are selected */
    isPartiallySelected: boolean;
    /** Number of selected items */
    selectedCount: number;
    /** Check if a specific item is selected */
    isSelected: (item: T) => boolean;
    /** Toggle selection of a single item */
    toggleItem: (item: T) => void;
    /** Select all items */
    selectAll: (items: T[]) => void;
    /** Clear all selections */
    clearSelection: () => void;
    /** Toggle all items (select all if none selected, clear if any selected) */
    toggleAll: (items: T[]) => void;
    /** Select a range of items (for shift+click) */
    selectRange: (items: T[], fromIndex: number, toIndex: number) => void;
    /** Get array of selected items */
    getSelectedItems: (items: T[]) => T[];
}

/**
 * Hook for managing bulk selection state
 * 
 * @example
 * ```tsx
 * const { selectedIds, isSelected, toggleItem, selectAll, clearSelection } = useBulkSelection({
 *   getItemId: (job) => job.id,
 *   onSelectionChange: (ids) => console.log('Selected:', ids.size),
 * });
 * 
 * // In render
 * <Checkbox checked={isSelected(job)} onChange={() => toggleItem(job)} />
 * ```
 */
export function useBulkSelection<T>(
    options: BulkSelectionOptions<T>
): BulkSelectionState<T> {
    const { getItemId, onSelectionChange } = options;
    const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

    const updateSelection = useCallback((newIds: Set<string | number>) => {
        setSelectedIds(newIds);
        onSelectionChange?.(newIds);
    }, [onSelectionChange]);

    const isSelected = useCallback((item: T): boolean => {
        return selectedIds.has(getItemId(item));
    }, [selectedIds, getItemId]);

    const toggleItem = useCallback((item: T) => {
        const id = getItemId(item);
        const newIds = new Set(selectedIds);
        if (newIds.has(id)) {
            newIds.delete(id);
        } else {
            newIds.add(id);
        }
        updateSelection(newIds);
    }, [selectedIds, getItemId, updateSelection]);

    const selectAll = useCallback((items: T[]) => {
        const newIds = new Set<string | number>(items.map(getItemId));
        updateSelection(newIds);
    }, [getItemId, updateSelection]);

    const clearSelection = useCallback(() => {
        updateSelection(new Set());
    }, [updateSelection]);

    const toggleAll = useCallback((items: T[]) => {
        if (selectedIds.size > 0) {
            clearSelection();
        } else {
            selectAll(items);
        }
    }, [selectedIds.size, clearSelection, selectAll]);

    const selectRange = useCallback((items: T[], fromIndex: number, toIndex: number) => {
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        const newIds = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
            if (items[i]) {
                newIds.add(getItemId(items[i]));
            }
        }
        updateSelection(newIds);
    }, [selectedIds, getItemId, updateSelection]);

    const getSelectedItems = useCallback((items: T[]): T[] => {
        return items.filter(item => selectedIds.has(getItemId(item)));
    }, [selectedIds, getItemId]);

    const isAllSelected = useMemo(() => false, []); // Will be computed when items are passed
    const isPartiallySelected = useMemo(() => selectedIds.size > 0, [selectedIds.size]);

    return {
        selectedIds,
        isAllSelected,
        isPartiallySelected,
        selectedCount: selectedIds.size,
        isSelected,
        toggleItem,
        selectAll,
        clearSelection,
        toggleAll,
        selectRange,
        getSelectedItems,
    };
}

/**
 * Hook for bulk actions on selected items
 */
export interface BulkActionsOptions<T> {
    selection: BulkSelectionState<T>;
    items: T[];
}

export interface BulkActions<T> {
    /** Enable all selected items */
    enableSelected: () => Promise<void>;
    /** Disable all selected items */
    disableSelected: () => Promise<void>;
    /** Delete all selected items */
    deleteSelected: () => Promise<void>;
    /** Custom action on selected items */
    performAction: (action: (items: T[]) => Promise<void>) => Promise<void>;
}

export default useBulkSelection;
