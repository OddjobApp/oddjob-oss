/**
 * Hover Tutorial Snippet Engine
 *
 * Automatically detects when a user hovers over a UI component for >= 5 seconds
 * and presents the corresponding S.C.O.R.E. tutorial snippet via TutorialHost.
 */

import { useState, useEffect, useRef } from "react";
import {
  TUTORIAL_SNIPPETS,
  CANONICAL_TUTORIALS,
  type TutorialDefinition,
  type ScoreDimension,
} from "@shared/tutorials/registry";

export const DEFAULT_HOVER_TUTORIAL_DELAY_MS = 3000;

export interface ResolvedTutorialTarget {
  snippetId?: string;
  def?: TutorialDefinition;
  anchorEl: HTMLElement;
}

/**
 * Resolves whether a DOM element (or any of its ancestors) is mapped
 * to a tutorial snippet or ad-hoc tutorial definition.
 */
export function resolveTutorialForElement(el: Element | null): ResolvedTutorialTarget | null {
  if (!el || typeof el.closest !== "function") return null;

  // 1. Explicit data-tutorial-snippet or data-snippet-id attribute
  const snippetEl = el.closest<HTMLElement>("[data-tutorial-snippet], [data-snippet-id]");
  if (snippetEl) {
    const rawId = snippetEl.getAttribute("data-tutorial-snippet") || snippetEl.getAttribute("data-snippet-id");
    if (rawId) {
      const normalizedId = rawId.startsWith("snippet:") ? rawId : `snippet:${rawId}`;
      if (TUTORIAL_SNIPPETS[normalizedId] || TUTORIAL_SNIPPETS[rawId]) {
        return { snippetId: TUTORIAL_SNIPPETS[normalizedId]?.id || rawId, anchorEl: snippetEl };
      }
    }
  }

  // 2. Explicit data-component-id mapped in TUTORIAL_SNIPPETS
  const componentEl = el.closest<HTMLElement>("[data-component-id]");
  if (componentEl) {
    const compId = componentEl.getAttribute("data-component-id");
    if (compId) {
      const match = Object.values(TUTORIAL_SNIPPETS).find((s) => s.componentId === compId);
      if (match) {
        return { snippetId: match.id, anchorEl: componentEl };
      }
    }
  }

  // 3. Ad-hoc snippet via data-tutorial-title and optional data-tutorial-description
  const adhocEl = el.closest<HTMLElement>("[data-tutorial-title]");
  if (adhocEl) {
    const title = adhocEl.getAttribute("data-tutorial-title");
    if (title) {
      const description = adhocEl.getAttribute("data-tutorial-description") || title;
      const action = adhocEl.getAttribute("data-tutorial-action") || undefined;
      const scoreDimension = (adhocEl.getAttribute("data-tutorial-score") as ScoreDimension) || "S";
      const side = (adhocEl.getAttribute("data-tutorial-side") as "top" | "bottom" | "left" | "right") || "bottom";
      const hint = adhocEl.getAttribute("data-tutorial-hint") || undefined;
      const shortcut = adhocEl.getAttribute("data-tutorial-shortcut") || undefined;

      const adhocDef: TutorialDefinition = {
        id: `adhoc:hover:${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        name: title,
        steps: [
          {
            target: adhocEl as any,
            title,
            description,
            action,
            scoreDimension,
            side,
            hint,
            shortcut,
          },
        ],
      };
      return { def: adhocDef, anchorEl: adhocEl };
    }
  }

  // 4. Check data-tutorial anchor mapped in CANONICAL_TUTORIALS or TUTORIAL_SNIPPETS
  const tutorialEl = el.closest<HTMLElement>("[data-tutorial]");
  if (tutorialEl) {
    const tutorialId = tutorialEl.getAttribute("data-tutorial");
    if (tutorialId) {
      if (TUTORIAL_SNIPPETS[tutorialId] || TUTORIAL_SNIPPETS[`snippet:${tutorialId}`]) {
        return { snippetId: TUTORIAL_SNIPPETS[tutorialId]?.id || `snippet:${tutorialId}`, anchorEl: tutorialEl };
      }
      if (CANONICAL_TUTORIALS[tutorialId]) {
        return { def: CANONICAL_TUTORIALS[tutorialId], anchorEl: tutorialEl };
      }
    }
  }

  // 5. Semantic auto-resolve: derive per-element info from accessible attributes.
  //    Only applies to interactive/focusable elements — avoids matching neutral
  //    backgrounds, wrappers, and layout elements that carry no meaningful context.
  const INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='option']",
    "[role='checkbox']",
    "[role='switch']",
    "[role='combobox']",
    "[tabindex]:not([tabindex='-1'])",
    "[data-testid]",
  ].join(", ");

  // Walk from the hovered element upward to find the nearest interactive ancestor
  let semanticEl: HTMLElement | null = null;
  let cursor: Element | null = el;
  while (cursor && cursor !== document.body) {
    if (cursor instanceof HTMLElement) {
      try {
        if (cursor.matches(INTERACTIVE_SELECTOR)) {
          semanticEl = cursor;
          break;
        }
      } catch { /* ignore invalid selectors */ }
    }
    cursor = cursor.parentElement;
  }

  if (semanticEl) {
    const tag = semanticEl.tagName.toLowerCase();
    const role = semanticEl.getAttribute("role") || tag;
    const ariaLabel = semanticEl.getAttribute("aria-label") || "";
    const titleAttr = semanticEl.getAttribute("title") || "";
    const placeholder = semanticEl.getAttribute("placeholder") || "";
    const testId = semanticEl.getAttribute("data-testid") || "";
    const inputType = semanticEl.getAttribute("type") || "text";

    // Prefer short visible text only for buttons/tabs — avoid pulling in
    // all descendant text of large containers
    const isCompact = tag === "button" || tag === "a" || role === "tab" || role === "menuitem" || role === "option";
    const visibleText = isCompact
      ? (semanticEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)
      : "";

    // 1. Check author-provided aria descriptions first
    const describedById = semanticEl.getAttribute("aria-describedby");
    let authorDescription = "";
    if (describedById) {
      const descEl = document.getElementById(describedById);
      authorDescription = descEl ? (descEl.textContent || "").trim() : "";
    }
    const ariaDescription = semanticEl.getAttribute("aria-description") || "";
    if (!authorDescription) authorDescription = ariaDescription;

    // 2. Build a raw label — prefer aria-label, then title, then visible text, then placeholder
    const rawTitle = ariaLabel || titleAttr || visibleText || placeholder || testId.replace(/[-_]/g, " ");
    if (!rawTitle.trim()) return null;

    const labelLower = rawTitle.trim().toLowerCase();
    const title = rawTitle.trim().charAt(0).toUpperCase() + rawTitle.trim().slice(1);

    // 3. Find nearest section context — heading or landmark label in parent tree
    let sectionContext = "";
    let parent = semanticEl.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 8) {
      const heading = parent.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading) {
        sectionContext = (heading.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
        break;
      }
      const ariaLabelledBy = parent.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) { sectionContext = (labelEl.textContent || "").trim().slice(0, 50); break; }
      }
      const parentAriaLabel = parent.getAttribute("aria-label");
      if (parentAriaLabel) { sectionContext = parentAriaLabel.trim().slice(0, 50); break; }
      parent = parent.parentElement;
      depth++;
    }

    // 4. Find associated form <label> for inputs
    let formLabel = "";
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const elId = semanticEl.id;
      if (elId) {
        const labelEl = document.querySelector<HTMLElement>(`label[for="${elId}"]`);
        formLabel = labelEl ? (labelEl.textContent || "").trim() : "";
      }
      if (!formLabel) {
        const wrappingLabel = semanticEl.closest("label");
        if (wrappingLabel) {
          formLabel = (wrappingLabel.textContent || "").replace((semanticEl as HTMLInputElement).value || "", "").trim();
        }
      }
    }

    // 5. If the author provided an explicit aria description, use it directly
    if (authorDescription && authorDescription.length > 10) {
      const adhocDef: TutorialDefinition = {
        id: `adhoc:semantic:${labelLower.replace(/[^a-z0-9]/g, "-").slice(0, 40)}`,
        name: title,
        steps: [{ target: semanticEl as any, title, description: authorDescription, scoreDimension: "S", side: "bottom" }],
      };
      return { def: adhocDef, anchorEl: semanticEl };
    }

    // 6. Action-verb → intent mapping for buttons and links
    const ACTION_VERBS: Array<[RegExp, (noun: string, ctx: string) => string]> = [
      [/^(ask for a take|ask for another take|generate take)\b/i, () => "Queues video generation for this shot. For Image-to-Video models, requires an approved keyframe as starting frame."],
      [/^(create|new|add)\b/i,   (n, c) => `Creates a new ${n.replace(/^(create|new|add)\s*/i, "").trim() || "item"}${c ? ` in ${c}` : ""}.`],
      [/^(delete|remove|destroy)\b/i, (n, c) => `Permanently deletes the ${n.replace(/^(delete|remove|destroy)\s*/i, "").trim() || "item"}${c ? ` from ${c}` : ""}. This cannot be undone.`],
      [/^(save|update|apply)\b/i, (n, c) => `Saves your current changes${c ? ` to ${c}` : ""}.`],
      [/^(cancel|discard)\b/i,   () => "Cancels the current action and discards unsaved changes."],
      [/^(close|dismiss|hide)\b/i, () => "Closes this panel without saving."],
      [/^(search|find|filter|query)\b/i, (n, c) => `Search ${c || "the workspace"} for matching results.`],
      [/^(send|submit|post)\b/i, (n, c) => `Submits ${n.replace(/^(send|submit|post)\s*/i, "").trim() || "your input"}${c ? ` to ${c}` : ""} for processing.`],
      [/^(run|execute|start|launch|trigger)\b/i, (n, c) => `Runs ${n.replace(/^(run|execute|start|launch|trigger)\s*/i, "").trim() || "the task"}${c ? ` in ${c}` : ""} immediately.`],
      [/^(stop|pause|abort|halt)\b/i, (n, c) => `Stops${c ? ` ${c}` : " the current task"} immediately.`],
      [/^(edit|modify|change|rename)\b/i, (n, c) => `Opens ${n.replace(/^(edit|modify|change|rename)\s*/i, "").trim() || (c || "this item")} for editing.`],
      [/^(view|open|show|expand|preview)\b/i, (n, c) => `Opens ${n.replace(/^(view|open|show|expand|preview)\s*/i, "").trim() || (c || "this item")} for viewing.`],
      [/^(copy|duplicate|clone)\b/i, (n, c) => `Creates a copy of ${n.replace(/^(copy|duplicate|clone)\s*/i, "").trim() || (c || "this item")}.`],
      [/^(export|download)\b/i, (n, c) => `Exports ${n.replace(/^(export|download)\s*/i, "").trim() || (c || "data")} to a downloadable file.`],
      [/^(import|upload)\b/i, (n, c) => `Imports ${n.replace(/^(import|upload)\s*/i, "").trim() || "a file"} from your device.`],
      [/^(refresh|reload|sync)\b/i, (n, c) => `Reloads ${c || "the data"} with the latest information from the server.`],
      [/^(next|continue|proceed)\b/i, () => "Proceeds to the next step."],
      [/^(back|previous|prev)\b/i, () => "Returns to the previous step."],
      [/^(toggle|enable|disable|activate|deactivate)\b/i, (n, c) => `Toggles ${n.replace(/^(toggle|enable|disable|activate|deactivate)\s*/i, "").trim() || (c || "this feature")} on or off.`],
      [/^(invite|share|collaborate)\b/i, (n, c) => `Invites collaborators to ${c || "this workspace"}.`],
      [/^(assign|delegate)\b/i, (n, c) => `Assigns ${n.replace(/^(assign|delegate)\s*/i, "").trim() || "a task"}${c ? ` in ${c}` : ""}.`],
      [/^(approve|confirm|accept)\b/i, (n, c) => `Approves and confirms ${c || "this action"}.`],
      [/^(reject|decline|deny)\b/i, (n, c) => `Rejects or declines ${c || "this action"}.`],
      [/\b(settings|configure|preferences)\b/i, (n, c) => `Opens configuration settings${c ? ` for ${c}` : ""}.`],
      [/\b(help|learn more|docs|documentation)\b/i, () => "Opens the documentation or help guide for this feature."],
      [/\b(sign out|log out|logout|signout)\b/i, () => "Signs you out of the platform and returns you to the login screen."],
      [/\b(sign in|log in|login|signin)\b/i, () => "Signs you in to access the platform."],
      [/\b(profile|account|my account)\b/i, () => "Opens your account profile and personal settings."],
      [/\b(notification|alerts)\b/i, () => "Shows your pending notifications and alerts."],
      [/\b(menu|more options|options)\b/i, (n, c) => `Opens a context menu with additional actions${c ? ` for ${c}` : ""}.`],
    ];

    // 7. Action-verb → intent mapping for buttons and interactive controls
    let action = semanticEl.getAttribute("data-tutorial-action") || "";

    if (!action) {
      if (tag === "button" || role === "button" || role === "menuitem") {
        for (const [pattern, descFn] of ACTION_VERBS) {
          if (pattern.test(labelLower)) {
            action = descFn(labelLower, sectionContext);
            break;
          }
        }
        if (!action) {
          action = sectionContext
            ? `Performs the "${rawTitle.trim()}" action within the ${sectionContext} section.`
            : `Performs the "${rawTitle.trim()}" action.`;
        }
      } else if (tag === "a" || role === "link") {
        const nav = sectionContext ? ` in the ${sectionContext} section` : "";
        action = `Navigates to ${rawTitle.trim()}${nav}.`;
      } else if (tag === "input") {
        if (inputType === "checkbox") {
          action = `Enables or disables "${formLabel || rawTitle.trim()}"${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
        } else if (inputType === "radio") {
          action = `Selects "${formLabel || rawTitle.trim()}" as the active option.`;
        } else if (inputType === "range") {
          action = `Adjusts the ${formLabel || rawTitle.trim()} value using a slider.`;
        } else {
          const label = formLabel || placeholder || rawTitle.trim();
          action = `Type here to ${inputType === "search" ? "search for" : "enter"} ${label.toLowerCase()}${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
        }
      } else if (tag === "select") {
        const label = formLabel || rawTitle.trim();
        action = `Choose a ${label.toLowerCase()} from the dropdown${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
      } else if (tag === "textarea") {
        const label = formLabel || placeholder || rawTitle.trim();
        action = `Enter ${label.toLowerCase()}${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
      } else if (role === "tab") {
        action = `Switch to the ${rawTitle.trim()} view${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
      } else if (role === "checkbox" || role === "switch") {
        action = `Toggles ${rawTitle.trim()} ${role === "switch" ? "on or off" : ""}${sectionContext ? ` in the ${sectionContext} section` : ""}.`;
      } else if (role === "combobox") {
        action = `Select or type a ${rawTitle.trim()} value.`;
      }
    }

    // 8. Purpose / What the component does
    let description = semanticEl.getAttribute("data-tutorial-description") || "";
    if (!description) {
      if (authorDescription) {
        description = authorDescription;
      } else if (action) {
        // Compose purpose and action for backwards compatibility and full coverage
        const contextPrefix = sectionContext
          ? `Interactive ${isCompact ? "control" : "component"} in the ${sectionContext} section.`
          : `Interactive ${isCompact ? "control" : "component"}.`;
        description = `${action} ${contextPrefix}`.trim();
      } else if (testId) {
        description = sectionContext
          ? `${rawTitle.trim()} — component in the ${sectionContext} section.`
          : `${rawTitle.trim()} — interface component.`;
      }
    }

    if (!description && !action) return null;

    const adhocDef: TutorialDefinition = {
      id: `adhoc:semantic:${labelLower.replace(/[^a-z0-9]/g, "-").slice(0, 40)}`,
      name: title,
      steps: [{ target: semanticEl as any, title, description, action: action || undefined, scoreDimension: "S", side: "bottom" }],
    };
    return { def: adhocDef, anchorEl: semanticEl };
  }

  return null;
}



/**
 * Reads configured hover delay for the target element, supporting:
 * 1. data-tutorial-delay attribute on the element (e.g. data-tutorial-delay="3000")
 * 2. window.__ODDJOB_HOVER_TUTORIAL_DELAY_MS override (used in unit/e2e tests)
 * 3. Default: 3,000 ms (3 seconds)
 */
export function getHoverTutorialDelay(el?: HTMLElement | null): number {
  if (el) {
    const attr = el.getAttribute("data-tutorial-delay");
    if (attr) {
      const parsed = parseInt(attr, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
  }

  if (typeof window !== "undefined") {
    const globalOverride = (window as any).__ODDJOB_HOVER_TUTORIAL_DELAY_MS;
    if (typeof globalOverride === "number" && globalOverride >= 0) {
      return globalOverride;
    }
  }

  return DEFAULT_HOVER_TUTORIAL_DELAY_MS;
}

export interface HoverTutorialPreview {
  anchorEl: HTMLElement;
  title: string;
  description: string;
  action?: string;
  scoreDimension: ScoreDimension;
  side: "top" | "bottom" | "left" | "right";
  hint?: string;
  snippetId?: string;
  remainingSeconds: number;
  /** true once the countdown has elapsed or the user clicked "View Now" */
  triggered: boolean;
  triggerNow: () => void;
  dismiss: () => void;
}

/**
 * Global hover detector hook.
 * Attach this within TutorialHost so that any component hovered for >= 3s
 * automatically displays its info bubble, while providing a reactive countdown.
 */
export function useGlobalHoverTutorial(isTutorialActive: boolean): HoverTutorialPreview | null {
  const [preview, setPreview] = useState<HoverTutorialPreview | null>(null);
  const currentTargetRef = useRef<ResolvedTutorialTarget | null>(null);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(3);
  const shownElementsRef = useRef<WeakSet<HTMLElement>>(new WeakSet());

  /** Extracts display text from a resolved target */
  const resolveDisplayInfo = (target: ResolvedTutorialTarget): {
    title: string;
    description: string;
    action?: string;
    scoreDimension: ScoreDimension;
    side: "top" | "bottom" | "left" | "right";
    hint?: string;
  } => {
    if (target.def) {
      const step = target.def.steps[0];
      return {
        title: step?.title || target.def.name,
        description: step?.description || target.def.name,
        action: step?.action,
        scoreDimension: step?.scoreDimension || "S",
        side: step?.side || "bottom",
        hint: step?.hint,
      };
    }
    if (target.snippetId) {
      const snippet = TUTORIAL_SNIPPETS[target.snippetId];
      if (snippet) {
        const step = snippet.steps[0];
        return {
          title: snippet.title,
          description: step?.description || snippet.title,
          action: step?.action || snippet.action,
          scoreDimension: step?.scoreDimension || "S",
          side: step?.side || "bottom",
          hint: step?.hint || snippet.hint,
        };
      }
    }
    return { title: "Component Info", description: "", scoreDimension: "S", side: "bottom" };
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const clearAllTimers = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setPreview(null);
    };

    const triggerSnippet = (target: ResolvedTutorialTarget) => {
      clearAllTimers();
      shownElementsRef.current.add(target.anchorEl);
      console.log(`[HoverTutorial] 5s threshold reached, displaying info bubble for:`, target.snippetId || target.def?.name);

      const info = resolveDisplayInfo(target);
      setPreview({
        anchorEl: target.anchorEl,
        triggered: true,
        remainingSeconds: 0,
        snippetId: target.snippetId,
        triggerNow: () => {},
        dismiss: () => setPreview(null),
        ...info,
      });
    };

    const handleMouseOver = (event: MouseEvent) => {
      // Do not trigger a hover snippet if another tutorial is actively running
      if (isTutorialActive) {
        clearAllTimers();
        currentTargetRef.current = null;
        return;
      }

      const target = event.target as Element | null;
      if (target?.closest('[data-hover-tutorial="off"]')) {
        clearAllTimers();
        currentTargetRef.current = null;
        return;
      }
      const resolved = resolveTutorialForElement(target);

      if (!resolved) {
        // Pointer is outside any tutorial-eligible component
        if (currentTargetRef.current && !currentTargetRef.current.anchorEl.contains(target as Node)) {
          clearAllTimers();
          currentTargetRef.current = null;
        }
        return;
      }

      // If already tracking this exact anchor element, preserve the running timer
      if (currentTargetRef.current?.anchorEl === resolved.anchorEl) {
        return;
      }

      // Switched to a different component: reset timer
      clearAllTimers();

      // If this element already triggered a tutorial during this session, don't spam
      if (shownElementsRef.current.has(resolved.anchorEl)) {
        currentTargetRef.current = resolved;
        return;
      }

      currentTargetRef.current = resolved;
      const delay = getHoverTutorialDelay(resolved.anchorEl);
      const initialSeconds = Math.max(1, Math.ceil(delay / 1000));
      remainingRef.current = initialSeconds;

      const info = resolveDisplayInfo(resolved);

      setPreview({
        anchorEl: resolved.anchorEl,
        title: info.title,
        description: info.description,
        scoreDimension: info.scoreDimension,
        side: info.side,
        hint: info.hint,
        snippetId: resolved.snippetId,
        remainingSeconds: initialSeconds,
        triggered: false,
        triggerNow: () => triggerSnippet(resolved),
        dismiss: () => setPreview(null),
      });

      console.log(`[HoverTutorial] Hover started on component (delay: ${delay}ms):`, resolved.snippetId || resolved.def?.name);

      // Countdown ticker every second
      intervalRef.current = window.setInterval(() => {
        remainingRef.current = Math.max(0, remainingRef.current - 1);
        const secs = remainingRef.current;
        setPreview((prev) => (prev ? { ...prev, remainingSeconds: secs } : null));
      }, 1000);

      // Final display trigger
      timerRef.current = window.setTimeout(() => {
        const current = currentTargetRef.current;
        if (current && current.anchorEl.isConnected) {
          triggerSnippet(current);
        } else {
          clearAllTimers();
        }
      }, delay);
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (!currentTargetRef.current) return;

      const relatedTarget = event.relatedTarget as Node | null;
      // If moving to another node inside the same anchor element, keep timer alive
      if (relatedTarget && currentTargetRef.current.anchorEl.contains(relatedTarget)) {
        return;
      }

      // Pointer truly left the component
      clearAllTimers();
      currentTargetRef.current = null;
    };

    document.addEventListener("mouseover", handleMouseOver, { passive: true });
    document.addEventListener("mouseout", handleMouseOut, { passive: true });
    document.addEventListener("pointerover", handleMouseOver as EventListener, { passive: true });
    document.addEventListener("pointerout", handleMouseOut as EventListener, { passive: true });

    return () => {
      clearAllTimers();
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("pointerover", handleMouseOver as EventListener);
      document.removeEventListener("pointerout", handleMouseOut as EventListener);
    };
  }, [isTutorialActive]);

  return preview;
}
