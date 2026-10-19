
import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@domain-ui/core/ui/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@domain-ui/core/ui/components/ui/popover";
import { cn } from "@/lib/utils";

export interface Option {
    label: string;
    value: string | number;
}

interface MultiSelectProps {
    options: Option[];
    selected: (string | number)[];
    onChange: (selected: (string | number)[]) => void;
    badgeClassName?: string;
    placeholder?: string;
    disabled?: boolean;
}

export function MultiSelect({
    options,
    selected,
    onChange,
    placeholder = "Select items...",
    badgeClassName,
    disabled = false,
}: MultiSelectProps) {
    const [open, setOpen] = React.useState(false);

    const handleUnselect = (value: string | number) => {
        onChange(selected.filter((s) => s !== value));
    };

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between h-auto min-h-10 py-2 px-3"
                    disabled={disabled}
                >
                    <div className="flex flex-wrap gap-1">
                        {selected.length > 0 ? (
                            selected.map((val) => {
                                const option = options.find((o) => o.value === val);
                                return (
                                    <Badge
                                        key={val}
                                        variant="secondary"
                                        className={cn("mr-1 mb-1", badgeClassName)}
                                        onClick={(e) => {
                                            if (disabled) return;
                                            e.stopPropagation();
                                            handleUnselect(val);
                                        }}
                                    >
                                        {option?.label || val}
                                        {!disabled && <X className="ml-1 h-3 w-3 text-muted-foreground hover:text-foreground" />}
                                    </Badge>
                                );
                            })
                        ) : (
                            <span className="text-muted-foreground">{placeholder}</span>
                        )}
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0">
                <Command>
                    <CommandInput placeholder="Search..." />
                    <CommandList>
                        <CommandEmpty>No item found.</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    onSelect={() => {
                                        const isSelected = selected.includes(option.value);
                                        if (isSelected) {
                                            handleUnselect(option.value);
                                        } else {
                                            onChange([...selected, option.value]);
                                        }
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            selected.includes(option.value)
                                                ? "opacity-100"
                                                : "opacity-0"
                                        )}
                                    />
                                    {option.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
