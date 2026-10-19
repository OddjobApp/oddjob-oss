/**
 * EditableField Component
 * 
 * A reusable component for fields that switch between view and edit modes.
 * Reduces repetitive ternary patterns like `isEditing ? <Input...> : <p...>`
 */

import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { cn } from "@/lib/utils";

interface EditableFieldProps {
    label: string;
    labelHint?: string;
    isEditing: boolean;
    type?: 'text' | 'textarea' | 'number' | 'code';
    value: string | number | undefined | null;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
    displayClassName?: string;
    /** Show as monospace code block in view mode */
    codeStyle?: boolean;
}

/**
 * EditableField - Simplifies the common pattern of switching between
 * an editable input and a read-only display.
 */
export function EditableField({
    label,
    labelHint,
    isEditing,
    type = 'text',
    value,
    onChange,
    placeholder,
    rows = 3,
    className,
    displayClassName,
    codeStyle = false,
}: EditableFieldProps) {
    const displayValue = value?.toString() ?? '';

    return (
        <div className={cn("space-y-2", className)}>
            <Label>
                {label}
                {labelHint && <span className="text-muted-foreground text-xs ml-1">{labelHint}</span>}
            </Label>

            {isEditing ? (
                type === 'textarea' ? (
                    <Textarea
                        value={displayValue}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        rows={rows}
                    />
                ) : (
                    <Input
                        type={type === 'number' ? 'number' : 'text'}
                        value={displayValue}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                    />
                )
            ) : (
                codeStyle || type === 'code' ? (
                    <code className={cn(
                        "text-sm text-foreground bg-muted px-2 py-1 rounded inline-block",
                        displayClassName
                    )}>
                        {displayValue || <span className="text-muted-foreground italic">Not set</span>}
                    </code>
                ) : (
                    <p className={cn("text-sm text-foreground", displayClassName)}>
                        {displayValue || <span className="text-muted-foreground italic">Not set</span>}
                    </p>
                )
            )}
        </div>
    );
}

interface EditableSelectFieldProps {
    label: string;
    labelHint?: string;
    isEditing: boolean;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    className?: string;
}

/**
 * EditableSelectField - Select dropdown that switches to display mode when not editing
 */
export function EditableSelectField({
    label,
    labelHint,
    isEditing,
    value,
    onChange,
    options,
    placeholder,
    className,
}: EditableSelectFieldProps) {
    // Note: Using native select for simplicity; could be enhanced with Shadcn Select
    const selectedOption = options.find(o => o.value === value);

    return (
        <div className={cn("space-y-2", className)}>
            <Label>
                {label}
                {labelHint && <span className="text-muted-foreground text-xs ml-1">{labelHint}</span>}
            </Label>

            {isEditing ? (
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    {placeholder && <option value="">{placeholder}</option>}
                    {options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            ) : (
                <p className="text-sm text-foreground">
                    {selectedOption?.label || value || <span className="text-muted-foreground italic">Not set</span>}
                </p>
            )}
        </div>
    );
}

export default EditableField;
