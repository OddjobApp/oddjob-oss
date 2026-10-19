import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Keyboard, Command, Search, X, ChevronRight, Menu } from "lucide-react";

interface ShortcutGroup {
    label: string;
    shortcuts: {
        keys: string[];
        description: string;
    }[];
}

const SHORTCUTS: ShortcutGroup[] = [
    {
        label: "General",
        shortcuts: [
            { keys: ["Ctrl", "K"], description: "Open command palette / search" },
            { keys: ["Shift", "?"], description: "Show keyboard shortcuts" },
            { keys: ["Esc"], description: "Close modal / dialog" },
            { keys: ["/"], description: "Focus search" },
        ],
    },
    {
        label: "Navigation (press G first, then letter)",
        shortcuts: [
            { keys: ["G", "H"], description: "Go to Home / Dashboard" },
            { keys: ["G", "J"], description: "Go to Jobs" },
            { keys: ["G", "P"], description: "Go to Pipelines" },
            { keys: ["G", "S"], description: "Go to Schedules" },
            { keys: ["G", "K"], description: "Go to Knowledge" },
        ],
    },
    {
        label: "Actions",
        shortcuts: [
            { keys: ["Ctrl", "N"], description: "Create new item" },
            { keys: ["Ctrl", "Shift", "R"], description: "Refresh current view" },
        ],
    }
];

interface KeyboardShortcutsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Keyboard className="w-5 h-5 text-indigo-600" />
                        Keyboard Shortcuts
                    </DialogTitle>
                    <DialogDescription>
                        Speed up your workflow with these shortcuts.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    {SHORTCUTS.map((group) => (
                        <div key={group.label}>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                {group.label}
                            </h4>
                            <div className="space-y-2">
                                {group.shortcuts.map((shortcut) => (
                                    <div key={shortcut.description} className="flex items-center justify-between text-sm">
                                        <span className="text-gray-700">{shortcut.description}</span>
                                        <div className="flex items-center gap-1">
                                            {shortcut.keys.map((key) => (
                                                <kbd
                                                    key={key}
                                                    className="inline-flex h-6 items-center justify-center rounded border bg-muted px-2 font-mono text-xs font-medium text-muted-foreground shadow-sm"
                                                >
                                                    {key}
                                                </kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
