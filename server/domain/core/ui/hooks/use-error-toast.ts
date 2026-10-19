import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ClientAppError, getErrorTitle, ErrorCode } from "@/lib/errors";
import { useCallback } from "react";

interface UseErrorToastOptions {
    title?: string;
    fallbackMessage?: string;
}

/**
 * Hook to display standardized error toasts.
 * Automatically handles ClientAppError structures and provides friendly messages.
 */
export function useErrorToast() {
    const { toast } = useToast();

    const notify = useCallback((error: unknown, options?: UseErrorToastOptions) => {
        // Normalize to ClientAppError
        const appError = ClientAppError.fromUnknown(error);

        // Log to console for debugging with full context
        console.error('Application Error:', {
            message: appError.message,
            code: appError.code,
            statusCode: appError.statusCode,
            details: appError.details,
            correlationId: appError.correlationId,
            stack: appError.stack
        });

        // Determine title
        const title = options?.title || getErrorTitle(appError.code);

        // Format validation details if present
        let description = appError.message || options?.fallbackMessage || "An unexpected error occurred.";

        // If it's a validation error with field-level details, prevent gigantic toasts
        // but try to be helpful
        if (appError.code === ErrorCode.VALIDATION_FAILED && Array.isArray(appError.details)) {
            // Zod issues usually look like { path: [], message: "" }
            const issues = appError.details as any[];
            if (issues.length > 0) {
                const firstIssue = issues[0];
                const fieldName = firstIssue.path?.join('.');
                description = `${firstIssue.message}${fieldName ? ` (${fieldName})` : ''}`;

                if (issues.length > 1) {
                    description += ` (+${issues.length - 1} more errors)`;
                }
            }
        }

        // Show toast
        toast({
            title,
            description,
            variant: "destructive",
        });

    }, [toast]);

    return { notify };
}

