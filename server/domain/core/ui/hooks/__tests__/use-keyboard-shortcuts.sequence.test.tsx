import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const setLocation = vi.fn();
vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useLocation: () => ["/armory/forms", setLocation],
}));

import { useGlobalKeyboardShortcuts } from "../use-keyboard-shortcuts";

/**
 * "g" then a letter navigates. In a live check, text that reached the page rather
 * than a field ("…data-handling audit…") left "g" armed across the space, and the
 * "a" of "audit" opened the assistant, closing the dialog being filled in.
 */

const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

beforeEach(() => {
  setLocation.mockReset();
  document.body.innerHTML = "";
  press("x"); // clear any sequence left armed by the previous test
});

describe("g navigation sequences", () => {
  it("navigates on g followed directly by a", () => {
    renderHook(() => useGlobalKeyboardShortcuts());
    press("g");
    press("a");
    expect(setLocation).toHaveBeenCalledWith("/assistant/workbench");
  });

  it("does not navigate when another key comes between g and a", () => {
    renderHook(() => useGlobalKeyboardShortcuts());
    for (const key of "handling audit") press(key);
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("does not navigate while a dialog is open", () => {
    renderHook(() => useGlobalKeyboardShortcuts());
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    press("g");
    press("a");
    expect(setLocation).not.toHaveBeenCalled();
  });
});
