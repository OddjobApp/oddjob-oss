/** @vitest-environment jsdom */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECORDER_SCRIPT, type RecordedStep } from "./skill-recorder.js";

// Runs the exact script injected into the desktop browser, in jsdom, and captures what it
// would send to Oddjob.
const sent: Array<Omit<RecordedStep, "at" | "url">> = [];

// Installed once, as in a page: listeners live on `document`, which outlives each test's DOM.
beforeAll(() => {
    (window as any).__oddjobRecordStep = (step: any) => sent.push(step);
    // eslint-disable-next-line no-new-func
    new Function(RECORDER_SCRIPT)();
});

beforeEach(() => {
    sent.length = 0;
    document.body.innerHTML = `
        <form>
          <label for="email">Email</label><input id="email" name="email" type="email">
          <label for="pw">Password</label><input id="pw" name="password" type="password">
          <input id="code" name="otp_code" autocomplete="one-time-code">
          <input name="cardnumber" autocomplete="cc-number">
          <input id="q" type="search" placeholder="Search Wikipedia">
          <select id="lang" aria-label="Language"><option value="en">English</option><option value="fr">French</option></select>
          <input id="remember" type="checkbox" aria-label="Remember me">
          <button type="submit" data-testid="sign-in">Sign in</button>
          <a href="/help" id="help-link-123456">Help</a>
        </form>`;
});

function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("recorder script", () => {
    it("records what was typed into ordinary fields, with a locator a replay can find", () => {
        type(document.getElementById("email") as HTMLInputElement, "ada@example.com");
        expect(sent).toEqual([{
            kind: "fill",
            value: "ada@example.com",
            target: expect.objectContaining({ tag: "input", id: "email", role: "textbox", label: "Email", nameAttr: "email", inputType: "email" }),
        }]);
    });

    it("never sends the value of a password, one-time-code or card field", () => {
        type(document.getElementById("pw") as HTMLInputElement, "hunter2-secret");
        type(document.getElementById("code") as HTMLInputElement, "123456");
        type(document.querySelector("[name=cardnumber]") as HTMLInputElement, "4111111111111111");
        expect(sent.map((s) => s.secret)).toEqual(["password", "otp", "payment"]);
        expect(JSON.stringify(sent)).not.toMatch(/hunter2|123456|4111/);
        expect(sent.every((s) => !("value" in s))).toBe(true);
    });

    it("flushes a field before Enter, since Enter can submit before 'change' fires", () => {
        const q = document.getElementById("q") as HTMLInputElement;
        q.focus();
        q.value = "Honolulu";
        q.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(sent.map((s) => s.kind)).toEqual(["fill", "press"]);
        expect(sent[0]).toMatchObject({ value: "Honolulu", target: { placeholder: "Search Wikipedia", role: "searchbox" } });
        expect(sent[1]).toMatchObject({ key: "Enter" });
    });

    it("ignores the synthetic submit-button click that Enter in a form produces", () => {
        const q = document.getElementById("q") as HTMLInputElement;
        q.focus();
        q.value = "Honolulu";
        q.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        // What the browser does next for implicit submission:
        document.querySelector<HTMLButtonElement>("[data-testid=sign-in]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(sent.map((s) => s.kind)).toEqual(["fill", "press"]);
    });

    it("records selects, checkboxes and clicks, but not clicks that only focus a field", () => {
        const lang = document.getElementById("lang") as HTMLSelectElement;
        lang.value = "fr";
        lang.dispatchEvent(new Event("change", { bubbles: true }));
        const remember = document.getElementById("remember") as HTMLInputElement;
        remember.click(); // fires click (ignored for checkboxes) and change
        (document.getElementById("email") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.querySelector<HTMLButtonElement>("[data-testid=sign-in]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(sent.map((s) => s.kind)).toEqual(["select", "check", "click"]);
        expect(sent[0]).toMatchObject({ value: "fr", target: { name: "Language" } });
        expect(sent[1]).toMatchObject({ checked: true, target: { name: "Remember me", role: "checkbox" } });
        expect(sent[2]).toMatchObject({ target: { testId: "sign-in", role: "button", name: "Sign in" } });
    });

    it("drops generated-looking ids so replays do not depend on them", () => {
        document.getElementById("help-link-123456")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(sent[0].target).toMatchObject({ role: "link", text: "Help" });
        expect(sent[0].target!.id).toBeUndefined();
    });

    it("installs once per page", () => {
        new Function(RECORDER_SCRIPT)();
        type(document.getElementById("email") as HTMLInputElement, "x@y.z");
        expect(sent).toHaveLength(1);
    });
});
