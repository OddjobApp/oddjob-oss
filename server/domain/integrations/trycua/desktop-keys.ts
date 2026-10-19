/**
 * Key names for the desktop's computer-server. It resolves a key with
 * getattr(pynput.keyboard.Key, name) or accepts a single character, and does nothing
 * (or errors) for anything else, so "Enter", "Control" or "Control_L" must be mapped.
 * Shared by the provider (all callers) and the Gemini computer-use loop.
 */
const KEY_ALIASES: Record<string, string> = {
    control: "ctrl", ctrl: "ctrl", ctrl_l: "ctrl", ctrl_r: "ctrl",
    alt: "alt", option: "alt", altgr: "alt_gr",
    shift: "shift",
    meta: "cmd", super: "cmd", cmd: "cmd", command: "cmd", win: "cmd", windows: "cmd", os: "cmd",
    enter: "enter", return: "enter",
    escape: "esc", esc: "esc",
    backspace: "backspace", delete: "delete", del: "delete", insert: "insert",
    tab: "tab", space: "space", spacebar: "space",
    arrowup: "up", up: "up", arrowdown: "down", down: "down",
    arrowleft: "left", left: "left", arrowright: "right", right: "right",
    pageup: "page_up", page_up: "page_up", prior: "page_up",
    pagedown: "page_down", page_down: "page_down", next: "page_down",
    home: "home", end: "end", capslock: "caps_lock", caps_lock: "caps_lock",
};

export function normalizeKey(raw: string, inCombination: boolean): string {
    const key = raw.trim();
    if (key.length === 1) {
        // In a combination an uppercase letter would add Shift (ctrl+L != ctrl+l).
        return inCombination ? key.toLowerCase() : key;
    }
    const lower = key.toLowerCase().replace(/[\s-]/g, "_");
    if (/^f([1-9]|1[0-9]|20)$/.test(lower)) return lower;
    const known = KEY_ALIASES[lower] ?? KEY_ALIASES[lower.replace(/_/g, "")];
    if (known) return known;
    // X11 keysyms carry a side: Control_L, Shift_R, Super_L. pynput spells the sided
    // modifiers ctrl_l, shift_r, alt_l, cmd_r; anything else drops the side.
    const sided = /^(.+?)_?(l|r)$/.exec(lower);
    if (sided) {
        const base = KEY_ALIASES[sided[1]] ?? KEY_ALIASES[sided[1].replace(/_/g, "")];
        if (base === "ctrl" || base === "shift" || base === "alt" || base === "cmd") return `${base}_${sided[2]}`;
        if (base) return base;
    }
    return lower;
}
