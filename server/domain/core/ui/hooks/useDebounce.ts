/**
 * useDebounce Hook
 * 
 * Debounces a value or callback to reduce unnecessary updates.
 * Useful for search inputs, API calls, and performance optimization.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Debounce a value
 * 
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearch = useDebounce(searchTerm, 300);
 * 
 * // Use debouncedSearch for API calls
 * useEffect(() => {
 *   if (debouncedSearch) {
 *     searchApi(debouncedSearch);
 *   }
 * }, [debouncedSearch]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}

/**
 * Debounce a callback function
 * 
 * @example
 * ```tsx
 * const handleSearch = useDebouncedCallback((query: string) => {
 *   fetchResults(query);
 * }, 300);
 * 
 * <Input onChange={(e) => handleSearch(e.target.value)} />
 * ```
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number = 300
): (...args: Parameters<T>) => void {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const callbackRef = useRef(callback);

    // Update callback ref on each render
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            callbackRef.current(...args);
        }, delay);
    }, [delay]);
}

/**
 * Debounced search state hook
 * Combines local state with debounced value
 * 
 * @example
 * ```tsx
 * const { value, debouncedValue, setValue, clear } = useDebouncedSearch(300);
 * 
 * <Input 
 *   value={value} 
 *   onChange={(e) => setValue(e.target.value)}
 *   placeholder="Search..."
 * />
 * 
 * // Use debouncedValue for filtering/API calls
 * const filteredItems = items.filter(item => 
 *   item.name.includes(debouncedValue)
 * );
 * ```
 */
export function useDebouncedSearch(delay: number = 300) {
    const [value, setValue] = useState('');
    const debouncedValue = useDebounce(value, delay);

    const clear = useCallback(() => {
        setValue('');
    }, []);

    return useMemo(() => ({
        value,
        debouncedValue,
        setValue,
        clear,
        isEmpty: value.length === 0,
        isSearching: value !== debouncedValue,
    }), [value, debouncedValue, clear]);
}

export default useDebounce;
