import { useRef, useState, useCallback } from 'react';
import { AlertCircle, Check, Braces, Wand2, Loader2, Search } from 'lucide-react';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@domain-ui/core/ui/components/ui/popover';
import { cn } from '@/lib/utils';
import { useJsonValidation } from '@domain-ui/core/ui/hooks/useJsonValidation';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import VariablePicker from '@domain-ui/core/ui/components/shared/VariablePicker';

interface JsonEditorProps {
    /** Current value */
    value: string;

    /** Change handler */
    onChange: (value: string) => void;

    /** Placeholder text */
    placeholder?: string;

    /** Number of rows */
    rows?: number;

    /** Field label */
    label?: string;

    /** Whether the field is required */
    required?: boolean;

    /** Whether the field is disabled */
    disabled?: boolean;

    /** Callback when validation state changes */
    onValidationChange?: (isValid: boolean) => void;

    /** Show format button (default: true) */
    showFormatButton?: boolean;

    /** Show AI-powered fix button (default: false) */
    showAiFixButton?: boolean;

    /** Show JQL helper button (default: false) */
    showJqlHelper?: boolean;

    /** Context for AI fix (e.g., "CURL job headers") */
    aiFixContext?: string;

    /** Test ID for testing */
    'data-testid'?: string;

    /** Additional class names for the textarea */
    className?: string;

    /** Helper text shown below the field */
    helperText?: string;

    /** Variables for picker */
    variables?: readonly any[]; // Using any[] to match VariablePicker's flexible typing or defined interface
}

/**
 * JSON Editor component with validation, formatting, and AI-powered fix
 * 
 * Drop-in replacement for Textarea with JSON-specific features:
 * - Real-time validation with debouncing
 * - Format/prettify button
 * - AI-powered fix suggestions (optional)
 * - Error highlighting with line/column info
 */
