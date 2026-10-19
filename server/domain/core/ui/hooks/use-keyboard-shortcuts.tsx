import { useEffect } from "react";
import { useLocation } from "wouter";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  description?: string;
}

export const GLOBAL_NAVIGATION_SHORTCUTS = [
  {
    key: "h",
    path: "/dashboard",
    description: "Go to Home / Dashboard",
  },
  {
    key: "j",
    path: "/operations",
    description: "Go to Operations",
  },
  {
    key: "p",
    path: "/operations/workstreams",
    description: "Go to Workstreams",
  },
  {
    key: "s",
    path: "/operations/schedules",
    description: "Go to Schedules",
  },
  {
    key: "k",
    path: "/knowledge",
    description: "Go to Knowledge",
  },
  {
    key: "a",
    path: "/assistant/workbench",
    description: "Open Assistant",
  },
] as const;

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Early return if key is undefined or we're in an input without modifiers
      if (!e.key) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor'); // Special handling for editors

      shortcuts.forEach((shortcut) => {
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
        const metaMatch = shortcut.meta !== undefined
          ? (shortcut.meta ? e.metaKey : !e.metaKey)
          : true;
        const shiftMatch = shortcut.shift !== undefined
          ? (shortcut.shift ? e.shiftKey : !e.shiftKey)
          : true;
        const altMatch = shortcut.alt !== undefined
          ? (shortcut.alt ? e.altKey : !e.altKey)
          : true;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (ctrlMatch && metaMatch && shiftMatch && altMatch && keyMatch) {
          // Only prevent default and trigger handler if:
          // 1. Not in an input field
          // 2. OR it's a control combo (Ctrl/Meta/Alt)
          // 3. OR it's a special key like Escape
          const isModifierCombo = e.ctrlKey || e.metaKey || e.altKey;
          const isSpecialKey = ['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);

          if (!isInput || isModifierCombo || isSpecialKey) {
            e.preventDefault();
            shortcut.handler(e);
          }
        }
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}

// Track "g" key for navigation sequences (g+h, g+j, g+p, etc.)
let gKeyPressed = false;
let gKeyTimeout: NodeJS.Timeout | null = null;

const SEQUENCE_KEYS = new Set<string>(["g", ...GLOBAL_NAVIGATION_SHORTCUTS.map((s) => s.key)]);

/** Typing aimed at an open dialog must never navigate the page behind it. */
function isDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
}

// Global keyboard shortcuts hook
export function useGlobalKeyboardShortcuts() {
  const [location, setLocation] = useLocation();

  // A "g" arms navigation for the very next key only. Nothing disarmed it, so text
  // that reached the page instead of a field ("…data-handling audit…": g, space, a)
  // opened the assistant a keystroke later.
  useEffect(() => {
    const disarm = (e: KeyboardEvent) => {
      if (!SEQUENCE_KEYS.has(e.key?.toLowerCase() ?? "")) gKeyPressed = false;
    };
    window.addEventListener("keydown", disarm);
    return () => window.removeEventListener("keydown", disarm);
  }, []);

  useKeyboardShortcuts([
    // Command palette
    {
      key: "k",
      ctrl: true,
      handler: () => {
        window.dispatchEvent(new CustomEvent('open-command-palette'));
      },
      description: "Open command palette",
    },

    // Show keyboard shortcuts help
    {
      key: "?",
      shift: true,
      handler: () => {
        window.dispatchEvent(new CustomEvent('open-shortcuts'));
      },
      description: "Show keyboard shortcuts",
    },

    // Focus search
    {
      key: "/",
      handler: (e) => {
        window.dispatchEvent(new CustomEvent('focus-search'));
      },
      description: "Focus search",
    },

    // Escape - close modals
    {
      key: "Escape",
      handler: (e) => {
        const modals = document.querySelectorAll('[role="dialog"]');
        if (modals.length > 0) {
          const lastModal = modals[modals.length - 1] as HTMLElement;
          const closeButton = lastModal.querySelector('[aria-label*="close" i], [aria-label*="Close" i]') as HTMLElement;
          if (closeButton) {
            closeButton.click();
          }
        }
      },
      description: "Close modal/dialog",
    },

    // Navigation: G key sequences
    {
      key: "g",
      handler: (e) => {
        gKeyPressed = true;
        if (gKeyTimeout) clearTimeout(gKeyTimeout);
        gKeyTimeout = setTimeout(() => { gKeyPressed = false; }, 1000);
      },
      description: "Start navigation sequence",
    },
    ...GLOBAL_NAVIGATION_SHORTCUTS.map(({ key, path, description }) => ({
      key,
      handler: () => {
        const armed = gKeyPressed;
        gKeyPressed = false;
        if (armed && !isDialogOpen()) setLocation(path);
      },
      description: `${description} (after g)`,
    })),

    // Quick actions
    {
      key: "n",
      ctrl: true,
      handler: () => {
        window.dispatchEvent(new CustomEvent('create-new-item'));
      },
      description: "Create new item",
    },
    {
      key: "r",
      ctrl: true,
      shift: true,
      handler: () => {
        window.dispatchEvent(new CustomEvent('refresh-data'));
      },
      description: "Refresh current view",
    },
  ]);
}

