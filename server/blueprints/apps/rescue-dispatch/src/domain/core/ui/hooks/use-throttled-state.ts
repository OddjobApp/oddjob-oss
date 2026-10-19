import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * A hook to manage an array of state updates with throttling.
 * Useful for high-frequency data like logs or telemetry to prevent re-render saturation.
 */
export function useThrottledArrayState<T>(
    initialItems: T[] = [],
    delayMs: number = 100,
    maxBuffer: number = 500
): [T[], (items: T | T[]) => void, () => void] {
    const [items, setItems] = useState<T[]>(initialItems);
    const bufferRef = useRef<T[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const flush = useCallback(() => {
        if (bufferRef.current.length === 0) return;

        setItems((prev) => {
            const next = [...prev, ...bufferRef.current];
            return next.slice(-maxBuffer);
        });
        bufferRef.current = [];
    }, [maxBuffer]);

    const append = useCallback((newItem: T | T[]) => {
        if (Array.isArray(newItem)) {
            bufferRef.current.push(...newItem);
        } else {
            bufferRef.current.push(newItem);
        }

        if (!timerRef.current) {
            timerRef.current = setTimeout(() => {
                flush();
                timerRef.current = null;
            }, delayMs);
        }
    }, [delayMs, flush]);

    const clear = useCallback(() => {
        setItems([]);
        bufferRef.current = [];
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return [items, append, clear];
}
