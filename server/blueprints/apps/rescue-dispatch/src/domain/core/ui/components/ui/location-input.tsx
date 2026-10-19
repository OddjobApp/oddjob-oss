import React, { useState, useEffect, useCallback } from 'react';
import { Check, ChevronsUpDown, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface LocationInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export function LocationInput({ value, onChange, placeholder = "Search address...", disabled, className }: LocationInputProps) {
    const [open, setOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [inputValue, setInputValue] = useState(value);

    const fetchSuggestions = useCallback(async (query: string) => {
        if (!query || query.length < 3) {
            setSuggestions([]);
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`/api/rescue/geocode/suggest?q=${encodeURIComponent(query)}`);
            if (response.ok) {
                const data = await response.json();
                setSuggestions(data);
            }
        } catch (error) {
            console.error("Failed to fetch suggestions:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputValue !== value) {
                fetchSuggestions(inputValue);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [inputValue, value, fetchSuggestions]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
                    disabled={disabled}
                >
                    <div className="flex items-center gap-2 truncate">
                        <MapPin className="h-4 w-4 shrink-0 opacity-50" />
                        {value || placeholder}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Type to search..."
                        value={inputValue}
                        onValueChange={setInputValue}
                    />
                    <CommandList>
                        {loading && (
                            <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                <span className="text-sm text-muted-foreground">Searching...</span>
                            </div>
                        )}
                        {!loading && suggestions.length === 0 && inputValue.length >= 3 && (
                            <CommandEmpty>No results found.</CommandEmpty>
                        )}
                        {!loading && inputValue.length < 3 && (
                            <div className="p-4 text-xs text-muted-foreground text-center">
                                Type at least 3 characters to search
                            </div>
                        )}
                        <CommandGroup>
                            {suggestions.map((addr) => (
                                <CommandItem
                                    key={addr}
                                    value={addr}
                                    onSelect={(currentValue) => {
                                        onChange(currentValue);
                                        setInputValue(currentValue);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === addr ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    {addr}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
