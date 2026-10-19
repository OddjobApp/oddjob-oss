import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard shortcuts for the studio.
 *
 * The keys avoid the app's global shortcuts (use-keyboard-shortcuts.tsx), whose single
 * letters g, h, j, k, p, s and a navigate after "g": approving is Y, not A. A key typed
 * into a field, a menu, a dialog or the tabs is left alone, so text undo still works
 * in the prompt box, and so is a key pressed with focus outside the studio, in the chat.
 */

export type StudioCommand =
  | "togglePlay" | "nextShot" | "previousShot" | "previousFrame" | "nextFrame" | "fullscreen"
  | "approveTake" | "reshootTake" | "undo" | "redo";

export interface ShortcutHint {
  command: StudioCommand;
  keys: string[];
  label: string;
}

export const STUDIO_SHORTCUTS: ShortcutHint[] = [
  { command: "togglePlay", keys: ["Space"], label: "Play or pause" },
  { command: "nextShot", keys: ["→"], label: "Next shot" },
  { command: "previousShot", keys: ["←"], label: "Previous shot" },
  { command: "nextFrame", keys: ["Shift", "→"], label: "Forward one frame" },
  { command: "previousFrame", keys: ["Shift", "←"], label: "Back one frame" },
  { command: "fullscreen", keys: ["F"], label: "Full screen, or back" },
  { command: "approveTake", keys: ["Y"], label: "Approve the take on screen" },
  { command: "reshootTake", keys: ["R"], label: "Re-shoot the take on screen" },
  { command: "undo", keys: ["Ctrl", "Z"], label: "Undo the last approval or re-shoot" },
  { command: "redo", keys: ["Ctrl", "Shift", "Z"], label: "Redo" },
];

/** The keys for a command, for a button's title, e.g. "Y". */
export const shortcutKeys = (command: StudioCommand) =>
  STUDIO_SHORTCUTS.find((hint) => hint.command === command)?.keys.join("+") ?? "";

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/** The command a key press means, or null. */
export function studioCommandFor(event: KeyPress): StudioCommand | null {
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && !event.shiftKey) return "redo";
    return null;
  }
  if (event.key === " " || key === "spacebar") return "togglePlay";
  if (event.key === "ArrowRight") return event.shiftKey ? "nextFrame" : "nextShot";
  if (event.key === "ArrowLeft") return event.shiftKey ? "previousFrame" : "previousShot";
  if (event.key === ".") return "nextShot";
  if (event.key === ",") return "previousShot";
  if (event.shiftKey) return null;
  if (key === "y") return "approveTake";
  if (key === "r") return "reshootTake";
  if (key === "f") return "fullscreen";
  return null;
}

/** Whether a key press belongs to where it was typed rather than to the studio. */
export function isOwnKeyTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return true;
  return Boolean(element.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tablist"], [contenteditable="true"]'));
}

/**
 * Runs a handler for each command it is given, while the root is on screen. Space is
 * left to a focused button or link, which it activates.
 */
export function useStudioShortcuts(root: RefObject<HTMLElement | null>, handlers: Partial<Record<StudioCommand, () => void>>, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const container = root.current;
      const target = event.target as Node | null;
      if (!container || !target) return;
      if (target !== document.body && !container.contains(target)) return;
      if (isOwnKeyTarget(event.target)) return;
      const command = studioCommandFor(event);
      if (!command) return;
      if (command === "togglePlay" && (event.target as HTMLElement).closest?.('button, a, summary, [role="button"]')) return;
      const handler = latest.current[command];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [root, enabled]);
}