export function JsonEditor({
    value,
    onChange,
    placeholder,
    rows = 4,
    label,
    required = false,
    disabled = false,
    onValidationChange,
    showFormatButton = true,
    showAiFixButton = false,
    aiFixContext = 'JSON input',
    'data-testid': testId,
    className,
    helperText,
    showJqlHelper = false,
    variables,
}: JsonEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isFixing, setIsFixing] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [jqlQuery, setJqlQuery] = useState('');
    const [jqlPopoverOpen, setJqlPopoverOpen] = useState(false);
    const { toast } = useToast();

    const { isValid, error, formattedValue, tryFix } = useJsonValidation(value);

    // Notify parent of validation changes
    const lastValidRef = useRef(isValid);
    if (lastValidRef.current !== isValid) {
        lastValidRef.current = isValid;
        onValidationChange?.(isValid);
    }

    // Format handler
    const handleFormat = useCallback(() => {
        if (formattedValue) {
            onChange(formattedValue);
            toast({
                title: 'Formatted',
                description: 'JSON has been formatted',
                duration: 2000,
            });
        }
    }, [formattedValue, onChange, toast]);

    // Try local fix first
    const handleLocalFix = useCallback(() => {
        const result = tryFix();
        if (result && result.changes.length > 0) {
            onChange(result.fixed);
            toast({
                title: 'Fixed',
                description: result.changes.join(', '),
                duration: 3000,
            });
            return true;
        }
        return false;
    }, [tryFix, onChange, toast]);

    // AI fix handler
    const handleAiFix = useCallback(async () => {
        // Try local fix first
        if (handleLocalFix()) {
            return;
        }

        // If local fix didn't work, try AI
        setIsFixing(true);
        try {
            const response = await apiRequest('POST', '/api/json/fix', {
                malformedJson: value,
                context: aiFixContext,
            }) as unknown as {
                success: boolean;
                fixedJson?: string;
                explanation?: string;
                error?: string;
            };

            if (response.success && response.fixedJson) {
                onChange(response.fixedJson);
                toast({
                    title: 'Fixed by AI',
                    description: response.explanation || 'JSON has been corrected',
                    duration: 5000,
                });
            } else {
                toast({
                    title: 'Could not fix',
                    description: response.error || 'AI was unable to fix this JSON',
                    variant: 'destructive',
                });
            }
        } catch (err) {
            // Fallback: just report the error
            toast({
                title: 'Fix failed',
                description: 'Could not connect to AI service. Try fixing manually.',
                variant: 'destructive',
            });
        } finally {
            setIsFixing(false);
        }
    }, [value, aiFixContext, handleLocalFix, onChange, toast]);

    // JQL translation handler
    const handleJqlTranslate = useCallback(async () => {
        if (!jqlQuery.trim()) return;

        setIsTranslating(true);
        try {
            const response = await apiRequest('POST', '/api/jql/translate', {
                query: jqlQuery,
            }) as unknown as {
                success: boolean;
                jql?: string;
                error?: string;
            };

            if (response.success && response.jql) {
                // Determine if we should wrap in JSON
                let newValue = response.jql;
                try {
                    // If current value is JSON, try to update 'query' or 'jql' field or wrap it
                    const currentJson = JSON.parse(value || '{}');
                    if (typeof currentJson === 'object') {
                        const updatedJson = { ...currentJson, query: response.jql };
                        newValue = JSON.stringify(updatedJson, null, 2);
                    }
                } catch (e) {
                    // Not JSON or empty, if it's supposed to be a request body, maybe wrap it
                    if (aiFixContext.toLowerCase().includes('body')) {
                        newValue = JSON.stringify({ query: response.jql }, null, 2);
                    }
                }

                onChange(newValue);
                setJqlPopoverOpen(false);
                setJqlQuery('');
                toast({
                    title: 'JQL Generated',
                    description: 'Natural language translated to JQL',
                    duration: 3000,
                });
            } else {
                toast({
                    title: 'Translation failed',
                    description: response.error || 'AI was unable to translate this query',
                    variant: 'destructive',
                });
            }
        } catch (err) {
            toast({
                title: 'Translation error',
                description: 'Could not connect to translation service.',
                variant: 'destructive',
            });
        } finally {
            setIsTranslating(false);
        }
    }, [jqlQuery, value, aiFixContext, onChange, toast]);

    // Insert variable at cursor
    const handleVariableSelect = useCallback((val: string) => {
        if (textareaRef.current) {
            const input = textareaRef.current;
            const start = input.selectionStart || 0;
            const text = input.value;
            const newText = text.substring(0, start) + val + text.substring(input.selectionEnd || 0);
            onChange(newText);

            // Restore focus and cursor position
            setTimeout(() => {
                input.focus();
                const newCursor = start + val.length;
                input.setSelectionRange(newCursor, newCursor);
            }, 0);
        } else {
            // Fallback append if no ref (unlikely)
            onChange(value + val);
        }
    }, [value, onChange]);

    // Determine if we should show validation feedback
    const trimmedValue = value.trim();
    const showValidation = trimmedValue.length > 0;
    const hasError = showValidation && !isValid && error;

    return (
        <div className="space-y-2">
            {/* Header with label and buttons */}
            {(label || showFormatButton || showAiFixButton) && (
                <div className="flex items-center justify-between">
                    {label && (
                        <Label className={cn(hasError && 'text-destructive')}>
                            {label}
                            {required && <span className="text-destructive ml-1">*</span>}
                            {!required && !trimmedValue && (
                                <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
                            )}
                        </Label>
                    )}

                    <div className="flex items-center gap-1">
                        {/* JQL Helper button */}
                        {showJqlHelper && (
                            <Popover open={jqlPopoverOpen} onOpenChange={setJqlPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
                                        title="JQL Helper agent"
                                    >
                                        <Search className="h-3.5 w-3.5" />
                                        JQL Helper
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-4 space-y-4" align="end">
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-sm">Translate to JQL</h4>
                                        <p className="text-xs text-muted-foreground">Describe the JIRA issues you want to find.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Input
                                            placeholder="e.g. issues in project ABC that are done"
                                            value={jqlQuery}
                                            onChange={(e) => setJqlQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleJqlTranslate();
                                            }}
                                            autoFocus
                                        />
                                        <Button
                                            className="w-full h-8 text-xs"
                                            onClick={handleJqlTranslate}
                                            disabled={!jqlQuery.trim() || isTranslating}
                                        >
                                            {isTranslating ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Wand2 className="h-3 w-3 mr-2" />}
                                            Translate to JQL
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}

                        {/* AI Fix button */}
                        {showAiFixButton && hasError && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleAiFix}
                                disabled={disabled || isFixing}
                                className="h-7 text-xs gap-1"
                                title="Fix JSON with AI"
                            >
                                {isFixing ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Wand2 className="h-3 w-3" />
                                )}
                                Fix
                            </Button>
                        )}

                        {/* Variable Picker */}
                        {variables && variables.length > 0 && (
                            <VariablePicker
                                variables={[...variables]}
                                onSelect={handleVariableSelect}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    title="Insert Variable"
                                >
                                    <Braces className="h-3 w-3" />
                                </Button>
                            </VariablePicker>
                        )}

                        {/* Format button */}
                        {showFormatButton && isValid && trimmedValue && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleFormat}
                                disabled={disabled}
                                className="h-7 text-xs gap-1"
                                title="Format JSON"
                            >
                                <Braces className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Textarea */}
            <div className="relative">
                <Textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                    disabled={disabled}
                    data-testid={testId}
                    className={cn(
                        'font-mono text-sm',
                        hasError && 'border-destructive focus-visible:ring-destructive',
                        className
                    )}
                />

                {/* Validation indicator */}
                {showValidation && (
                    <div className="absolute top-2 right-2">
                        {isValid ? (
                            <Check className="h-4 w-4 text-green-500" />
                        ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                    </div>
                )}
            </div>

            {/* Validation message / Helper text */}
            {hasError ? (
                <div className="text-xs text-destructive flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                        {error.line && (
                            <span className="font-medium">Line {error.line}: </span>
                        )}
                        {error.message}
                        {error.context && (
                            <div className="mt-1 font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                {error.context}
                            </div>
                        )}
                    </div>
                </div>
            ) : helperText ? (
                <p className="text-xs text-muted-foreground">{helperText}</p>
            ) : showValidation && isValid ? (
                <p className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Valid JSON
                </p>
            ) : null}
        </div>
    );
}

export default JsonEditor;

