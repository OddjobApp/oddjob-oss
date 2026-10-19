import { useState, useEffect, useCallback, useMemo } from 'react';
import { validateJson, formatJson, tryFixJson, type JsonValidationResult, type JsonValidationError } from '@shared/utils/jsonUtils';

interface UseJsonValidationOptions {
    /**
     * Debounce delay in milliseconds for validation
     * @default 300
     */
    debounceMs?: number;

    /**
     * Whether to validate on initial mount
     * @default true
     */
    validateOnMount?: boolean;
}

interface UseJsonValidationReturn {
    /** Whether the current value is valid JSON */
    isValid: boolean;

    /** Error details if invalid */
    error: JsonValidationError | null;

    /** Formatted/prettified JSON if valid, null otherwise */
    formattedValue: string | null;

    /** Format the current value and return the result */
    format: () => string | null;

    /** Try to auto-fix the current value */
    tryFix: () => { fixed: string; changes: string[] } | null;

    /** Whether validation is pending (debounced) */
    isPending: boolean;

    /** Force immediate validation (skip debounce) */
    validateNow: () => JsonValidationResult;
}

/**
 * React hook for JSON validation with debouncing
 * 
 * @example
 * ```tsx
 * const { isValid, error, format, tryFix } = useJsonValidation(jsonValue);
 * 
 * return (
 *   <div>
 *     <Textarea value={jsonValue} onChange={(e) => setJsonValue(e.target.value)} />
 *     {error && <p className="text-red-500">Line {error.line}: {error.message}</p>}
 *     <Button onClick={() => setJsonValue(format() || jsonValue)}>Format</Button>
 *   </div>
 * );
 * ```
 */
export function useJsonValidation(
    value: string,
    options: UseJsonValidationOptions = {}
): UseJsonValidationReturn {
    const { debounceMs = 300, validateOnMount = true } = options;

    const [result, setResult] = useState<JsonValidationResult>(() =>
        validateOnMount ? validateJson(value) : { isValid: true }
    );
    const [isPending, setIsPending] = useState(false);

    // Memoize validation function
    const validateNow = useCallback(() => {
        const newResult = validateJson(value);
        setResult(newResult);
        setIsPending(false);
        return newResult;
    }, [value]);

    // Debounced validation
    useEffect(() => {
        setIsPending(true);

        const timer = setTimeout(() => {
            validateNow();
        }, debounceMs);

        return () => {
            clearTimeout(timer);
        };
    }, [value, debounceMs, validateNow]);

    // Format function
    const format = useCallback(() => {
        return formatJson(value);
    }, [value]);

    // Try fix function
    const tryFixFn = useCallback(() => {
        return tryFixJson(value);
    }, [value]);

    // Memoize return value
    return useMemo(() => ({
        isValid: result.isValid,
        error: result.error ?? null,
        formattedValue: result.formatted ?? null,
        format,
        tryFix: tryFixFn,
        isPending,
        validateNow,
    }), [result, format, tryFixFn, isPending, validateNow]);
}

export default useJsonValidation;
