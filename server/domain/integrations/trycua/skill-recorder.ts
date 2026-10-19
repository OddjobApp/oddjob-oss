/**
 * Records a person's actions in the desktop's Chromium as page-level steps, over the
 * DevTools protocol (Playwright connectOverCDP). This is the "dual control" half of
 * computer use: when a task hands control to a person, what they do can become a skill.
 *
 * What is captured: clicks, text entry (as the field's final value), selects, checkboxes,
 * Enter/Escape/Tab key presses, and top-level navigations. Each element is described the
 * way Playwright locates things (test id, role + accessible name, label, placeholder, ...)
 * with a CSS path as the last resort, so replay survives layout changes.
 *
 * What is never captured: the value of a password, one-time-code or payment field. Such
 * a step is stored as a secret slot ({ secret: "password" }) with no value, and replay
 * hands control back to a person there.
 */
import { chromium, type Browser, type Page } from "playwright";

export type StepKind = "navigate" | "click" | "fill" | "select" | "check" | "press" | "wait" | "extract";
export type SecretKind = "password" | "otp" | "payment";

export interface TargetDescriptor {
    tag: string;
    testId?: string;
    id?: string;
    role?: string;
    name?: string;
    label?: string;
    placeholder?: string;
    nameAttr?: string;
    text?: string;
    inputType?: string;
    css: string;
}

export interface RecordedStep {
    kind: StepKind;
    /** Page URL when the step happened (the destination, for navigate). */
    url: string;
    target?: TargetDescriptor;
    /** fill/select value, or a {{input}} template after synthesis. Absent for secrets. */
    value?: string;
    checked?: boolean;
    secret?: SecretKind;
    key?: string;
    /** navigate only: true when no click/key in the page just before caused it (typed URL, bookmark). */
    direct?: boolean;
    /** ms since the recording started. */
    at: number;
    output?: string;
    extractMode?: "text" | "attribute" | "structured_json" | "table" | "url";
    attribute?: string;
}

