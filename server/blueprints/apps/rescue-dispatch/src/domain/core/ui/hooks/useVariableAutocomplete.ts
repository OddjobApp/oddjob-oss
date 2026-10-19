import { useState, useCallback, useMemo, useEffect } from 'react';
import {
    type VariableInfo,
    findVariableTrigger,
    filterVariables
} from '@shared/utils/variableDiscovery';

export interface UseVariableAutocompleteOptions {
    /** Current input value */
    value: string;
    /** Current cursor position */
    cursorPosition: number;
    /** Available variables */
    variables: VariableInfo[];
    /** Whether autocomplete is enabled */
    enabled?: boolean;
}

export interface UseVariableAutocompleteResult {
    /** Whether the autocomplete menu should be open */
    isOpen: boolean;
    /** Filtered variables based on partial input */
    filteredVariables: VariableInfo[];
    /** Currently selected index in the list */
    selectedIndex: number;
    /** Position info for the trigger */
    triggerInfo: { start: number; partial: string } | null;
    /** Handle keyboard navigation - returns true if event was handled */
    handleKeyDown: (e: React.KeyboardEvent) => boolean;
    /** Insert a variable and return the new value */
    insertVariable: (variable: VariableInfo) => { newValue: string; newCursorPosition: number };
    /** Move selection up */
    selectPrevious: () => void;
    /** Move selection down */
    selectNext: () => void;
    /** Close the autocomplete menu */
    close: () => void;
    /** Get currently selected variable */
    getSelectedVariable: () => VariableInfo | undefined;
}

export function useVariableAutocomplete({
    value,
    cursorPosition,
    variables,
    enabled = true,
}: UseVariableAutocompleteOptions): UseVariableAutocompleteResult {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isManuallyOpen, setIsManuallyOpen] = useState(false);

    // Detect trigger and partial input
    const triggerInfo = useMemo(() => {
        if (!enabled) return null;
        return findVariableTrigger(value, cursorPosition);
    }, [value, cursorPosition, enabled]);

    // Filter variables based on partial input
    const filteredVariables = useMemo(() => {
        if (!triggerInfo) return [];
        return filterVariables(variables, triggerInfo.partial);
    }, [variables, triggerInfo]);

    // Determine if open
    const isOpen = useMemo(() => {
        if (!enabled) return false;
        if (isManuallyOpen) return true;
        return triggerInfo !== null && filteredVariables.length > 0;
    }, [enabled, isManuallyOpen, triggerInfo, filteredVariables.length]);

    // Reset selection when filtered list changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredVariables.length, triggerInfo?.partial]);

    // Close when no trigger
    useEffect(() => {
        if (!triggerInfo) {
            setIsManuallyOpen(false);
        }
    }, [triggerInfo]);

    const selectPrevious = useCallback(() => {
        setSelectedIndex(prev => {
            const newIndex = prev - 1;
            return newIndex < 0 ? filteredVariables.length - 1 : newIndex;
        });
    }, [filteredVariables.length]);

    const selectNext = useCallback(() => {
        setSelectedIndex(prev => {
            const newIndex = prev + 1;
            return newIndex >= filteredVariables.length ? 0 : newIndex;
        });
    }, [filteredVariables.length]);

    const close = useCallback(() => {
        setIsManuallyOpen(false);
    }, []);

    const getSelectedVariable = useCallback(() => {
        return filteredVariables[selectedIndex];
    }, [filteredVariables, selectedIndex]);

    const insertVariable = useCallback((variable: VariableInfo): { newValue: string; newCursorPosition: number } => {
        if (!triggerInfo) {
            return { newValue: value, newCursorPosition: cursorPosition };
        }

        // Replace from trigger start to cursor with the variable
        const before = value.substring(0, triggerInfo.start);
        const after = value.substring(cursorPosition);
        const newValue = before + variable.name + after;
        const newCursorPosition = before.length + variable.name.length;

        close();

        return { newValue, newCursorPosition };
    }, [value, cursorPosition, triggerInfo, close]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
        if (!isOpen) return false;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                selectPrevious();
                return true;

            case 'ArrowDown':
                e.preventDefault();
                selectNext();
                return true;

            case 'Tab':
            case 'Enter':
                if (filteredVariables.length > 0) {
                    e.preventDefault();
                    const selected = getSelectedVariable();
                    if (selected) {
                        // Return true to indicate the event was handled
                        // The parent component should call insertVariable
                        return true;
                    }
                }
                return false;

            case 'Escape':
                e.preventDefault();
                close();
                return true;

            default:
                return false;
        }
    }, [isOpen, selectPrevious, selectNext, filteredVariables.length, getSelectedVariable, close]);

    return {
        isOpen,
        filteredVariables,
        selectedIndex,
        triggerInfo,
        handleKeyDown,
        insertVariable,
        selectPrevious,
        selectNext,
        close,
        getSelectedVariable,
    };
}

export default useVariableAutocomplete;