/** Connects Playwright to the desktop Chromium. The DevTools host is loopback-only. */
export async function connectDesktopBrowser(cdpHost: string): Promise<Browser> {
    const res = await fetch(`http://${cdpHost}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Desktop browser DevTools endpoint answered HTTP ${res.status}`);
    const ws = new URL(((await res.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl);
    ws.host = cdpHost; // Chrome reports its in-container port; we reach it through the relay
    return chromium.connectOverCDP(ws.toString(), { timeout: 15_000 });
}


const BINDING = "__oddjobRecordStep";

/**
 * Runs in every page. Kept dependency-free and defensive: it must never break the page.
 * Exported for tests (evaluated in jsdom-free unit tests via describeTarget below).
 */
export const RECORDER_SCRIPT = `(() => {
  if (window.__oddjobRecorderInstalled) return;
  window.__oddjobRecorderInstalled = true;
  const send = (step) => { try { if (typeof window.${BINDING} === "function") window.${BINDING}(step); } catch (e) {} };
  const SECRET_AUTOCOMPLETE = { "current-password": "password", "new-password": "password", "one-time-code": "otp",
    "cc-number": "payment", "cc-csc": "payment", "cc-exp": "payment", "cc-exp-month": "payment", "cc-exp-year": "payment" };
  const secretKind = (el) => {
    if (!el || !el.tagName) return undefined;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return "password";
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (SECRET_AUTOCOMPLETE[ac]) return SECRET_AUTOCOMPLETE[ac];
    const hint = ((el.name || "") + " " + (el.id || "")).toLowerCase();
    if (/otp|totp|2fa|mfa|one.?time|verification.?code|passcode|security.?code/.test(hint)) return "otp";
    if (/card.?number|cvv|cvc|ccnum/.test(hint)) return "payment";
    return undefined;
  };
  const text = (s) => (s || "").replace(/\\s+/g, " ").trim().slice(0, 80) || undefined;
  const visible = (n) => (n ? n.innerText || n.textContent : undefined); // innerText can be missing (jsdom)
  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (["submit", "button", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["text", "email", "search", "tel", "url", "password", "number"].includes(type)) return type === "search" ? "searchbox" : "textbox";
    }
    return undefined;
  };
  const labelOf = (el) => {
    if (el.labels && el.labels.length) return text(visible(el.labels[0]));
    const by = el.getAttribute("aria-labelledby");
    if (by) { const l = document.getElementById(by.split(" ")[0]); if (l) return text(visible(l)); }
    return undefined;
  };
  const accessibleName = (el) => text(el.getAttribute("aria-label")) || labelOf(el) || text(el.getAttribute("alt"))
    || text(el.getAttribute("title")) || (["button", "link"].includes(implicitRole(el) || el.getAttribute("role")) ? text(visible(el) || el.value) : undefined);
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 5 && n !== document.body; n = n.parentElement) {
      let part = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const stableId = (id) => id && /^[A-Za-z][\\w-]{1,40}$/.test(id) && !/\\d{4,}/.test(id) && !/^(ember|react|radix|mui|headlessui)/i.test(id) ? id : undefined;
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    testId: el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa") || undefined,
    id: stableId(el.id),
    role: el.getAttribute("role") || implicitRole(el),
    name: accessibleName(el),
    label: labelOf(el),
    placeholder: text(el.getAttribute("placeholder")),
    nameAttr: el.getAttribute("name") || undefined,
    text: ["a", "button"].includes(el.tagName.toLowerCase()) ? text(visible(el)) : undefined,
    inputType: el.tagName.toLowerCase() === "input" ? (el.getAttribute("type") || "text").toLowerCase() : undefined,
    css: cssPath(el),
  });
  const actionable = (el) => el && el.closest ? el.closest("a,button,input,select,textarea,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[onclick]") || el : el;
  const isTextField = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "submit", "button", "reset", "image", "file", "hidden"].includes((el.getAttribute("type") || "text").toLowerCase())) || el.isContentEditable);
  const lastFilled = new WeakMap();
  // Enter in a form makes the browser fire a synthetic click on its submit button
  // ("implicit submission"). That click is not a step: replaying it would click whatever
  // sits there on the next page.
  let lastEnter = { at: 0, form: null };
  const isImplicitSubmit = (el) => el && el.form && el.form === lastEnter.form && Date.now() - lastEnter.at < 1000
    && ((el.tagName === "BUTTON" && (el.getAttribute("type") || "submit").toLowerCase() === "submit")
      || (el.tagName === "INPUT" && ["submit", "image"].includes((el.getAttribute("type") || "").toLowerCase())));
  const flushFill = (el) => {
    if (!isTextField(el)) return;
    const value = el.isContentEditable ? visible(el) : el.value;
    if (lastFilled.get(el) === value) return;
    lastFilled.set(el, value);
    const secret = secretKind(el);
    send(secret ? { kind: "fill", target: describe(el), secret } : { kind: "fill", target: describe(el), value });
  };
  document.addEventListener("click", (e) => {
    const el = actionable(e.target);
    if (!el || !el.tagName || isTextField(el)) return; // focusing a field is part of the fill
    if (el.tagName === "INPUT" && ["checkbox", "radio"].includes((el.getAttribute("type") || "").toLowerCase())) return; // change handles it
    if (isImplicitSubmit(el)) return;
    send({ kind: "click", target: describe(el) });
  }, true);
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    if (el.tagName === "SELECT") send({ kind: "select", target: describe(el), value: el.value });
    else if (el.tagName === "INPUT" && ["checkbox", "radio"].includes((el.getAttribute("type") || "").toLowerCase())) send({ kind: "check", target: describe(el), checked: !!el.checked });
    else flushFill(el);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!["Enter", "Escape", "Tab"].includes(e.key)) return;
    const el = document.activeElement;
    if (isTextField(el)) flushFill(el); // Enter may submit before "change" fires
    if (e.key === "Enter") lastEnter = { at: Date.now(), form: el && el.form ? el.form : null };
    send({ kind: "press", key: e.key, target: el && el !== document.body ? describe(el) : undefined });
  }, true);
})();`;

export interface RecorderHandle {
    steps: RecordedStep[];
    stop(): Promise<RecordedStep[]>;
}

/**
 * Attaches to the running desktop browser and records until stop(). The browser keeps
 * running after stop(): Playwright only disconnects from a connectOverCDP browser.
 */
export async function startRecorder(cdpHost: string, onStep?: (step: RecordedStep) => void): Promise<RecorderHandle> {
    const browser = await connectDesktopBrowser(cdpHost);
    const context = browser.contexts()[0];
    if (!context) {
        await browser.close();
        throw new Error("The desktop browser has no open context to record");
    }

    const steps: RecordedStep[] = [];
    const startedAt = Date.now();
    let lastInteractionAt = 0;
    const push = (step: Omit<RecordedStep, "at">) => {
        const full = { ...step, at: Date.now() - startedAt } as RecordedStep;
        steps.push(full);
        onStep?.(full);
    };

    await context.exposeBinding(BINDING, (source, raw: Omit<RecordedStep, "at" | "url">) => {
        if (!raw || typeof raw !== "object" || typeof (raw as RecordedStep).kind !== "string") return;
        lastInteractionAt = Date.now();
        const step = raw as RecordedStep;
        // Defence in depth: never keep a value for a field the page flagged as secret.
        if (step.secret) delete step.value;
        push({ ...step, url: source.page?.url() ?? "" });
    });
    await context.addInitScript(RECORDER_SCRIPT);

    const watch = (page: Page) => {
        page.on("framenavigated", (frame) => {
            if (frame !== page.mainFrame()) return;
            const url = frame.url();
            if (!/^https?:/i.test(url)) return;
            const prev = steps[steps.length - 1];
            if (prev?.kind === "navigate" && prev.url === url) return;
            push({ kind: "navigate", url, direct: Date.now() - lastInteractionAt > 3000 });
        });
        // Pages already open when recording starts do not get init scripts until they navigate.
        page.evaluate(RECORDER_SCRIPT).catch(() => undefined);
    };
    context.pages().forEach(watch);
    context.on("page", watch);

    // No guess at "the tab the person is on": under the desktop's virtual display every tab
    // reports visible and focused, and /json/list is not in recency order. cleanSteps adds a
    // navigation to wherever the first interaction happened instead.

    return {
        steps,
        async stop() {
            context.off("page", watch);
            // Pages keep the listeners until they navigate, but the binding disappears with
            // the connection, so they go quiet.
            await browser.close().catch(() => undefined);
            return steps;
        },
    };
}
